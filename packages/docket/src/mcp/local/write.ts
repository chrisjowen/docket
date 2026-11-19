import { randomUUID } from 'node:crypto'

import type { Diagnostic, MemoryDocument } from '../../model/index.js'
import { parseMemoryFile } from '../../source/parser.js'
import { validateDocuments } from '../../ontology/validator.js'
import { DocumentError, checkDocument } from '../../workspace/documents.js'
import { dayOf } from '../../workspace/supersession.js'
import { appendedNotes, composeDocument, sameMeaning, type ResourceChange } from '../../workspace/write/document.js'
import { evidenceProblems, hasErrors, refuse, stampAll, stampContext } from '../../workspace/write/evidence.js'
import {
  WRITE_LIMITS,
  type AddEvidenceInput,
  type AppendNotesInput,
  type EvidenceInput,
  type RememberInput,
  type WriteOptions,
  type WriteResult,
  type Writer
} from '../../workspace/write/inputs.js'
import type { SupersedeInput } from '../surface/arguments.js'
import {
  absolute,
  declaring,
  documentPathOf,
  freeDocumentPath,
  readSupersessions,
  removeFile,
  writeSupersessions,
  writeText,
  type LocalDocument,
  type LocalSupersession,
  type LocalWorkspace
} from './files.js'

/*
 * The write tools over a project's own files, by the rules every Docket MCP
 * server writes by: a write is merged into the resource's document (or a new
 * one, at the path a repo would give it), validated against the ontology with
 * docket's validator, and carries evidence stamped with who wrote it. Unlike a
 * server, which keeps its writes apart from a repository's documents, the
 * project's files are the docket here, so a write changes them in place.
 */

type Declared = LocalDocument & { document: MemoryDocument }

/** Who evidence without a source is from, and who the people directory knows. */
const stampContextOf = (workspace: LocalWorkspace) => stampContext(workspace.ontology?.ontology, workspace.people)

/** The document a write to `resource` changes: the one at its own path, else the first that declares it. */
const ownOf = (workspace: LocalWorkspace, existing: readonly Declared[], resource: { id: string; type: string }): Declared | null =>
  existing.find((entry) => entry.path === documentPathOf(workspace, resource)) ?? existing[0] ?? null

const tooMuchEvidence = (where: { path: string; id: string }) =>
  refuse('too-much-evidence', `A write carries at most ${WRITE_LIMITS.evidencePerCall} evidence entries.`, where)

/** Validates and writes one change to a resource's document. A refusal or a dry run writes nothing. */
async function applyChange(
  workspace: LocalWorkspace,
  input: { change: ResourceChange; existing: readonly Declared[]; own: Declared | null; early: Diagnostic[] },
  options: WriteOptions
): Promise<WriteResult> {
  const { change, own } = input
  const base = { created: input.existing.length === 0, changed: false, evidenceAdded: 0 }
  const refused = (diagnostics: Diagnostic[]): WriteResult => ({ ...base, diagnostics })
  const path = own?.path ?? (await freeDocumentPath(workspace, change))
  const where = { path: path ?? documentPathOf(workspace, change), id: change.id }
  if (hasErrors(input.early)) return refused(input.early)
  if (path === null) return refused([refuse('invalid-path', `No free path for a document of ${change.id} beside ${where.path}.`, where)])
  const ontology = workspace.ontology?.ontology
  if (!ontology) return refused([refuse('no-ontology', 'This docket has no ontology to check the write against: `docket validate` says why.', where)])

  const fallbackTitle = input.existing[0]?.document.title ?? change.id
  const merged = composeDocument(own?.raw ?? null, change, fallbackTitle)
  if (!merged) return refused([refuse('unreadable-document', `The document at ${path} has frontmatter this write cannot update.`, where)])
  // A write that says nothing new keeps the document's text as it is, rather than re-rendering its layout.
  if (own?.raw !== undefined && sameMeaning(own.raw, merged.raw, path)) merged.raw = own.raw

  let parsed: MemoryDocument
  try {
    parsed = checkDocument(path, merged.raw)
  } catch (caught) {
    if (!(caught instanceof DocumentError)) throw caught
    const errors = caught.diagnostics.filter((d) => d.severity === 'error')
    return refused(errors.length ? errors : [refuse(caught.code === 'too-large' ? 'document-too-large' : 'invalid-document', caught.message, where)])
  }
  const parseWarnings = parseMemoryFile(merged.raw, path).diagnostics
  if (parsed.links.length > WRITE_LIMITS.linksPerResource) {
    return refused([refuse('too-many-links', `A resource holds at most ${WRITE_LIMITS.linksPerResource} links in one document.`, where)])
  }

  const wanted = new Set(parsed.links.map((link) => link.target))
  wanted.delete(change.id)
  const targets = workspace.documents.flatMap((entry) => (entry.document && wanted.has(entry.document.id) ? [entry.document] : []))
  const validated = validateDocuments([parsed, ...targets], ontology).filter((d) => d.path === path)
  const diagnostics = [...input.early, ...parseWarnings, ...validated]
  if (hasErrors(diagnostics)) return refused(diagnostics)
  if (options.dryRun) return { ...base, path, diagnostics, evidenceAdded: merged.added }

  const changed = own?.raw !== merged.raw
  if (changed) await writeText(absolute(workspace.resolved, path), merged.raw)
  return { ...base, path, changed, diagnostics, evidenceAdded: changed ? merged.added : 0 }
}

