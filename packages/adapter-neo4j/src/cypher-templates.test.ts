import neo4j, { type Node, type Record as Neo4jRecord, type Relationship } from 'neo4j-driver'
import { describe, expect, it, vi } from 'vitest'

import { validateAdapterAnswer, type AskRequest, type TableBlock } from '@docket/contracts'
import type { ChatPrompt } from '@docket/adapter-kit'

import { scopeProblem } from './cypher-guard.js'
import type { GraphSchema } from './cypher-prompt.js'
import type { CypherPort } from './cypher-search.js'
import {
  buildTemplatePrompt,
  parseSelection,
  PATH_HOPS,
  RESOLVE_QUERY,
  runTemplate,
  templateAnswer,
  templateSearch,
  TRANSITIVE_HOPS,
  type TemplateRun
} from './cypher-templates.js'
import { neo4jValues } from './neo4j-projection.js'

const SCOPE = 'payments'

const SCHEMA: GraphSchema = {
  labels: [
    { label: 'Datasource', count: 1 },
    { label: 'FeatureFlag', count: 1 },
    { label: 'Service', count: 3 },
    { label: 'Team', count: 1 }
  ],
  patterns: [
    { from: 'Service', type: 'DEPENDS_ON', to: 'Service', count: 2 },
    { from: 'Service', type: 'DEPENDS_ON', to: 'Datasource', count: 1 },
    { from: 'Service', type: 'OWNED_BY', to: 'Team', count: 3 },
    { from: 'Service', type: 'USES', to: 'Datasource', count: 1 }
  ]
}

/** The entities names resolve against: id → title. */
const ENTITIES: Record<string, string> = {
  'service.orders': 'Orders',
  'service.orders-worker': 'Orders Worker',
  'service.ledger': 'Ledger',
  'datasource.ledger-db': 'Ledger DB',
  'team.payments': 'Payments'
}

let element = 0
const node = (id: string, properties: Record<string, unknown> = {}): Node =>
  new neo4j.types.Node(neo4j.int((element += 1)), ['Memory'], { scope: SCOPE, id, title: ENTITIES[id] ?? id, hash: `sha256:${id}`, stub: false, ...properties }, `n-${id}-${element}`)

const relationship = (start: Node, rel: string, end: Node): Relationship =>
  new neo4j.types.Relationship(neo4j.int((element += 1)), start.identity, end.identity, rel.toUpperCase(), { rel, confidence: 0.9 }, `r-${element}`, start.elementId, end.elementId)

const path = (...steps: [Node, ...(readonly [string, Node])[]]): InstanceType<typeof neo4j.types.Path> => {
  const [start, ...rest] = steps
  let from = start
  const segments = rest.map(([rel, to]) => {
    const segment = new neo4j.types.PathSegment(from, relationship(from, rel, to), to)
    from = to
    return segment
  })
  return new neo4j.types.Path(start, from, segments)
}

const record = (values: Record<string, unknown>): Neo4jRecord => new neo4j.types.Record(Object.keys(values), Object.values(values)) as Neo4jRecord

const isResolve = (cypher: string): boolean => cypher === RESOLVE_QUERY
const isExact = (cypher: string): boolean => cypher.includes('toLower(n.title) = toLower($name)')

/**
 * Names resolve as the graph would: an exact id or title first, then
 * full-text, where every entity sharing a word with the name matches, the
 * more words the better.
 */
