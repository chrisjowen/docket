import neo4j, { type Driver } from 'neo4j-driver'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { validateAdapterAnswer, type AskRequest, type EntityInput, type GraphBlock } from '@docket/contracts'
import type { EntityProjection } from '@docket/adapter-kit'
import { entityInput, entityLink } from '@docket/adapter-kit/testing'

import type { Neo4jConfig } from './config.js'
import { createNeo4jProjection } from './neo4j-projection.js'

/**
 * Runs against a real Neo4j: `NEO4J_TEST_URL=bolt://127.0.0.1:27687`, with
 * the password in `NEO4J_PASSWORD` or auth off without it (see the README).
 * Skipped without a URL. Every test works in its own scope and clears it after.
 */
const URL = process.env.NEO4J_TEST_URL
const PASSWORD_ENV = 'NEO4J_PASSWORD'
const PASSWORD = process.env[PASSWORD_ENV]
/** How the projection is told to log in: as the server expects, from the same variable. */
const AUTH = PASSWORD ? { passwordEnv: PASSWORD_ENV } : {}

const CONTEXT = { projectRoot: '/repos/acme' }

const makeDocument = (overrides: Partial<EntityInput> = {}): EntityInput =>
  entityInput({
    id: 'service.api',
    type: 'service',
    title: 'Orders API',
    path: '.docket/resources/services/api.md',
    paths: ['.docket/resources/services/api.md'],
    revision: 'sha256:api',
    tags: ['core'],
    attributes: { language: 'elixir' },
    links: [entityLink({ rel: 'depends_on', target: 'datasource.postgres', attributes: { criticality: 'high' } })],
    content: 'Takes orders and stores them.\n',
    ...overrides
  })

