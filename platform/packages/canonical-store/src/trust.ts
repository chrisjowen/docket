// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from '@docket/platform-tenancy'

import {
  aggregate,
  confidenceModel,
  findPerson,
  readCanonical,
  validateDocuments,
  type CanonicalSource,
  type ConfidenceModel,
  type Ontology,
  type PeopleDirectory,
  type SourceRegistry,
  type SourceTypeDefinition,
  type ValidateResult,
} from './docket.js'
import type { StoreContext } from './documents.js'
import { enqueue } from './workspaces.js'

/**
 * Trust set by policy: confidence comes from the ontology's policies about
 * sources, and a policy can test only what is attested about a source - never
 * what a writer claims, unless the source type lets the writer set it. Three
 * things attest, all per org, since a lead is a lead in every workspace:
 *
 * - the people directory: each member's role, team and flags, set by an owner
 *   or admin (`member_attributes`), for the ontology's identity sources;
 * - GitHub: each connected repository's visibility and branch protection,
 *   read at every sync, for source attributes marked `setBy: connection`;
 * - the source registry: instances an owner or admin registers, such as a
 *   document by its URL with its status, for attributes marked
 *   `setBy: registry`.
 */

/** A value the directory or the registry attests: what a policy condition compares with. */
export type AttestedValue = string | number | boolean | (string | number | boolean)[]
export type Attested = Record<string, AttestedValue>

/** A member as the people directory knows them. */
export interface DirectoryPerson {
  userId: string
  login: string
  name: string | null
  attributes: Attested
  updatedBy: string
  updatedAt: Date
}

/** A source instance the org has registered. */
export interface RegisteredSource {
  source: string
  instance: string
  attributes: Attested
  updatedBy: string
  updatedAt: Date
}

/** A connected repository and what GitHub says about it. */
export interface ConnectedRepository {
  fullName: string
  attributes: Attested
}

/** Everything the org attests about sources, read once per pass. */
export interface OrgTrust {
  people: PeopleDirectory
  registry: RegisteredSource[]
  repositories: ConnectedRepository[]
}

export const NO_TRUST: OrgTrust = { people: { people: {} }, registry: [], repositories: [] }

/** At most this many attributes on one person or source instance. */
export const MAX_ATTRIBUTES = 20
const ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/
const SOURCE_NAME = /^[A-Za-z0-9_-]{1,64}$/

export class TrustError extends Error {
  override name = 'TrustError'
  constructor(
    readonly code: 'invalid' | 'not-found',
    message: string,
  ) {
    super(message)
  }
}

const scalar = (value: unknown): value is string | number | boolean =>
  (typeof value === 'string' && value.length <= 200) || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean'

/** Attributes as given, checked: names a policy can name, scalar values or lists of them. Throws `TrustError` for anything else. */
export function attestedAttributes(raw: unknown): Attested {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new TrustError('invalid', 'Attributes are an object of names and values.')
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > MAX_ATTRIBUTES) throw new TrustError('invalid', `At most ${MAX_ATTRIBUTES} attributes.`)
  const out: Attested = {}
  for (const [name, value] of entries) {
    if (!ATTRIBUTE_NAME.test(name)) throw new TrustError('invalid', `"${name}" is not an attribute name: letters, digits, _ and -, starting with a letter.`)
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue
    if (Array.isArray(value)) {
      if (value.length > 20 || !value.every(scalar)) throw new TrustError('invalid', `${name}: a list of at most 20 strings, numbers or booleans.`)
      out[name] = value
    } else if (scalar(value)) out[name] = value
    else throw new TrustError('invalid', `${name}: a string, number, boolean or a list of them.`)
  }
  return out
}

/** A repository as a source instance names it: `owner/name`, from a URL, an SSH remote or the name itself, in lower case. */
export function repositoryKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/|git@)?(?:www\.)?github\.com[/:]/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
}

// --- Reading --------------------------------------------------------------------

type PersonRow = { user_id: string; login: string; name: string | null; attributes: Attested; updated_by: string; updated_at: Date }
type RegistryRow = { source: string; instance: string; attributes: Attested; updated_by: string; updated_at: Date }