const resolveRows = (cypher: string, parameters: Record<string, unknown>): Neo4jRecord[] | undefined => {
  if (isExact(cypher)) {
    const name = String(parameters.name)
    return Object.entries(ENTITIES)
      .filter(([id, title]) => id === name || title.toLowerCase() === name.toLowerCase())
      .map(([id, title]) => record({ id, title, byId: id === name }))
  }
  if (isResolve(cypher)) {
    const words = String(parameters.lucene).toLowerCase().split(' or ')
    return Object.entries(ENTITIES)
      .map(([id, title]) => ({ id, title, score: words.filter((word) => `${id} ${title}`.toLowerCase().includes(word)).length }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .map((match) => record(match))
  }
  return undefined
}

interface Read {
  cypher: string
  parameters: Record<string, unknown>
}

/** A port over a fixed graph: names resolve against `ENTITIES`, and the template's query reads `rows`. */
const port = (rows: Neo4jRecord[] = [], schema: GraphSchema = SCHEMA): CypherPort & { reads: Read[] } => {
  const reads: Read[] = []
  return {
    scope: SCOPE,
    reads,
    schema: async () => schema,
    read: vi.fn(async (cypher: string, _timeoutMs?: number, parameters: Record<string, unknown> = {}) => {
      reads.push({ cypher, parameters })
      return resolveRows(cypher, parameters) ?? rows
    }),
    documents: async (ids) => new Map(ids.filter((id) => id in ENTITIES).map((id) => [id, `sha256:${id}`])),
    ...neo4jValues(neo4j)
  }
}

/** Stands in for the model: answers every prompt with `reply`, and keeps the prompts. */
const model = (reply: unknown) => {
  const prompts: ChatPrompt[] = []
  const chat = async (prompt: ChatPrompt) => {
    prompts.push(prompt)
    return typeof reply === 'string' ? reply : JSON.stringify(reply)
  }
  return { prompts, chat }
}

const request = (question = 'Who owns orders?', maxResults = 10): Pick<AskRequest, 'question' | 'context' | 'budget'> => ({
  question,
  context: { scope: SCOPE, now: '2026-11-05T00:00:00.000Z', timezone: 'UTC' },
  budget: { maxResults, maxEvidenceBytes: 100_000, deadline: '2026-11-05T00:01:00.000Z' }
})

/** The template's own read: the last one, after any name lookups. */
const templateRead = (graph: { reads: Read[] }): Read => graph.reads.at(-1) as Read

const answered = async (selection: unknown, rows: Neo4jRecord[] = [], question?: string, maxResults?: number) => {
  const graph = port(rows)
  const result = await templateAnswer(graph, model(selection).chat, request(question, maxResults))
  if ('reason' in result) throw new Error(`expected a template to run: ${result.reason}`)
  expect(validateAdapterAnswer(result.answer, request(question, maxResults))).toEqual(result.answer)
  return { graph, ...result, read: templateRead(graph) }
}

describe('buildTemplatePrompt', () => {
  it('lists the types and relationships this graph has, for the model to choose among', () => {
    const prompt = buildTemplatePrompt('who owns orders?', SCHEMA)

    expect(prompt.system).toContain('You never write a query yourself')
    expect(prompt.user).toContain('- FeatureFlag (1)')
    expect(prompt.user).toContain('- depends_on: Service -> Datasource (1)')
    expect(prompt.user).toContain('- owned_by: Service -> Team (3)')
    expect(prompt.user.endsWith('Question: who owns orders?')).toBe(true)
  })
})

describe('parseSelection', () => {
  it('reads the JSON object out of a reply, whatever surrounds it', () => {
    expect(parseSelection('```json\n{"intent": "owner", "params": {"entity": "orders"}}\n```')).toEqual({ intent: 'owner', params: { entity: 'orders' } })
    expect(parseSelection('Sure: {"intent": "none"}')).toEqual({ intent: 'none' })
  })

  it('reads null and missing optional parameters as left out, with their defaults', () => {
    expect(parseSelection('{"intent": "dependencies", "params": {"entity": "orders", "transitive": null}}')).toEqual({
      intent: 'dependencies',
      params: { entity: 'orders', transitive: false }
    })
    expect(parseSelection('{"intent": "low_confidence"}')).toEqual({ intent: 'low_confidence', params: { below: 0.5 } })
    expect(parseSelection('{"intent": "list_related", "params": {"entity": "x", "rel": "uses", "direction": "incoming", "type": null}}')).toEqual({
      intent: 'list_related',
      params: { entity: 'x', rel: 'uses', direction: 'incoming' }
    })
  })

  it('refuses a reply that is not one of the templates, saying why', () => {
    expect(() => parseSelection('MATCH (n) RETURN n')).toThrow(/chose no template/)
    expect(() => parseSelection('{intent: owner}')).toThrow(/not JSON/)
    expect(() => parseSelection('{"intent": "delete_everything"}')).toThrow(/does not fit one at intent/)
    expect(() => parseSelection('{"intent": "owner", "params": {}}')).toThrow(/does not fit one at params.entity/)
    expect(() => parseSelection('{"intent": "low_confidence", "params": {"below": 7}}')).toThrow(/at params.below/)
  })
})

describe('every template', () => {
  const selections: unknown[] = [
    { intent: 'dependencies', params: { entity: 'orders', transitive: false } },
    { intent: 'dependencies', params: { entity: 'orders', transitive: true } },
    { intent: 'dependents', params: { entity: 'ledger', transitive: false } },
    { intent: 'dependents', params: { entity: 'ledger', transitive: true } },
    { intent: 'owner', params: { entity: 'orders' } },
    { intent: 'path', params: { from: 'orders', to: 'ledger db' } },
    { intent: 'count_related', params: { entity: 'ledger', rel: 'depends_on', direction: 'incoming', type: 'Service' } },
    { intent: 'list_related', params: { entity: 'orders', rel: 'uses', direction: 'outgoing' } },
    { intent: 'count_of_type', params: { type: 'service' } },
    { intent: 'list_of_type', params: { type: 'feature-flag' } },
    { intent: 'low_confidence', params: { type: 'Service', below: 0.7 } },
    { intent: 'single_source', params: { type: 'Service', source: 'Code' } }
  ]

  it.each(selections)('reads only in scope, as a model-written query must: %j', async (selection) => {
    const graph = port()
    const run = (await runTemplate(graph, model(selection).chat, 'q')) as TemplateRun
    expect(run.query, JSON.stringify(run)).toBeDefined()

    for (const { cypher } of graph.reads) expect(scopeProblem(cypher), cypher).toBeUndefined()
    // Nothing the model wrote is in the query: only parameters carry it.
    for (const value of Object.values(run.selection.params)) {
      if (typeof value === 'string') expect(run.query.cypher).not.toContain(value)
    }
    expect(run.query.cypher).toMatch(/\nLIMIT 50$/)
  })
})

describe('dependencies and dependents', () => {
  const orders = node('service.orders')
  const ledger = node('service.ledger')
  const db = node('datasource.ledger-db', { stub: true, hash: undefined, title: undefined })

  it('lists direct dependencies with how each is reached, exhaustively', async () => {
    const rows = [record({ dependency: ledger, hops: neo4j.int(1), via: path(orders, ['depends_on', ledger]) })]
    const { answer, read } = await answered({ intent: 'dependencies', params: { entity: 'orders' } }, rows)

    expect(read.cypher).toContain('-[:DEPENDS_ON*1..1]->')
    expect(read.parameters).toEqual({ id: 'service.orders' })
    expect(answer.coverage).toEqual({ mode: 'exhaustive', truncated: false, scope: SCOPE })
    expect(answer.interpretation.description).toMatch(/^Hand-written Cypher template dependencies: what service\.orders depends on, directly/)
    expect(answer.interpretation.assumptions[0]).toBe('"orders" was read as service.orders (Orders), its title.')
    expect((answer.blocks.find((block) => block.kind === 'table') as TableBlock).rows[0]?.cells).toEqual({
      dependency: { kind: 'entity', id: 'service.ledger', revision: 'sha256:service.ledger' },
      hops: 1,
      via: 'service.orders -depends_on-> service.ledger'
    })
    expect(answer.blocks.find((block) => block.kind === 'graph')).toMatchObject({ edges: [{ source: 'service.orders', target: 'service.ledger', rel: 'depends_on' }] })
  })

  it('follows dependencies transitively, exhaustive only when none was reached at the furthest hop', async () => {
    const short = [
      record({ dependency: ledger, hops: neo4j.int(1), via: path(orders, ['depends_on', ledger]) }),
      record({ dependency: db, hops: neo4j.int(2), via: path(orders, ['depends_on', ledger], ['depends_on', db]) })
    ]
    const ended = await answered({ intent: 'dependencies', params: { entity: 'orders', transitive: true } }, short)
    expect(ended.read.cypher).toContain(`-[:DEPENDS_ON*1..${TRANSITIVE_HOPS}]->`)
    expect(ended.answer.coverage.mode).toBe('exhaustive')

    const far = [record({ dependency: db, hops: neo4j.int(TRANSITIVE_HOPS), via: path(orders, ['depends_on', db]) })]
    const cut = await answered({ intent: 'dependencies', params: { entity: 'orders', transitive: true } }, far)
    expect(cut.answer.coverage.mode).toBe('top-k')
  })

  it('reads dependents against the arrow', async () => {
    const { read, answer } = await answered({ intent: 'dependents', params: { entity: 'service.ledger', transitive: false } })

    expect(read.cypher).toContain('(x:Memory {scope: $scope, id: $id})<-[:DEPENDS_ON*1..1]-(n:Memory {scope: $scope})')
    expect(read.cypher).toContain('RETURN n AS dependent')
    expect(answer.interpretation.assumptions[0]).toBe('"service.ledger" was read as service.ledger (Ledger), its id.')
  })

  it('answers nothing recorded as an exhaustive empty answer that still names the entity', async () => {
    const { answer } = await answered({ intent: 'dependents', params: { entity: 'orders' } })

    expect(answer.coverage.mode).toBe('exhaustive')
    expect(answer.blocks).toEqual([
      expect.objectContaining({ kind: 'entities', entities: [{ ref: { kind: 'entity', id: 'service.orders', revision: 'sha256:service.orders' } }] })
    ])
  })
})

describe('owner', () => {
  it('follows owned_by from the entity', async () => {
    const orders = node('service.orders')
    const team = node('team.payments')
    const rows = [record({ resource: orders, link: relationship(orders, 'owned_by', team), owner: team })]
    const { read, answer } = await answered({ intent: 'owner', params: { entity: 'Orders' } }, rows)

    expect(read.cypher).toContain('-[r:OWNED_BY]->(o:Memory {scope: $scope})')
    expect(answer.coverage.mode).toBe('exhaustive')
    expect(answer.blocks.find((block) => block.kind === 'entities')).toMatchObject({
      entities: [{ ref: { id: 'service.orders' } }, { ref: { id: 'team.payments' } }]
    })
  })
})

describe('path', () => {
  it('finds the shortest connections in either direction, and never calls them every connection', async () => {
    const orders = node('service.orders')
    const ledger = node('service.ledger')
    const rows = [record({ path: path(orders, ['depends_on', ledger]), hops: neo4j.int(1) })]
    const { read, answer } = await answered({ intent: 'path', params: { from: 'orders', to: 'ledger' } }, rows)

    expect(read.cypher).toContain(`allShortestPaths((a)-[*..${PATH_HOPS}]-(b))`)
    expect(read.parameters).toEqual({ from: 'service.orders', to: 'service.ledger' })
    expect(answer.coverage).toEqual({ mode: 'top-k', truncated: false, scope: SCOPE })
    expect(answer.interpretation.assumptions).toContain(`Only the shortest paths, of up to ${PATH_HOPS} relationships in either direction: not every way they are connected.`)
  })

  it('does not run between an entity and itself', async () => {
    const result = await runTemplate(port(), model({ intent: 'path', params: { from: 'orders', to: 'service.orders' } }).chat, 'q')
    expect(result).toEqual({ reason: 'No query template ran: "orders" and "service.orders" are both service.orders' })
  })
})

describe('count_related and list_related', () => {
  it('counts what points to the entity by a relationship, of one type, as an exhaustive metric', async () => {
    const { read, answer } = await answered(
      { intent: 'count_related', params: { entity: 'ledger', rel: 'depends_on', direction: 'incoming', type: 'services' } },
      [record({ count: neo4j.int(2) })]
    )

    expect(read.cypher).toContain('(x:Memory {scope: $scope, id: $id})<-[r]-(n:Memory {scope: $scope})')
    expect(read.cypher).toContain('WHERE type(r) = $relType AND $label IN labels(n)')
    expect(read.parameters).toEqual({ id: 'service.ledger', relType: 'DEPENDS_ON', label: 'Service' })
    expect(answer.blocks[0]).toEqual({ kind: 'metric', id: 'metric-1', label: 'count', value: 2, evidenceIds: ['row-1'] })
    expect(answer.coverage.mode).toBe('exhaustive')
    expect(answer.interpretation.description).toContain('how many Service resources that depends_on service.ledger')
  })

  it('lists what the entity points to, and calls a list its row cap cut short a top-k', async () => {
    const orders = node('service.orders')
    const rows = ['a', 'b', 'c'].map((id) => {
      const used = node(`datasource.${id}`)
      return record({ entity: orders, link: relationship(orders, 'uses', used), related: used })
    })
    const { read, answer } = await answered({ intent: 'list_related', params: { entity: 'orders', rel: 'USES', direction: 'outgoing' } }, rows, 'q', 2)

    expect(read.cypher).toContain('-[r]->')
    expect(read.cypher).not.toContain('$label')
    expect(read.cypher).toMatch(/\nLIMIT 3$/)
    expect(answer.coverage).toEqual({ mode: 'top-k', truncated: true, scope: SCOPE })
  })
})

describe('count_of_type and list_of_type', () => {
  it('counts recorded resources of a type, matching the type however it is written', async () => {
    const { read, answer } = await answered({ intent: 'count_of_type', params: { type: 'feature-flag' } }, [record({ count: neo4j.int(1) })])

    expect(read.parameters).toEqual({ label: 'FeatureFlag' })
    expect(read.cypher).toContain('n.stub = false')
    expect(answer.blocks[0]).toMatchObject({ kind: 'metric', value: 1 })
    expect(answer.coverage.mode).toBe('exhaustive')
  })

  it('lists them by id', async () => {
    const { read } = await answered({ intent: 'list_of_type', params: { type: 'Service' } }, [record({ resource: node('service.orders') })])
    expect(read.cypher).toContain('RETURN n AS resource\nORDER BY resource.id')
  })
})

describe('low_confidence and single_source', () => {
  it('lists resources below a confidence, weakest first', async () => {
    const rows = [record({ resource: node('service.ledger'), confidence: 0.5, basis: 'unevidenced', sources: [] })]
    const { read, answer } = await answered({ intent: 'low_confidence', params: {} }, rows)

    expect(read.parameters).toEqual({ below: 0.5 })
    expect(read.cypher).toContain('ORDER BY confidence, resource.id')
    expect(answer.coverage.mode).toBe('exhaustive')
  })

  it('lists resources only one kind of evidence corroborates, of one kind when named', async () => {
    const { read } = await answered({ intent: 'single_source', params: { source: 'Runtime' } })

    expect(read.cypher).toContain('size(n.sources) = 1 AND $source IN n.sources')
    expect(read.parameters).toEqual({ source: 'runtime' })
  })
})

describe('names', () => {
  it('reads a name through the full-text index when no id or title is exactly it, naming close readings', async () => {
    const { answer, run } = await answered({ intent: 'owner', params: { entity: 'orders service' } })

    expect(run.entities).toEqual([
      { name: 'orders service', id: 'service.orders', title: 'Orders', how: 'full-text', alternatives: ['service.orders-worker'] }
    ])
    expect(answer.interpretation.assumptions[0]).toBe(
      '"orders service" was read as service.orders (Orders), the best full-text match; service.orders-worker matched nearly as well.'
    )
    expect(answer.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'template-ambiguous-name',
        message: '"orders service" could mean service.orders or service.orders-worker; the template read it as service.orders.'
      }
    ])
  })
})

