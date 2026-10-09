import { canonicalReferenceSchema, type CanonicalReference } from '@docket/contracts'

import { checkReference } from './resolve.js'
import type { RequestSnapshot } from './snapshot.js'
import type { ResolvedReference } from './wire.js'

/** References one request may resolve: an inspector click is one piece of evidence, not a crawl. */
export const MAX_RESOLVED_REFERENCES = 16

/** Text returned per reference. */
export const MAX_EXCERPT_CHARS = 4_000

/** A request to resolve references that cannot be served as asked. */
export class EvidenceRequestError extends Error {
  override name = 'EvidenceRequestError'
}

const bounded = (text: string): { text: string; truncated: boolean } =>
  text.length <= MAX_EXCERPT_CHARS ? { text, truncated: false } : { text: `${text.slice(0, MAX_EXCERPT_CHARS)}…`, truncated: true }

/** Lines `from`-`to` of a text whose first line is line `first` of its file. */
const linesOf = (text: string, first: number, from: number, to: number): string =>
  text
    .split('\n')
    .slice(Math.max(0, from - first), Math.max(0, to - first + 1))
    .join('\n')

/** Checks the request is a list of canonical references, within the bound. */
export const readEvidenceBody = (body: unknown): CanonicalReference[] => {
  const references = (body as { references?: unknown } | null)?.references
  if (!Array.isArray(references)) throw new EvidenceRequestError('Send { "references": [...] }: the canonical references to resolve.')
  if (references.length > MAX_RESOLVED_REFERENCES) {
    throw new EvidenceRequestError(`At most ${MAX_RESOLVED_REFERENCES} references can be resolved at once, got ${references.length}.`)
  }
  return references.map((reference, index) => {
    const parsed = canonicalReferenceSchema.safeParse(reference)
    if (!parsed.success) throw new EvidenceRequestError(`references.${index} is not a canonical reference: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
    return parsed.data
  })
}

/**
 * Resolves canonical references against the files as they stand, for the
 * evidence inspector: each one's standing, the record the files hold, and the
 * text at the reference - the lines its span names, else the record's own text
 * - cut to a bounded size. A reference to a record the files do not hold
 * resolves to its standing alone; nothing is made up for it.
 */
export const resolveReferences = (snapshot: RequestSnapshot, references: readonly CanonicalReference[]): ResolvedReference[] =>
  references.map((reference): ResolvedReference => {
    const check = checkReference(reference, snapshot)
    const status = check === 'foreign' ? 'unresolved' : check
    const derived = check === 'foreign' ? undefined : snapshot.record(reference.kind, reference.id)
    if (!derived) return { reference, status }

    const { input, owner } = derived
    const entity = snapshot.entity(owner)
    const record: NonNullable<ResolvedReference['record']> = {
      kind: input.kind,
      id: input.id,
      revision: input.revision,
      entity: owner,
      ...(entity ? { title: entity.title, type: entity.type } : {}),
      paths:
        input.kind === 'entity' ? [...input.paths] : input.kind === 'document' ? [input.source.path] : [...(input.recordedIn ?? [])]
    }

    const span = reference.span
    let excerpt: ResolvedReference['excerpt']
    if (input.kind === 'document') {
      const { startLine, endLine } = input.source
      const narrow = span?.path === input.source.path && span.startLine !== undefined && startLine !== undefined && status === 'resolved'
      const from = narrow ? (span.startLine as number) : startLine
      const to = narrow ? (span.endLine ?? span.startLine as number) : endLine
      const text = narrow && startLine !== undefined ? linesOf(input.text, startLine, from as number, to as number) : input.text
      excerpt = {
        path: input.source.path,
        ...(from !== undefined ? { startLine: from } : {}),
        ...(to !== undefined ? { endLine: to } : {}),
        ...bounded(text)
      }
    } else if (input.kind === 'observation') {
      const [source] = input.sources
      excerpt = {
        ...(source ? { path: source.path } : {}),
        ...(source?.startLine !== undefined ? { startLine: source.startLine } : {}),
        ...(source?.endLine !== undefined ? { endLine: source.endLine } : {}),
        ...bounded(input.text)
      }
    } else {
      // An entity's body, or the lines of one of its files when the reference names them.
      const file = span ? snapshot.record('document', span.path) : undefined
      if (file?.input.kind === 'document' && span?.startLine !== undefined && file.input.source.startLine !== undefined && status === 'resolved') {
        const to = span.endLine ?? span.startLine
        excerpt = {
          path: span.path,
          startLine: span.startLine,
          endLine: to,
          ...bounded(linesOf(file.input.text, file.input.source.startLine, span.startLine, to))
        }
      } else {
        excerpt = { path: input.path, ...bounded(input.content.trim()) }
      }
    }
    return { reference, status, record, excerpt }
  })
