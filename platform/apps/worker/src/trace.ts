// SPDX-License-Identifier: AGPL-3.0-only
import type { CoordinatedAnswer } from '@chrisjowen/docket'
import type { AdapterAnswer } from '@chrisjowen/docket/contracts'
import { redactSecrets } from '@docket/platform-audit'
import type { QueryTraceDetail, TracedCall, TracedHit, TracedQuery, TracedStore } from '@docket/platform-canonical-store'

/**
 * A question's trace (Settings → Queries) from what the coordinator
 * answered: per store, how it read the question, the query it ran and who
 * wrote it, and the records it pointed at; then what went into the answer
 * and what it cost. Ids and titles only: no evidence excerpt or document
 * body is copied out of the answer, and every message and query is redacted
 * as a log line would be, so no credential an error carries is kept.
 */

/** Hits named per store, references named per answer: enough to replay, small enough to keep. */
const HITS_KEPT = 10
const REFERENCES_KEPT = 20
const NOTES_KEPT = 5
const TEXT_LIMIT = 4_000

/** The Neo4j adapter's own words when a model wrote the Cypher (`cypher-search.js`). */
const MODEL_CYPHER = 'Read-only Cypher written by '
/** What mem0 runs, in place of a query it does not report: no model writes it. */
const MEM0_QUERY = "Nearest-neighbour search over the workspace's memories in Qdrant, with the question embedded on the box"
/** What cognee runs (docket's cognee adapter): no model writes it, and none answers it. */
const COGNEE_QUERY =
  "cognee CHUNKS search over the workspace's own dataset, with the question embedded on the box; chunks under the workspace's similarity floor are left out, so it may answer with nothing"

const clip = (text: string, limit = TEXT_LIMIT) => {
  const safe = redactSecrets(text)
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe
}

/** Who wrote the query a store ran: the template, or the model the question's metering names. */
export function tracedQuery(adapter: string, answer: AdapterAnswer, calls: readonly TracedCall[]): TracedQuery | undefined {
  const { description, nativeQuery } = answer.interpretation
  if (description.startsWith(MODEL_CYPHER)) {
    const model = calls.find((call) => call.purpose === 'cypher')?.model
    return { text: clip(nativeQuery ?? ''), by: 'model', ...(model ? { model } : {}) }
  }
  if (adapter === 'cognee') return { text: COGNEE_QUERY, by: 'template' }
  const fallback = answer.diagnostics.find((diagnostic) => diagnostic.code === 'cypher-fallback')?.message
  if (nativeQuery) return { text: clip(nativeQuery), by: 'template', ...(fallback ? { fallback: clip(fallback, 1_000) } : {}) }
  if (adapter === 'mem0') return { text: MEM0_QUERY, by: 'template' }
  return undefined
}

export interface TraceInput {
  question: string
  answer?: CoordinatedAnswer
  /** Titles and types of the workspace's exhibits, to name what the stores found. */
  entities?: ReadonlyMap<string, { title: string; type: string }>
  read?: QueryTraceDetail['read']
  calls: readonly TracedCall[]
  notice?: string
  error?: string
}

export function traceOf(input: TraceInput): QueryTraceDetail {
  const { answer, entities = new Map() } = input
  const named = (id: string): TracedHit => {
    const entity = entities.get(id)
    return entity ? { id, title: entity.title, type: entity.type } : { id }
  }
  const references = answer?.references ?? []
  const stores: TracedStore[] = (answer?.results ?? []).map((result) => {
    const found = [...new Set(references.filter((reference) => reference.foundBy.some((by) => by.adapter === result.adapter)).map((reference) => reference.entity ?? reference.id))]
    const base = {
      adapter: result.adapter,
      ...(result.durationMs !== undefined ? { durationMs: Math.round(result.durationMs) } : {}),
      hits: found.slice(0, HITS_KEPT).map(named),
      hitCount: found.length,
    }
    if (result.state === 'failed') return { ...base, state: 'failed', error: clip(result.error.message, 1_000), notes: (result.issues ?? []).slice(0, NOTES_KEPT).map((issue) => clip(issue, 500)) }
    const adapterAnswer = result.answer
    const query = tracedQuery(result.adapter, adapterAnswer, input.calls)
    const rows = adapterAnswer.blocks.reduce((sum, block) => sum + (block.kind === 'table' ? block.rows.length : 0), 0)
    return {
      ...base,
      state: 'answered',
      interpretation: clip(adapterAnswer.interpretation.description, 1_000),
      assumptions: adapterAnswer.interpretation.assumptions.slice(0, NOTES_KEPT).map((text) => clip(text, 500)),
      ...(query ? { query } : {}),
      coverage: { mode: adapterAnswer.coverage.mode, truncated: adapterAnswer.coverage.truncated },
      ...(rows > 0 ? { rows } : {}),
      ...(result.freshness ? { freshness: { state: result.freshness.state, ...(result.freshness.behind !== undefined ? { behind: result.freshness.behind } : {}) } } : {}),
      notes: adapterAnswer.diagnostics
        .filter((diagnostic) => diagnostic.code !== 'cypher-fallback')
        .slice(0, NOTES_KEPT)
        .map((diagnostic) => clip(diagnostic.message, 500)),
    }
  })
  const counts = { resolved: 0, stale: 0, unresolved: 0 }
  for (const reference of references) counts[reference.status] += 1
  const synthesis = answer?.synthesis
  return {
    question: input.question,
    read: input.read ?? { exhibits: 0, documents: 0, indexBehind: 0, indexSynced: false },
    stores,
    answer: {
      references: references.slice(0, REFERENCES_KEPT).map((reference) => {
        const entity = reference.entity ? entities.get(reference.entity) : undefined
        return {
          id: reference.id,
          ...(reference.entity ? { entity: reference.entity } : {}),
          ...(entity ? { title: entity.title } : {}),
          kind: reference.kind,
          status: reference.status,
          foundBy: reference.foundBy.map((by) => by.adapter),
        }
      }),
      counts,
      connections: answer?.connections?.length ?? 0,
      ...(synthesis
        ? { synthesis: { model: synthesis.model, citedEntities: synthesis.citedEntities.slice(0, REFERENCES_KEPT), citedEvidence: synthesis.citedEvidence.length } }
        : {}),
      ...(input.notice ? { notice: input.notice } : {}),
    },
    calls: [...input.calls],
    ...(input.error ? { error: clip(input.error, 1_000) } : {}),
  }
}
