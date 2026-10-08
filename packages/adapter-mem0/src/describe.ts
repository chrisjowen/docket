import type { Assessment, EvidenceRecord } from '@docket/contracts'

/** Where an observation points, as one line: `src/db.ts:12-40 OrdersRepository at 3f2c1d0`. */
export const describeLocation = (evidence: EvidenceRecord): string => {
  const parts: string[] = []
  if (evidence.repository) parts.push(evidence.repository)
  if (evidence.path) parts.push(evidence.lines ? `${evidence.path}:${evidence.lines}` : evidence.path)
  if (evidence.symbol) parts.push(evidence.symbol)
  if (evidence.key) parts.push(`key ${evidence.key}`)
  if (evidence.endpoint) parts.push(evidence.method ? `${evidence.method} ${evidence.endpoint}` : evidence.endpoint)
  if (evidence.commit) parts.push(`at ${evidence.commit}`)
  parts.push(...(evidence.urls ?? []))
  return parts.join(' ')
}

/** One observation for a reader: `code: src/db.ts:12-40 OrdersRepository - opens the pool (2026-10-05, claude)`. */
export const describeEvidence = (evidence: EvidenceRecord): string => {
  const location = describeLocation(evidence)
  const when = [evidence.observedAt, evidence.observedBy].filter(Boolean).join(', ')
  return [
    `${evidence.source}:`,
    ...(location ? [location] : []),
    ...(evidence.note ? [`- ${evidence.note}`] : []),
    ...(when ? [`(${when})`] : [])
  ].join(' ')
}

/** How far to trust something and why: `0.93 from code, runtime (3 observations)`. */
export const describeAssessment = (assessment: Assessment): string => {
  switch (assessment.basis) {
    case 'evidence': {
      const count = assessment.evidenceCount
      return `${assessment.confidence} from ${assessment.sources.join(', ')} (${count} observation${count === 1 ? '' : 's'})`
    }
    case 'stated':
      return `${assessment.confidence} as stated, no evidence recorded`
    case 'unevidenced':
      return `${assessment.confidence}, no evidence recorded`
  }
}