const personOf = (row: PersonRow): DirectoryPerson => ({
  userId: row.user_id,
  login: row.login,
  name: row.name,
  attributes: row.attributes,
  updatedBy: row.updated_by,
  updatedAt: row.updated_at,
})

/** Every member the directory says something about, by login. */
export async function listPeople(ctx: Pick<StoreContext, 'tx'>): Promise<DirectoryPerson[]> {
  const { rows } = await ctx.tx.query<PersonRow>('SELECT * FROM member_attributes ORDER BY lower(login)')
  return rows.map(personOf)
}

/**
 * The people directory as docket scores person sources by: each member by
 * their login, also known as `user:<id>`, with what the org attests about them.
 */
export function directoryOf(people: readonly DirectoryPerson[]): PeopleDirectory {
  return {
    people: Object.fromEntries(
      people.map((person) => [person.login, { ...(person.name ? { name: person.name } : {}), aliases: [`user:${person.userId}`], attributes: person.attributes }]),
    ),
  }
}

/** The org's people directory. */
export async function peopleDirectory(ctx: Pick<StoreContext, 'tx'>): Promise<PeopleDirectory> {
  return directoryOf(await listPeople(ctx))
}

/** Every source instance the org has registered. */
export async function listRegistry(ctx: Pick<StoreContext, 'tx'>, source?: string): Promise<RegisteredSource[]> {
  const { rows } = await ctx.tx.query<RegistryRow>(
    source === undefined ? 'SELECT * FROM source_registry ORDER BY source, instance' : 'SELECT * FROM source_registry WHERE source = $1 ORDER BY instance',
    source === undefined ? [] : [source],
  )
  return rows.map((row) => ({ source: row.source, instance: row.instance, attributes: row.attributes, updatedBy: row.updated_by, updatedAt: row.updated_at }))
}

/** Every repository connected to a workspace of the org, with what its last sync read from GitHub. */
export async function connectedRepositories(ctx: Pick<StoreContext, 'tx'>): Promise<ConnectedRepository[]> {
  const { rows } = await ctx.tx.query<{ repo_full_name: string; visibility: string | null; branch_protected: boolean | null }>(
    `SELECT DISTINCT ON (lower(repo_full_name)) repo_full_name, visibility, branch_protected FROM repo_connections
      WHERE disconnected_at IS NULL ORDER BY lower(repo_full_name), attributes_synced_at DESC NULLS LAST`,
  )
  return rows.map((row) => ({
    fullName: row.repo_full_name,
    attributes: {
      ...(row.visibility !== null ? { visibility: row.visibility } : {}),
      ...(row.branch_protected !== null ? { branch_protected: row.branch_protected } : {}),
    },
  }))
}

/** What the org attests about sources, in the caller's transaction, one query at a time. */
export async function orgTrust(ctx: Pick<StoreContext, 'tx'>): Promise<OrgTrust> {
  const people = await peopleDirectory(ctx)
  const registry = await listRegistry(ctx)
  const repositories = await connectedRepositories(ctx)
  return { people, registry, repositories }
}

/** A fingerprint of what the org attests, for caches of scored reads. */
export const TRUST_FINGERPRINT_SQL = `json_build_array(
  (SELECT json_agg(json_build_array(user_id, login, attributes) ORDER BY user_id) FROM member_attributes),
  (SELECT json_agg(json_build_array(source, instance, attributes) ORDER BY source, instance) FROM source_registry),
  (SELECT json_agg(json_build_array(repo_full_name, visibility, branch_protected) ORDER BY id) FROM repo_connections WHERE disconnected_at IS NULL)
)`

// --- Scoring --------------------------------------------------------------------

/**
 * The org's attestations as a registry for one ontology's sources: the people
 * directory for its identity sources, and for the rest what GitHub says about
 * a connected repository (attributes the source marks `setBy: connection`)
 * and what the registry says about a registered instance (`setBy: registry`).
 * A source type only ever sees the attributes it declares, set by whom it says.
 */
