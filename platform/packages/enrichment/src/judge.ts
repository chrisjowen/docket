// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatMessage, ModelClient } from '@docket/platform-ai'

import type { Candidate } from './detect.js'

/** The job's monthly AI limit is spent: the rest of the run goes without AI review. */
export class EnrichmentLimitReached extends Error {
  override name = 'EnrichmentLimitReached'
  constructor(
    readonly spentUsd: number,
    readonly limitUsd: number,
  ) {
    super(`The enrichment job has spent $${spentUsd.toFixed(2)} of its $${limitUsd.toFixed(2)} monthly AI limit.`)
  }
}

/** A resource as the reviewer sees it: enough to judge, never a whole document. */
export interface Brief {
  id: string
  type: string
  title: string
  /** The start of its description. */
  excerpt: string
}

/** The reviewer's answer for one candidate: the relationship it chose, or none, and why. */
export interface Verdict {
  rel: string | null
  reasoning: string
}

/** Candidates the rules leave open, reviewed by a model in batches. */
export const REVIEW_BATCH = 20
const EXCERPT = 280
const REASONING = 400

export const briefOf = (resource: { id: string; type: string; title: string; content: string }): Brief => ({
  id: resource.id,
  type: resource.type,
  title: resource.title,
  excerpt: resource.content.replace(/\s+/g, ' ').trim().slice(0, EXCERPT),
})

const SYSTEM = [
  "You review inferences about a software organisation's knowledge graph.",
  'Each candidate says why two resources look related and which relationships the ontology allows between them.',
  'Accept a candidate only when the evidence clearly supports one of the allowed relationships; otherwise reject it.',
  'Answer with JSON only: {"verdicts":[{"n":<candidate number>,"rel":"<one allowed relationship>" or null,"reasoning":"<one sentence>"}]}.',
].join(' ')

/** The prompt for one batch: each candidate with its two resources and the relationships that fit. */
export function reviewPrompt(batch: readonly Candidate[], briefs: ReadonlyMap<string, Brief>): ChatMessage[] {
  const describe = (id: string) => {
    const brief = briefs.get(id)
    return brief ? `${brief.id} (${brief.type}) "${brief.title}"${brief.excerpt ? `: ${brief.excerpt}` : ''}` : id
  }
  const lines = batch.map((candidate, index) =>
    [
      `${index + 1}. from ${describe(candidate.from)}`,
      `   to ${describe(candidate.target)}`,
      `   why: ${candidate.reasoning}`,
      `   allowed: ${candidate.rels.join(', ')}`,
    ].join('\n'),
  )
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Candidates:\n${lines.join('\n')}` },
  ]
}

/** Reads a model's answer: a verdict per candidate it judged, an allowed relationship or none. Anything else is no verdict. */
export function parseVerdicts(text: string, batch: readonly Candidate[]): (Verdict | null)[] {
  const out: (Verdict | null)[] = batch.map(() => null)
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return out
  }
  const verdicts = (parsed as { verdicts?: unknown }).verdicts
  if (!Array.isArray(verdicts)) return out
  for (const entry of verdicts) {
    if (typeof entry !== 'object' || entry === null) continue
    const { n, rel, reasoning } = entry as { n?: unknown; rel?: unknown; reasoning?: unknown }
    const candidate = typeof n === 'number' && Number.isInteger(n) ? batch[n - 1] : undefined
    if (!candidate || out[n as number - 1]) continue
    const text = typeof reasoning === 'string' ? reasoning.trim().slice(0, REASONING) : ''
    if (rel === null) out[(n as number) - 1] = { rel: null, reasoning: text }
    else if (typeof rel === 'string' && candidate.rels.includes(rel) && text) out[(n as number) - 1] = { rel, reasoning: text }
  }
  return out
}

export interface Reviewer {
  /** Checked before every model call: throws `EnrichmentLimitReached` once the job's limit is spent. */
  beforeCall(): Promise<void>
  model: ModelClient
}

/**
 * Reviews candidates in batches, stopping at the first refusal of the limit or
 * the org's cap (which it rethrows), and once `room` says nothing more could
 * be written: no batch is larger than the room left.
 */
export async function review(
  reviewer: Reviewer,
  candidates: readonly Candidate[],
  briefs: ReadonlyMap<string, Brief>,
  onBatch: (batch: readonly Candidate[], verdicts: readonly (Verdict | null)[]) => Promise<void>,
  room: () => number = () => Infinity,
): Promise<{ calls: number }> {
  let calls = 0
  for (let start = 0; start < candidates.length; ) {
    const size = Math.min(REVIEW_BATCH, room())
    if (size <= 0) break
    const batch = candidates.slice(start, start + size)
    start += batch.length
    await reviewer.beforeCall()
    const answer = await reviewer.model.chat(reviewPrompt(batch, briefs))
    calls += 1
    await onBatch(batch, parseVerdicts(answer, batch))
  }
  return { calls }
}
