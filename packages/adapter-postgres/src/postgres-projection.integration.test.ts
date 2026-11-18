import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { validateAdapterAnswer, type AskRequest, type EntityInput, type GraphBlock } from '@docket/contracts'
import type { Embedder, EntityProjection } from '@docket/adapter-kit'
import { entityInput, entityLink, GRAPH_PATH_FIXTURE } from '@docket/adapter-kit/testing'

import { createTestDatabase, hasPgvector, TEST_PG_URL, type TestDatabase } from '../test/postgres.js'
import { postgresConfigSchema, type PostgresConfig } from './config.js'
import { createPostgresProjection } from './postgres-projection.js'

/**
 * Runs against a real Postgres 16+ (`DOCKET_TEST_PG_URL`, see test/postgres.ts),
 * each suite in a database of its own and each test in a scope of its own.
 */
const CONTEXT = { projectRoot: '/repos/acme' }

const makeDocument = (overrides: Partial<EntityInput> & { id?: string } = {}): EntityInput =>
  entityInput({
    id: 'service.api',
    type: 'service',
    title: 'Orders API',
    revision: 'sha256:api',
    tags: ['core'],
    links: [entityLink({ rel: 'depends_on', target: 'datasource.postgres', confidence: 0.9 })],
    content: 'Takes orders and stores them.\n',
    ...overrides
  })

const ask = (question: string, maxResults = 10): AskRequest => {
  const now = new Date()
  return {
    requestId: 'request-1',
    question,
    context: { scope: 'default', now: now.toISOString(), timezone: 'UTC' },
    budget: { maxResults, maxEvidenceBytes: 100_000, deadline: new Date(now.getTime() + 60_000).toISOString() }
  }
}

const graphOf = (answer: { blocks: { kind: string }[] } | undefined): GraphBlock | undefined =>
  answer?.blocks.find((block): block is GraphBlock => block.kind === 'graph')

/**
 * A stand-in embedding model: each word counts towards one of 16 dimensions,
 * so texts sharing words point the same way. `calls` holds every batch.
 */
const wordEmbedder = (model = 'fake-words'): Embedder & { calls: string[][] } => {
  const calls: string[][] = []
  return {
    model,
    dimensions: 16,
    calls,
    async embed(texts) {
      calls.push([...texts])
      return texts.map((text) => {
        const vector = new Array<number>(16).fill(0)
        for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
          let hash = 0
          for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) % 16
          vector[hash] = (vector[hash] ?? 0) + 1
        }
        if (!vector.some((value) => value !== 0)) vector[0] = 1
        return vector
      })
    }
  }
}

