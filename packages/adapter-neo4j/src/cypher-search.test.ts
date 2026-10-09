import neo4j, { type Node, type Record as Neo4jRecord, type Relationship } from 'neo4j-driver'
import { describe, expect, it, vi } from 'vitest'

import { validateAdapterAnswer, type AskRequest, type MetricBlock, type TableBlock } from '@docket/contracts'
import type { ChatPrompt } from '@docket/adapter-kit'

import { cypherAnswer, rowsAnswer, type CypherPort, type CypherRun } from './cypher-search.js'
import { neo4jValues } from './neo4j-projection.js'

const SCOPE = 'payments'

let element = 0
const node = (id: string, properties: Record<string, unknown> = {}, labels = ['Memory']): Node =>
  new neo4j.types.Node(neo4j.int((element += 1)), labels, { scope: SCOPE, id, title: id, hash: `sha256:${id}`, stub: false, ...properties }, `n-${id}-${element}`)

const relationship = (start: Node, rel: string, end: Node): Relationship =>
  new neo4j.types.Relationship(
    neo4j.int((element += 1)),
    start.identity,
    end.identity,
    rel.toUpperCase(),
    { rel },
    `r-${element}`,
    start.elementId,
    end.elementId
  )

const record = (values: Record<string, unknown>): Neo4jRecord =>
  new neo4j.types.Record(Object.keys(values), Object.values(values)) as Neo4jRecord

/** A port over fixed rows: what a real session would return, with the real driver's type guards. */
const port = (records: Neo4jRecord[], documents: Record<string, string> = {}): CypherPort & { read: ReturnType<typeof vi.fn> } => ({
  scope: SCOPE,
  schema: async () => ({ labels: [{ label: 'Deployment', count: 4 }], patterns: [] }),
  read: vi.fn(async () => records),
  documents: async (ids) => new Map(ids.filter((id) => id in documents).map((id) => [id, documents[id]])),
  ...neo4jValues(neo4j)
})

const request = (maxResults = 10): Pick<AskRequest, 'question' | 'context' | 'budget'> => ({
  question: 'How many deployments of orders in the last four weeks?',
  context: { scope: SCOPE, now: '2026-10-09T00:00:00.000Z', timezone: 'UTC' },
  budget: { maxResults, maxEvidenceBytes: 100_000, deadline: '2026-10-09T00:01:00.000Z' }
})

const run = (records: Neo4jRecord[], cypher = 'MATCH (d:Memory:Deployment {scope: $scope}) RETURN count(d) AS deployments\nLIMIT 11', limit = 11): CypherRun => ({
  cypher,
  records,
  limit,
  retried: false
})