export function sourceRegistry(trust: OrgTrust, sources: Readonly<Record<string, SourceTypeDefinition>>, people: SourceRegistry): SourceRegistry {
  const registered = new Map(trust.registry.map((entry) => [`${entry.source}\u0000${entry.instance}`, entry.attributes]))
  const repositories = new Map(trust.repositories.map((repository) => [repositoryKey(repository.fullName), repository.attributes]))
  return {
    attributes(source, instance) {
      const definition = sources[source]
      if (!definition) return undefined
      if (definition.kind === 'identity') return people.attributes(source, instance)
      const declared = definition.attributes ?? {}
      const out: Attested = {}
      const take = (values: Attested | undefined, setBy: 'connection' | 'registry') => {
        for (const [name, value] of Object.entries(values ?? {})) if (declared[name]?.setBy === setBy) out[name] = value
      }
      take(repositories.get(repositoryKey(instance)), 'connection')
      take(registered.get(`${source}\u0000${instance}`), 'registry')
      return Object.keys(out).length ? out : undefined
    },
    instance: (source, name) => people.instance?.(source, name),
  }
}

/** The workspace's confidence model: its ontology's policies over what the org attests. */
export function trustModel(ontology: Ontology, trust: OrgTrust = NO_TRUST): ConfidenceModel {
  // docket's model reads the people directory for the identity sources; the rest is the cloud's.
  const model = confidenceModel(ontology, { people: trust.people })
  return { ...model, registry: sourceRegistry(trust, model.sources, model.registry) }
}

/** The person a name means in the directory - a login, `user:<id>`, an alias - or undefined. */
export const directoryPerson = (trust: OrgTrust, name: string): string | undefined => findPerson(trust.people, name)

/**
 * A canonical source that also says what the org attests about sources.
 * `postgresSource` is one; a source without `trust` is scored with nothing
 * attested, as docket scores a project with no people file.
 */
export interface TrustedSource extends CanonicalSource {
  trust?(): Promise<OrgTrust>
}

const errorPaths = (diagnostics: ValidateResult['diagnostics']) =>
  diagnostics.flatMap((d) => (d.severity === 'error' && d.path !== undefined ? [d.path] : []))

/**
 * docket's `validate`, scoring with everything the org attests: one read-only
 * pass that loads the ontology, validates every document and merges them one
 * per id with confidence computed. docket's own scores person sources by the
 * people directory alone; the cloud's registry adds what GitHub and the
 * source registry attest. The rest is docket's, unchanged.
 */
export async function validate(options: { source: TrustedSource }): Promise<ValidateResult> {
  const { source } = options
  const { documents, diagnostics: read, files, ontology: loaded, people } = await readCanonical(source)
  const diagnostics = [...read, ...loaded.diagnostics]
  const result: ValidateResult = { resolved: source.resolved, ontology: loaded.ontology, documents, entities: [], broken: new Set(errorPaths(diagnostics)), diagnostics, files, people }
  if (!loaded.ontology) return result
  diagnostics.push(...validateDocuments(documents, loaded.ontology, { strict: false }))
  const broken = new Set(errorPaths(diagnostics))
  const trust = (await source.trust?.()) ?? { ...NO_TRUST, people }
  const merged = aggregate(
    documents.filter((document) => !broken.has(document.path)),
    trustModel(loaded.ontology, trust),
  )
  diagnostics.push(...merged.diagnostics)
  return { ...result, entities: merged.entities, broken: new Set(errorPaths(diagnostics)) }
}

// --- Writing --------------------------------------------------------------------

/**
 * Re-scores every live workspace of the org after what it attests changed:
 * the worker projects confidence again. Pending supersede proposals are
 * scored again by the caller (`promoteProposals`), workspace by workspace.
 */
export async function trustChanged(tx: Tx): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM workspaces WHERE deleted_at IS NULL ORDER BY id')
  for (const { id } of rows) await enqueue(tx, id, 'trust')
  return rows.map((row) => row.id)
}

