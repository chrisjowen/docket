import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Sqlite from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { validateAdapterAnswer, type AskRequest, type EntityInput, type GraphBlock } from '@docket/contracts'
import type { Embedder, EntityProjection } from '@docket/adapter-kit'
import { entityInput, entityLink, GRAPH_PATH_FIXTURE } from '@docket/adapter-kit/testing'

import { sqliteConfigSchema } from './config.js'
import { createSqliteProjection, ftsWords } from './sqlite-projection.js'

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

describe('ftsWords', () => {
  it('quotes each word worth matching', () => {
    expect(ftsWords('Which service takes "orders"?')).toEqual(['"service"', '"takes"', '"orders"'])
    expect(ftsWords('who is it')).toEqual([])
  })
})

describe('sqlite projection', () => {
  let root: string
  let scope: string
  const opened: EntityProjection[] = []

  /** Opens a projection on `overrides`, as a `.docket.yaml` entry would give them, defaults and all. */
  const open = async (overrides: Record<string, unknown> = {}, embedder?: Embedder): Promise<EntityProjection> => {
    const config = sqliteConfigSchema.parse({ scope, ...overrides })
    const projection = createSqliteProjection(config, join(root, '.docket/.index/adapters/sqlite'), embedder ? { embedder } : {})
    await projection.init?.({ projectRoot: root })
    opened.push(projection)
    return projection
  }

  /** Rows from the default file, read beside the projection. */
  const rows = (sql: string): unknown[] => {
    const db = new Sqlite(join(root, '.docket/.index/adapters/sqlite/index.sqlite'), { readonly: true })
    try {
      return db.prepare(sql).all(scope)
    } finally {
      db.close()
    }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'docket-sqlite-'))
    scope = 'test'
  })

  afterEach(async () => {
    while (opened.length > 0) await opened.pop()?.close?.()
    await rm(root, { recursive: true, force: true })
  })

  it('keeps its file in its own state directory, or where `file` says, and migrates it once', async () => {
    await Promise.all([open(), open()])
    expect(rows('SELECT name FROM migrations WHERE ? IS NOT NULL')).toEqual([{ name: '0001_entities_edges' }])
    const elsewhere = await open({ file: 'index/docket.sqlite' })
    await elsewhere.upsert(makeDocument())
    const db = new Sqlite(join(root, 'index/docket.sqlite'), { readonly: true })
    expect(db.prepare('SELECT id FROM entities').all()).toEqual([{ id: 'service.api' }])
    db.close()
  })

  it('stores an entity and the links it owns, and rewrites them whole', async () => {
    const projection = await open()
    await projection.upsert(
      makeDocument({
        links: [
          entityLink({ rel: 'depends_on', target: 'datasource.postgres', confidence: 0.9, sources: ['code'], attributes: { criticality: 'high' } }),
          entityLink({ rel: 'owned_by', target: 'team.orders', confidence: 0.6 })
        ]
      })
    )
    expect(rows('SELECT source, rel, target, confidence, sources, attrs FROM edges WHERE scope = ? ORDER BY rel')).toEqual([
      { source: 'service.api', rel: 'depends_on', target: 'datasource.postgres', confidence: expect.closeTo(0.9), sources: '["code"]', attrs: '{"criticality":"high"}' },
      { source: 'service.api', rel: 'owned_by', target: 'team.orders', confidence: expect.closeTo(0.6), sources: '[]', attrs: null }
    ])
    await projection.upsert(makeDocument({ links: [entityLink({ rel: 'owned_by', target: 'team.orders', confidence: 0.6 })] }))
    await projection.upsert(makeDocument({ links: [entityLink({ rel: 'owned_by', target: 'team.orders', confidence: 0.6 })] }))
    expect(rows('SELECT source, rel, target FROM edges WHERE scope = ?')).toEqual([{ source: 'service.api', rel: 'owned_by', target: 'team.orders' }])
    expect(rows('SELECT count(*) AS n FROM entities_fts WHERE ? IS NOT NULL')).toEqual([{ n: 1 }])
  })

  it('removes an entity and its links, keeping links to it as a stub target', async () => {
    const projection = await open()
    await projection.upsert(makeDocument())
    await projection.upsert(makeDocument({ id: 'service.web', title: 'Web', links: [entityLink({ rel: 'depends_on', target: 'service.api' })] }))
    await projection.remove('service.api')
    await projection.remove('service.api')
    expect(rows('SELECT id FROM entities WHERE scope = ?')).toEqual([{ id: 'service.web' }])
    expect(rows('SELECT source, target FROM edges WHERE scope = ?')).toEqual([{ source: 'service.web', target: 'service.api' }])
    // Its full-text row went with it.
    expect((await projection.search?.('orders', 10))?.hits.map((hit) => hit.id)).toEqual(['service.web'])
  })

  it('keeps an entity with index.graph false out of the graph, and one with index.fts false out of full-text search', async () => {
    const projection = await open()
    await projection.upsert(makeDocument({ index: { graph: false, fts: true, vector: true } }))
    await projection.upsert(makeDocument({ id: 'service.hidden', title: 'Hidden orders', index: { graph: true, fts: false, vector: true } }))
    expect(rows(`SELECT source FROM edges WHERE scope = ? AND source = 'service.api'`)).toEqual([])
    expect((await projection.search?.('orders', 10))?.hits.map((hit) => hit.id)).toEqual(['service.api'])
  })

  it('resets only its own scope', async () => {
    const mine = await open()
    await mine.upsert(makeDocument())
    scope = 'other'
    const other = await open()
    await other.upsert(makeDocument())
    await mine.reset?.()
    expect(rows('SELECT scope FROM entities WHERE ? IS NOT NULL')).toEqual([{ scope: 'other' }])
    expect(rows('SELECT scope FROM edges WHERE ? IS NOT NULL')).toEqual([{ scope: 'other' }])
    expect(rows('SELECT count(*) AS n FROM entities_fts WHERE ? IS NOT NULL')).toEqual([{ n: 1 }])
  })

  describe('full-text search', () => {
    it('weighs a word by Lucene\'s idf, even one in most rows, where FTS5 would count it all but worthless', async () => {
      const projection = await open()
      await projection.upsert(makeDocument({ id: 'service.orders', title: 'Orders', content: 'Order intake.', tags: [] }))
      await projection.upsert(makeDocument({ id: 'service.billing', title: 'Billing', content: 'Bills each order once a month for many orders.', tags: [] }))
      await projection.upsert(makeDocument({ id: 'service.returns', title: 'Returns', content: 'Refunds an order.', tags: [] }))
      // "order" is in every row; the title still decides.
      expect((await projection.search?.('orders', 10))?.hits.map((hit) => hit.id)).toEqual(['service.orders', 'service.billing', 'service.returns'])
    })

    const corpus = async (projection: EntityProjection) => {
      await projection.upsert(makeDocument({ id: 'service.orders', title: 'Orders', content: 'Takes customer orders and fulfils them.', tags: ['checkout'] }))
      await projection.upsert(makeDocument({ id: 'service.ledger', title: 'Ledger', content: 'Double-entry bookkeeping for every order.', tags: [] }))
      await projection.upsert(makeDocument({ id: 'person.priyanka-sharma', type: 'person', title: 'Priyanka Sharma', content: 'Leads the platform team.', tags: [] }))
      await projection.upsert(makeDocument({ id: 'service.search', title: 'Search', content: 'Indexes products for the storefront.', tags: [] }))
    }

    it('matches other forms of a word, any of the query\'s words, title first', async () => {
      const projection = await open()
      await corpus(projection)
      const answer = await projection.search?.('who is ordering things?', 10)
      expect(answer?.hits.map((hit) => hit.id)).toEqual(['service.orders', 'service.ledger'])
      expect(answer?.hits[0]).toMatchObject({ revision: 'sha256:api', passage: { text: 'Takes customer orders and fulfils them.' } })
      expect(answer?.note).toContain('SQLite FTS5 full-text search')
    })

    it('searches tags and types too, and finds nothing when no word matches', async () => {
      const projection = await open()
      await corpus(projection)
      expect((await projection.search?.('checkout', 10))?.hits.map((hit) => hit.id)).toEqual(['service.orders'])
      expect((await projection.search?.('person', 10))?.hits.map((hit) => hit.id)).toEqual(['person.priyanka-sharma'])
      expect((await projection.search?.('who is sophia', 10))?.hits).toEqual([])
      expect((await projection.search?.('the of and', 10))?.hits).toEqual([])
    })
  })

  describe('answers through the graph', () => {
    it('holds to the graph-path baseline Neo4j keeps', async () => {
      const projection = await open()
      for (const entity of GRAPH_PATH_FIXTURE.entities) await projection.upsert(entity)
      for (const { question, traverse, paths } of GRAPH_PATH_FIXTURE.cases) {
        const answer = await (await open({ traverse })).answer?.(ask(question))
        const facts = answer?.evidence.filter((item) => item.kind === 'derived-fact').map((item) => item.text.replace(/ \([^)]*\)/g, ''))
        expect(facts, JSON.stringify(traverse)).toEqual(paths)
      }
    })

    it('answers with the matches, a graph of the paths from them, and their passages', async () => {
      const projection = await open()
      for (const entity of GRAPH_PATH_FIXTURE.entities) await projection.upsert(entity)
      const request = ask('zebrafish')
      const answer = await projection.answer?.(request)

      expect(answer && validateAdapterAnswer(answer, request)).toEqual(answer)
      expect(answer?.blocks.map((block) => block.kind)).toEqual(['entities', 'graph', 'passages'])
      expect(answer?.blocks[0]).toMatchObject({ entities: [{ ref: { kind: 'entity', id: 'service.orders', revision: 'sha256:service.orders' } }] })
      expect(graphOf(answer)?.paths).toEqual([
        ['service.orders', 'datasource.orders-db'],
        ['service.orders', 'service.ledger', 'datasource.ledger-db'],
        ['service.orders', 'team.payments', 'service.billing']
      ])
      expect(answer?.evidence.find((item) => item.id === 'path-1')).toMatchObject({ kind: 'derived-fact', derivation: { engine: 'sqlite' } })
      expect(answer?.interpretation.nativeQuery).toContain('WITH RECURSIVE')
    })

    it('shows a link to an entity not projected, or out of the graph, as a stub', async () => {
      const projection = await open({ traverse: { hops: 2, rels: ['depends_on'] } })
      for (const entity of GRAPH_PATH_FIXTURE.entities) await projection.upsert(entity)
      await projection.upsert({ ...GRAPH_PATH_FIXTURE.entities[2]!, index: { graph: false, fts: true, vector: true } })
      const graph = graphOf(await projection.answer?.(ask('zebrafish')))
      expect(graph?.nodes).toContainEqual({ id: 'service.ledger', label: 'service.ledger' })
      // Billing still depends on the ledger, so a path runs through it.
      expect(graph?.paths).toEqual([['service.orders', 'datasource.orders-db'], ['service.orders', 'service.ledger', 'service.billing']])
    })

    it('walks out from each path rather than scanning every link for it, so a well-linked entity stays quick', async () => {
      const projection = await open()
      await projection.upsert(makeDocument({ id: 'team.hub', type: 'team', title: 'Hub zebrafish', content: '', links: [] }))
      for (let i = 0; i < 400; i++) {
        const links = [entityLink({ rel: 'owned_by', target: 'team.hub' }), entityLink({ rel: 'depends_on', target: `service.s${(i + 1) % 400}` })]
        await projection.upsert(makeDocument({ id: `service.s${i}`, title: `Service ${i}`, content: '', links }))
      }
      const started = performance.now()
      const graph = graphOf(await projection.answer?.(ask('zebrafish')))
      expect(graph?.paths).toHaveLength(3)
      expect(performance.now() - started).toBeLessThan(2000)
    })

    it('does not reach other scopes', async () => {
      scope = 'other'
      const other = await open()
      for (const entity of GRAPH_PATH_FIXTURE.entities) await other.upsert(entity)
      scope = 'mine'
      const mine = await open()
      await mine.upsert(GRAPH_PATH_FIXTURE.entities[0]!)
      expect((await mine.search?.('ledger books', 10))?.hits).toEqual([])
      const graph = graphOf(await mine.answer?.(ask('zebrafish')))
      expect(graph?.nodes.every((node) => node.id === 'service.orders' || node.ref === undefined)).toBe(true)
    })
  })

  describe('with embeddings', () => {
    const corpus = async (projection: EntityProjection) => {
      await projection.upsert(makeDocument({ id: 'service.orders', title: 'Orders', content: 'Takes customer purchases.', tags: [] }))
      await projection.upsert(makeDocument({ id: 'service.ledger', title: 'Ledger', content: 'Keeps the books balanced.', tags: [] }))
      await projection.upsert(makeDocument({ id: 'service.secret', title: 'Secret', content: 'Keeps the books hidden.', tags: [], index: { graph: true, fts: true, vector: false } }))
      await projection.flush?.()
    }

    it('embeds what it may at flush, once per text and model', async () => {
      const embedder = wordEmbedder()
      const projection = await open({ semantic: { model: 'fake-words', dimensions: 16 } }, embedder)
      await corpus(projection)
      expect(embedder.calls.flat().map((text) => text.split('\n')[0])).toEqual(['# Ledger', '# Orders'])
      await projection.upsert(makeDocument({ id: 'service.ledger', title: 'Ledger', content: 'Keeps the books balanced.', tags: [], revision: 'sha256:other' }))
      await projection.flush?.()
      expect(embedder.calls).toHaveLength(1)
      await projection.upsert(makeDocument({ id: 'service.ledger', title: 'Ledger', content: 'Keeps the accounts.', tags: [] }))
      await projection.flush?.()
      expect(embedder.calls[1]?.map((text) => text.split('\n')[0])).toEqual(['# Ledger'])
      const other = wordEmbedder('fake-words-2')
      await (await open({ semantic: { model: 'fake-words-2', dimensions: 16 } }, other)).flush?.()
      expect(other.calls.flat()).toHaveLength(2)
    })

    it('searches by embedding alone, or fused with full-text', async () => {
      const embedder = wordEmbedder()
      const semantic = { model: 'fake-words', dimensions: 16 }
      const byMeaning = await open({ semantic, search: 'semantic' }, embedder)
      await corpus(byMeaning)
      const found = await byMeaning.search?.('books balanced', 10)
      expect(found?.hits.map((hit) => hit.id)).toEqual(['service.ledger', 'service.orders'])
      expect(found?.note).toBe('SQLite cosine similarity of fake-words embeddings')
      const hybrid = await open({ semantic }, embedder)
      expect((await hybrid.search?.('books', 10))?.hits.map((hit) => hit.id)).toEqual(['service.ledger', 'service.orders', 'service.secret'])
    })

    it('drops embeddings with their entities', async () => {
      const projection = await open({ semantic: { model: 'fake-words', dimensions: 16 } }, wordEmbedder())
      await corpus(projection)
      await projection.remove('service.ledger')
      expect(rows('SELECT e.id FROM embeddings m JOIN entities e ON e.rid = m.rid WHERE e.scope = ?')).toEqual([{ id: 'service.orders' }])
      await projection.reset?.()
      expect(rows('SELECT count(*) AS n FROM embeddings WHERE ? IS NOT NULL')).toEqual([{ n: 0 }])
    })
  })
})
