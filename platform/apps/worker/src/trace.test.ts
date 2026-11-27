// SPDX-License-Identifier: AGPL-3.0-only
import type { CoordinatedAnswer } from '@chrisjowen/docket'
import type { AdapterAnswer } from '@chrisjowen/docket/contracts'
import { describe, expect, it } from 'vitest'

import { traceOf, tracedQuery } from './trace.js'

const adapterAnswer = (overrides: Partial<AdapterAnswer> & { description?: string; nativeQuery?: string } = {}): AdapterAnswer => {
  const { description = 'Neo4j full-text search', nativeQuery, ...rest } = overrides
  return {
    interpretation: { description, assumptions: [], ...(nativeQuery ? { nativeQuery } : {}) },
    blocks: [],
    evidence: [],
    coverage: { mode: 'top-k', truncated: false, scope: 'ws_1' },
    diagnostics: [],
    ...rest,
  }
}

const CYPHER_CALL = { purpose: 'cypher', model: 'anthropic/claude-haiku-5.5', promptTokens: 10, completionTokens: 5, costUsd: 0.001 }

describe('who wrote the query a store ran', () => {
  it('names the model that wrote Cypher, from the metered call', () => {
    const answer = adapterAnswer({ description: 'Read-only Cypher written by a model from the graph’s schema', nativeQuery: 'MATCH (n) RETURN n' })
    expect(tracedQuery('neo4j', answer, [CYPHER_CALL])).toEqual({ text: 'MATCH (n) RETURN n', by: 'model', model: 'anthropic/claude-haiku-5.5' })
  })

  it("calls the full-text query a template, with why it ran when the model's Cypher did not answer", () => {
    const answer = adapterAnswer({
      nativeQuery: 'CALL db.index.fulltext.queryNodes(...)',
      diagnostics: [{ severity: 'info', code: 'cypher-fallback', message: 'The Cypher query found nothing: MATCH (x) RETURN x' }],
    })
    expect(tracedQuery('neo4j', answer, [CYPHER_CALL])).toEqual({
      text: 'CALL db.index.fulltext.queryNodes(...)',
      by: 'template',
      fallback: 'The Cypher query found nothing: MATCH (x) RETURN x',
    })
  })

  it("names cognee's floored chunk search, which no model writes, so its results are told apart in Query replay", () => {
    const answer = adapterAnswer({ description: 'cognee chunk search of dataset "docket_org_a__ws_b"', nativeQuery: 'who owns orders?' })
    const query = tracedQuery('cognee', answer, [])
    expect(query).toMatchObject({ by: 'template' })
    expect(query?.text).toMatch(/^cognee CHUNKS search/)
    expect(query?.text).toContain('similarity floor')
  })

  it('describes the vector search mem0 runs, which no model writes', () => {
    expect(tracedQuery('mem0', adapterAnswer({ description: 'mem0 semantic search' }), [])).toMatchObject({ by: 'template' })
  })
})

describe('a trace', () => {
  const entities = new Map(Array.from({ length: 30 }, (_, i) => [`team.t${i}`, { title: `Team ${i}`, type: 'team' }]))
  const answer: CoordinatedAnswer = {
    requestId: 'r1',
    question: 'teams?',
    results: [
      {
        adapter: 'neo4j',
        state: 'answered',
        durationMs: 12.4,
        answer: adapterAnswer({
          nativeQuery: 'CALL db.index.fulltext.queryNodes(...)',
          evidence: [{ id: 'e1', text: 'SECRET BODY TEXT', canonicalRefs: [] } as never],
        }),
      },
      { adapter: 'mem0', state: 'failed', error: { code: 'unavailable', message: 'Qdrant did not answer' }, durationMs: 3 },
    ],
    synthesis: null,
    references: Array.from({ length: 30 }, (_, i) => ({
      kind: 'entity' as const,
      id: `team.t${i}`,
      entity: `team.t${i}`,
      status: i === 0 ? ('stale' as const) : ('resolved' as const),
      foundBy: [{ adapter: 'neo4j', blockIds: [], evidenceIds: [] }],
    })),
    connections: [{ nodes: ['team.t0', 'team.t1'], steps: [{ rel: 'owns', forward: true }] }],
    diagnostics: [],
  }

  it('names what each store found by id and title, bounded, and never copies evidence text', () => {
    const trace = traceOf({ question: 'teams?', answer, entities, calls: [] })
    const [graph, index] = trace.stores
    expect(graph).toMatchObject({ adapter: 'neo4j', state: 'answered', durationMs: 12, hitCount: 30, query: { by: 'template' } })
    expect(graph?.hits).toHaveLength(10)
    expect(graph?.hits[0]).toEqual({ id: 'team.t0', title: 'Team 0', type: 'team' })
    expect(index).toMatchObject({ adapter: 'mem0', state: 'failed', error: 'Qdrant did not answer', hitCount: 0 })
    expect(trace.answer.references).toHaveLength(20)
    expect(trace.answer.counts).toEqual({ resolved: 29, stale: 1, unresolved: 0 })
    expect(trace.answer.connections).toBe(1)
    expect(JSON.stringify(trace)).not.toContain('SECRET BODY TEXT')
  })

  it('keeps the error of a question that failed before any store answered, with any credential in it redacted', () => {
    expect(traceOf({ question: 'teams?', calls: [], error: 'pod asleep' })).toMatchObject({ stores: [], error: 'pod asleep', answer: { references: [] } })
    expect(traceOf({ question: 'teams?', calls: [], error: 'connect bolt://neo4j:hunter2@neo4j-org-1:7687 refused' }).error).toBe(
      'connect bolt://neo4j:[redacted]@neo4j-org-1:7687 refused',
    )
  })
})
