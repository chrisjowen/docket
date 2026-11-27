// SPDX-License-Identifier: AGPL-3.0-only
import { LIMITS } from '@docket/platform-tenancy'

import { hashContent, parseMemoryFile, parseOntology, validateDocuments, type Diagnostic, type MemoryDocument } from './docket.js'
import { DocumentError, checkDocument, putDocument, readDocument, retireDocument, type StoreContext } from './documents.js'
import { recordIngest, type IngestDocument } from './ingest.js'
import { cloudDiagnostics, hasErrors, lockOntologyHead, type Writer } from './write.js'

/**
 * `docket cloud push` (§6.1): a checkout's canonical files become `cli`
 * documents, keyed by the checkout (`origin_ref`), at their repo-relative
 * paths. The whole push is validated - each path, size and structure, and
 * the changed documents against the published ontology head, held `FOR
 * SHARE` - before anything is written: any error refuses it all. A dry run
 * validates and reports, writing nothing. Every other push is one ingest
 * event in the transaction that applies it.
 */

export interface PushInput {
  /** docket's `checkoutScope(projectRoot)`: `docket-<dir>-<12 hex>`. */
  checkout: string
  upsert: { path: string; raw: string }[]
  /** Paths of this checkout's documents to retire. */
  remove: string[]
}

export interface PushDiagnostic {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

export interface PushResult {
  /** False when an error refused the push: then nothing was applied. */
  ok: boolean
  dryRun: boolean
  created: string[]
  updated: string[]
  unchanged: string[]
  removed: string[]
  diagnostics: PushDiagnostic[]
  ingestId?: string
}

/** The checkout id docket sends: printable, no whitespace, at most 200 characters. */
export function checkoutProblem(checkout: unknown): string | null {
  if (typeof checkout !== 'string' || checkout.length === 0 || checkout.length > 200) return 'checkout is a string of 1-200 characters.'
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(checkout)) return 'checkout has no whitespace or control characters.'
  return null
}

/** At most this many diagnostics go into the activity log's encrypted detail. */
const LOGGED_DIAGNOSTICS = 200

type LiveRow = { path: string; origin: 'repo' | 'cloud' | 'cli'; origin_ref: string | null; resource_id: string; hash: string }

const toPush = (diagnostic: Diagnostic, path: string): PushDiagnostic => ({
  severity: diagnostic.severity,
  code: diagnostic.code,
  message: diagnostic.message,
  path: diagnostic.path ?? path,
})

const holder = (row: LiveRow) =>
  row.origin === 'repo' ? `a repo connection's ${row.resource_id}` : row.origin === 'cloud' ? `the cloud document ${row.resource_id}` : `another checkout's ${row.resource_id}`

/** The documents that declare the pushed documents' link targets, parsed, other than those the push replaces or retires. */
async function targetDocuments(ctx: StoreContext, workspaceId: string, targets: readonly string[], excluded: ReadonlySet<string>): Promise<MemoryDocument[]> {
  const wanted = [...new Set(targets)]
  if (!wanted.length) return []
  const { rows } = await ctx.tx.query<{ path: string }>(
    'SELECT path FROM documents WHERE workspace_id = $1 AND resource_id = ANY($2::text[]) AND retired_at IS NULL ORDER BY path',
    [workspaceId, wanted],
  )
  const out: MemoryDocument[] = []
  for (const { path } of rows) {
    if (excluded.has(path)) continue
    const opened = await readDocument(ctx, workspaceId, path)
    const document = opened?.raw === undefined ? null : parseMemoryFile(opened.raw, opened.path).document
    if (document) out.push(document)
  }
  return out
}