/**
 * Sets what the directory attests about a member, replacing what it said; no
 * attributes removes them from the directory. Their login and name are kept
 * beside it, as evidence names people by login.
 */
export async function setMemberAttributes(
  ctx: Pick<StoreContext, 'tx'>,
  input: { userId: string; login: string; name?: string | null; attributes: unknown; actor: string },
): Promise<DirectoryPerson | null> {
  const attributes = attestedAttributes(input.attributes)
  if (Object.keys(attributes).length === 0) {
    await ctx.tx.query('DELETE FROM member_attributes WHERE user_id = $1', [input.userId])
    return null
  }
  const { rows } = await ctx.tx.query<PersonRow>(
    `INSERT INTO member_attributes (user_id, login, name, attributes, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET login = EXCLUDED.login, name = EXCLUDED.name, attributes = EXCLUDED.attributes,
       updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [input.userId, input.login, input.name ?? null, JSON.stringify(attributes), input.actor],
  )
  return personOf(rows[0] as PersonRow)
}

/** Drops a member from the directory: when they leave the org. */
export async function removeMemberAttributes(ctx: Pick<StoreContext, 'tx'>, userId: string): Promise<boolean> {
  const { rowCount } = await ctx.tx.query('DELETE FROM member_attributes WHERE user_id = $1', [userId])
  return (rowCount ?? 0) > 0
}

/** Registers a source instance with what the org attests about it, replacing what it said. */
export async function registerSource(
  ctx: Pick<StoreContext, 'tx'>,
  input: { source: string; instance: string; attributes: unknown; actor: string },
): Promise<RegisteredSource> {
  const source = input.source.trim()
  const instance = input.instance.trim()
  if (!SOURCE_NAME.test(source)) throw new TrustError('invalid', 'Name the source type as the ontology does: letters, digits, _ and -.')
  if (!instance || instance.length > 2000) throw new TrustError('invalid', 'Name the instance - a document URL, say - in at most 2000 characters.')
  const attributes = attestedAttributes(input.attributes)
  const { rows } = await ctx.tx.query<RegistryRow>(
    `INSERT INTO source_registry (source, instance, attributes, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (source, instance) DO UPDATE SET attributes = EXCLUDED.attributes, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [source, instance, JSON.stringify(attributes), input.actor],
  )
  const row = rows[0] as RegistryRow
  return { source: row.source, instance: row.instance, attributes: row.attributes, updatedBy: row.updated_by, updatedAt: row.updated_at }
}

/** Removes a registered source instance. Throws `TrustError('not-found')` when it was not registered. */
export async function unregisterSource(ctx: Pick<StoreContext, 'tx'>, input: { source: string; instance: string }): Promise<void> {
  const { rowCount } = await ctx.tx.query('DELETE FROM source_registry WHERE source = $1 AND instance = $2', [input.source.trim(), input.instance.trim()])
  if (!rowCount) throw new TrustError('not-found', 'That source instance is not registered.')
}

/** Records what GitHub said about a connected repository at a sync; what it did not say is left as it was. Whether anything changed. */
export async function recordRepositoryAttributes(
  ctx: Pick<StoreContext, 'tx'>,
  connectionId: string,
  attributes: { visibility: 'public' | 'private' | null; branchProtected: boolean | null },
): Promise<boolean> {
  const { rows } = await ctx.tx.query<{ changed: boolean }>(
    `WITH was AS (SELECT id, visibility, branch_protected FROM repo_connections WHERE id = $1 FOR UPDATE)
     UPDATE repo_connections r SET visibility = coalesce($2, was.visibility), branch_protected = coalesce($3, was.branch_protected), attributes_synced_at = now()
       FROM was WHERE r.id = was.id
     RETURNING (was.visibility IS DISTINCT FROM coalesce($2, was.visibility) OR was.branch_protected IS DISTINCT FROM coalesce($3, was.branch_protected)) AS changed`,
    [connectionId, attributes.visibility, attributes.branchProtected],
  )
  return Boolean(rows[0]?.changed)
}
