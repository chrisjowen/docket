import { describe, expect, it } from 'vitest'

import { entitiesOf, entityOf } from '../../../test/entities.js'
import type { Mem0ProjectionConfig } from '../../config/config.js'
import type { MemoryDocument, MemoryEntity } from '../../model/index.js'
import { checkoutScope } from '../scope.js'
import type { Mem0Backend, Mem0Scope, StoredMemory } from './backend.js'
import {
  DOCUMENT_ID_KEY,
  createMem0Projection,
  defaultScope,
  renderDocument
} from './mem0-projection.js'

const CONTEXT = {
  projectRoot: '/repos/acme platform',
  memoryRoot: '/repos/acme platform/.docket',
  stateRoot: '/repos/acme platform/.docket/.index'
}

const makeFile = (overrides: Partial<MemoryDocument> = {}): MemoryDocument => ({
  id: 'service.orders',
  type: 'service',
  title: 'Orders',
  path: '.docket/resources/services/orders.md',
  hash: 'sha256:orders',
  tags: ['core'],
  attributes: {},
  links: [{ rel: 'owned_by', target: 'team.payments' }],
  content: 'Handles orders.\n',
  mentions: [],
  evidence: [],
  index: { graph: true, fts: true, vector: true },
  ...overrides
})

const makeDocument = (overrides: Partial<MemoryDocument> = {}): MemoryEntity => entityOf(makeFile(overrides))

/** An in-memory mem0 that can withhold ids on add, as the hosted API may. */
class FakeMem0 implements Mem0Backend {
  readonly memories = new Map<string, StoredMemory & { text: string }>()
  reportIds = true
  lists = 0
  private next = 0

  async add(text: string, metadata: Record<string, unknown>): Promise<string[]> {
    const id = `mem-${(this.next += 1)}`
    this.memories.set(id, { id, text, metadata })
    return this.reportIds ? [id] : []
  }
  async list(): Promise<StoredMemory[]> {
    this.lists += 1
    return [...this.memories.values()]
  }
  async delete(memoryId: string): Promise<void> {
    this.memories.delete(memoryId)
  }
  async deleteAll(): Promise<void> {
    this.memories.clear()
  }
  /** What the next search returns, in order, as mem0 would rank it. */
  searchResults: StoredMemory[] = []
  lastSearch: { query: string; limit: number } | null = null
  async search(query: string, limit: number): Promise<StoredMemory[]> {
    this.lastSearch = { query, limit }
    return this.searchResults
  }

  texts(): string[] {
    return [...this.memories.values()].map((memory) => memory.text)
  }
}

const OSS: Mem0ProjectionConfig = { type: 'mem0', mode: 'oss', config: {} }

const setup = async (config: Mem0ProjectionConfig = OSS, backend = new FakeMem0()) => {
  const scopes: Mem0Scope[] = []
  const projection = createMem0Projection(config, async (_config, scope) => {
    scopes.push(scope)
    return backend
  })
  await projection.init?.(CONTEXT)
  return { projection, backend, scopes }
}

