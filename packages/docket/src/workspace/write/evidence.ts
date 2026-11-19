import { EVIDENCE_LOCATION_FIELDS, type Diagnostic } from '../docket.js'
import type { EvidenceInput, StampedEvidence, Writer } from './inputs.js'

const LOCATION_FIELDS: readonly string[] = EVIDENCE_LOCATION_FIELDS
/** The order evidence fields are written in. */
const EVIDENCE_ORDER = ['source', ...LOCATION_FIELDS, 'note', 'observedAt', 'observedBy', 'session', 'reportedBy']

/** An error that refuses a write, at the document and resource it is about. */
export const refuse = (code: string, message: string, where: { path?: string; id?: string } = {}): Diagnostic => ({
  severity: 'error',
  code,
  message,
  ...where
})

export const hasErrors = (diagnostics: readonly Diagnostic[]): boolean => diagnostics.some((d) => d.severity === 'error')

/**
 * docket's diagnostics for a written document, unchanged.
 *
 * @deprecated docket's parser now accepts `reportedBy`, so there is no warning
 * about it left to drop. Kept for `@chrisjowen/docket-server`, which also
 * runs with docket 0.15.0.
 */
export function writeDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics]
}

/** Stamps a client's evidence: the writer observed it, in this request, now unless the client said when. */
export function stampEvidence(entry: EvidenceInput, writer: Pick<Writer, 'label' | 'requestId'>, now: Date): StampedEvidence {
  const out: Record<string, unknown> = { source: entry.source }
  for (const field of LOCATION_FIELDS) {
    const value = entry[field as keyof EvidenceInput]
    if (value !== undefined) out[field] = value
  }
  if (entry.note !== undefined) out.note = entry.note
  out.observedAt = entry.observedAt ?? now.toISOString()
  out.observedBy = writer.label
  out.session = writer.requestId
  if (entry.observedBy !== undefined && entry.observedBy !== writer.label) out.reportedBy = entry.observedBy
  return out as unknown as StampedEvidence
}

/**
 * What makes two entries the same observation, for idempotent writes: all of
 * an entry but when and in which session it was recorded. The same writer
 * sending the same evidence again adds nothing.
 */
export function evidenceKey(entry: Record<string, unknown>): string {
  const keyed: Record<string, unknown> = {}
  for (const field of EVIDENCE_ORDER) {
    if (field === 'observedAt' || field === 'session') continue
    if (entry[field] !== undefined) keyed[field] = entry[field]
  }
  return JSON.stringify(keyed)
}

/** An entry with its fields in the order evidence is written in, any others after. */
export function orderedEvidence(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of EVIDENCE_ORDER) if (entry[field] !== undefined) out[field] = entry[field]
  for (const [field, value] of Object.entries(entry)) if (!(field in out)) out[field] = value
  return out
}

/** A refusal when a write gives no evidence for `subject`; none when it gives some. */
export function evidenceProblems(evidence: readonly EvidenceInput[], subject: string, where: { path: string; id: string }): Diagnostic[] {
  return evidence.length === 0
    ? [refuse('missing-evidence', `Give at least one piece of evidence for ${subject}: where it was seen, as a source the ontology registers.`, where)]
    : []
}