/**
 * `docket_remember`: upserts one resource with its links. A new resource
 * needs at least one evidence entry of its own, each link the resource does
 * not have yet needs its own, and any write carries some. Validator errors
 * refuse the write, warnings come back with it. Repeating a write adds
 * nothing.
 */
export async function writeResource(workspace: LocalWorkspace, writer: Writer, input: RememberInput, options: WriteOptions = {}): Promise<WriteResult> {
  const now = (options.now ?? (() => new Date()))()
  const existing = declaring(workspace, input.id)
  const own = ownOf(workspace, existing, input)
  const where = { path: own?.path ?? documentPathOf(workspace, input), id: input.id }

  const early: Diagnostic[] = []
  const links = input.links ?? []
  const evidenceCount = input.evidence.length + links.reduce((sum, link) => sum + link.evidence.length, 0)
  if (evidenceCount > WRITE_LIMITS.evidencePerCall) early.push(tooMuchEvidence(where))
  // A new resource needs its own evidence; any write needs some, on the resource or a link.
  if (!existing.length) early.push(...evidenceProblems(input.evidence, input.id, where))
  else if (evidenceCount === 0) early.push(...evidenceProblems([], `what this write says about ${input.id}`, where))
  const other = existing.find((entry) => entry.document.type !== input.type)
  if (other) early.push(refuse('type-conflict', `${input.id} is a ${other.document.type} in ${other.path}: write it as that type, or change it there.`, where))
  const known = new Set(existing.flatMap((entry) => entry.document.links.map((link) => `${link.rel}\u0000${link.target}`)))
  for (const link of links) {
    if (known.has(`${link.rel}\u0000${link.target}`)) continue
    early.push(...evidenceProblems(link.evidence, `the new link ${link.rel} -> ${link.target}`, where))
  }

  const context = stampContextOf(workspace)
  const stamp = (entries: readonly EvidenceInput[], subject: string) => {
    const { stamped, diagnostics } = stampAll(entries, writer, now, context, { where, subject })
    early.push(...diagnostics)
    return stamped
  }
  const change: ResourceChange = {
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
      evidence: stamp(link.evidence, `the link ${link.rel} -> ${link.target}`)
    }))
  }
  return applyChange(workspace, { change, existing, own, early }, options)
}

/** `docket_update_notes`: appends dated notes to the body of the resource's document, with evidence. */
export async function appendNotes(workspace: LocalWorkspace, writer: Writer, input: AppendNotesInput, options: WriteOptions = {}): Promise<WriteResult> {
  const now = (options.now ?? (() => new Date()))()
  const existing = declaring(workspace, input.id)
  const type = existing[0]?.document.type ?? 'resource'
  const own = ownOf(workspace, existing, { id: input.id, type })
  const where = { path: own?.path ?? documentPathOf(workspace, { id: input.id, type }), id: input.id }
  const early: Diagnostic[] = []
  if (!existing.length) early.push(refuse('unknown-resource', `There is no resource ${input.id} in this docket: write it with docket_remember first.`, where))
  if (!input.additionalNotes.trim()) early.push(refuse('missing-notes', 'Give non-empty narrative notes to append.', where))
  if (input.additionalNotes.length > 60000) early.push(refuse('notes-too-long', 'Additional notes are at most 60000 characters.', where))
  early.push(...evidenceProblems(input.evidence, `the new notes for ${input.id}`, where))
  if (input.evidence.length > WRITE_LIMITS.evidencePerCall) early.push(tooMuchEvidence(where))
  const stamped = stampAll(input.evidence, writer, now, stampContextOf(workspace), { where, subject: input.id })
  early.push(...stamped.diagnostics)
  const change: ResourceChange = {
    id: input.id,
    type,
    body: appendedNotes(own?.raw, input.additionalNotes, now),
    evidence: stamped.stamped,
    links: []
  }
  return applyChange(workspace, { change, existing, own, early }, options)
}