describe('rowsAnswer', () => {
  it('keeps a count as an exhaustive metric, not a list of documents', () => {
    const records = [record({ deployments: neo4j.int(4) })]
    const answer = rowsAnswer(port(records), { request: request(), run: run(records), writtenBy: 'Ollama qwen', hits: [] })

    expect(validateAdapterAnswer(answer, request())).toEqual(answer)
    expect(answer.blocks).toEqual([
      { kind: 'metric', id: 'metric-1', label: 'deployments', value: 4, evidenceIds: ['row-1'] }
    ])
    expect(answer.evidence).toEqual([
      { id: 'row-1', kind: 'derived-fact', text: 'deployments: 4', canonicalRefs: [], derivation: { engine: 'neo4j' } }
    ])
    expect(answer.coverage).toEqual({ mode: 'exhaustive', truncated: false, scope: SCOPE })
    expect(answer.interpretation.nativeQuery).toContain('count(d)')
  })

  it('keeps grouped counts as a typed table, every row with its own evidence', () => {
    const orders = node('service.orders', { title: 'Orders', type: 'service' })
    const records = [
      record({ service: orders, deployments: neo4j.int(3), last: new neo4j.types.Date(2026, 10, 1) }),
      record({ service: node('service.billing'), deployments: neo4j.int(1), last: null })
    ]
    const answer = rowsAnswer(port(records), {
      request: request(),
      run: run(records, 'MATCH (s:Memory {scope: $scope})<-[:OF]-(d) RETURN s AS service, count(d) AS deployments, max(d.on) AS last\nLIMIT 11'),
      writtenBy: 'a model',
      hits: [{ id: 'service.orders', revision: 'sha256:service.orders' }]
    })

    expect(validateAdapterAnswer(answer, request())).toEqual(answer)
    const table = answer.blocks.find((block): block is TableBlock => block.kind === 'table')
    expect(table?.columns).toEqual([
      { key: 'service', label: 'service', type: 'reference' },
      { key: 'deployments', label: 'deployments', type: 'integer' },
      { key: 'last', label: 'last', type: 'date' }
    ])
    expect(table?.rows).toEqual([
      {
        cells: { service: { kind: 'entity', id: 'service.orders', revision: 'sha256:service.orders' }, deployments: 3, last: '2026-10-01' },
        evidenceIds: ['row-1']
      },
      {
        cells: { service: { kind: 'entity', id: 'service.billing', revision: 'sha256:service.billing' }, deployments: 1, last: null },
        evidenceIds: ['row-2']
      }
    ])
    expect(answer.evidence[0]).toMatchObject({
      text: 'service: service.orders; deployments: 3; last: 2026-10-01',
      canonicalRefs: [{ kind: 'entity', id: 'service.orders', revision: 'sha256:service.orders' }]
    })
    expect(answer.blocks.find((block) => block.kind === 'entities')).toMatchObject({
      entities: [{ ref: { kind: 'entity', id: 'service.orders', revision: 'sha256:service.orders' } }]
    })
    expect(answer.coverage.mode).toBe('exhaustive')
  })

  it('keeps a count past the safe integer range as a decimal string, never a rounded number', () => {
    const records = [record({ label: 'events', total: neo4j.int('9007199254740993') })]
    const answer = rowsAnswer(port(records), { request: request(), run: run(records), writtenBy: 'a model', hits: [] })

    expect(validateAdapterAnswer(answer, request())).toEqual(answer)
    expect(answer.blocks).toEqual([
      expect.objectContaining({
        kind: 'table',
        columns: [
          { key: 'label', label: 'label', type: 'string' },
          { key: 'total', label: 'total', type: 'decimal' }
        ],
        rows: [{ cells: { label: 'events', total: '9007199254740993' }, evidenceIds: ['row-1'] }]
      })
    ])
  })

  it('shows relationships among the rows as a graph, each edge citing its row', () => {
    const orders = node('service.orders', { type: 'service' })
    const ledger = node('datasource.ledger', { type: 'datasource' })
    const stub = node('team.ghost', { stub: true, title: undefined })
    const records = [
      record({ s: orders, r: relationship(orders, 'depends_on', ledger), d: ledger }),
      record({ s: orders, r: relationship(orders, 'owned_by', stub), d: stub })
    ]
    const answer = rowsAnswer(port(records), { request: request(), run: run(records, 'MATCH (s:Memory {scope: $scope})-[r]->(d) RETURN s, r, d\nLIMIT 11'), writtenBy: 'a model', hits: [] })

    expect(validateAdapterAnswer(answer, request())).toEqual(answer)
    expect(answer.blocks.find((block) => block.kind === 'graph')).toEqual({
      kind: 'graph',
      id: 'graph',
      title: 'Relationships in the rows',
      evidenceIds: [],
      nodes: [
        { id: 'service.orders', label: 'service.orders', type: 'service', ref: { kind: 'entity', id: 'service.orders', revision: 'sha256:service.orders' } },
        { id: 'datasource.ledger', label: 'datasource.ledger', type: 'datasource', ref: { kind: 'entity', id: 'datasource.ledger', revision: 'sha256:datasource.ledger' } },
        { id: 'team.ghost', label: 'team.ghost' }
      ],
      edges: [
        { source: 'service.orders', target: 'datasource.ledger', rel: 'depends_on', evidenceIds: ['row-1'] },
        { source: 'service.orders', target: 'team.ghost', rel: 'owned_by', evidenceIds: ['row-2'] }
      ]
    })
    expect((answer.blocks.find((block) => block.kind === 'table') as TableBlock).rows[0]?.cells.r).toBe('service.orders depends_on → datasource.ledger')
  })

  it('calls a result that filled its row cap a top-k, cut short', () => {
    const records = Array.from({ length: 3 }, (_, index) => record({ d: node(`deployment.${index}`) }))
    const answer = rowsAnswer(port(records), { request: request(2), run: run(records, 'MATCH (d:Memory {scope: $scope}) RETURN d\nLIMIT 3', 3), writtenBy: 'a model', hits: [] })

    expect(answer.coverage).toEqual({ mode: 'top-k', truncated: true, scope: SCOPE })
    expect((answer.blocks[0] as TableBlock).rows).toHaveLength(2)
  })

  it('does not call a count exhaustive when an inner LIMIT or SKIP fed it a sample', () => {
    const records = [record({ n: neo4j.int(5) })]
    const cypher = 'MATCH (d:Memory {scope: $scope}) WITH d LIMIT 5 RETURN count(d) AS n\nLIMIT 11'
    expect(rowsAnswer(port(records), { request: request(), run: run(records, cypher), writtenBy: 'a model', hits: [] }).coverage.mode).toBe('unknown')
  })

  it('leaves out rows holding nodes from another scope, and stops calling the result exhaustive', () => {
    const foreign = new neo4j.types.Node(neo4j.int(99), ['Memory'], { scope: 'elsewhere', id: 'service.secret' }, 'n-foreign')
    const records = [record({ s: node('service.orders') }), record({ s: foreign })]
    const answer = rowsAnswer(port(records), { request: request(), run: run(records, 'MATCH (s:Memory {scope: $scope}) RETURN s\nLIMIT 11'), writtenBy: 'a model', hits: [] })

    expect((answer.blocks[0] as TableBlock).rows).toHaveLength(1)
    expect(JSON.stringify(answer)).not.toContain('service.secret')
    expect(answer.coverage.mode).toBe('unknown')
    expect(answer.diagnostics).toEqual([expect.objectContaining({ severity: 'warning', code: 'foreign-rows' })])
  })
})

describe('cypherAnswer', () => {
  it('refuses a query that does not bind every pattern to the scope, before running it', async () => {
    const graph = port([record({ n: neo4j.int(7) })])
    const chat = async (_prompt: ChatPrompt) => 'MATCH (d:Memory:Deployment) RETURN count(d) AS n'

    await expect(cypherAnswer(graph, chat, request(), { writtenBy: 'a model' })).rejects.toThrow(/beyond this scope: it never binds \$scope/)
    expect(graph.read).not.toHaveBeenCalled()
  })

  it('caps the query at one row more than it may show, so a cut-short result is known', async () => {
    const graph = port([record({ n: neo4j.int(2) })])
    const chat = async () => 'MATCH (d:Memory:Deployment {scope: $scope}) RETURN count(d) AS n'

    const { answer } = await cypherAnswer(graph, chat, request(5), { writtenBy: 'a model' })

    expect(graph.read).toHaveBeenCalledWith('MATCH (d:Memory:Deployment {scope: $scope}) RETURN count(d) AS n\nLIMIT 6', undefined)
    expect(answer.blocks).toEqual([expect.objectContaining<Partial<MetricBlock>>({ kind: 'metric', label: 'n', value: 2 })])
  })
})
