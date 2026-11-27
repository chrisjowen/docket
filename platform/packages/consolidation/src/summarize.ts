// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'

import type { ChatMessage } from '@docket/platform-ai'

import type { Neighbourhood } from './walk.js'

/** The org's model as summaries use it: the text it answered, and the model that answered it. */
export interface SummaryModel {
  chat(messages: ChatMessage[], options?: { signal?: AbortSignal | undefined }): Promise<{ text: string; model: string }>
}

export interface SummaryResult {
  text: string
  /** The model that wrote it. */
  model: string
  confidence: number
  citedEvidence: string[]
}

/** How much of the target's notes the model is shown. */
const NOTES = 4_000

/**
 * Builds the prompt for narrative summarization. Emphasizes relationships
 * and observations over restating graph attributes.
 */
export function summaryPrompt(n: Neighbourhood): ChatMessage[] {
  const lines: string[] = []
  lines.push(`Entity: ${n.target.id} (${n.target.type}) "${n.target.title}"`)
  if (n.target.attributes && Object.keys(n.target.attributes).length) {
    lines.push(`Attributes: ${JSON.stringify(n.target.attributes)}`)
  }
  if (n.target.content) {
    lines.push(`Notes: ${n.target.content.slice(0, NOTES)}`)
  }
  lines.push('')
  if (n.direct.length) {
    lines.push('Direct relationships:')
    for (const d of n.direct) {
      lines.push(`- ${d.rel} → ${d.id} (${d.type}) "${d.title}"${d.attributes ? ' ' + JSON.stringify(d.attributes) : ''}`)
    }
  }
  if (n.context.length) {
    lines.push('')
    lines.push('Context (neighbours of neighbours):')
    for (const c of n.context) {
      lines.push(`- ${c.id} (${c.type}) via ${c.via}`)
    }
  }
  if (n.evidence.length) {
    lines.push('')
    lines.push('Evidence notes:')
    for (const e of n.evidence) {
      lines.push(`- [${e.id}] ${e.note ?? e.path}`)
    }
  }
  lines.push('')
  lines.push('Write a concise narrative summary of this entity and its relationships.')
  lines.push('Focus on observed interactions, roles, and notable facts from evidence.')
  lines.push('Do NOT restate the graph attributes or list IDs.')
  lines.push('Example: "Alice Hong sent Chris an email about Q3 planning. She seemed dismissive about Sophia\'s auth proposal."')
  lines.push('Cite evidence by id in parentheses when relevant. Mark uncertain statements (low confidence).')
  lines.push('Keep under 300 words. Write in prose, not bullets.')

  return [
    {
      role: 'system',
      content: 'You are reviewing a knowledge graph of a software organization. Synthesize narrative summaries from neighbourhoods. Never restate obvious graph data; describe relationships and observations.',
    },
    { role: 'user', content: lines.join('\n') },
  ]
}

/** What a prompt says and what its neighbourhood was read from, as a fingerprint: the same neighbourhood always gives the same one. */
export const fingerprintOf = (n: Neighbourhood, prompt: readonly ChatMessage[]): string =>
  createHash('sha256').update(JSON.stringify([prompt, n.digest])).digest('hex')

/**
 * How far a summary can be trusted: never further than its evidence. The
 * resource's own confidence, capped by the mean confidence of the evidence
 * the summary cites - or, when it cites none, of all the evidence it was given.
 */
export function confidenceOf(n: Neighbourhood, citedEvidence: readonly string[]): number {
  const cited = n.evidence.filter((e) => citedEvidence.includes(e.id))
  const basis = cited.length ? cited : n.evidence
  const mean = basis.length ? basis.reduce((sum, e) => sum + e.confidence, 0) / basis.length : n.target.confidence
  return Number(Math.min(n.target.confidence, mean).toFixed(2))
}

/**
 * Asks the model for a neighbourhood's narrative summary (`prompt` from
 * `summaryPrompt`), and reads which evidence it cited: the ids it names in
 * brackets or parentheses, alone or in a group split by commas or
 * semicolons, that are evidence it was given. None when it names none. The
 * caller decides whether the text is long enough to keep.
 */
export async function summarize(n: Neighbourhood, prompt: ChatMessage[], model: SummaryModel, signal?: AbortSignal): Promise<SummaryResult> {
  const answer = await model.chat(prompt, { signal })
  const text = answer.text.trim()

  const known = new Set(n.evidence.map((e) => e.id))
  const cited = new Set<string>()
  for (const m of text.matchAll(/\[([^\]]+)\]|\(([^)]+)\)/g)) {
    for (const id of (m[1] ?? m[2] ?? '').split(/[,;]/)) if (known.has(id.trim())) cited.add(id.trim())
  }
  const citedEvidence = [...cited]

  return { text, model: answer.model, confidence: confidenceOf(n, citedEvidence), citedEvidence }
}