describe('mem0 projection', () => {
  it('stores each document verbatim with its id in the metadata', async () => {
    const { projection, backend } = await setup()
    await projection.upsert(makeDocument())

    const [memory] = [...backend.memories.values()]
    expect(memory?.text).toBe(
      '# Orders\nservice service.orders\nConfidence: 0.5, no evidence recorded\n\nHandles orders.\n\n' +
        'Links:\n- owned_by team.payments (confidence 0.5)\n\nTags: core\n'
    )
    expect(memory?.metadata).toMatchObject({
      [DOCUMENT_ID_KEY]: 'service.orders',
      memory_type: 'service',
      memory_hash: expect.stringMatching(/^sha256:/),
      confidence: 0.5,
      confidence_basis: 'unevidenced',
      evidence_count: 0
    })
  })

  it('replaces rather than duplicates a document that changes', async () => {
    const { projection, backend } = await setup()
    await projection.upsert(makeDocument())
    await projection.upsert(makeDocument({ title: 'Orders API', hash: 'sha256:v2' }))

    expect(backend.texts()).toHaveLength(1)
    expect(backend.texts()[0]).toContain('# Orders API')
  })

  it('removes a deleted document', async () => {
    const { projection, backend } = await setup()
    await projection.upsert(makeDocument())
    await projection.upsert(makeDocument({ id: 'team.payments', type: 'team', title: 'Payments' }))
    await projection.remove('service.orders')

    expect(backend.texts()).toEqual([expect.stringContaining('# Payments')])
  })

  it('keeps documents with index.vector false out of mem0', async () => {
    const { projection, backend } = await setup()
    await projection.upsert(makeDocument())
    await projection.upsert(makeDocument({ index: { graph: true, fts: true, vector: false } }))

    expect(backend.memories.size).toBe(0)
  })

  it('finds memories written by an earlier run through their metadata', async () => {
    const backend = new FakeMem0()
    await (await setup(OSS, backend)).projection.upsert(makeDocument())

    // A fresh process knows nothing locally - no mapping file is kept.
    const { projection } = await setup(OSS, backend)
    await projection.remove('service.orders')

    expect(backend.memories.size).toBe(0)
  })

  it('re-reads mem0 when an add did not report its ids', async () => {
    const backend = new FakeMem0()
    backend.reportIds = false
    const { projection } = await setup(OSS, backend)

    await projection.upsert(makeDocument())
    await projection.upsert(makeDocument({ title: 'Orders API', hash: 'sha256:v2' }))

    expect(backend.texts()).toEqual([expect.stringContaining('# Orders API')])
  })

  it('reads mem0 once, not per document, when ids are reported', async () => {
    const { projection, backend } = await setup()
    for (const id of ['a.one', 'a.two', 'a.three']) {
      await projection.upsert(makeDocument({ id }))
    }
    expect(backend.lists).toBe(1)
  })

  it('reset empties the scope', async () => {
    const { projection, backend } = await setup()
    await projection.upsert(makeDocument())
    await projection.reset?.()

    expect(backend.memories.size).toBe(0)
  })

  it('scopes to the checkout by default and honours a configured scope', async () => {
    expect((await setup()).scopes).toEqual([{ agentId: checkoutScope('/repos/acme platform') }])
    expect(defaultScope('/x/y')).toEqual({ agentId: checkoutScope('/x/y') })
    expect(defaultScope('/a/platform')).not.toEqual(defaultScope('/b/platform'))

    const scoped = await setup({ ...OSS, scope: { userId: 'platform-team' } })
    expect(scoped.scopes).toEqual([{ userId: 'platform-team' }])
  })

  it('answers a search with document ids and mem0 scores, in mem0 order', async () => {
    const { projection, backend } = await setup()
    backend.searchResults = [
      { id: 'mem-9', score: 0.8, metadata: { [DOCUMENT_ID_KEY]: 'decision.minio' } },
      { id: 'mem-3', score: 0.6, metadata: { [DOCUMENT_ID_KEY]: 'service.orders' } }
    ]

    expect(await projection.search?.('uploads', 5)).toEqual({
      hits: [
        { id: 'decision.minio', score: 0.8 },
        { id: 'service.orders', score: 0.6 }
      ]
    })
    expect(backend.lastSearch).toEqual({ query: 'uploads', limit: 5 })
  })

  it('skips memories it did not project, and repeats of one document', async () => {
    const { projection, backend } = await setup()
    backend.searchResults = [
      { id: 'mem-1', score: 0.9, metadata: { source: 'someone else' } },
      { id: 'mem-2', score: 0.7, metadata: { [DOCUMENT_ID_KEY]: 'service.orders' } },
      { id: 'mem-3', score: 0.5, metadata: { [DOCUMENT_ID_KEY]: 'service.orders' } }
    ]

    expect(await projection.search?.('orders', 5)).toEqual({
      hits: [{ id: 'service.orders', score: 0.7 }]
    })
  })

  it('renders a document without body, links or tags', () => {
    expect(renderDocument(makeDocument({ content: '', links: [], tags: [] }))).toBe(
      '# Orders\nservice service.orders\nConfidence: 0.5, no evidence recorded\n'
    )
  })

  it('says exactly where each thing was seen, listing evidence a link shares with its resource once', () => {
    const seenInCode = {
      source: 'code',
      path: 'src/orders/server.ts',
      lines: '10-42',
      symbol: 'createServer',
      observedAt: '2026-10-05',
      observedBy: 'claude'
    }
    const text = renderDocument(
      makeDocument({
        tags: [],
        evidence: [seenInCode],
        links: [
          { rel: 'owned_by', target: 'team.payments' },
          {
            rel: 'depends_on',
            target: 'datasource.orders-db',
            evidence: [{ source: 'manifest', path: 'package.json', key: 'dependencies.pg', urls: ['https://example.com/pg'] }]
          }
        ]
      })
    )

    expect(text).toBe(
      [
        '# Orders',
        'service service.orders',
        'Confidence: 0.6 from code (1 observation)',
        '',
        'Handles orders.',
        '',
        'Links:',
        '- owned_by team.payments (confidence 0.5)',
        '- depends_on datasource.orders-db (confidence 0.9)',
        '  - manifest: package.json key dependencies.pg https://example.com/pg',
        '',
        'Evidence:',
        '- code: src/orders/server.ts:10-42 createServer (2026-10-05, claude)',
        ''
      ].join('\n')
    )
  })

  it('stores files that share an id as one memory with their combined confidence', async () => {
    const { projection, backend } = await setup()
    const [merged] = entitiesOf([
      makeFile({ evidence: [{ source: 'code', path: 'src/orders.ts' }] }),
      makeFile({
        path: '.docket/captured/orders.md',
        evidence: [{ source: 'runtime', symbol: 'deployment/orders' }]
      })
    ])
    if (!merged) throw new Error('no entity')
    await projection.upsert(merged)

    expect(backend.memories.size).toBe(1)
    expect([...backend.memories.values()][0]?.metadata).toMatchObject({
      memory_path: '.docket/captured/orders.md',
      memory_paths: '.docket/captured/orders.md,.docket/resources/services/orders.md',
      confidence: 0.94,
      confidence_basis: 'evidence',
      evidence_count: 2,
      evidence_sources: 'code,runtime'
    })
  })
})