/** `docket_add_evidence`: appends evidence to a resource or one of its links. Evidence is append-only. */
export async function addEvidence(workspace: LocalWorkspace, writer: Writer, input: AddEvidenceInput, options: WriteOptions = {}): Promise<WriteResult> {
  const now = (options.now ?? (() => new Date()))()
  const existing = declaring(workspace, input.id)
  const type = existing[0]?.document.type ?? 'resource'
  const own = ownOf(workspace, existing, { id: input.id, type })
  const where = { path: own?.path ?? documentPathOf(workspace, { id: input.id, type }), id: input.id }

  const early: Diagnostic[] = []
  if (!existing.length) early.push(refuse('unknown-resource', `There is no resource ${input.id} in this docket: write it with docket_remember first.`, where))
  if (input.evidence.length > WRITE_LIMITS.evidencePerCall) early.push(tooMuchEvidence(where))
  const subject = input.link ? `the link ${input.link.rel} -> ${input.link.target}` : input.id
  early.push(...evidenceProblems(input.evidence, subject, where))
  if (input.link && existing.length) {
    const { rel, target } = input.link
    const has = existing.some((entry) => entry.document.links.some((link) => link.rel === rel && link.target === target))
    if (!has) early.push(refuse('unknown-link', `${input.id} has no link ${rel} -> ${target}: add it with docket_remember, with its evidence.`, where))
  }
  const stamping = stampAll(hasErrors(early) ? [] : input.evidence, writer, now, stampContextOf(workspace), { where, subject })
  early.push(...stamping.diagnostics)
  const stamped = stamping.stamped
  const change: ResourceChange = {
    id: input.id,
    type,
    evidence: input.link ? [] : stamped,
    links: input.link ? [{ rel: input.link.rel, target: input.link.target, evidence: stamped }] : []
  }
  return applyChange(workspace, { change, existing, own, early }, options)
}

export interface RetireResult {
  retired: { path: string }[]
  remaining: never[]
  diagnostics: Diagnostic[]
}

/**
 * `docket_retire`: removes the documents that declare a resource, with a
 * required reason. They are the project's own files, so git keeps their
 * history; nothing else declares the resource.
 */
export async function retireResource(workspace: LocalWorkspace, input: { id: string; reason: string }): Promise<RetireResult> {
  const existing = declaring(workspace, input.id)
  const reason = input.reason.trim()
  const diagnostics: Diagnostic[] = []
  if (!reason) diagnostics.push(refuse('missing-reason', 'Say why the resource is retired.', { id: input.id }))
  else if (reason.length > WRITE_LIMITS.reasonLength) diagnostics.push(refuse('reason-too-long', `A reason is at most ${WRITE_LIMITS.reasonLength} characters.`, { id: input.id }))
  if (!existing.length) diagnostics.push(refuse('unknown-resource', `There is no resource ${input.id} in this docket.`, { id: input.id }))
  if (hasErrors(diagnostics)) return { retired: [], remaining: [], diagnostics }
  for (const entry of existing) await removeFile(absolute(workspace.resolved, entry.path))
  return { retired: existing.map((entry) => ({ path: entry.path })), remaining: [], diagnostics }
}

