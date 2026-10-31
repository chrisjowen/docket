import { describe, expect, it } from 'vitest'

import { validateAdapterAnswer, type AskRequest, type GraphBlock } from '@docket/contracts'

import { scopeProblem } from './cypher-guard.js'
import { describePath, matchesOf, subgraphAnswer, subgraphQuery, type MatchPath } from './subgraph-search.js'

const SCOPE = 'payments'

const request = (maxResults = 10, maxEvidenceBytes = 100_000): Pick<AskRequest, 'question' | 'context' | 'budget'> => ({
  question: 'what do orders depend on?',
  context: { scope: SCOPE, now: '2026-10-31T00:00:00.000Z', timezone: 'UTC' },
  budget: { maxResults, maxEvidenceBytes, deadline: '2026-10-31T00:01:00.000Z' }
})

/** A node as the query projects it. */
const node = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, type: id.split('.')[0], hash: `sha256:${id}`, stub: false, ...extra })
const edge = (source: string, rel: string, target: string, confidence = 0.9, sources = ['code']) => ({ source, rel, target, confidence, sources })

/** The scout report's case: orders depends on ledger, which depends on ledger-db; payments owns orders. */
const ordersRow = () => ({
  id: 'service.orders',
  title: 'Orders',
  content: 'Takes orders and stores them in the ledger.\n',
  hash: 'sha256:service.orders',
  score: 2.5,
  paths: [
    {
      nodes: [node('service.orders'), node('service.ledger')],
      edges: [edge('service.orders', 'depends_on', 'service.ledger', 0.95, ['code', 'manifest'])]
    },
    {
      nodes: [node('service.orders'), node('service.ledger'), node('datasource.ledger-db', { stub: true, hash: null, title: null, type: null })],
      edges: [edge('service.orders', 'depends_on', 'service.ledger', 0.95, ['code', 'manifest']), edge('service.ledger', 'depends_on', 'datasource.ledger-db', 0.9, ['runtime'])]
    },
    {
      nodes: [node('service.orders'), node('team.payments')],
      edges: [edge('team.payments', 'owns', 'service.orders', 0.6, [])]
    }
  ]
})

describe('subgraphQuery', () => {
  it('keeps every node it reads in scope, as a model-written query must', () => {
    for (const hops of [1, 2, 3]) expect(scopeProblem(subgraphQuery(hops))).toBeUndefined()
  })

  it('writes only a whole number of hops into the query', () => {
    expect(subgraphQuery(2)).toContain('[*1..2]')
    for (const hops of [0, 4, 1.5, Number.NaN]) expect(() => subgraphQuery(hops)).toThrow(/1 to 3 hops/)
  })
})

describe('matchesOf', () => {
  it('drops a path another one extends, and keeps stubs as stubs', () => {
    const [orders] = matchesOf([ordersRow()])

    expect(orders?.paths.map((path) => path.nodes.map((n) => n.id))).toEqual([
      ['service.orders', 'service.ledger', 'datasource.ledger-db'],
      ['service.orders', 'team.payments']
    ])
    expect(orders?.paths[0]?.nodes[2]).toEqual({ id: 'datasource.ledger-db', stub: true })
  })

  it('keeps the best three paths, none visiting a node twice', () => {
    const leaf = (id: string) => ({ nodes: [node('service.orders'), node(id)], edges: [edge('service.orders', 'uses', id)] })
    const loop = {
      nodes: [node('service.orders'), node('service.a'), node('service.orders')],
      edges: [edge('service.orders', 'uses', 'service.a'), edge('service.a', 'calls', 'service.orders')]
    }
    const [orders] = matchesOf([{ ...ordersRow(), paths: [loop, leaf('service.a'), leaf('service.b'), leaf('service.c'), leaf('service.d')] }])

    expect(orders?.paths.map((path) => path.nodes.at(-1)?.id)).toEqual(['service.a', 'service.b', 'service.c'])
  })

  it('reads a match with no paths', () => {
    expect(matchesOf([{ id: 'service.lonely', title: 'Lonely', content: null, hash: 'sha256:l', score: 1, paths: [] }])).toEqual([
      { id: 'service.lonely', title: 'Lonely', hash: 'sha256:l', score: 1, paths: [] }
    ])
  })
})

describe('describePath', () => {
  it('draws each relationship in its stored direction, and with why how far it holds', () => {
    const path: MatchPath = {
      nodes: [{ id: 'service.ledger', stub: false }, { id: 'service.orders', stub: false }, { id: 'team.payments', stub: false }],
      edges: [
        { source: 'service.orders', rel: 'depends_on', target: 'service.ledger', confidence: 0.951, sources: ['code', 'manifest'] },
        { source: 'team.payments', rel: 'owns', target: 'service.orders', sources: [] }
      ]
    }

    expect(describePath(path)).toBe('service.ledger <-depends_on- service.orders <-owns- team.payments')
    expect(describePath(path, true)).toBe('service.ledger <-depends_on- service.orders (0.95, code+manifest) <-owns- team.payments')
  })
})