describe.skipIf(!TEST_PG_URL)('postgres projection', () => {
  let database: TestDatabase
  let scope: string
  const opened: EntityProjection[] = []

  const open = async (overrides: Partial<PostgresConfig> = {}, embedder?: Embedder): Promise<EntityProjection> => {
    const config = postgresConfigSchema.parse({ url: database.url, scope, ...overrides })
    const projection = createPostgresProjection(config, embedder ? { embedder } : {})
    await projection.init?.(CONTEXT)
    opened.push(projection)
    return projection
  }

  const rows = async (sql: string): Promise<Record<string, unknown>[]> => (await database.pool.query(sql, [scope])).rows

  beforeAll(async () => {
    database = await createTestDatabase()
  })

  afterAll(async () => {
    await database?.drop()
  })

  afterEach(async () => {
    while (opened.length > 0) await opened.pop()?.close?.()
  })

  const fresh = () => {
    scope = `test-${Math.random().toString(36).slice(2)}`
  }

  it('migrates its own schema once, however many open it at once', async () => {
    fresh()
    await Promise.all([open(), open(), open()])
    expect(await rows(`SELECT name FROM docket_index.migrations WHERE $1::text IS NOT NULL ORDER BY name`)).toEqual([
      { name: '0001_entities_edges' },
      { name: 't0001_title_trigrams' }
    ])
  })

  it('stores an entity and the links it owns, and rewrites them whole', async () => {
    fresh()
    const projection = await open()
    await projection.upsert(
      makeDocument({
        attributes: { language: 'elixir' },
        links: [
          entityLink({ rel: 'depends_on', target: 'datasource.postgres', confidence: 0.9, sources: ['code'], attributes: { criticality: 'high' } }),
          entityLink({ rel: 'owned_by', target: 'team.orders', confidence: 0.6 })
        ]
      })
    )
    expect(await rows(`SELECT id, type, title, tags, attrs, revision, len FROM docket_index.entities WHERE scope = $1`)).toEqual([
      // len counts the words BM25 weighs its length by: orders, api; service, core; takes, orders, stores.
      { id: 'service.api', type: 'service', title: 'Orders API', tags: ['core'], attrs: { language: 'elixir' }, revision: 'sha256:api', len: 7 }
    ])
    expect(await rows(`SELECT source, rel, target, confidence, sources, attrs FROM docket_index.edges WHERE scope = $1 ORDER BY rel`)).toEqual([
      { source: 'service.api', rel: 'depends_on', target: 'datasource.postgres', confidence: 0.9, sources: ['code'], attrs: { criticality: 'high' } },
      { source: 'service.api', rel: 'owned_by', target: 'team.orders', confidence: 0.6, sources: [], attrs: null }
    ])

    // Replaying is a no-op; a new revision replaces the links it no longer has.
    await projection.upsert(makeDocument({ links: [entityLink({ rel: 'owned_by', target: 'team.orders', confidence: 0.6 })] }))
    await projection.upsert(makeDocument({ links: [entityLink({ rel: 'owned_by', target: 'team.orders', confidence: 0.6 })] }))
    expect(await rows(`SELECT source, rel, target FROM docket_index.edges WHERE scope = $1`)).toEqual([
      { source: 'service.api', rel: 'owned_by', target: 'team.orders' }
    ])
  })

  it('removes an entity and its links, keeping links to it as a stub target', async () => {
    fresh()
    const projection = await open()
    await projection.upsert(makeDocument())
    await projection.upsert(makeDocument({ id: 'service.web', title: 'Web', links: [entityLink({ rel: 'depends_on', target: 'service.api' })] }))
    await projection.remove('service.api')
    await projection.remove('service.api')
    expect(await rows(`SELECT id FROM docket_index.entities WHERE scope = $1`)).toEqual([{ id: 'service.web' }])
    expect(await rows(`SELECT source, target FROM docket_index.edges WHERE scope = $1`)).toEqual([{ source: 'service.web', target: 'service.api' }])
  })

  it('keeps an entity with index.graph false out of the graph, and one with index.fts false out of full-text search', async () => {
    fresh()
    const projection = await open()
    await projection.upsert(makeDocument({ index: { graph: false, fts: true, vector: true } }))
    await projection.upsert(makeDocument({ id: 'service.hidden', title: 'Hidden orders', index: { graph: true, fts: false, vector: true } }))
    expect(await rows(`SELECT source FROM docket_index.edges WHERE scope = $1 AND source = 'service.api'`)).toEqual([])
    expect((await projection.search?.('orders', 10))?.hits.map((hit) => hit.id)).toEqual(['service.api'])
  })

  it('resets only its own scope', async () => {
    fresh()
    const mine = await open()
    await mine.upsert(makeDocument())
    const theirs = scope
    fresh()
    const other = await open()
    await other.upsert(makeDocument())
    await mine.reset?.()
    expect((await database.pool.query(`SELECT scope FROM docket_index.entities WHERE scope IN ($1, $2)`, [theirs, scope])).rows).toEqual([{ scope }])
    expect((await database.pool.query(`SELECT scope FROM docket_index.edges WHERE scope IN ($1, $2)`, [theirs, scope])).rows).toEqual([{ scope }])
  })

  describe('full-text search', () => {
    const corpus = async (projection: EntityProjection) => {
      await projection.upsert(makeDocument({ id: 'service.orders', title: 'Orders', content: 'Takes customer orders and fulfils them.', tags: ['checkout'] }))
      await projection.upsert(makeDocument({ id: 'service.ledger', title: 'Ledger', content: 'Double-entry bookkeeping for every order.', tags: [] }))
      await projection.upsert(makeDocument({ id: 'person.priyanka-sharma', type: 'person', title: 'Priyanka Sharma', content: 'Leads the platform team.', tags: [] }))
      await projection.upsert(makeDocument({ id: 'service.search', title: 'Search', content: 'Indexes products for the storefront.', tags: [] }))
    }

    it('matches other forms of a word, any of the query\'s words, title first', async () => {
      fresh()
      const projection = await open()
      await corpus(projection)
      const answer = await projection.search?.('who is ordering things?', 10)
      expect(answer?.hits.map((hit) => hit.id)).toEqual(['service.orders', 'service.ledger'])
      expect(answer?.hits[0]).toMatchObject({ revision: 'sha256:api', passage: { text: 'Takes customer orders and fulfils them.' } })
      expect(answer?.note).toContain('Postgres full-text search (english)')
    })

    it('weighs a word by its idf, so one in every entity counts for little', async () => {
      fresh()
      const projection = await open({ trigram: false })
      await projection.upsert(makeDocument({ id: 'service.orders', title: 'Orders', content: 'Order intake.', tags: [] }))
      await projection.upsert(makeDocument({ id: 'service.billing', title: 'Billing', content: 'Bills each order once a month for many orders.', tags: [] }))
      await projection.upsert(makeDocument({ id: 'service.returns', title: 'Returns', content: 'Refunds an order for a customer.', tags: [] }))
      // "order" is in every entity; "customer" in one, so it decides.
      expect((await projection.search?.('customer orders', 10))?.hits.map((hit) => hit.id)).toEqual(['service.returns', 'service.orders', 'service.billing'])
    })

    it('searches tags and types too, and honours quoted phrases and exclusions', async () => {
      fresh()
      const projection = await open()
      await corpus(projection)
      expect((await projection.search?.('checkout', 10))?.hits.map((hit) => hit.id)).toEqual(['service.orders'])
      expect((await projection.search?.('"customer orders"', 10))?.hits.map((hit) => hit.id)).toEqual(['service.orders'])
      expect((await projection.search?.('order -bookkeeping', 10))?.hits.map((hit) => hit.id)).toEqual(['service.orders'])
    })

    it('finds a misspelt name by its title\'s trigrams, and only with trigrams on', async () => {
      fresh()
      const projection = await open()
      await corpus(projection)
      expect((await projection.search?.('priyanca sharmah', 10))?.hits.map((hit) => hit.id)).toEqual(['person.priyanka-sharma'])
      const plain = await open({ trigram: false })
      expect((await plain.search?.('priyanca sharmah', 10))?.hits.map((hit) => hit.id)).toEqual([])
    })

    it('lifts the entity a question names above those that only mention it', async () => {
      fresh()
      const projection = await open()
      await corpus(projection)
      await projection.upsert(makeDocument({ id: 'doc.ledger-notes', title: 'Notes', content: 'The ledger, the ledger and the ledger again: ledger ledger.', tags: [] }))
      expect((await projection.search?.('what does the ledger do', 10))?.hits[0]?.id).toBe('service.ledger')
    })

    it('finds nothing when no word matches', async () => {
      fresh()
      const projection = await open()
      await corpus(projection)
      expect((await projection.search?.('who is sophia', 10))?.hits).toEqual([])
      expect((await projection.search?.('the of and', 10))?.hits).toEqual([])
    })

    it('rebuilds a scope\'s vectors when its text search configuration changes', async () => {
      fresh()
      const english = await open({ trigram: false })
      await corpus(english)
      expect((await english.search?.('ordering', 10))?.hits.map((hit) => hit.id)).toContain('service.orders')
      const simple = await open({ language: 'simple', trigram: false })
      expect((await simple.search?.('ordering', 10))?.hits).toEqual([])
      expect((await simple.search?.('orders', 10))?.hits.map((hit) => hit.id)).toEqual(['service.orders'])
    })
  })

  describe('answers through the graph', () => {
    it('holds to the graph-path baseline Neo4j keeps', async () => {
      fresh()
      const projection = await open()
      for (const entity of GRAPH_PATH_FIXTURE.entities) await projection.upsert(entity)
      for (const { question, traverse, paths } of GRAPH_PATH_FIXTURE.cases) {
        const answer = await (await open({ traverse })).answer?.(ask(question))
        const facts = answer?.evidence.filter((item) => item.kind === 'derived-fact').map((item) => item.text.replace(/ \([^)]*\)/g, ''))
        expect(facts, JSON.stringify(traverse)).toEqual(paths)
      }
    })

    it('answers with the matches, a graph of the paths from them, and their passages', async () => {
      fresh()
      const projection = await open()
      for (const entity of GRAPH_PATH_FIXTURE.entities) await projection.upsert(entity)
      const request = ask('zebrafish')
      const answer = await projection.answer?.(request)

      expect(answer && validateAdapterAnswer(answer, request)).toEqual(answer)
      expect(answer?.blocks.map((block) => block.kind)).toEqual(['entities', 'graph', 'passages'])
      expect(answer?.blocks[0]).toMatchObject({ entities: [{ ref: { kind: 'entity', id: 'service.orders', revision: 'sha256:service.orders' } }] })
      const graph = graphOf(answer)
      expect(graph?.paths).toEqual([
        ['service.orders', 'datasource.orders-db'],
        ['service.orders', 'service.ledger', 'datasource.ledger-db'],
        ['service.orders', 'team.payments', 'service.billing']
      ])
      expect(graph?.nodes).toContainEqual({ id: 'team.payments', label: 'Payments team', type: 'team', ref: { kind: 'entity', id: 'team.payments', revision: 'sha256:team.payments' } })
      expect(answer?.evidence.find((item) => item.id === 'path-1')).toMatchObject({ kind: 'derived-fact', derivation: { engine: 'postgres' } })
      expect(answer?.interpretation.nativeQuery).toContain('WITH RECURSIVE')
      expect(answer?.coverage).toEqual({ mode: 'top-k', truncated: false, scope: 'default' })
    })

    it('shows a link to an entity not projected, or out of the graph, as a stub', async () => {
      fresh()
      const projection = await open({ traverse: { hops: 2, rels: ['depends_on'] } })
      for (const entity of GRAPH_PATH_FIXTURE.entities) await projection.upsert(entity)
      await projection.upsert({ ...GRAPH_PATH_FIXTURE.entities[2]!, index: { graph: false, fts: true, vector: true } })
      const graph = graphOf(await projection.answer?.(ask('zebrafish')))
      expect(graph?.nodes).toContainEqual({ id: 'service.ledger', label: 'service.ledger' })
      // Billing still depends on the ledger, so a path runs through it.
      expect(graph?.paths).toEqual([['service.orders', 'datasource.orders-db'], ['service.orders', 'service.ledger', 'service.billing']])
    })

    it('answers nothing when nothing matches', async () => {
      fresh()
      const projection = await open()
      for (const entity of GRAPH_PATH_FIXTURE.entities) await projection.upsert(entity)
      const answer = await projection.answer?.(ask('kangaroo'))
      expect(answer?.blocks).toEqual([])
    })
  })

  describe('does not reach other scopes', () => {
    it('in search or in paths', async () => {
      fresh()
      const other = await open()
      for (const entity of GRAPH_PATH_FIXTURE.entities) await other.upsert(entity)
      fresh()
      const mine = await open()
      await mine.upsert(GRAPH_PATH_FIXTURE.entities[0]!)
      expect((await mine.search?.('ledger books', 10))?.hits).toEqual([])
      const graph = graphOf(await mine.answer?.(ask('zebrafish')))
      // Its links' targets are stubs here: their entities are another scope's.
      expect(graph?.nodes.every((node) => node.id === 'service.orders' || node.ref === undefined)).toBe(true)
    })
  })
})