describe.skipIf(!URL)('neo4j projection', () => {
  let driver: Driver
  let scope: string
  let projection: EntityProjection
  const opened: EntityProjection[] = []

  const open = async (overrides: Partial<Neo4jConfig> = {}): Promise<EntityProjection> => {
    const created = createNeo4jProjection({
      type: 'neo4j',
      url: URL ?? '',
      username: 'neo4j',
      scope,
      ...AUTH,
      ...overrides
    })
    await created.init?.(CONTEXT)
    opened.push(created)
    return created
  }

  /** Rows from a read against the test scope. */
  const read = async (cypher: string): Promise<Record<string, unknown>[]> => {
    const result = await driver.executeQuery(cypher, { scope })
    return result.records.map((record) => record.toObject())
  }

  const nodes = () =>
    read(
      'MATCH (n:Memory {scope: $scope}) RETURN n.id AS id, n.stub AS stub, n.title AS title, ' +
        '[l IN labels(n) WHERE l <> "Memory"] AS labels ORDER BY id'
    )

  const edges = () =>
    read(
      'MATCH (a:Memory {scope: $scope})-[r]->(b:Memory {scope: $scope}) ' +
        'RETURN a.id AS from, type(r) AS type, r.rel AS rel, r.criticality AS criticality, b.id AS to ' +
        'ORDER BY from, type, to'
    )

  beforeAll(() => {
    driver = PASSWORD ? neo4j.driver(URL ?? '', neo4j.auth.basic('neo4j', PASSWORD)) : neo4j.driver(URL ?? '')
  })

  afterAll(async () => {
    await driver.close()
  })

  afterEach(async () => {
    await read('MATCH (n:Memory {scope: $scope}) DETACH DELETE n')
    while (opened.length > 0) await opened.pop()?.close?.()
  })

  const fresh = async () => {
    scope = `test-${Math.random().toString(36).slice(2)}`
    projection = await open()
  }

  it('stores a document as a typed node with typed links to stub targets', async () => {
    await fresh()
    await projection.upsert(makeDocument())

    expect(await nodes()).toEqual([
      { id: 'datasource.postgres', stub: true, title: null, labels: [] },
      { id: 'service.api', stub: false, title: 'Orders API', labels: ['Service'] }
    ])
    expect(await edges()).toEqual([
      { from: 'service.api', type: 'DEPENDS_ON', rel: 'depends_on', criticality: 'high', to: 'datasource.postgres' }
    ])
  })

  it('writes one relationship per (source, rel, target) with its evidence count and confidence', async () => {
    await fresh()
    const inManifest = { source: 'manifest', path: 'package.json', key: 'dependencies.pg' }
    const inCode = { source: 'code', path: 'src/db.ts', lines: '12' }
    // Two files declaring service.api, merged as docket hands them over.
    const merged = makeDocument({
      path: '.docket/a.md',
      paths: ['.docket/a.md', '.docket/b.md'],
      evidence: [inCode],
      confidence: 0.6,
      basis: 'evidence',
      evidenceCount: 1,
      sources: ['code'],
      links: [
        entityLink({
          rel: 'depends_on',
          target: 'datasource.postgres',
          evidence: [inManifest, inCode],
          confidence: 0.96,
          basis: 'evidence',
          evidenceCount: 2,
          sources: ['code', 'manifest']
        })
      ]
    })
    await projection.upsert(merged)
    await projection.upsert(merged)

    expect(
      await read(
        'MATCH (a:Memory {scope: $scope})-[r]->(b:Memory {scope: $scope}) ' +
          'RETURN a.id AS from, r.rel AS rel, b.id AS to, r.evidenceCount AS count, r.confidence AS confidence, r.sources AS sources'
      )
    ).toEqual([
      { from: 'service.api', rel: 'depends_on', to: 'datasource.postgres', count: 2, confidence: 0.96, sources: ['code', 'manifest'] }
    ])
    expect(
      await read(
        'MATCH (n:Memory {scope: $scope, id: "service.api"}) ' +
          'RETURN n.paths AS paths, n.confidence AS confidence, n.evidenceCount AS count, n.evidence AS evidence'
      )
    ).toEqual([
      { paths: ['.docket/a.md', '.docket/b.md'], confidence: 0.6, count: 1, evidence: JSON.stringify([inCode]) }
    ])
  })

  it('fills in a stub when its own document arrives, keeping the links to it', async () => {
    await fresh()
    await projection.upsert(makeDocument())
    await projection.upsert(
      makeDocument({ id: 'datasource.postgres', type: 'datasource', title: 'Postgres', links: [] })
    )

    expect(await nodes()).toEqual([
      { id: 'datasource.postgres', stub: false, title: 'Postgres', labels: ['Datasource'] },
      { id: 'service.api', stub: false, title: 'Orders API', labels: ['Service'] }
    ])
    expect(await edges()).toHaveLength(1)
  })

  it('replaces the type label and outgoing links when a document changes', async () => {
    await fresh()
    await projection.upsert(makeDocument())
    await projection.upsert(
      makeDocument({ type: 'library', links: [entityLink({ rel: 'uses', target: 'system.s3' })] })
    )

    expect(await nodes()).toEqual([
      { id: 'service.api', stub: false, title: 'Orders API', labels: ['Library'] },
      { id: 'system.s3', stub: true, title: null, labels: [] }
    ])
    expect(await edges()).toEqual([
      { from: 'service.api', type: 'USES', rel: 'uses', criticality: null, to: 'system.s3' }
    ])
  })

  it('turns a removed document that others still link to back into a stub', async () => {
    await fresh()
    await projection.upsert(makeDocument())
    await projection.upsert(
      makeDocument({ id: 'datasource.postgres', type: 'datasource', title: 'Postgres', links: [] })
    )
    await projection.remove('datasource.postgres')

    expect(await nodes()).toEqual([
      { id: 'datasource.postgres', stub: true, title: null, labels: [] },
      { id: 'service.api', stub: false, title: 'Orders API', labels: ['Service'] }
    ])
    expect(await edges()).toHaveLength(1)
  })

  it('deletes a removed document, and stubs nothing links to any more', async () => {
    await fresh()
    await projection.upsert(makeDocument())
    await projection.remove('service.api')

    expect(await nodes()).toEqual([])
  })

  it('keeps a document with index.graph false out of the graph', async () => {
    await fresh()
    await projection.upsert(makeDocument())
    await projection.upsert(makeDocument({ index: { graph: false, fts: true, vector: true } }))

    expect(await nodes()).toEqual([])
  })

  it('resets only its own scope', async () => {
    await fresh()
    const mine = scope
    await projection.upsert(makeDocument())

    scope = `${mine}-other`
    const other = await open()
    await other.upsert(makeDocument())
    scope = mine
    await projection.reset?.()

    expect(await nodes()).toEqual([])
    scope = `${mine}-other`
    expect(await nodes()).toHaveLength(2)
  })

  it('searches text, and answers with each match and what it is linked to', async () => {
    await fresh()
    await projection.upsert(makeDocument())
    await projection.upsert(
      makeDocument({
        id: 'service.web',
        title: 'Storefront',
        content: 'The shop UI.\n',
        links: [entityLink({ rel: 'uses', target: 'service.api' })]
      })
    )

    // Only text matches are answers. The paths from them travel in `detail`, rather than
    // as hits of their own - well-linked documents would otherwise answer everything.
    expect(await projection.search?.('orders', 10)).toEqual({
      hits: [
        {
          id: 'service.api',
          score: expect.any(Number),
          detail: 'service.api -depends_on-> datasource.postgres; service.api <-uses- service.web',
          revision: 'sha256:api',
          passage: { text: 'Takes orders and stores them.' }
        }
      ]
    })
  })

  it('ignores stop words and matches other forms of a word', async () => {
    await fresh()
    await projection.upsert(makeDocument())

    expect(await projection.search?.('the and of', 10)).toEqual({ hits: [] })
    expect((await projection.search?.('ordering', 10))?.hits.map((hit) => hit.id)).toEqual(['service.api'])
  })

  describe('without a model', () => {
    const ask = (question: string): AskRequest => {
      const now = new Date()
      return {
        requestId: 'native',
        question,
        context: { scope: 'default', now: now.toISOString(), timezone: 'UTC' },
        budget: { maxResults: 10, maxEvidenceBytes: 10_000, deadline: new Date(now.getTime() + 30_000).toISOString() }
      }
    }

    const graphOf = (answer: { blocks: readonly { kind: string }[] } | undefined) =>
      answer?.blocks.find((block) => block.kind === 'graph') as GraphBlock | undefined

    /** The scout report's case: orders depends on ledger, which depends on a database no file describes. */
    const payments = async (graph: EntityProjection) => {
      await graph.upsert(
        makeDocument({
          id: 'service.orders',
          title: 'Orders',
          content: 'Takes orders and records them.\n',
          revision: 'sha256:orders',
          links: [
            entityLink({ rel: 'depends_on', target: 'service.ledger', confidence: 0.95, sources: ['code', 'manifest'] }),
            entityLink({ rel: 'owned_by', target: 'team.payments', confidence: 0.6 })
          ]
        })
      )
      await graph.upsert(
        makeDocument({
          id: 'service.ledger',
          title: 'Ledger',
          content: 'Double-entry bookkeeping.\n',
          revision: 'sha256:ledger',
          links: [entityLink({ rel: 'depends_on', target: 'datasource.ledger-db', confidence: 0.9, sources: ['runtime'] })]
        })
      )
      await graph.upsert(makeDocument({ id: 'team.payments', type: 'team', title: 'Payments', content: 'Runs checkout.\n', revision: 'sha256:payments', links: [] }))
    }

    it('answers with the matches and the paths from them', async () => {
      await fresh()
      await payments(projection)
      const request = ask('what do orders rely on?')

      const answer = await projection.answer?.(request)

      expect(answer && validateAdapterAnswer(answer, request)).toEqual(answer)
      expect(answer?.blocks.map((block) => block.kind)).toEqual(['entities', 'graph', 'passages'])
      // Only the text match is an entity; what its paths reach is context.
      expect(answer?.blocks[0]).toMatchObject({ entities: [{ ref: { kind: 'entity', id: 'service.orders', revision: 'sha256:orders' } }] })
      const graph = graphOf(answer)
      expect(graph?.paths).toEqual([
        ['service.orders', 'service.ledger', 'datasource.ledger-db'],
        ['service.orders', 'team.payments']
      ])
      expect(graph?.edges).toEqual([
        { source: 'service.orders', target: 'service.ledger', rel: 'depends_on', confidence: 0.95, evidenceIds: ['path-1'] },
        { source: 'service.ledger', target: 'datasource.ledger-db', rel: 'depends_on', confidence: 0.9, evidenceIds: ['path-1'] },
        { source: 'service.orders', target: 'team.payments', rel: 'owned_by', confidence: 0.6, evidenceIds: ['path-2'] }
      ])
      expect(graph?.nodes).toContainEqual({ id: 'datasource.ledger-db', label: 'datasource.ledger-db' })
      expect(answer?.evidence.find((item) => item.id === 'path-1')).toMatchObject({
        kind: 'derived-fact',
        text: 'service.orders -depends_on-> service.ledger (0.95, code+manifest) -depends_on-> datasource.ledger-db (0.9, runtime)'
      })
      expect(answer?.interpretation.nativeQuery).toContain("db.index.fulltext.queryNodes('memory_text', $lucene)")
      expect(answer?.coverage).toEqual({ mode: 'top-k', truncated: false, scope: 'default' })
    })

    it('reaches as far as traverse allows', async () => {
      await fresh()
      await payments(projection)
      const pathsWith = async (traverse: Neo4jConfig['traverse']) =>
        graphOf(await (await open({ traverse })).answer?.(ask('orders')))?.paths

      expect(await pathsWith({ hops: 1 })).toEqual([
        ['service.orders', 'service.ledger'],
        ['service.orders', 'team.payments']
      ])
      expect(await pathsWith({ minConfidence: 0.7 })).toEqual([['service.orders', 'service.ledger', 'datasource.ledger-db']])
      expect(await pathsWith({ rels: ['owned_by'] })).toEqual([['service.orders', 'team.payments']])
    })

    it('ranks paths by confidence, damped where they end at a well-connected node', async () => {
      await fresh()
      await projection.upsert(
        makeDocument({
          id: 'service.orders',
          title: 'Orders',
          content: 'Takes orders.\n',
          links: [
            entityLink({ rel: 'uses', target: 'platform.hub', confidence: 0.9 }),
            entityLink({ rel: 'uses', target: 'library.shaky', confidence: 0.3 }),
            entityLink({ rel: 'uses', target: 'library.leaf', confidence: 0.9 })
          ]
        })
      )
      for (const n of [1, 2, 3, 4, 5]) {
        await projection.upsert(
          makeDocument({ id: `service.x${n}`, title: `X${n}`, content: 'Elsewhere.\n', links: [entityLink({ rel: 'uses', target: 'platform.hub' })] })
        )
      }

      const graph = graphOf(await (await open({ traverse: { hops: 1 } })).answer?.(ask('orders')))

      expect(graph?.paths?.map((path) => path.at(-1))).toEqual(['library.leaf', 'platform.hub', 'library.shaky'])
    })
  })

  describe('with a model writing Cypher', () => {
    /** Stands in for the model: answers every prompt with `cypher`, and keeps the prompts. */
    const model = (cypher: string) => {
      const prompts: string[] = []
      return {
        prompts,
        chat: async (prompt: { user: string }) => {
          prompts.push(prompt.user)
          return cypher
        }
      }
    }

    const withModel = async (cypher: string) => {
      scope = `test-${Math.random().toString(36).slice(2)}`
      const fake = model(cypher)
      const created = createNeo4jProjection(
        { type: 'neo4j', url: URL ?? '', username: 'neo4j', scope, ...AUTH },
        { chat: fake.chat }
      )
      await created.init?.(CONTEXT)
      opened.push(created)
      await created.upsert(makeDocument({ links: [entityLink({ rel: 'deployed_to', target: 'environment.local' })] }))
      await created.upsert(
        makeDocument({
          id: 'environment.local',
          type: 'environment',
          title: 'Local',
          content: 'Where it runs.\n',
          links: []
        })
      )
      return { projection: created, prompts: fake.prompts }
    }

    it('answers from the rows the query returns, and shows the query', async () => {
      const cypher =
        'MATCH (s:Memory:Service {scope: $scope})-[r:DEPLOYED_TO]->(e:Memory:Environment {scope: $scope}) RETURN s, r, e'
      const { projection: graph, prompts } = await withModel(cypher)

      const answer = await graph.search?.('what is actually deployed', 10)

      expect(answer).toEqual({
        note: `cypher: ${cypher}\nLIMIT 50`,
        hits: [
          { id: 'service.api', detail: 'service.api deployed_to → environment.local', revision: 'sha256:api' },
          { id: 'environment.local', detail: 'service.api deployed_to → environment.local', revision: 'sha256:api' }
        ]
      })
      // The model is shown this graph's schema, not a generic one.
      expect(prompts[0]).toContain('(:Service)-[:DEPLOYED_TO]->(:Environment) (1)')
    })

    it('maps returned ids back to documents', async () => {
      const { projection: graph } = await withModel(
        'MATCH (s:Memory:Service {scope: $scope}) RETURN s.id AS id, s.title AS title'
      )

      expect((await graph.search?.('which services', 10))?.hits).toEqual([
        { id: 'service.api', detail: 'service.api, Orders API', revision: 'sha256:api' }
      ])
    })

    it('leaves out a detail that would only repeat the id', async () => {
      const { projection: graph } = await withModel('MATCH (s:Memory:Service {scope: $scope}) RETURN s')

      expect((await graph.search?.('which services', 10))?.hits).toEqual([{ id: 'service.api', revision: 'sha256:api' }])
    })

    it('refuses a query that could read another scope, before running it', async () => {
      const { projection: graph } = await withModel('MATCH (n:Memory) RETURN n')
      const mine = scope
      scope = `${mine}-other`
      await (await open()).upsert(makeDocument({ id: 'service.elsewhere', links: [] }))
      scope = mine

      const answer = await graph.search?.('everything', 10)

      expect(answer?.hits).toEqual([])
      expect(answer?.note).toMatch(/beyond this scope[\s\S]*full-text/)
      scope = `${mine}-other`
      await read('MATCH (n:Memory {scope: $scope}) DETACH DELETE n')
      scope = mine
    })

    it('answers a count with the count, exhaustively, never with documents', async () => {
      const { projection: graph } = await withModel(
        'MATCH (s:Memory:Service {scope: $scope})-[:DEPLOYED_TO]->(e:Memory {scope: $scope}) RETURN count(e) AS deployments'
      )
      const now = new Date()
      const request = {
        requestId: 'r1',
        question: 'how many deployments?',
        context: { scope: 'default', now: now.toISOString(), timezone: 'UTC' },
        budget: { maxResults: 10, maxEvidenceBytes: 10_000, deadline: new Date(now.getTime() + 30_000).toISOString() }
      }

      const answer = await graph.answer?.(request)

      expect(answer?.blocks).toEqual([{ kind: 'metric', id: 'metric-1', label: 'deployments', value: 1, evidenceIds: ['row-1'] }])
      expect(answer?.coverage).toEqual({ mode: 'exhaustive', truncated: false, scope: 'default' })
    })

    it('answers grouped values as a typed table, keeping each row', async () => {
      const { projection: graph } = await withModel(
        // evidenceCount is written from a JS number, so Neo4j holds a float;
        // toInteger makes the column a Neo4j Integer, which stays an integer.
        'MATCH (s:Memory {scope: $scope}) RETURN s.id AS id, s.title AS title, toInteger(s.evidenceCount) AS evidence ORDER BY id'
      )
      const now = new Date()
      const answer = await graph.answer?.({
        requestId: 'r2',
        question: 'list everything',
        context: { scope: 'default', now: now.toISOString(), timezone: 'UTC' },
        budget: { maxResults: 10, maxEvidenceBytes: 10_000, deadline: new Date(now.getTime() + 30_000).toISOString() }
      })

      expect(answer?.blocks[0]).toMatchObject({
        kind: 'table',
        columns: [
          { key: 'id', type: 'string' },
          { key: 'title', type: 'string' },
          { key: 'evidence', type: 'integer' }
        ],
        rows: [
          { cells: { id: 'environment.local', title: 'Local', evidence: 0 } },
          { cells: { id: 'service.api', title: 'Orders API', evidence: 0 } }
        ]
      })
    })

    it('falls back to full-text, saying why, when the query is refused', async () => {
      const { projection: graph } = await withModel('MATCH (n) DETACH DELETE n')

      const answer = await graph.search?.('orders', 10)

      expect(answer?.hits.map((hit) => hit.id)).toEqual(['service.api'])
      expect(answer?.note).toMatch(/DETACH.*read-only[\s\S]*full-text/)
      expect(await nodes()).toHaveLength(2)
    })

    it('falls back to full-text when the query finds nothing', async () => {
      const { projection: graph } = await withModel(
        'MATCH (n:Memory:Team {scope: $scope}) RETURN n'
      )

      const answer = await graph.search?.('orders', 10)

      expect(answer?.hits.map((hit) => hit.id)).toEqual(['service.api'])
      expect(answer?.note).toMatch(/found nothing[\s\S]*full-text/)
    })
  })

  it('does not search other scopes', async () => {
    await fresh()
    const mine = scope
    scope = `${mine}-other`
    const other = await open()
    await other.upsert(makeDocument())
    scope = mine

    expect(await projection.search?.('orders', 10)).toEqual({ hits: [] })
    scope = `${mine}-other`
  })
})
