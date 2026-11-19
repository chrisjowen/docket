import { hashContent, parseOntology, readCanonical } from '../docket.js'
import { checkDraft as checkSnapshot, evaluateDraft, needsAcceptance, parseDraft, type CheckResult, type Disposed, type Disposition, type DraftCheck, type Evaluation, type WorkspaceSnapshot } from '../ontology/check.js'
import { OntologyBreakingChange, OntologyNarrowingChange, OntologyWriteDisabled, StaleDraft, VersionNotFound } from '../ontology/errors.js'
import type { Migration } from '../ontology/migrations.js'
import { proposedText, type Proposal } from '../ontology/propose.js'
import { template, type TemplateId } from '../ontology/templates.js'
import { importYaml } from '../ontology/yaml-io.js'
import type { Role } from '../auth/roles.js'
import type { Ontology } from '../docket.js'
import type { StoreContext, Tx } from '../ports.js'
import type { Writer } from '../write/inputs.js'
import { listDocuments, putDocument, readDocuments, type DocumentRecord } from './documents.js'
import { recordIngest } from './ingest.js'
import { postgresSource, publishedOntology } from './source.js'
import { insertWorkspace, ontologyMcpRoles, workspaceById, enqueue, type Workspace } from './workspaces.js'
import { lockOntologyHead } from './write.js'

/**
 * A workspace's ontology as the store keeps it: drafts and numbered published
 * versions, never rewritten, each published through the change check, with a
 * migration's rewrites of server documents and the publisher's dispositions
 * recorded with it.
 */

/** One row of a workspace's ontology history. */
export interface OntologyVersion {
  id: string
  workspaceId: string
  /** Null until published. */
  number: number | null
  parentNumber: number | null
  status: 'draft' | 'published' | 'discarded'
  yaml: string
  yamlHash: string
  message: string | null
  /** template:<id>, import, copy:<workspace>, editor, rollback:v<n>. */
  source: string
  author: string
  createdAt: Date
  updatedAt: Date
  publishedAt: Date | null
  publishedBy: string | null
  checkResult: CheckResult | null
  migration: Migration[] | null
  /** What the publisher decided for each resource a breaking change left unknown. */
  dispositions: Disposed[] | null
}

/** Who publishes: the audit actor, and the login the migration evidence names. */
export interface Publisher {
  actor: string
  login: string
}

type VersionRow = {
  id: string
  workspace_id: string
  number: number | null
  parent_number: number | null
  status: OntologyVersion['status']
  yaml: string
  yaml_hash: string
  message: string | null
  source: string
  author: string
  created_at: Date
  updated_at: Date
  published_at: Date | null
  published_by: string | null
  check_result: CheckResult | null
  migration: Migration[] | null
  dispositions: Disposed[] | null
}

const toVersion = (row: VersionRow): OntologyVersion => ({
  id: row.id,
  workspaceId: row.workspace_id,
  number: row.number,
  parentNumber: row.parent_number,
  status: row.status,
  yaml: row.yaml,
  yamlHash: row.yaml_hash,
  message: row.message,
  source: row.source,
  author: row.author,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  publishedAt: row.published_at,
  publishedBy: row.published_by,
  checkResult: row.check_result,
  migration: row.migration,
  dispositions: row.dispositions
})

/** The workspace's published head, or null before its first publish. */
export async function headOf(tx: Tx, workspaceId: string): Promise<OntologyVersion | null> {
  const { rows } = await tx.query<VersionRow>(`SELECT * FROM ontology_versions WHERE workspace_id = $1 AND status = 'published' ORDER BY number DESC LIMIT 1`, [workspaceId])
  return rows[0] ? toVersion(rows[0]) : null
}

/** Every published version, newest first. */
export async function listPublished(tx: Tx, workspaceId: string): Promise<OntologyVersion[]> {
  const { rows } = await tx.query<VersionRow>(`SELECT * FROM ontology_versions WHERE workspace_id = $1 AND status = 'published' ORDER BY number DESC`, [workspaceId])
  return rows.map(toVersion)
}

