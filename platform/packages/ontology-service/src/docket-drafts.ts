// SPDX-License-Identifier: AGPL-3.0-only
import { workspaceBySlug, workspaceSlugProblem, type StoreContext, type Workspace } from '@docket/platform-canonical-store'
import type { Tx } from '@docket/platform-tenancy'

import { checkDraft, parseDraft, type DraftCheck } from './check.js'
import { VersionNotFound } from './errors.js'
import type { Migration } from './migrations.js'
import type { Published, Publisher } from './versions.js'
import { createWorkspace } from './workspaces.js'
import { importYaml } from './yaml-io.js'

/**
 * A new docket's ontology, drafted before the docket exists: AI drafts it
 * from a description of the domain, it opens in the ontology editor with the
 * usual change check, and only accepting it creates the docket, with the
 * draft as its first published version. Only the member who started it
 * opens it, changes it or accepts it.
 */
/** One line of a new docket's initial access: who, and which role they get on it, kept with its draft. */
export interface InitialAccess {
  /** A member's id, or `everyone`. */
  who: string
  roleId: string
}

export interface DocketDraft {
  id: string
  /** The docket's name and address, as New docket was given them. */
  name: string
  slug: string
  /** The space it will be made in. */
  spaceId: string
  /** Who gets access to it when it is made, beyond what its space and the account give. */
  access: InitialAccess[]
  yaml: string
  /** ai:<template>: drafted by AI starting from that template. */
  source: string
  message: string | null
  author: string
  createdAt: Date
  updatedAt: Date
}

type DraftRow = {
  id: string
  name: string
  slug: string
  space_id: string
  access: unknown
  yaml: string
  source: string
  message: string | null
  author: string
  created_at: Date
  updated_at: Date
}

/** The initial access a draft keeps, as far as it is well formed. */
export function initialAccessOf(value: unknown): InitialAccess[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) =>
    entry && typeof entry === 'object' && typeof entry.who === 'string' && typeof entry.roleId === 'string' ? [{ who: entry.who, roleId: entry.roleId }] : [],
  )
}

const toDraft = (row: DraftRow): DocketDraft => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  spaceId: row.space_id,
  access: initialAccessOf(row.access),
  yaml: row.yaml,
  source: row.source,
  message: row.message,
  author: row.author,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The most open new-docket drafts one member keeps: starting another drops their oldest. */
export const MAX_DOCKET_DRAFTS = 5

/** The name and address a new docket will take, checked before anything is drafted for it. */
export async function newDocketProblem(tx: Tx, input: { name: string; slug: string }): Promise<string | null> {
  const name = input.name.trim()
  if (!name || name.length > 80) return 'Name the workspace in 1-80 characters.'
  const problem = workspaceSlugProblem(input.slug)
  if (problem) return problem
  if (await workspaceBySlug(tx, input.slug)) return 'A workspace already has that address.'
  return null
}

function ontologyText(yaml: string): string {
  const text = importYaml(yaml).yaml
  parseDraft(text)
  return text
}

/** Keeps a drafted ontology for its author to review. Throws `OntologyInvalid` for text that is not one. */
export async function createDocketDraft(
  tx: Tx,
  input: { name: string; slug: string; yaml: string; source: string; message?: string | null; author: string; spaceId?: string; access?: readonly InitialAccess[] },
): Promise<DocketDraft> {
  const yaml = ontologyText(input.yaml)
  await tx.query(
    `DELETE FROM docket_drafts WHERE id IN (
       SELECT id FROM docket_drafts WHERE author = $1 ORDER BY updated_at DESC OFFSET $2)`,
    [input.author, MAX_DOCKET_DRAFTS - 1],
  )
  const { rows } = await tx.query<DraftRow>(
    `INSERT INTO docket_drafts (name, slug, yaml, source, message, author, space_id, access)
     VALUES ($1, $2, $3, $4, $5, $6, coalesce($7, 'general'), $8) RETURNING *`,
    [input.name.trim(), input.slug, yaml, input.source, input.message ?? null, input.author, input.spaceId ?? null, JSON.stringify(input.access ?? [])],
  )
  return toDraft(rows[0] as DraftRow)
}

/** The author's open drafts, most recently changed first. */
export async function listDocketDrafts(tx: Tx, author: string): Promise<DocketDraft[]> {
  const { rows } = await tx.query<DraftRow>('SELECT * FROM docket_drafts WHERE author = $1 ORDER BY updated_at DESC', [author])
  return rows.map(toDraft)
}

/** The author's draft; null for another member's, as for one that does not exist. */
export async function docketDraftById(tx: Tx, id: string, author: string): Promise<DocketDraft | null> {
  if (!UUID.test(id)) return null
  const { rows } = await tx.query<DraftRow>('SELECT * FROM docket_drafts WHERE id = $1 AND author = $2', [id, author])
  return rows[0] ? toDraft(rows[0]) : null
}

async function openDraft(tx: Tx, id: string, author: string): Promise<DocketDraft> {
  const draft = await docketDraftById(tx, id, author)
  if (!draft) throw new VersionNotFound('No such draft.')
  return draft
}

/** Saves the editor's text over the draft. Throws `OntologyInvalid` for text that is not an ontology. */
export async function updateDocketDraft(tx: Tx, id: string, author: string, input: { yaml: string; message?: string | null }): Promise<DocketDraft> {
  await openDraft(tx, id, author)
  const yaml = ontologyText(input.yaml)
  const { rows } = await tx.query<DraftRow>(
    'UPDATE docket_drafts SET yaml = $3, message = coalesce($4, message), updated_at = now() WHERE id = $1 AND author = $2 RETURNING *',
    [id, author, yaml, input.message ?? null],
  )
  return toDraft(rows[0] as DraftRow)
}

export async function discardDocketDraft(tx: Tx, id: string, author: string): Promise<void> {
  await openDraft(tx, id, author)
  await tx.query('DELETE FROM docket_drafts WHERE id = $1 AND author = $2', [id, author])
}

/** A workspace id no workspace can have (they are lowercase letters and digits): a check against it sees no documents. */
const NO_WORKSPACE = '-'

/**
 * The editor's dry run for a docket that does not exist yet: the draft is
 * read and diffed against nothing, with no documents to re-validate. Throws
 * `OntologyInvalid` for text that is not an ontology.
 */
export function checkNewDocket(ctx: StoreContext, yaml: string, options: { migration?: readonly Migration[]; login?: string } = {}): Promise<DraftCheck> {
  return checkDraft(ctx, NO_WORKSPACE, yaml, options)
}

/**
 * Accepts the draft: creates the docket with the draft's text, or `yaml`
 * when the editor sends newer, as its first published version, and deletes
 * the draft, in the caller's transaction.
 */
export async function acceptDocketDraft(
  ctx: StoreContext,
  id: string,
  input: { yaml?: string; message?: string | null; publisher: Publisher; requestId?: string; docketLimit?: number },
): Promise<{ workspace: Workspace; version: Published; draft: DocketDraft }> {
  const draft = await openDraft(ctx.tx, id, input.publisher.actor)
  const yaml = input.yaml ? ontologyText(input.yaml) : draft.yaml
  const created = await createWorkspace(ctx, {
    name: draft.name,
    slug: draft.slug,
    spaceId: draft.spaceId,
    start: { drafted: { yaml, source: draft.source, message: input.message ?? draft.message } },
    publisher: input.publisher,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.docketLimit !== undefined ? { docketLimit: input.docketLimit } : {}),
  })
  await ctx.tx.query('DELETE FROM docket_drafts WHERE id = $1', [id])
  return { ...created, draft }
}