/** A date an agent gives, or why it will not do. Never later than now: a record cannot stop holding in the future. */
function untilOf(given: string | undefined, now: Date, id: string): Date | Diagnostic {
  if (given === undefined) return now
  const at = /^\d{4}-\d{2}-\d{2}$/.test(given) ? new Date(`${given}T00:00:00.000Z`) : new Date(given)
  if (Number.isNaN(at.getTime())) return refuse('invalid-date', `validUntil must be a date (YYYY-MM-DD) or an ISO timestamp, not "${given}".`, { id })
  if (at.getTime() > now.getTime() + 60_000) return refuse('future-date', 'validUntil cannot be in the future: say when the record stopped holding.', { id })
  return at
}

export interface SupersedeResult {
  supersession?: LocalSupersession
  /** False for a refusal, or when the record was already superseded by the same replacement. */
  changed: boolean
  /** The replacement this one took over from, when the record was superseded by another before. */
  replaced?: string
  diagnostics: Diagnostic[]
}

/**
 * `docket_supersede`: marks a record superseded by another, with why and the
 * evidence. Both must be declared and different, and the replacement current
 * itself. A record already superseded by the same replacement is left as it
 * is; one superseded by another is re-pointed, the earlier supersession kept,
 * lifted. The documents are untouched.
 */
export async function supersedeResource(workspace: LocalWorkspace, writer: Writer, input: SupersedeInput, options: { now?: () => Date } = {}): Promise<SupersedeResult> {
  const now = (options.now ?? (() => new Date()))()
  const id = input.id.trim()
  const by = input.by.trim()
  const reason = input.reason.trim()
  const diagnostics: Diagnostic[] = []
  if (!id || !by) diagnostics.push(refuse('missing-resource', 'Give the record that went out of date (id) and the one that replaces it (by).', { id }))
  else if (id === by) diagnostics.push(refuse('same-resource', 'A record cannot supersede itself: name the record that replaces it.', { id }))
  if (!reason) diagnostics.push(refuse('missing-reason', 'Say why the record is out of date.', { id }))
  else if (reason.length > WRITE_LIMITS.reasonLength) diagnostics.push(refuse('reason-too-long', `A reason is at most ${WRITE_LIMITS.reasonLength} characters.`, { id }))
  if (input.evidence.length === 0) diagnostics.push(refuse('missing-evidence', 'Give at least one piece of evidence that the record changed: where the newer fact was seen.', { id }))
  else if (input.evidence.length > WRITE_LIMITS.evidencePerCall) diagnostics.push(refuse('too-much-evidence', `A write carries at most ${WRITE_LIMITS.evidencePerCall} evidence entries.`, { id }))
  const until = untilOf(input.validUntil, now, id)
  if (!(until instanceof Date)) diagnostics.push(until)

  const records = await readSupersessions(workspace)
  let live: LocalSupersession | undefined
  if (id && by && id !== by) {
    for (const each of [id, by]) if (!declaring(workspace, each).length) diagnostics.push(refuse('unknown-resource', `There is no resource ${each} in this docket.`, { id: each }))
    live = records.find((record) => record.resource === id && record.liftedAt === undefined)
    const replacement = records.find((record) => record.resource === by && record.liftedAt === undefined)
    if (replacement) {
      diagnostics.push(
        refuse(
          'replacement-superseded',
          `${by} is itself out of date: it was superseded by ${replacement.supersededBy} on ${dayOf(replacement.validUntil)}. Supersede ${id} with the current record.`,
          { id: by }
        )
      )
    }
  }
  const stamping = stampAll(input.evidence, writer, now, stampContextOf(workspace), { where: { id }, subject: `the supersession of ${id}` })
  diagnostics.push(...stamping.diagnostics)
  if (hasErrors(diagnostics)) return { changed: false, diagnostics }
  if (live?.supersededBy === by) return { supersession: live, changed: false, diagnostics }
  if (live) {
    diagnostics.push({
      severity: 'warning',
      code: 'repointed',
      message: `${id} was superseded by ${live.supersededBy}; it now points to ${by}, and the earlier supersession stays in its history.`,
      id
    })
    live.liftedAt = now.toISOString()
  }
  const supersession: LocalSupersession = {
    id: randomUUID(),
    resource: id,
    supersededBy: by,
    validUntil: (until as Date).toISOString(),
    source: 'agent',
    recordedBy: writer.label,
    recordedAt: now.toISOString(),
    reason,
    evidence: stamping.stamped
  }
  await writeSupersessions(workspace, [...records, supersession])
  return { supersession, changed: true, ...(live ? { replaced: live.supersededBy } : {}), diagnostics }
}