/** Open drafts, most recently changed first. */
export async function listDrafts(tx: Tx, workspaceId: string): Promise<OntologyVersion[]> {
  const { rows } = await tx.query<VersionRow>(`SELECT * FROM ontology_versions WHERE workspace_id = $1 AND status = 'draft' ORDER BY updated_at DESC`, [workspaceId])
  return rows.map(toVersion)
}

export async function versionByNumber(tx: Tx, workspaceId: string, number: number): Promise<OntologyVersion | null> {
  if (!Number.isInteger(number) || number < 1 || number > 2 ** 31 - 1) return null
  const { rows } = await tx.query<VersionRow>('SELECT * FROM ontology_versions WHERE workspace_id = $1 AND number = $2', [workspaceId, number])
  return rows[0] ? toVersion(rows[0]) : null
}

export async function versionById(tx: Tx, workspaceId: string, id: string): Promise<OntologyVersion | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  const { rows } = await tx.query<VersionRow>('SELECT * FROM ontology_versions WHERE workspace_id = $1 AND id = $2', [workspaceId, id])
  return rows[0] ? toVersion(rows[0]) : null
}

/**
 * Starts a draft from a text: an editor's, an import, a template, another
 * workspace's ontology. Its parent is the current head. Throws
 * `OntologyInvalid` with the schema errors at their paths.
 */
export async function createDraft(tx: Tx, workspaceId: string, input: { yaml: string; source: string; author: string; message?: string | null }): Promise<OntologyVersion> {
  const { yaml } = importYaml(input.yaml)
  parseDraft(yaml)
  const head = await headOf(tx, workspaceId)
  const { rows } = await tx.query<VersionRow>(
    `INSERT INTO ontology_versions (workspace_id, parent_number, status, yaml, yaml_hash, message, source, author)
     VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7) RETURNING *`,
    [workspaceId, head?.number ?? null, yaml, hashContent(yaml), input.message ?? null, input.source, input.author]
  )
  return toVersion(rows[0] as VersionRow)
}

async function openDraft(tx: Tx, workspaceId: string, draftId: string): Promise<OntologyVersion> {
  const draft = await versionById(tx, workspaceId, draftId)
  if (!draft || draft.status !== 'draft') throw new VersionNotFound('No such draft.')
  return draft
}

/** Saves an editor's text over an open draft. With `rebase`, its parent becomes the current head. */
export async function updateDraft(tx: Tx, workspaceId: string, draftId: string, input: { yaml: string; message?: string | null; rebase?: boolean }): Promise<OntologyVersion> {
  await openDraft(tx, workspaceId, draftId)
  const { yaml } = importYaml(input.yaml)
  parseDraft(yaml)
  const head = input.rebase ? await headOf(tx, workspaceId) : null
  const { rows } = await tx.query<VersionRow>(
    `UPDATE ontology_versions SET yaml = $3, yaml_hash = $4, message = coalesce($5, message), updated_at = now(),
            parent_number = CASE WHEN $6 THEN $7 ELSE parent_number END
      WHERE workspace_id = $1 AND id = $2 AND status = 'draft' RETURNING *`,
    [workspaceId, draftId, yaml, hashContent(yaml), input.message ?? null, input.rebase ?? false, head?.number ?? null]
  )
  return toVersion(rows[0] as VersionRow)
}

export async function discardDraft(tx: Tx, workspaceId: string, draftId: string): Promise<OntologyVersion> {
  await openDraft(tx, workspaceId, draftId)
  const { rows } = await tx.query<VersionRow>(`UPDATE ontology_versions SET status = 'discarded', updated_at = now() WHERE workspace_id = $1 AND id = $2 RETURNING *`, [
    workspaceId,
    draftId
  ])
  return toVersion(rows[0] as VersionRow)
}

/** The workspace as a check sees it: its parsed documents, where each came from, and its head. */
export async function workspaceSnapshot(ctx: StoreContext, workspaceId: string): Promise<WorkspaceSnapshot> {
  // One query at a time: they share the transaction's connection.
  const read = await readCanonical(postgresSource(ctx, workspaceId))
  const records = await listDocuments(ctx.tx, workspaceId)
  const head = await publishedOntology(ctx, workspaceId)
  return {
    documents: read.documents,
    origins: new Map(records.map((record) => [record.path, record.origin])),
    head: head ? { number: head.number, ontology: parseOntology(head.text).ontology } : null,
    people: read.people
  }
}