describe.skipIf(!TEST_PG_URL)('postgres projection with pgvector', async () => {
  const vector = await hasPgvector()
  let database: TestDatabase
  let scope: string
  const opened: EntityProjection[] = []

  const open = async (embedder: Embedder, overrides: Partial<PostgresConfig> = {}): Promise<EntityProjection> => {
    const config = postgresConfigSchema.parse({ url: database.url, scope, semantic: { model: embedder.model, dimensions: 16 }, ...overrides })
    const projection = createPostgresProjection(config, { embedder })
    await projection.init?.(CONTEXT)
    opened.push(projection)
    return projection
  }

  beforeAll(async () => {
    database = await createTestDatabase()
  })

  afterAll(async () => {
    await database?.drop()
  })

  afterEach(async () => {
    while (opened.length > 0) await opened.pop()?.close?.()
  })

  const corpus = async (projection: EntityProjection) => {
    await projection.upsert(makeDocument({ id: 'service.orders', title: 'Orders', content: 'Takes customer purchases.', tags: [] }))
    await projection.upsert(makeDocument({ id: 'service.ledger', title: 'Ledger', content: 'Keeps the books balanced.', tags: [] }))
    await projection.upsert(makeDocument({ id: 'service.secret', title: 'Secret', content: 'Keeps the books hidden.', tags: [], index: { graph: true, fts: true, vector: false } }))
    await projection.flush?.()
  }

  it.skipIf(!vector)('embeds what it may at flush, once per text and model', async () => {
    scope = `test-${Math.random().toString(36).slice(2)}`
    const embedder = wordEmbedder()
    const projection = await open(embedder)
    await corpus(projection)
    expect(embedder.calls.flat().map((text) => text.split('\n')[0])).toEqual(['# Ledger', '# Orders'])

    // Nothing changed, nothing re-embedded; a changed body is, alone.
    await projection.upsert(makeDocument({ id: 'service.ledger', title: 'Ledger', content: 'Keeps the books balanced.', tags: [], revision: 'sha256:other' }))
    await projection.flush?.()
    expect(embedder.calls).toHaveLength(1)
    await projection.upsert(makeDocument({ id: 'service.ledger', title: 'Ledger', content: 'Keeps the accounts.', tags: [] }))
    await projection.flush?.()
    expect(embedder.calls[1]?.map((text) => text.split('\n')[0])).toEqual(['# Ledger'])

    // Another model re-embeds everything.
    const other = wordEmbedder('fake-words-2')
    await (await open(other)).flush?.()
    expect(other.calls.flat()).toHaveLength(2)
  })

  it.skipIf(!vector)('searches by embedding alone, or fused with full-text', async () => {
    scope = `test-${Math.random().toString(36).slice(2)}`
    const embedder = wordEmbedder()
    const semantic = await open(embedder, { search: 'semantic' })
    await corpus(semantic)
    const byMeaning = await semantic.search?.('books balanced', 10)
    expect(byMeaning?.hits.map((hit) => hit.id)).toEqual(['service.ledger', 'service.orders'])
    expect(byMeaning?.hits[0]?.score).toBeGreaterThan(byMeaning?.hits[1]?.score ?? 1)
    expect(byMeaning?.note).toBe('Postgres cosine similarity of fake-words embeddings')

    const hybrid = await open(embedder)
    const fused = await hybrid.search?.('books', 10)
    // Full-text finds both that say "books", and only the embedded one twice; the others tie, and go by id.
    expect(fused?.hits.map((hit) => hit.id)).toEqual(['service.ledger', 'service.orders', 'service.secret'])
    expect(fused?.note).toContain('fused by reciprocal rank')
  })

  it.skipIf(!vector)('drops embeddings with their entities', async () => {
    scope = `test-${Math.random().toString(36).slice(2)}`
    const projection = await open(wordEmbedder())
    await corpus(projection)
    await projection.remove('service.ledger')
    expect((await database.pool.query(`SELECT id FROM docket_index.embeddings WHERE scope = $1`, [scope])).rows).toEqual([{ id: 'service.orders' }])
    await projection.reset?.()
    expect((await database.pool.query(`SELECT id FROM docket_index.embeddings WHERE scope = $1`, [scope])).rows).toEqual([])
  })
})
