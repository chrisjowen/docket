// SPDX-License-Identifier: AGPL-3.0-only
import { isMap, isSeq, parseDocument, stringify, type Document } from 'yaml'

import {
  evidenceKey,
  evidenceProblems,
  hasErrors,
  orderedEvidence,
  refuse,
  stampAll,
  stampContext,
  type EvidenceInput,
  type LinkInput,
  type RememberInput,
  type StampContext,
  type StampedEvidence,
  type Writer,
} from '@chrisjowen/docket/workspace'

import { parseMemoryFile, parseOntology, validateDocuments, writeDiagnostics, type Diagnostic, type MemoryDocument, type Ontology } from './docket.js'
import {
  DocumentError,
  checkDocument,
  cloudDocumentPath,
  pathProblem,
  putDocument,
  readDocument,
  retireDocument,
  type OpenedDocument,
  type Origin,
  type StoreContext,
} from './documents.js'
import { recordIngest, type IngestAction, type IngestDetail, type IngestDocument } from './ingest.js'
import { peopleDirectory } from './trust.js'

/**
 * Structured writes (§9.1, §14.2): `docket_remember` and the other write
 * tools, and the web's capture forms, all come through here. A write is
 * rendered as a docket Markdown document, validated against the published
 * ontology head inside the transaction it commits in, and stored with its
 * evidence stamped with who wrote it. The validator is docket's own; on top of
 * it, every write carries evidence.
 */

/**
 * What a write carries and who makes it are docket's (§9.1): evidence as a
 * client gives it - a source, which instance of it, the attributes claimed
 * and where it was seen - stamped with the writer, the person they act for
 * (`principal`), the request and the time.
 */
export type { EvidenceInput, LinkInput, RememberInput, StampedEvidence, Writer } from '@chrisjowen/docket/workspace'
export { hasErrors, stampEvidence } from '@chrisjowen/docket/workspace'

export interface WriteOptions {
  /** Validate and report, write nothing. */
  dryRun?: boolean
  /** The clock, for tests. */
  now?: () => Date
}

export interface WriteResult {
  /** The cloud document written; absent when the write was refused, a dry run, or changed nothing. */
  documentId?: string
  path?: string
  revision?: number
  /** True when the resource had no document before this write. */
  created: boolean
  /** False for a dry run, a refusal, or a write that added nothing new (writes are idempotent). */
  changed: boolean
  /** Errors refuse the write; warnings come back with it (§9.1). */
  diagnostics: Diagnostic[]
  /** The evidence entries this write added. */
  evidenceAdded: number
  ingestId?: string
}

/** Server-side write limits (§9.1). */
export const WRITE_LIMITS = {
  evidencePerCall: 50,
  linksPerResource: 100,
  reasonLength: 500,
} as const

/**
 * `reportedBy` is the cloud's (§9.1) and docket's parser does not know it: it
 * warns about it on every entry that carries one. That warning is the cloud's
 * own field, not the writer's mistake, so it is not reported back; docket's
 * workspace core drops it the same way.
 */
export const cloudDiagnostics: (diagnostics: readonly Diagnostic[]) => Diagnostic[] = writeDiagnostics

/**
 * Takes the workspace's published ontology head `FOR SHARE` and returns it:
 * a publish, which takes the head `FOR UPDATE`, waits for every write that
 * validated against the head to commit, and a write that starts after a
 * publish sees the new head. The head is read again after the lock is held,
 * since a row locked while a publish was in flight may no longer be the head.
 */
export async function lockOntologyHead(
  ctx: Pick<StoreContext, 'tx'>,
  workspaceId: string,
  mode: 'share' | 'update' = 'share',
): Promise<{ id: string; number: number; yaml: string } | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { rows } = await ctx.tx.query<{ id: string; number: number; yaml: string }>(
      `SELECT id, number, yaml FROM ontology_versions WHERE workspace_id = $1 AND status = 'published'
        ORDER BY number DESC LIMIT 1 FOR ${mode === 'share' ? 'SHARE' : 'UPDATE'}`,
      [workspaceId],
    )
    const locked = rows[0]
    if (!locked) return null
    const { rows: now } = await ctx.tx.query<{ number: number }>(
      `SELECT max(number) AS number FROM ontology_versions WHERE workspace_id = $1 AND status = 'published'`,
      [workspaceId],
    )
    if (now[0]?.number === locked.number) return locked
  }
  throw new Error(`the ontology head of workspace ${workspaceId} kept moving`)
}

/** One write per resource at a time, so concurrent writes merge rather than overwrite (§9: evidence is append-only). */
export async function lockResource(ctx: StoreContext, workspaceId: string, resourceId: string): Promise<void> {
  await ctx.tx.query("SELECT pg_advisory_xact_lock(hashtext('docket-cloud:resource:' || current_schema() || ':' || $1 || ':' || $2))", [
    workspaceId,
    resourceId,
  ])
}