/**
 * Checks an ontology against the workspace as publishing it would, with the
 * migration's rewrites of server documents applied first. Writes nothing.
 */
export async function evaluate(
  ctx: StoreContext,
  workspaceId: string,
  draft: Ontology,
  options: { migration?: readonly Migration[]; version?: number; login?: string } = {}
): Promise<Evaluation> {
  const snapshot = await workspaceSnapshot(ctx, workspaceId)
  const stored = options.migration?.length ? await readDocuments(ctx, workspaceId) : []
  return evaluateDraft(snapshot, stored, draft, options)
}

/**
 * Re-validates every document of the workspace against a draft and diffs the
 * diagnostics with the published head's, with the migration's rewrites
 * applied when there is one. Writes nothing. Throws `OntologyInvalid` for a
 * draft that is not an ontology, and `MigrationInvalid` for a migration that
 * names what the draft does not have.
 */
export async function checkDraft(ctx: StoreContext, workspaceId: string, draftYaml: string, options: { migration?: readonly Migration[]; login?: string } = {}): Promise<DraftCheck> {
  parseDraft(draftYaml)
  const snapshot = await workspaceSnapshot(ctx, workspaceId)
  const stored = options.migration?.length ? await readDocuments(ctx, workspaceId) : []
  return checkSnapshot(snapshot, stored, draftYaml, options)
}

export interface PublishOptions {
  /** The head the draft was made and checked against: publishing needs it to still be the head. */
  expectedHead: number
  migration?: Migration[]
  /** "Publish anyway": accept resources that gain diagnostics. */
  acceptNarrowing?: boolean
  /** By resource id: what to do with each resource a breaking change leaves unknown. */
  dispositions?: Readonly<Record<string, Disposition>>
  publisher: Publisher
  message?: string | null
  /** The request that publishes, which the activity log links to its audit event. */
  requestId?: string
}

/** The version as published, with the server documents its migration rewrote as new revisions. */
export interface Published extends OntologyVersion {
  rewritten: DocumentRecord[]
}

/**
 * Publishes a draft as head + 1, in the caller's transaction: the workspace
 * is locked, the head must still be `expectedHead`, every document is
 * re-validated against the draft, and every resource a breaking change leaves
 * unknown after the migration needs a recorded disposition:
 * `accept-data-loss`, or `update-in-repo` for a repo or CLI document whose
 * changes a step names. The migration's rewrites are new document revisions
 * with evidence from the publisher.
 */