describe('routing', () => {
  const reason = async (selection: unknown, schema?: GraphSchema) => {
    const graph = port([], schema)
    const result = await runTemplate(graph, model(selection).chat, 'q')
    return { result, graph }
  }

  it('runs nothing when the model chooses no template', async () => {
    const { result, graph } = await reason({ intent: 'none' })
    expect(result).toEqual({ reason: 'No query template fits the question' })
    expect(graph.reads).toEqual([])
  })

  it('runs nothing when the model writes Cypher instead of choosing', async () => {
    const { result, graph } = await reason('MATCH (n:Memory {scope: $scope}) DETACH DELETE n')
    expect(result).toEqual({ reason: expect.stringMatching(/^No query template ran: The model's choice of template is not JSON/) })
    expect(graph.reads).toEqual([])
  })

  it('runs nothing for a type or relationship the graph does not have', async () => {
    expect((await reason({ intent: 'count_of_type', params: { type: 'technology' } })).result).toEqual({
      reason: 'No query template ran: "technology" is not a type this graph has'
    })
    expect((await reason({ intent: 'list_related', params: { entity: 'orders', rel: 'calls', direction: 'outgoing' } })).result).toEqual({
      reason: 'No query template ran: "calls" is not a relationship this graph has'
    })
    expect((await reason({ intent: 'owner', params: { entity: 'orders' } }, { labels: SCHEMA.labels, patterns: [] })).result).toEqual({
      reason: 'No query template ran: owner follows owned_by, which this graph has none of'
    })
  })

  it('runs nothing when no entity matches a name', async () => {
    const { result, graph } = await reason({ intent: 'owner', params: { entity: 'warehouse' } })
    expect(result).toEqual({ reason: 'No query template ran: Nothing in the graph matches "warehouse"' })
    expect(graph.reads.every((read) => isExact(read.cypher) || isResolve(read.cypher))).toBe(true)
  })

  it('lets a model that fails fail, for the caller to fall back from', async () => {
    const failing = async () => {
      throw new Error('model unreachable')
    }
    await expect(runTemplate(port(), failing, 'q')).rejects.toThrow('model unreachable')
  })

  it('searches with the documents the template is about, and the template as the query', async () => {
    const orders = node('service.orders')
    const team = node('team.payments')
    const graph = port([record({ resource: orders, link: relationship(orders, 'owned_by', team), owner: team })])
    const result = await templateSearch(graph, model({ intent: 'owner', params: { entity: 'orders' } }).chat, 'who owns orders')

    expect(result).toEqual({
      query: expect.stringMatching(/^owner: MATCH [\s\S]*\n\/\/ \$id: "service\.orders"$/),
      hits: [
        { id: 'service.orders', detail: 'service.orders owned_by → team.payments', revision: 'sha256:service.orders' },
        { id: 'team.payments', detail: 'service.orders owned_by → team.payments', revision: 'sha256:team.payments' }
      ]
    })
  })
})