describe('subgraphAnswer', () => {
  const interpretation = { description: 'Neo4j full-text search', assumptions: [], nativeQuery: 'CALL ...' }

  it('answers with the matches, the paths from them and why each holds', () => {
    const answer = subgraphAnswer(matchesOf([ordersRow()]), request(), interpretation)

    expect(validateAdapterAnswer(answer, request())).toEqual(answer)
    expect(answer.blocks.map((block) => block.kind)).toEqual(['entities', 'graph', 'passages'])
    // Only the full-text match is an entity: what its paths reach is context.
    expect(answer.blocks[0]).toEqual({
      kind: 'entities',
      id: 'hits',
      evidenceIds: ['passage-1'],
      entities: [
        {
          ref: { kind: 'entity', id: 'service.orders', revision: 'sha256:service.orders' },
          score: 2.5,
          detail: 'service.orders -depends_on-> service.ledger -depends_on-> datasource.ledger-db; service.orders <-owns- team.payments'
        }
      ]
    })
    const graph = answer.blocks[1] as GraphBlock
    expect(graph.paths).toEqual([
      ['service.orders', 'service.ledger', 'datasource.ledger-db'],
      ['service.orders', 'team.payments']
    ])
    expect(graph.nodes).toContainEqual({ id: 'datasource.ledger-db', label: 'datasource.ledger-db' })
    expect(graph.nodes).toContainEqual({
      id: 'service.ledger',
      label: 'service.ledger',
      type: 'service',
      ref: { kind: 'entity', id: 'service.ledger', revision: 'sha256:service.ledger' }
    })
    expect(graph.edges).toEqual([
      { source: 'service.orders', target: 'service.ledger', rel: 'depends_on', confidence: 0.95, evidenceIds: ['path-1'] },
      { source: 'service.ledger', target: 'datasource.ledger-db', rel: 'depends_on', confidence: 0.9, evidenceIds: ['path-1'] },
      { source: 'team.payments', target: 'service.orders', rel: 'owns', confidence: 0.6, evidenceIds: ['path-2'] }
    ])
    expect(answer.evidence.filter((item) => item.kind === 'derived-fact')).toEqual([
      {
        id: 'path-1',
        kind: 'derived-fact',
        text: 'service.orders -depends_on-> service.ledger (0.95, code+manifest) -depends_on-> datasource.ledger-db (0.9, runtime)',
        // The stub is no entity the files hold, so the fact cites the two that are.
        canonicalRefs: [
          { kind: 'entity', id: 'service.orders', revision: 'sha256:service.orders' },
          { kind: 'entity', id: 'service.ledger', revision: 'sha256:service.ledger' }
        ],
        derivation: { engine: 'neo4j' }
      },
      expect.objectContaining({ id: 'path-2', text: 'service.orders <-owns- team.payments (0.6)' })
    ])
    expect(answer.coverage).toEqual({ mode: 'top-k', truncated: false, scope: SCOPE })
  })

  it('cites every path a relationship lies on', () => {
    const row = ordersRow()
    const second = { ...row, id: 'service.ledger', score: 1, paths: [row.paths[0] as (typeof row.paths)[number]] }
    const answer = subgraphAnswer(matchesOf([row, second]), request(), interpretation)

    const graph = answer.blocks.find((block) => block.kind === 'graph') as GraphBlock
    expect(graph.edges[0]).toMatchObject({ source: 'service.orders', target: 'service.ledger', evidenceIds: ['path-1', 'path-3'] })
    expect(validateAdapterAnswer(answer, request())).toEqual(answer)
  })

  it('still draws the paths whose why no longer fits the evidence budget, and says it was cut', () => {
    const passage = 'Takes orders and stores them in the ledger.'
    const answer = subgraphAnswer(matchesOf([ordersRow()]), request(10, Buffer.byteLength(passage) + 50), interpretation)

    // The long path's why is left out; the short one's still fits.
    expect(answer.evidence.map((item) => [item.id, item.text])).toEqual([
      ['passage-1', passage],
      ['path-1', 'service.orders <-owns- team.payments (0.6)']
    ])
    const graph = answer.blocks.find((block) => block.kind === 'graph') as GraphBlock
    expect(graph.paths).toHaveLength(2)
    expect(graph.edges[0]).toEqual({ source: 'service.orders', target: 'service.ledger', rel: 'depends_on', confidence: 0.95 })
    expect(graph.edges.at(-1)).toMatchObject({ rel: 'owns', evidenceIds: ['path-1'] })
    expect(answer.coverage.truncated).toBe(true)
    expect(validateAdapterAnswer(answer, request())).toEqual(answer)
  })

  it('has no graph for matches with no paths', () => {
    const answer = subgraphAnswer(matchesOf([{ ...ordersRow(), paths: [] }]), request(), interpretation)

    expect(answer.blocks.map((block) => block.kind)).toEqual(['entities', 'passages'])
  })

  it('keeps only the paths of the matches it shows', () => {
    const row = ordersRow()
    const answer = subgraphAnswer(matchesOf([row, { ...row, id: 'service.other', score: 1 }]), request(1), interpretation)

    expect((answer.blocks.find((block) => block.kind === 'graph') as GraphBlock).paths).toHaveLength(2)
    expect(answer.coverage.truncated).toBe(true)
  })
})