export async function publish(ctx: StoreContext, workspaceId: string, draftId: string, options: PublishOptions): Promise<Published> {
  const { tx } = ctx
  // The head first: every write validating against it holds it FOR SHARE, so the
  // publish waits for those writes to commit (and then checks them too), and a
  // write that starts after it validates against the new head.
  await lockOntologyHead(ctx, workspaceId, 'update')
  // One publish at a time per workspace, including the first.
  const locked = await tx.query('SELECT 1 FROM workspaces WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [workspaceId])
  if (!locked.rowCount) throw new VersionNotFound('No such workspace.')
  const draft = await openDraft(tx, workspaceId, draftId)
  const head = (await headOf(tx, workspaceId))?.number ?? 0
  if (options.expectedHead !== head) throw new StaleDraft(options.expectedHead, head)

  const { ontology } = parseDraft(draft.yaml)
  const migration = options.migration ?? []
  const number = head + 1
  const { check, rewrites, unresolved } = await evaluate(ctx, workspaceId, ontology, { migration, version: number, login: options.publisher.login })
  const disposed: Disposed[] = []
  for (const resource of unresolved) {
    const disposition = options.dispositions?.[resource.resourceId]
    if (disposition !== 'accept-data-loss' && !(disposition === 'update-in-repo' && resource.updatable)) {
      throw new OntologyBreakingChange(check)
    }
    disposed.push({ ...resource, disposition })
  }
  if (needsAcceptance(check.classification) && !options.acceptNarrowing) throw new OntologyNarrowingChange(check)

  const rewritten: DocumentRecord[] = []
  for (const rewrite of rewrites) {
    const { document } = await putDocument(ctx, { workspaceId, path: rewrite.path, raw: rewrite.raw, origin: 'cloud', actor: options.publisher.actor })
    rewritten.push(document)
  }

  const { rows } = await tx.query<VersionRow>(
    `UPDATE ontology_versions
        SET status = 'published', number = $3, parent_number = $4, published_at = now(), published_by = $5,
            message = coalesce($6, message), check_result = $7, migration = $8, dispositions = $9, updated_at = now()
      WHERE workspace_id = $1 AND id = $2 RETURNING *`,
    [
      workspaceId,
      draftId,
      number,
      head || null,
      options.publisher.actor,
      options.message ?? null,
      JSON.stringify(check),
      migration.length ? JSON.stringify(migration) : null,
      disposed.length ? JSON.stringify(disposed) : null
    ]
  )
  await enqueue(tx, workspaceId, 'ontology')
  await recordIngest(ctx, {
    workspaceId,
    channel: 'ontology',
    actor: options.publisher.actor,
    actorLabel: options.publisher.login,
    action: 'publish-ontology',
    documents: rewritten.map((document) => ({
      documentId: document.id,
      path: document.path,
      resourceId: document.resourceId,
      revision: document.revision,
      change: 'updated' as const
    })),
    evidenceCount: rewritten.length,
    outcome: 'ok',
    detail: {
      ontology: { number, draftId, classification: check.classification },
      ...(rewrites.length ? { evidence: rewrites.map((rewrite) => ({ on: rewrite.resourceId, entries: [rewrite.evidence] })) } : {})
    },
    ontologyDraftId: draftId,
    requestId: options.requestId ?? `publish:${draftId}`
  })
  return { ...toVersion(rows[0] as VersionRow), rewritten }
}

/** Rollback publishes a new version equal to an old one: versions are never rewritten. It is checked like any other publish. */
export async function rollback(ctx: StoreContext, workspaceId: string, toNumber: number, options: PublishOptions): Promise<Published> {
  const target = await versionByNumber(ctx.tx, workspaceId, toNumber)
  if (!target) throw new VersionNotFound(`No version ${toNumber}.`)
  const draft = await createDraft(ctx.tx, workspaceId, {
    yaml: target.yaml,
    source: `rollback:v${toNumber}`,
    author: options.publisher.actor,
    message: options.message ?? `Roll back to v${toNumber}`
  })
  return publish(ctx, workspaceId, draft.id, options)
}

/**
 * `docket_propose_ontology_change`: makes a draft from the proposal and
 * checks it against every document of the workspace. It never publishes: an
 * admin does that. The draft is recorded in the activity log.
 */
export async function proposeOntologyChange(ctx: StoreContext, writer: Writer, proposal: Proposal): Promise<{ draft: OntologyVersion; check: DraftCheck }> {
  const head = await headOf(ctx.tx, writer.workspaceId)
  const yaml = proposedText(head?.yaml ?? null, proposal)
  const draft = await createDraft(ctx.tx, writer.workspaceId, {
    yaml,
    source: `${writer.channel}:${writer.actor}`.slice(0, 200),
    author: writer.actor,
    message: proposal.message?.trim() || `Proposed by ${writer.label}`
  })
  const check = await checkDraft(ctx, writer.workspaceId, draft.yaml)
  await recordIngest(ctx, {
    workspaceId: writer.workspaceId,
    channel: writer.channel,
    actor: writer.actor,
    actorLabel: writer.label,
    action: 'propose-ontology',
    outcome: 'ok',
    detail: {
      ontology: { draftId: draft.id, classification: check.classification },
      ...(check.introduced.length ? { diagnostics: check.introduced.slice(0, 50).map(({ severity, code, message }) => ({ severity, code, message })) } : {})
    },
    ontologyDraftId: draft.id,
    requestId: writer.requestId
  })
  return { draft, check }
}

/** What `docket_publish_ontology_change` takes: a proposal, and what an editor's publish takes with it. */
export type DirectChange = Proposal & {
  /** The head the caller read and means to change: refused as stale when another version was published since. */
  expectedHead?: number
  migration?: Migration[]
  /** Accept resources that gain diagnostics, as an editor's "publish anyway" does. */
  acceptNarrowing?: boolean
  /** By resource id: what to do with each resource a breaking change leaves unknown. */
  dispositions?: Readonly<Record<string, Disposition>>
}

/**
 * `docket_publish_ontology_change`: publishes a proposal as the next version,
 * through the editor's publish path - the same change check, migration of the
 * documents, dispositions and activity record, with no review. Allowed only
 * while the workspace's setting names `role`: the setting is read under the
 * publish's own locks (the head, then the workspace row, in the order
 * `publish` takes them), so turning it off waits for an in-flight publish and
 * refuses every one after. Rolled back like any version.
 */
export async function publishOntologyChange(ctx: StoreContext, writer: Writer, role: Role | null, change: DirectChange): Promise<Published> {
  const head = await lockOntologyHead(ctx, writer.workspaceId, 'update')
  await ctx.tx.query('SELECT 1 FROM workspaces WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [writer.workspaceId])
  const allowed = await ontologyMcpRoles(ctx.tx, writer.workspaceId)
  if (role === null || !(allowed as readonly string[]).includes(role)) throw new OntologyWriteDisabled(role)
  const message = change.message?.trim() || `Published by ${writer.label}`
  const draft = await createDraft(ctx.tx, writer.workspaceId, {
    yaml: proposedText(head?.yaml ?? null, change),
    source: `${writer.channel}:${writer.actor}`.slice(0, 200),
    author: writer.actor,
    message
  })
  return publish(ctx, writer.workspaceId, draft.id, {
    expectedHead: change.expectedHead ?? head?.number ?? 0,
    ...(change.migration ? { migration: change.migration } : {}),
    ...(change.acceptNarrowing ? { acceptNarrowing: true } : {}),
    ...(change.dispositions ? { dispositions: change.dispositions } : {}),
    publisher: { actor: writer.actor, login: writer.label },
    message,
    requestId: writer.requestId
  })
}

/** Where a new workspace's ontology comes from: a template, an imported file, or another workspace's. */
export type OntologyStart = { template: TemplateId } | { importYaml: string } | { copyFrom: string }

/**
 * Creates a workspace and publishes its first ontology version, in the
 * caller's transaction. The ontology goes through the same draft and checks
 * as any other; with no documents yet, they pass. The store's workspace limit
 * holds unless `maxWorkspaces` names another.
 */
export async function createWorkspace(
  ctx: StoreContext,
  input: { name: string; slug: string; start: OntologyStart; publisher: Publisher; requestId?: string; maxWorkspaces?: number }
): Promise<{ workspace: Workspace; version: Published }> {
  let yaml: string
  let source: string
  if ('template' in input.start) {
    yaml = template(input.start.template).yaml
    source = `template:${input.start.template}`
  } else if ('importYaml' in input.start) {
    yaml = input.start.importYaml
    source = 'import'
  } else {
    const from = await workspaceById(ctx.tx, input.start.copyFrom)
    const head = from ? await headOf(ctx.tx, from.id) : null
    if (!from || !head) throw new VersionNotFound('That workspace has no published ontology to copy.')
    yaml = head.yaml
    source = `copy:${from.slug}`
  }
  const maxWorkspaces = input.maxWorkspaces ?? ctx.limits?.workspaces
  const workspace = await insertWorkspace(ctx.tx, {
    name: input.name,
    slug: input.slug,
    createdBy: input.publisher.actor,
    ...(maxWorkspaces !== undefined ? { maxWorkspaces } : {})
  })
  const draft = await createDraft(ctx.tx, workspace.id, { yaml, source, author: input.publisher.actor })
  const version = await publish(ctx, workspace.id, draft.id, {
    expectedHead: 0,
    publisher: input.publisher,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    message: source === 'import' ? 'Imported' : source.startsWith('copy:') ? `Copied from ${source.slice(5)}` : `Started from the ${source.slice(9)} template`
  })
  return { workspace, version }
}