/**
 * Stamps a write's evidence (§9.1), docket's way: the writer observed it, for
 * the person they act for, in this request. Evidence citing no source is that
 * person's, under the ontology's person source; legacy `human` evidence is
 * written as a person. Refuses an entry with no source when there is no one
 * it could be from, and warns `confirm-requested` for one citing someone else.
 */
async function stamping(ctx: Pick<StoreContext, 'tx'>, ontology: Ontology | null): Promise<StampContext> {
  return stampContext(ontology, await peopleDirectory(ctx))
}

const DELIMITER = /^---[ \t]*\r?$/

/** A docket file's frontmatter as a YAML document, and its body, the text after the closing delimiter. */
function split(raw: string): { frontmatter: Document; body: string } | null {
  const lines = raw.split('\n')
  if (!DELIMITER.test(lines[0] ?? '')) return null
  const end = lines.findIndex((line, index) => index > 0 && DELIMITER.test(line))
  if (end < 0) return null
  const frontmatter = parseDocument(lines.slice(1, end).join('\n'))
  if (frontmatter.errors.length || !isMap(frontmatter.contents)) return null
  return { frontmatter, body: lines.slice(end + 1).join('\n') }
}

function render(frontmatter: Document | Record<string, unknown>, body: string): string {
  const yaml = isDocumentNode(frontmatter)
    ? frontmatter.toString({ lineWidth: 0, flowCollectionPadding: false })
    : stringify(frontmatter, { lineWidth: 0 })
  const text = body.replace(/^\n+/, '').replace(/\s+$/, '')
  return `---\n${yaml}---\n${text ? `${text}\n` : ''}`
}

const isDocumentNode = (value: unknown): value is Document =>
  typeof value === 'object' && value !== null && 'contents' in value && typeof (value as Document).toString === 'function' && 'errors' in value

/** A change to one resource's cloud document: what `remember` and `add-evidence` both make. */
interface Change {
  id: string
  type: string
  /** Absent: keep the document's title (a new document takes the resource's). */
  title?: string
  attributes?: Record<string, unknown>
  body?: string
  evidence: StampedEvidence[]
  links: { rel: string; target: string; attributes?: Record<string, unknown>; evidence: StampedEvidence[] }[]
  /** A new document's `provenance`: who captured it, when a person did not. */
  provenance?: Record<string, unknown>
}