export async function pushDocuments(ctx: StoreContext, writer: Writer, input: PushInput, options: { dryRun?: boolean } = {}): Promise<PushResult> {
  const { workspaceId } = writer
  const { checkout } = input
  const dryRun = options.dryRun === true
  const diagnostics: PushDiagnostic[] = []
  const refuse = (code: string, message: string, path?: string) => diagnostics.push({ severity: 'error', code, message, ...(path ? { path } : {}) })
  const warn = (code: string, message: string, path: string) => diagnostics.push({ severity: 'warning', code, message, path })

  // One push per checkout at a time; the published head is held FOR SHARE, so a publish waits for this push.
  await ctx.tx.query("SELECT pg_advisory_xact_lock(hashtext('docket-cloud:push:' || current_schema() || ':' || $1 || ':' || $2))", [workspaceId, checkout])
  const head = await lockOntologyHead(ctx, workspaceId)
  const ontology = head ? (parseOntology(head.yaml).ontology ?? null) : null
  if (!ontology) refuse('no-ontology', 'This workspace has no published ontology yet: an admin publishes one in the web app.')

  // Each file on its own: its path, size and structure, as the store will hold it.
  const removing = new Set(input.remove)
  const files = new Map<string, { raw: string; hash: string; document: MemoryDocument }>()
  const seen = new Set<string>()
  for (const { path, raw } of input.upsert) {
    if (seen.has(path)) {
      refuse('duplicate-path', `${path} is in the push twice.`, path)
      continue
    }
    seen.add(path)
    if (removing.has(path)) {
      refuse('upsert-and-remove', `${path} is both upserted and removed.`, path)
      continue
    }
    try {
      const document = checkDocument(path, raw)
      diagnostics.push(...cloudDiagnostics(parseMemoryFile(raw, path).diagnostics).map((d) => toPush(d, path)))
      files.set(path, { raw, hash: hashContent(raw), document })
    } catch (caught) {
      if (!(caught instanceof DocumentError)) throw caught
      const errors = cloudDiagnostics(caught.diagnostics).filter((d) => d.severity === 'error')
      if (errors.length) diagnostics.push(...errors.map((d) => toPush(d, path)))
      else refuse(caught.code === 'too-large' ? 'document-too-large' : 'invalid-document', caught.message, path)
    }
  }

  // What each path holds now: nothing, this checkout's document, or another source's. The workspace is locked first, as
  // `putDocument` locks it for a new document, so no other writer creates a path between this read and the writes.
  await ctx.tx.query('SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE', [workspaceId])
  const { rows: live } = await ctx.tx.query<LiveRow>(
    `SELECT path, origin, origin_ref, resource_id, hash FROM documents
      WHERE workspace_id = $1 AND path = ANY($2::text[]) AND retired_at IS NULL FOR UPDATE`,
    [workspaceId, [...files.keys()]],
  )
  const liveAt = new Map(live.map((row) => [row.path, row]))
  const created: string[] = []
  const updated: string[] = []
  const unchanged: string[] = []
  for (const [path, file] of files) {
    const held = liveAt.get(path)
    if (!held) created.push(path)
    else if (held.origin === 'cli' && held.origin_ref === checkout) (held.hash === file.hash ? unchanged : updated).push(path)
    else if (held.hash === file.hash) {
      warn('held-elsewhere', `${path} is held by ${holder(held)} with the same text, so it is left as it is.`, path)
      unchanged.push(path)
    } else {
      refuse('path-taken', `${path}: the workspace already holds ${holder(held)} at that path. Move the file, or change it at its source.`, path)
    }
  }

  const { rows: ours } = await ctx.tx.query<{ path: string }>(
    `SELECT path FROM documents WHERE workspace_id = $1 AND origin = 'cli' AND origin_ref = $2 AND path = ANY($3::text[]) AND retired_at IS NULL
      ORDER BY path FOR UPDATE`,
    [workspaceId, checkout, [...removing]],
  )
  const removed = ours.map((row) => row.path)
  for (const path of removing) {
    if (!removed.includes(path)) warn('not-pushed', `${path} is not a document this checkout pushed, so there is nothing to remove.`, path)
  }

  // The changed documents against the published head, beside the documents their links point at.
  const changed = new Set([...created, ...updated])
  if (ontology && changed.size) {
    const pushed = [...files.values()].map((file) => file.document)
    const targets = await targetDocuments(
      ctx,
      workspaceId,
      pushed.flatMap((document) => document.links.map((link) => link.target)),
      new Set([...files.keys(), ...removed]),
    )
    const validated = validateDocuments([...pushed, ...targets], ontology).filter((d) => d.path !== undefined && changed.has(d.path))
    diagnostics.push(...cloudDiagnostics(validated).map((d) => toPush(d, d.path as string)))
  }

  // The workspace's document limit, with the workspace still locked.
  if (created.length > removed.length) {
    const { rows } = await ctx.tx.query<{ count: string }>('SELECT count(*) FROM documents WHERE workspace_id = $1 AND retired_at IS NULL', [workspaceId])
    if (Number(rows[0]?.count ?? 0) - removed.length + created.length > LIMITS.documentsPerWorkspace) {
      refuse('document-limit', `A workspace holds at most ${LIMITS.documentsPerWorkspace} documents in the beta.`)
    }
  }

  const logged = diagnostics.slice(0, LOGGED_DIAGNOSTICS).map(({ severity, code, message }) => ({ severity, code, message }))
  const event = { workspaceId, channel: writer.channel, actor: writer.actor, actorLabel: writer.label, action: 'push' as const, requestId: writer.requestId }
  if (hasErrors(diagnostics)) {
    const result: PushResult = { ok: false, dryRun, created: [], updated: [], unchanged: [], removed: [], diagnostics }
    if (!dryRun) result.ingestId = await recordIngest(ctx, { ...event, outcome: 'refused', detail: { diagnostics: logged } })
    return result
  }
  const result: PushResult = { ok: true, dryRun, created, updated, unchanged, removed, diagnostics }
  if (dryRun) return result

  const touched: IngestDocument[] = []
  for (const path of removed) {
    const record = await retireDocument(ctx.tx, { workspaceId, path })
    touched.push({ documentId: record.id, path, resourceId: record.resourceId, revision: record.revision, change: 'retired' })
  }
  for (const path of changed) {
    const file = files.get(path) as { raw: string }
    const { document } = await putDocument(ctx, { workspaceId, path, raw: file.raw, origin: 'cli', originRef: checkout, actor: writer.actor })
    touched.push({ documentId: document.id, path, resourceId: document.resourceId, revision: document.revision, change: created.includes(path) ? 'created' : 'updated' })
  }
  result.ingestId = await recordIngest(ctx, { ...event, documents: touched, outcome: 'ok', ...(logged.length ? { detail: { diagnostics: logged } } : {}) })
  return result
}