/** Merges a change into a document's text, or makes a new one. Keeps the evidence entries it really added, by resource and link. */
function merge(existing: string | null, change: Change, fallbackTitle: string): { raw: string; added: number; evidence: NonNullable<IngestDetail['evidence']> } | null {
  let added = 0
  const kept = new Map<string, Record<string, unknown>[]>()
  const note = (on: string, entry: Record<string, unknown>) => {
    added += 1
    kept.set(on, [...(kept.get(on) ?? []), entry])
  }
  const evidence = () => [...kept].map(([on, entries]) => ({ on, entries }))
  if (existing === null) {
    const seen = new Set<string>()
    const fresh = (on: string, entries: StampedEvidence[]) =>
      entries
        .filter((entry) => {
          const key = evidenceKey(entry as unknown as Record<string, unknown>)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .map((entry) => {
          const plain = orderedEvidence(entry as unknown as Record<string, unknown>)
          note(on, plain)
          return plain
        })
    const own = fresh(change.id, change.evidence)
    const links = new Map<string, { rel: string; target: string; attributes?: Record<string, unknown>; evidence: Record<string, unknown>[] }>()
    for (const link of change.links) {
      const at = `${link.rel}\u0000${link.target}`
      const entry = links.get(at) ?? { rel: link.rel, target: link.target, evidence: [] }
      if (link.attributes && Object.keys(link.attributes).length) entry.attributes = { ...entry.attributes, ...link.attributes }
      seen.clear()
      for (const known of entry.evidence) seen.add(evidenceKey(known))
      entry.evidence.push(...fresh(`${link.rel} -> ${link.target}`, link.evidence))
      links.set(at, entry)
    }
    const frontmatter: Record<string, unknown> = { id: change.id, type: change.type, title: change.title ?? fallbackTitle }
    if (change.provenance) frontmatter.provenance = change.provenance
    if (change.attributes && Object.keys(change.attributes).length) frontmatter.attributes = change.attributes
    if (links.size) frontmatter.links = [...links.values()].map((link) => (link.evidence.length ? link : { rel: link.rel, target: link.target, ...(link.attributes ? { attributes: link.attributes } : {}) }))
    if (own.length) frontmatter.evidence = own
    return { raw: render(frontmatter, change.body ?? ''), added, evidence: evidence() }
  }

  const parts = split(existing)
  if (!parts) return null
  const doc = parts.frontmatter
  if (change.title !== undefined && doc.get('title') !== change.title) doc.set('title', change.title)
  for (const [key, value] of Object.entries(change.attributes ?? {})) {
    const attributes = doc.get('attributes', true)
    if (!isMap(attributes)) doc.set('attributes', doc.createNode({ [key]: value }))
    else if (JSON.stringify(attributes.toJSON()[key]) !== JSON.stringify(value)) attributes.set(key, doc.createNode(value))
  }

  const appendTo = (on: string, holder: { get(key: string, keepNode: true): unknown; set(key: string, value: unknown): void }, entries: StampedEvidence[]) => {
    const current = holder.get('evidence', true)
    const seen = new Set<string>(isSeq(current) ? (current.toJSON() as Record<string, unknown>[]).map(evidenceKey) : [])
    for (const entry of entries) {
      const plain = orderedEvidence(entry as unknown as Record<string, unknown>)
      const key = evidenceKey(plain)
      if (seen.has(key)) continue
      seen.add(key)
      note(on, plain)
      const seq = holder.get('evidence', true)
      if (isSeq(seq)) seq.add(doc.createNode(plain))
      else holder.set('evidence', doc.createNode([plain]))
    }
  }
  appendTo(change.id, doc, change.evidence)

  for (const link of change.links) {
    let links = doc.get('links', true)
    if (!isSeq(links)) {
      doc.set('links', doc.createNode([]))
      links = doc.get('links', true)
    }
    if (!isSeq(links)) return null
    let node = links.items.find((item) => isMap(item) && item.get('rel') === link.rel && item.get('target') === link.target)
    if (!isMap(node)) {
      node = doc.createNode({ rel: link.rel, target: link.target })
      links.add(node)
    }
    if (!isMap(node)) return null
    for (const [key, value] of Object.entries(link.attributes ?? {})) {
      const attributes = node.get('attributes', true)
      if (!isMap(attributes)) node.set('attributes', doc.createNode({ [key]: value }))
      else if (JSON.stringify(attributes.toJSON()[key]) !== JSON.stringify(value)) attributes.set(key, doc.createNode(value))
    }
    appendTo(`${link.rel} -> ${link.target}`, node as unknown as Parameters<typeof appendTo>[1], link.evidence)
  }

  const body = change.body !== undefined ? change.body : parts.body
  const raw = render(doc, body)
  return { raw, added, evidence: evidence() }
}

/**
 * Where a resource's cloud document goes: its existing cloud document, or the
 * path it would have in a repo (§6.1). When a repo or CLI document already
 * holds that path, the cloud document sits beside it as `<slug>.cloud.md`, so
 * a cloud write never takes over a document that changes at its source.
 */
async function cloudPath(ctx: StoreContext, workspaceId: string, resource: { id: string; type: string }, cloud: Declaring | null): Promise<string> {
  if (cloud) return cloud.record.path
  const base = cloudDocumentPath(resource)
  for (const candidate of [base, base.replace(/\.md$/, '.cloud.md'), ...[2, 3, 4, 5].map((n) => base.replace(/\.md$/, `.cloud-${n}.md`))]) {
    const { rowCount } = await ctx.tx.query('SELECT 1 FROM documents WHERE workspace_id = $1 AND path = $2 AND retired_at IS NULL', [workspaceId, candidate])
    if (!rowCount) return candidate
  }
  throw new DocumentError('invalid', `No free path for a cloud document of ${resource.id}.`)
}

type Declaring = { record: { id: string; path: string; origin: Origin; resourceType: string }; document: MemoryDocument | null }

/** Every live document that declares `resourceId`, parsed; cloud documents first, at their canonical path first. */
async function declaring(ctx: StoreContext, workspaceId: string, resourceId: string): Promise<(Declaring & { opened: OpenedDocument })[]> {
  const { rows } = await ctx.tx.query<{ path: string }>(
    'SELECT path FROM documents WHERE workspace_id = $1 AND resource_id = $2 AND retired_at IS NULL ORDER BY path',
    [workspaceId, resourceId],
  )
  const out: (Declaring & { opened: OpenedDocument })[] = []
  for (const { path } of rows) {
    const opened = await readDocument(ctx, workspaceId, path)
    if (!opened) continue
    const document = opened.raw === undefined ? null : (parseMemoryFile(opened.raw, opened.path).document ?? null)
    out.push({ record: opened, document, opened })
  }
  return out
}

/**
 * A resource's type and title as its documents declare them, or null: its
 * cloud document's, the one a write updates, else the first that parses in path order.
 */
export async function describeResource(ctx: StoreContext, workspaceId: string, resourceId: string): Promise<{ type: string; title: string } | null> {
  const existing = await declaring(ctx, workspaceId, resourceId)
  const first = (existing.find((entry) => entry.document && !isInferredPath(entry.record.path)) ?? existing.find((entry) => entry.document))?.document
  if (!first) return null
  const found = cloudOf(existing, { id: resourceId, type: first.type })?.document ?? first
  return { type: found.type, title: found.title }
}

/**
 * Where background enrichment writes: one cloud document per
 * inference, apart from every document a person, a repo or a checkout wrote,
 * so retiring an inference never touches theirs and their writes never land
 * in one. `~` sorts after every letter and digit, so an inferred document
 * comes after the resource's own in path order, and docket's aggregation
 * keeps theirs as the primary that names its title and holds its path.
 */
export const INFERRED_ROOT = '.docket/~inferred/'
export const isInferredPath = (path: string): boolean => path.startsWith(INFERRED_ROOT)

/** A resource's consolidation summary document: beside its inferences, apart from every document a person, repo or checkout wrote. */
export const summaryPath = (resourceId: string): string =>
  `${INFERRED_ROOT}${(resourceId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+|-+$/g, '') || 'resource').slice(0, 150)}/summary.md`

/** The resource's cloud document, if it has one: at its canonical path first. An inferred document is never it. */
function cloudOf<T extends Declaring>(existing: readonly T[], resource: { id: string; type: string }): T | null {
  const cloud = existing.filter((entry) => entry.record.origin === 'cloud' && !isInferredPath(entry.record.path))
  return cloud.find((entry) => entry.record.path === cloudDocumentPath(resource)) ?? cloud[0] ?? null
}

/** The documents that declare the link targets, parsed, so the validator can check each `to` constraint. */
async function targetDocuments(ctx: StoreContext, workspaceId: string, targets: readonly string[], skip: string): Promise<MemoryDocument[]> {
  const wanted = [...new Set(targets)].filter((target) => target !== skip)
  if (!wanted.length) return []
  const { rows } = await ctx.tx.query<{ path: string }>(
    'SELECT path FROM documents WHERE workspace_id = $1 AND resource_id = ANY($2::text[]) AND retired_at IS NULL ORDER BY path',
    [workspaceId, wanted],
  )
  const out: MemoryDocument[] = []
  for (const { path } of rows) {
    const opened = await readDocument(ctx, workspaceId, path)
    const document = opened?.raw === undefined ? null : parseMemoryFile(opened.raw, opened.path).document
    if (document) out.push(document)
  }
  return out
}

const summary = (diagnostics: readonly Diagnostic[]) => diagnostics.map(({ severity, code, message }) => ({ severity, code, message }))

/**
 * Validates and writes one change to a resource's cloud document, in the
 * caller's transaction, with the ontology head held `FOR SHARE`. A refusal
 * writes nothing but its ingest event; a dry run writes nothing at all.
 */
async function applyChange(
  ctx: StoreContext,
  writer: Writer,
  workspaceId: string,
  input: {
    change: Change
    action: IngestAction
    ontology: Ontology | null
    existing: Declaring[]
    cloud: (Declaring & { opened: OpenedDocument }) | null
    early: Diagnostic[]
    /** Write at this path rather than the resource's own cloud document's: an inference's. */
    path?: string
  },
  options: WriteOptions,
): Promise<WriteResult> {
  const { change, cloud } = input
  const path = input.path ?? (await cloudPath(ctx, workspaceId, change, cloud))
  const base = { created: input.existing.length === 0, changed: false, evidenceAdded: 0 }
  const refused = async (diagnostics: Diagnostic[]): Promise<WriteResult> => {
    const result: WriteResult = { ...base, diagnostics }
    if (options.dryRun) return result
    result.ingestId = await recordIngest(ctx, {
      workspaceId,
      channel: writer.channel,
      actor: writer.actor,
      actorLabel: writer.label,
      action: input.action,
      outcome: 'refused',
      detail: { resourceId: change.id, diagnostics: summary(diagnostics) },
      requestId: writer.requestId,
    })
    return result
  }
  if (hasErrors(input.early)) return refused(input.early)
  if (!input.ontology) return refused([refuse('no-ontology', 'This workspace has no published ontology yet: an admin publishes one in the web app.', { path, id: change.id })])

  if (cloud && cloud.opened.raw === undefined) {
    return refused([refuse('unreadable-document', `The cloud document at ${path} does not open: ${cloud.opened.error ?? 'unreadable'}.`, { path, id: change.id })])
  }
  const fallbackTitle = input.existing.find((entry) => entry.document)?.document?.title ?? change.id
  const merged = merge(cloud?.opened.raw ?? null, change, fallbackTitle)
  if (!merged) return refused([refuse('unreadable-document', `The cloud document at ${path} has frontmatter this write cannot update.`, { path, id: change.id })])
  // A write that says nothing new keeps the document's text as it is, rather than re-rendering its layout.
  if (cloud?.opened.raw !== undefined && sameMeaning(cloud.opened.raw, merged.raw, path)) merged.raw = cloud.opened.raw

  let parsed: MemoryDocument
  try {
    parsed = checkDocument(path, merged.raw)
  } catch (caught) {
    if (!(caught instanceof DocumentError)) throw caught
    const errors = cloudDiagnostics(caught.diagnostics).filter((d) => d.severity === 'error')
    return refused(errors.length ? errors : [refuse(caught.code === 'too-large' ? 'document-too-large' : 'invalid-document', caught.message, { path, id: change.id })])
  }
  const parseWarnings = cloudDiagnostics(parseMemoryFile(merged.raw, path).diagnostics)
  if (parsed.links.length > WRITE_LIMITS.linksPerResource) {
    return refused([refuse('too-many-links', `A resource holds at most ${WRITE_LIMITS.linksPerResource} links in one document.`, { path, id: change.id })])
  }

  const targets = await targetDocuments(ctx, workspaceId, parsed.links.map((link) => link.target), change.id)
  const validated = validateDocuments([parsed, ...targets], input.ontology).filter((d) => d.path === path)
  const diagnostics = [...input.early, ...parseWarnings, ...validated]
  if (hasErrors(diagnostics)) return refused(diagnostics)
  if (options.dryRun) return { ...base, path, diagnostics, evidenceAdded: merged.added }

  let written
  try {
    written = await putDocument(ctx, { workspaceId, path, raw: merged.raw, origin: 'cloud', actor: writer.actor })
  } catch (caught) {
    if (!(caught instanceof DocumentError)) throw caught
    const code = caught.code === 'limit' ? 'document-limit' : caught.code === 'too-large' ? 'document-too-large' : 'invalid-document'
    return refused([...diagnostics, refuse(code, caught.message, { path, id: change.id })])
  }
  const result: WriteResult = {
    ...base,
    documentId: written.document.id,
    path,
    revision: written.document.revision,
    changed: written.changed,
    diagnostics,
    evidenceAdded: written.changed ? merged.added : 0,
  }
  if (!written.changed) return result
  const touched: IngestDocument = {
    documentId: written.document.id,
    path,
    resourceId: change.id,
    revision: written.document.revision,
    change: written.document.revision === 1 ? 'created' : 'updated',
  }
  result.ingestId = await recordIngest(ctx, {
    workspaceId,
    channel: writer.channel,
    actor: writer.actor,
    actorLabel: writer.label,
    action: input.action,
    documents: [touched],
    evidenceCount: merged.added,
    outcome: 'ok',
    detail: { resourceId: change.id, evidence: merged.evidence, ...(diagnostics.length ? { diagnostics: summary(diagnostics) } : {}) },
    requestId: writer.requestId,
  })
  return result
}

/** Whether two texts of a document say the same thing: the same frontmatter values and body, whatever the layout. */
function sameMeaning(a: string, b: string, path: string): boolean {
  const meaning = (raw: string) => {
    const parts = split(raw)
    return parts ? JSON.stringify([parts.frontmatter.toJS(), parts.body.trim()]) : raw
  }
  return parseMemoryFile(b, path).document !== undefined && meaning(a) === meaning(b)
}

/** The published head, parsed, held `FOR SHARE` for the rest of the transaction. */
async function headOntology(ctx: StoreContext, workspaceId: string): Promise<Ontology | null> {
  const head = await lockOntologyHead(ctx, workspaceId)
  return head ? parseOntology(head.yaml).ontology : null
}

/**
 * `docket_remember` (§9): upserts one resource with its links into its cloud
 * document. A new resource needs at least one evidence entry of its own, each
 * link the resource does not have yet needs its own, and any write carries
 * some evidence. The document is validated against
 * the head it commits under; validator errors refuse the write, warnings come
 * back with it. Repeating a write adds nothing.
 */
export async function writeResource(ctx: StoreContext, writer: Writer, input: RememberInput, options: WriteOptions = {}): Promise<WriteResult> {
  const now = (options.now ?? (() => new Date()))()
  const { workspaceId } = writer
  const ontology = await headOntology(ctx, workspaceId)
  await lockResource(ctx, workspaceId, input.id)
  const existing = await declaring(ctx, workspaceId, input.id)
  const cloud = cloudOf(existing, input)
  const where = { path: cloud?.record.path ?? cloudDocumentPath(input), id: input.id }

  const early: Diagnostic[] = []
  const links = input.links ?? []
  const evidenceCount = input.evidence.length + links.reduce((sum, link) => sum + link.evidence.length, 0)
  if (evidenceCount > WRITE_LIMITS.evidencePerCall) {
    early.push(refuse('too-much-evidence', `A write carries at most ${WRITE_LIMITS.evidencePerCall} evidence entries.`, where))
  }
  // A new resource needs its own evidence (§9); any write needs some, on the resource or a link.
  if (!existing.length) early.push(...evidenceProblems(input.evidence, input.id, where))
  else if (evidenceCount === 0) early.push(...evidenceProblems([], `what this write says about ${input.id}`, where))
  const other = existing.find((entry) => entry.record.resourceType !== input.type)
  if (other) {
    early.push(refuse('type-conflict', `${input.id} is a ${other.record.resourceType} in ${other.record.path}: write it as that type, or change it there.`, where))
  }
  // An inferred link is not one the resource has: saying it yourself takes evidence of your own.
  const known = new Set(
    existing.filter((entry) => !isInferredPath(entry.record.path)).flatMap((entry) => entry.document?.links.map((link) => `${link.rel}\u0000${link.target}`) ?? []),
  )
  for (const link of links) {
    if (known.has(`${link.rel}\u0000${link.target}`)) continue
    early.push(...evidenceProblems(link.evidence, `the new link ${link.rel} -> ${link.target}`, where))
  }

  const context = await stamping(ctx, ontology)
  const stamp = (entries: readonly EvidenceInput[], subject: string) => {
    const stamped = stampAll(entries, writer, now, context, { where, subject })
    early.push(...stamped.diagnostics)
    return stamped.stamped
  }
  const change: Change = {
    id: input.id,
    type: input.type,
    title: input.title,
    ...(input.attributes ? { attributes: input.attributes } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    evidence: stamp(input.evidence, input.id),
    links: links.map((link) => ({
      rel: link.rel,
      target: link.target,
      ...(link.attributes ? { attributes: link.attributes } : {}),
      evidence: stamp(link.evidence, `the link ${link.rel} -> ${link.target}`),
    })),
  }
  return applyChange(ctx, writer, workspaceId, { change, action: 'remember', ontology, existing, cloud, early }, options)
}

export interface AddEvidenceInput {
  id: string
  /** Add to this link of the resource rather than to the resource itself. */
  link?: { rel: string; target: string }
  evidence: EvidenceInput[]
}

export interface AppendNotesInput {
  id: string
  additionalNotes: string
  evidence: EvidenceInput[]
}

/**
 * Append narrative notes under the same lock as remember/add-evidence. Read
 * after taking the lock, so concurrent appends cannot replace each other.
 * Repo/CLI notes stay at their source; only the cloud body is extended and
 * aggregation joins it with the other documents' notes.
 */
export async function appendNotes(ctx: StoreContext, writer: Writer, input: AppendNotesInput, options: WriteOptions = {}): Promise<WriteResult> {
  const now = (options.now ?? (() => new Date()))()
  const { workspaceId } = writer
  const ontology = await headOntology(ctx, workspaceId)
  await lockResource(ctx, workspaceId, input.id)
  const existing = await declaring(ctx, workspaceId, input.id)
  const first = existing.find((entry) => entry.document && !isInferredPath(entry.record.path))?.document
    ?? existing.find((entry) => entry.document)?.document
  const type = first?.type ?? 'resource'
  const cloud = cloudOf(existing, { id: input.id, type })
  const where = { path: cloud?.record.path ?? cloudDocumentPath({ id: input.id, type }), id: input.id }
  const early: Diagnostic[] = []
  if (!existing.length) early.push(refuse('unknown-resource', `There is no resource ${input.id} in this workspace: write it with docket_remember first.`, where))
  if (!input.additionalNotes.trim()) early.push(refuse('missing-notes', 'Give non-empty narrative notes to append.', where))
  if (input.additionalNotes.length > 60000) early.push(refuse('notes-too-long', 'Additional notes are at most 60000 characters.', where))
  early.push(...evidenceProblems(input.evidence, `the new notes for ${input.id}`, where))
  if (input.evidence.length > WRITE_LIMITS.evidencePerCall) {
    early.push(refuse('too-much-evidence', `A write carries at most ${WRITE_LIMITS.evidencePerCall} evidence entries.`, where))
  }
  const current = cloud?.opened.raw === undefined ? '' : split(cloud.opened.raw)?.body ?? ''
  const body = `${current.trimEnd()}${current.trim() ? '\n\n---\n\n' : ''}### Notes added ${now.toISOString()}\n\n${input.additionalNotes.trim()}`
  const stamped = stampAll(input.evidence, writer, now, await stamping(ctx, ontology), { where, subject: `the new notes for ${input.id}` })
  early.push(...stamped.diagnostics)
  const change: Change = { id: input.id, type, body, evidence: stamped.stamped, links: [] }
  return applyChange(ctx, writer, workspaceId, { change, action: 'remember', ontology, existing, cloud, early }, options)
}

/**
 * `docket_add_evidence` (§9): appends evidence to a resource or one of its
 * links. Evidence is append-only. A resource declared only in a repo gets a
 * cloud document of its own that carries the new evidence; aggregation merges
 * the two (§6.1).
 */
export async function addEvidence(ctx: StoreContext, writer: Writer, input: AddEvidenceInput, options: WriteOptions = {}): Promise<WriteResult> {
  const now = (options.now ?? (() => new Date()))()
  const { workspaceId } = writer
  const ontology = await headOntology(ctx, workspaceId)
  await lockResource(ctx, workspaceId, input.id)
  const existing = await declaring(ctx, workspaceId, input.id)
  const first = existing.find((entry) => entry.document)
  const type = first?.record.resourceType ?? existing[0]?.record.resourceType ?? ''
  const cloud = cloudOf(existing, { id: input.id, type })
  const where = { path: cloud?.record.path ?? cloudDocumentPath({ id: input.id, type: type || 'resource' }), id: input.id }

  const early: Diagnostic[] = []
  if (!existing.length) {
    early.push(refuse('unknown-resource', `There is no resource ${input.id} in this workspace: write it with docket_remember first.`, where))
  }
  if (input.evidence.length > WRITE_LIMITS.evidencePerCall) {
    early.push(refuse('too-much-evidence', `A write carries at most ${WRITE_LIMITS.evidencePerCall} evidence entries.`, where))
  }
  const subject = input.link ? `the link ${input.link.rel} -> ${input.link.target}` : input.id
  early.push(...evidenceProblems(input.evidence, subject, where))
  if (input.link && existing.length) {
    const { rel, target } = input.link
    const has = existing.some((entry) => entry.document?.links.some((link) => link.rel === rel && link.target === target))
    if (!has) early.push(refuse('unknown-link', `${input.id} has no link ${rel} -> ${target}: add it with docket_remember, with its evidence.`, where))
  }
  if (hasErrors(early)) {
    const change: Change = { id: input.id, type: type || 'resource', evidence: [], links: [] }
    return applyChange(ctx, writer, workspaceId, { change, action: 'add-evidence', ontology, existing, cloud, early }, options)
  }

  const { stamped, diagnostics } = stampAll(input.evidence, writer, now, await stamping(ctx, ontology), { where, subject })
  early.push(...diagnostics)
  const change: Change = {
    id: input.id,
    type,
    evidence: input.link ? [] : stamped,
    links: input.link ? [{ rel: input.link.rel, target: input.link.target, evidence: stamped }] : [],
  }
  return applyChange(ctx, writer, workspaceId, { change, action: 'add-evidence', ontology, existing, cloud, early }, options)
}

export interface InferenceInput {
  /** The resource the inference is about: one the workspace already has. */
  id: string
  /** Its own document, under `INFERRED_ROOT`. */
  path: string
  /** What it infers, each link with the `inferred` evidence that gives the reasoning and cites the sources. */
  links: LinkInput[]
}

/** How an inferred document says who captured it. */
export const INFERRED_PROVENANCE = { authority: 'inferred', capturedBy: 'docket-cloud enrichment' } as const

/**
 * Background enrichment's write: links a resource's documents imply but
 * never state, in a cloud document of the inference's own under
 * `INFERRED_ROOT`, validated against the published head and logged like any
 * other write. The resource must exist already and every link needs evidence.
 */
export async function writeInference(ctx: StoreContext, writer: Writer, input: InferenceInput, options: WriteOptions = {}): Promise<WriteResult> {
  const now = (options.now ?? (() => new Date()))()
  const { workspaceId } = writer
  const ontology = await headOntology(ctx, workspaceId)
  await lockResource(ctx, workspaceId, input.id)
  const existing = await declaring(ctx, workspaceId, input.id)
  const own = existing.find((entry) => entry.record.path === input.path) ?? null
  const others = existing.filter((entry) => entry !== own && !isInferredPath(entry.record.path))
  const first = others.find((entry) => entry.document)?.document
  const declared = first ? (cloudOf(others, { id: input.id, type: first.type })?.document ?? first) : null
  const where = { path: input.path, id: input.id }

  const early: Diagnostic[] = []
  if (!isInferredPath(input.path) || pathProblem(input.path)) {
    early.push(refuse('invalid-path', `An inference is written under ${INFERRED_ROOT}, as a Markdown file.`, where))
  }
  if (!declared) early.push(refuse('unknown-resource', `There is no resource ${input.id} in this workspace to infer anything about.`, where))
  if (!input.links.length) early.push(refuse('missing-links', 'An inference names at least one link.', where))
  const evidenceCount = input.links.reduce((sum, link) => sum + link.evidence.length, 0)
  if (evidenceCount > WRITE_LIMITS.evidencePerCall) {
    early.push(refuse('too-much-evidence', `A write carries at most ${WRITE_LIMITS.evidencePerCall} evidence entries.`, where))
  }
  for (const link of input.links) early.push(...evidenceProblems(link.evidence, `the inferred link ${link.rel} -> ${link.target}`, where))

  const context = await stamping(ctx, ontology)
  const stamp = (entries: readonly EvidenceInput[], subject: string) => {
    const stamped = stampAll(entries, writer, now, context, { where, subject })
    early.push(...stamped.diagnostics)
    return stamped.stamped
  }
  const change: Change = {
    id: input.id,
    type: declared?.type ?? 'resource',
    ...(declared ? { title: declared.title } : {}),
    evidence: [],
    links: input.links.map((link) => ({
      rel: link.rel,
      target: link.target,
      ...(link.attributes ? { attributes: link.attributes } : {}),
      evidence: stamp(link.evidence, `the inferred link ${link.rel} -> ${link.target}`),
    })),
    provenance: { ...INFERRED_PROVENANCE },
  }
  return applyChange(ctx, writer, workspaceId, { change, action: 'infer', ontology, existing, cloud: own, early, path: input.path }, options)
}

export interface RetireInput {
  id: string
  reason: string
}

export interface RetireResult {
  retired: IngestDocument[]
  /** Repo and CLI documents that still declare the resource: they change at their source. */
  remaining: { path: string; origin: Origin }[]
  diagnostics: Diagnostic[]
  ingestId?: string
}

/**
 * `docket_retire` (§9): soft-retires a resource's cloud documents, with a
 * required reason. A repo or CLI document cannot be retired here: it comes
 * back on the next sync, so the answer says to change it at its source.
 */
export async function retireResource(ctx: StoreContext, writer: Writer, input: RetireInput): Promise<RetireResult> {
  const { workspaceId } = writer
  await lockResource(ctx, workspaceId, input.id)
  const { rows } = await ctx.tx.query<{ path: string; origin: Origin }>(
    'SELECT path, origin FROM documents WHERE workspace_id = $1 AND resource_id = $2 AND retired_at IS NULL ORDER BY path',
    [workspaceId, input.id],
  )
  const reason = input.reason.trim()
  const cloud = rows.filter((row) => row.origin === 'cloud')
  const remaining = rows.filter((row) => row.origin !== 'cloud')
  const diagnostics: Diagnostic[] = []
  if (!reason) diagnostics.push(refuse('missing-reason', 'Say why the resource is retired.', { id: input.id }))
  else if (reason.length > WRITE_LIMITS.reasonLength) diagnostics.push(refuse('reason-too-long', `A reason is at most ${WRITE_LIMITS.reasonLength} characters.`, { id: input.id }))
  if (!rows.length) diagnostics.push(refuse('unknown-resource', `There is no resource ${input.id} in this workspace.`, { id: input.id }))
  else if (!cloud.length) {
    const where = remaining.map((row) => `${row.path} (${row.origin === 'repo' ? 'from a repo' : 'from a CLI push'})`).join(', ')
    diagnostics.push(
      refuse('repo-origin', `${input.id} comes from ${where}: change it in the repo and push, and the sync retires it. It cannot be retired here.`, { id: input.id }),
    )
  } else if (remaining.length) {
    diagnostics.push({
      severity: 'warning',
      code: 'still-declared',
      message: `${input.id} is still declared in ${remaining.map((row) => row.path).join(', ')}: change it in the repo to remove it entirely.`,
      id: input.id,
    })
  }
  if (hasErrors(diagnostics)) {
    const ingestId = await recordIngest(ctx, {
      workspaceId,
      channel: writer.channel,
      actor: writer.actor,
      actorLabel: writer.label,
      action: 'retire',
      outcome: 'refused',
      detail: { resourceId: input.id, diagnostics: summary(diagnostics), ...(reason ? { reason: reason.slice(0, WRITE_LIMITS.reasonLength) } : {}) },
      requestId: writer.requestId,
    })
    return { retired: [], remaining, diagnostics, ingestId }
  }
  const retired: IngestDocument[] = []
  for (const row of cloud) {
    const record = await retireDocument(ctx.tx, { workspaceId, path: row.path })
    retired.push({ documentId: record.id, path: record.path, resourceId: record.resourceId, revision: record.revision, change: 'retired' })
  }
  const ingestId = await recordIngest(ctx, {
    workspaceId,
    channel: writer.channel,
    actor: writer.actor,
    actorLabel: writer.label,
    action: 'retire',
    documents: retired,
    outcome: 'ok',
    detail: { resourceId: input.id, reason, ...(diagnostics.length ? { diagnostics: summary(diagnostics) } : {}) },
    requestId: writer.requestId,
  })
  return { retired, remaining, diagnostics, ingestId }
}
