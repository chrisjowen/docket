import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkoutScope } from '@docket/adapter-kit'
import { entityInput, entityLink } from '@docket/adapter-kit/testing'
import type { AdapterAnswer, CanonicalInput, EntityInput, MemoryAdapter, ProjectionBatch, RecordChange } from '@docket/contracts'
import { checkAdapterContract, fakeServices, SAMPLE_SCOPE, sampleAskRequest, sampleDocument, sampleEntity, sampleObservation } from '@docket/contracts/testing'
import { describe, expect, it } from 'vitest'

import { startFakeCognee, type FakeCognee } from '../fixtures/fake-cognee.js'
import { cogneeConfigSchema, type CogneeConfig } from './config.js'
import { createCogneeAdapter, parseCitedAnswer } from './cognee-adapter.js'
import { contentHash } from './cognee-client.js'
import { defaultDataset, disambiguation, identityMetadata, parseIdentity, renderEntity, stripDisambiguation } from './cognee-store.js'
import cognee from './index.js'

const URL_ = 'http://cognee.test:8000'
const DATASET = 'docket-test'

const entity = (id: string, overrides: Partial<EntityInput> = {}): EntityInput => entityInput({ id, scope: SAMPLE_SCOPE, ...overrides })

interface Harness {
  adapter: MemoryAdapter
  fake: FakeCognee
  records: CanonicalInput[]
  apply(...changes: RecordChange[]): Promise<Awaited<ReturnType<NonNullable<MemoryAdapter['projection']>['apply']>>>
  ask(question: string, overrides?: Partial<Parameters<typeof sampleAskRequest>[0]>): Promise<AdapterAnswer>
  /** The data items the fake holds in the dataset, as [docket id, text]. */
  held(): [unknown, string][]
}

let batches = 0

const harness = async (config: Partial<CogneeConfig> = {}, fake = startFakeCognee(), env: Record<string, string> = {}): Promise<Harness> => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'docket-cognee-'))
  const records: CanonicalInput[] = []
  const services = fakeServices({ stateRoot, records, env })
  const adapter = createCogneeAdapter(cogneeConfigSchema.parse({ url: URL_, dataset: DATASET, ...config }), services, { version: 'test', fetch: fake.fetch })
  return {
    adapter,
    fake,
    records,
    apply: (...changes) => {
      batches += 1
      for (const change of changes) {
        if (change.operation === 'upsert') {
          const at = records.findIndex((record) => record.kind === change.record.kind && record.id === change.record.id)
          if (at >= 0) records.splice(at, 1, change.record)
          else records.push(change.record)
        } else {
          const at = records.findIndex((record) => record.kind === change.kind && record.id === change.id)
          if (at >= 0) records.splice(at, 1)
        }
      }
      const batch: ProjectionBatch = { batchId: `batch-${batches}`, scope: SAMPLE_SCOPE, checkpoint: `checkpoint-${batches}`, changes }
      return adapter.projection!.apply(batch)
    },
    ask: (question, overrides = {}) => adapter.query!.ask(sampleAskRequest({ question, ...overrides })),
    held: () => [...(fake.datasets.get(DATASET)?.items.values() ?? [])].map((item) => [item.externalMetadata?.docket_id, item.text])
  }
}

const upsert = (record: CanonicalInput): RecordChange => ({ operation: 'upsert', record })
const remove = (record: CanonicalInput): RecordChange => ({ operation: 'remove', kind: record.kind, id: record.id, revision: record.revision })

const entityIds = (answer: AdapterAnswer): string[] =>
  answer.blocks.flatMap((block) => (block.kind === 'entities' ? block.entities.map((item) => item.ref.id) : []))

describe('cognee adapter definition', () => {
  it('needs a server URL, and defaults the key variable, the inputs and the bounds', () => {
    expect(() => cognee.validateConfig(undefined)).toThrow(/url/)
    expect(cognee.validateConfig({ url: 'http://localhost:8000' })).toEqual({
      url: 'http://localhost:8000',
      apiKeyEnv: 'COGNEE_API_KEY',
      inputs: ['entity'],
      timeoutMs: 60_000,
      cognifyTimeoutMs: 3_600_000
    })
    expect(cognee).toMatchObject({ apiVersion: 1, name: 'cognee' })
  })

  it('refuses unknown fields, dataset names cognee would refuse and unknown completion searches', () => {
    expect(() => cognee.validateConfig({ url: URL_, datasets: 'x' })).toThrow(/datasets/)
    for (const dataset of ['has.dot', 'has space', '']) expect(() => cognee.validateConfig({ url: URL_, dataset }), dataset).toThrow(/dataset/)
    expect(() => cognee.validateConfig({ url: URL_, completion: 'CHUNKS' })).toThrow(/completion/)
    expect(() => cognee.validateConfig({ url: URL_, apiKeyEnv: 'sk-live-123' })).toThrow(/apiKeyEnv/)
    expect(cognee.validateConfig({ url: URL_, inputs: ['entity', 'document', 'entity'] }).inputs).toEqual(['entity', 'document'])
  })

  it('files a checkout in a dataset of its own, named as cognee allows', () => {
    const dataset = defaultDataset('/repos/acme.platform v2', 'default')
    expect(dataset).toBe(checkoutScope('/repos/acme.platform v2').replace(/[.\s]+/g, '-'))
    expect(cognee.validateConfig({ url: URL_, dataset }).dataset).toBe(dataset)
    expect(defaultDataset('/repos/acme', 'staging')).toBe(`${checkoutScope('/repos/acme')}-staging`)
  })
})

describe('identity in external metadata', () => {
  it('round-trips, also as the JSON string a search returns', () => {
    const identity = { kind: 'entity' as const, id: 'service.orders', revision: 'sha256:abc' }
    const metadata = identityMetadata(DATASET, 'default', identity, '# Orders service\n')
    expect(parseIdentity(DATASET, 'default', metadata)).toEqual(identity)
    expect(parseIdentity(DATASET, 'default', JSON.stringify(metadata))).toEqual(identity)
  })

  it('does not claim items of another dataset, scope or writer', () => {
    const metadata = identityMetadata(DATASET, 'default', { kind: 'entity', id: 'a', revision: 'r' }, 'A\n')
    expect(parseIdentity('docket-other', 'default', metadata)).toBeUndefined()
    expect(parseIdentity(DATASET, 'staging', metadata)).toBeUndefined()
    expect(parseIdentity(DATASET, 'default', { ...metadata, docket_kind: 'task' })).toBeUndefined()
    expect(parseIdentity(DATASET, 'default', { source: 'crm' })).toBeUndefined()
    expect(parseIdentity(DATASET, 'default', null)).toBeUndefined()
    expect(parseIdentity(DATASET, 'default', '{not json')).toBeUndefined()
  })

  it('strips the disambiguation line from the chunk that ends with it, and only that one', () => {
    const identity = { kind: 'entity' as const, id: 'team.a', revision: 'r1' }
    expect(stripDisambiguation(`Same text.\n${disambiguation(identity)}`, identity)).toBe('Same text.\n')
    expect(stripDisambiguation('Same text.\n', identity)).toBe('Same text.\n')
  })
})

describe('what cognify reads', () => {
  it('is the title, type, body, links by their targets\' titles and tags - no ids', async () => {
    const services = fakeServices({ records: [entity('team.payments', { title: 'Payments team' })] })
    const text = await renderEntity(
      entity('service.orders', {
        title: 'Orders service',
        type: 'service',
        content: 'Takes customer orders.\n',
        tags: ['payments', 'tier-1'],
        links: [entityLink({ rel: 'owned_by', target: 'team.payments' }), entityLink({ rel: 'depends_on', target: 'datasource.orders-db' })]
      }),
      services.canonical
    )
    expect(text).toBe('# Orders service\nservice\n\nTakes customer orders.\n\nLinks:\n- owned by: Payments team\n- depends on: datasource.orders-db\n\nTags: payments, tier-1\n')
    expect(text).not.toContain('service.orders')
  })
})

describe('cited answers', () => {
  it('splits cognee\'s answer from the references it appends', () => {
    const data = '667c035a-5c5e-4d8e-bb2e-5684f3a3016d'
    const chunk = '8a695b0e-9bf5-521e-bfd5-9ffe4d8f5470'
    expect(parseCitedAnswer(`The orders service is owned by the payments team.\n\nEvidence:\n- chunk 1 of document docket-entity-service.orders (data_id: ${data}, chunk_id: ${chunk})`)).toEqual({
      text: 'The orders service is owned by the payments team.',
      dataIds: [data],
      chunkIds: [chunk]
    })
    expect(parseCitedAnswer('No evidence here.')).toEqual({ text: 'No evidence here.', dataIds: [], chunkIds: [] })
  })
})

describe('cognee adapter against a mocked cognee API', () => {
  it('meets the adapter contract', async () => {
    const fake = startFakeCognee()
    const stateRoot = await mkdtemp(join(tmpdir(), 'docket-cognee-contract-'))
    const report = await checkAdapterContract(
      { ...cognee, create: async (config: CogneeConfig, services: Parameters<typeof cognee.create>[1]) => createCogneeAdapter(config, services, { version: 'test', fetch: fake.fetch }) },
      {
        config: { url: URL_, dataset: 'docket-contract' },
        invalidConfig: { url: URL_, dataset: 'has.dot' },
        services: fakeServices({ projectRoot: stateRoot, stateRoot, records: [sampleEntity()] })
      }
    )
    expect(report.checks.filter((check) => !check.ok)).toEqual([])
    expect(report.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining(['projection.apply replays the same batch', 'projection.reset', 'query.ask returns a valid answer'])
    )
  })

  it('adds each entity as one item with its identity, cognifies once per batch, and answers with its id', async () => {
    const h = await harness()
    const orders = entity('service.orders', { title: 'Orders service', content: 'Takes customer orders and stores them in Postgres.' })
    const payments = entity('team.payments', { title: 'Payments team', content: 'Runs checkout and billing.' })
    const receipt = await h.apply(upsert(orders), upsert(payments))
    expect(receipt).toEqual({ batchId: expect.any(String), applied: ['service.orders', 'team.payments'], failed: [] })
    expect(h.fake.requests.filter((request) => request === 'POST /api/v1/cognify')).toHaveLength(1)
    expect(h.held().map(([id]) => id)).toEqual(['service.orders', 'team.payments'])

    const answer = await h.ask('which service stores customer orders')
    expect(entityIds(answer)).toEqual(['service.orders'])
    expect(answer.evidence[0]).toMatchObject({
      kind: 'passage',
      text: expect.stringContaining('Takes customer orders'),
      canonicalRefs: [{ kind: 'entity', id: 'service.orders', revision: orders.revision }],
      score: expect.any(Number)
    })
    expect(answer.coverage.mode).toBe('top-k')
    expect(answer.interpretation.assumptions.join(' ')).toMatch(/cosine distances - lower is closer/)
  })

  it('replays a batch without adding anything again', async () => {
    const h = await harness()
    const orders = entity('service.orders', { content: 'Takes customer orders.' })
    await h.apply(upsert(orders))
    const adds = () => h.fake.requests.filter((request) => request === 'POST /api/v1/add').length
    const before = adds()
    expect((await h.apply(upsert(orders))).applied).toEqual(['service.orders'])
    expect(adds()).toBe(before)
    expect(h.held()).toHaveLength(1)
  })

  it('replaces an earlier revision, and deletes on remove', async () => {
    const h = await harness()
    const first = entity('service.orders', { revision: 'r1', content: 'Takes customer orders.' })
    await h.apply(upsert(first))
    const second = entity('service.orders', { revision: 'r2', content: 'Takes and refunds customer orders.' })
    await h.apply(upsert(second))
    expect(h.held()).toEqual([['service.orders', expect.stringContaining('refunds')]])
    expect((await h.ask('refunds orders')).evidence[0]?.canonicalRefs).toEqual([{ kind: 'entity', id: 'service.orders', revision: 'r2', span: { path: second.path } }])

    await h.apply(remove(second))
    expect(h.held()).toEqual([])
    expect(entityIds(await h.ask('refunds orders'))).toEqual([])
  })

  it('files a new revision whose text did not change under its new revision', async () => {
    const h = await harness()
    await h.apply(upsert(entity('service.orders', { revision: 'r1', content: 'Takes customer orders.' })))
    // Only the evidence changed: the same text, which cognee would file under r1's metadata.
    await h.apply(upsert(entity('service.orders', { revision: 'r2', content: 'Takes customer orders.' })))
    const items = [...h.fake.datasets.get(DATASET)!.items.values()]
    expect(items.map((item) => item.externalMetadata?.docket_revision)).toEqual(['r2'])
    expect((await h.ask('customer orders')).diagnostics).toEqual([])
  })

  it('re-files an entity whose linked entity is retitled, though its own revision did not change', async () => {
    const h = await harness()
    const orders = entity('service.orders', { title: 'Orders service', links: [entityLink({ rel: 'owned_by', target: 'team.payments' })] })
    await h.apply(upsert(orders), upsert(entity('team.payments', { revision: 'r1', title: 'Payments team' })))
    expect(h.held()).toContainEqual(['service.orders', expect.stringContaining('owned by: Payments team')])

    const cognified = () => h.fake.requests.filter((request) => request === 'POST /api/v1/cognify').length
    const before = cognified()
    expect(await h.apply(upsert(entity('team.payments', { revision: 'r2', title: 'Billing team' })))).toMatchObject({ applied: ['team.payments'], failed: [] })
    const filed = h.held().filter(([id]) => id === 'service.orders')
    expect(filed).toEqual([['service.orders', expect.stringContaining('owned by: Billing team')]])
    expect(cognified()).toBe(before + 1)
    expect((await h.ask('which service does the billing team own')).evidence.map((item) => item.canonicalRefs[0]?.id)).toContain('service.orders')

    // Removing the target names it by id instead.
    await h.apply(remove(entity('team.payments', { revision: 'r2' })))
    expect(h.held()).toEqual([['service.orders', expect.stringContaining('owned by: team.payments')]])

    // A replay with nothing to re-file adds nothing.
    const adds = () => h.fake.requests.filter((request) => request === 'POST /api/v1/add').length
    const added = adds()
    await h.apply(upsert(orders))
    expect(adds()).toBe(added)
  })

  it('cognifies an entity re-filed for a removed link target when the removal is retried after cognify failed', async () => {
    const h = await harness()
    const payments = entity('team.payments', { title: 'Payments team' })
    await h.apply(upsert(entity('service.orders', { title: 'Orders service', links: [entityLink({ rel: 'owned_by', target: 'team.payments' })] })), upsert(payments))

    h.fake.failNextCognify = true
    const failed = await h.apply(remove(payments))
    expect(failed.failed).toEqual([{ id: 'team.payments', retryable: true, message: expect.stringMatching(/cognify failed/) }])
    expect(h.held()).toEqual([['service.orders', expect.stringContaining('owned by: team.payments')]])
    expect(h.fake.datasets.get(DATASET)!.items.values().next().value?.cognified).toBe(false)

    expect(await h.apply(remove(payments))).toMatchObject({ applied: ['team.payments'], failed: [] })
    expect([...h.fake.datasets.get(DATASET)!.items.values()].map((item) => item.cognified)).toEqual([true])
    expect(entityIds(await h.ask('orders service owned by team payments'))).toEqual(['service.orders'])
  })

  it('keeps two inputs with the same text apart', async () => {
    const h = await harness()
    const a = entity('person.alex-a', { type: 'person', title: 'Alex Kim', content: 'Engineer.' })
    const b = entity('person.alex-b', { type: 'person', title: 'Alex Kim', content: 'Engineer.' })
    expect((await h.apply(upsert(a), upsert(b))).failed).toEqual([])
    expect(h.held().map(([id]) => id)).toEqual(['person.alex-a', 'person.alex-b'])
    const answer = await h.ask('alex kim engineer')
    expect(entityIds(answer).sort()).toEqual(['person.alex-a', 'person.alex-b'])
    expect(answer.evidence.map((item) => item.text)).toEqual([expect.not.stringContaining('(docket'), expect.not.stringContaining('(docket')])
  })

  it('leaves an entity opted out of vector indexing unfiled', async () => {
    const h = await harness()
    const hidden = entity('service.hidden', { content: 'Secret orders.', index: { graph: true, fts: true, vector: false } })
    expect((await h.apply(upsert(hidden))).applied).toEqual(['service.hidden'])
    expect(h.held()).toEqual([])
  })

  it('projects observations and documents when configured to', async () => {
    const h = await harness({ inputs: ['entity', 'observation', 'document'] })
    const observation = sampleObservation()
    const document = sampleDocument()
    expect((await h.apply(upsert(sampleEntity()), upsert(observation), upsert(document))).failed).toEqual([])
    const answer = await h.ask('OrdersRepository opens the pool')
    expect(answer.evidence[0]).toMatchObject({ kind: 'observation', text: observation.text, observedAt: '2026-10-05' })
  })

  it('refuses inputs it was not configured for, and batches of another scope', async () => {
    const h = await harness()
    const receipt = await h.apply(upsert(sampleObservation()))
    expect(receipt.failed).toEqual([{ id: sampleObservation().id, retryable: false, message: 'this adapter does not project observation inputs' }])
    const foreign = await h.adapter.projection!.apply({ batchId: 'x', scope: 'other', checkpoint: 'c', changes: [upsert(entity('a'))] })
    expect(foreign.failed[0]?.message).toMatch(/not this adapter's scope/)
    await expect(h.adapter.query!.ask(sampleAskRequest({ context: { scope: 'other', now: new Date().toISOString(), timezone: 'UTC' } }))).rejects.toThrow(/scope/)
  })

  it('reports every upsert failed when cognify fails, then succeeds on the retry', async () => {
    const h = await harness()
    const orders = entity('service.orders', { content: 'Takes customer orders.' })
    h.fake.failNextCognify = true
    const failed = await h.apply(upsert(orders))
    expect(failed.applied).toEqual([])
    expect(failed.failed).toEqual([{ id: 'service.orders', retryable: true, message: expect.stringMatching(/cognify failed: .*LLM extraction failed/) }])
    expect((await h.adapter.status()).checkpoint).toBeUndefined()

    const retried = await h.apply(upsert(orders))
    expect(retried.applied).toEqual(['service.orders'])
    expect(h.held()).toHaveLength(1)
    expect((await h.adapter.status()).checkpoint).toBe(`checkpoint-${batches}`)
    expect(entityIds(await h.ask('customer orders'))).toEqual(['service.orders'])
  })

  it('resets only what docket filed, never the dataset', async () => {
    const h = await harness()
    await h.apply(upsert(entity('service.orders', { content: 'Takes customer orders.' })))
    h.fake.addForeign(DATASET, 'A note someone else added about orders.')
    await h.adapter.projection!.reset(SAMPLE_SCOPE)
    expect(h.held()).toEqual([[undefined, 'A note someone else added about orders.']])
    await expect(h.adapter.projection!.reset('other')).rejects.toThrow(/scope/)
  })

  it('leaves out chunks of other datasets a search returns, and says so', async () => {
    const fake = startFakeCognee({ accessControl: false })
    const other = await harness({ dataset: 'docket-other' }, fake)
    await other.apply(upsert(entity('service.other-orders', { content: 'Takes customer orders too.' })))
    const h = await harness({}, fake)
    await h.apply(upsert(entity('service.orders', { content: 'Takes customer orders.' })))
    const answer = await h.ask('customer orders')
    expect(entityIds(answer)).toEqual(['service.orders'])
    expect(answer.diagnostics).toEqual([expect.objectContaining({ code: 'cognee-foreign-chunks', severity: 'warning' })])
  })

  it('drops chunks further than maxDistance', async () => {
    const h = await harness({ maxDistance: 0.4 })
    await h.apply(upsert(entity('service.orders', { content: 'Takes customer orders.' })), upsert(entity('service.billing', { content: 'Sends customer invoices.' })))
    // "customer" is all billing shares with the question: a distance of 2/3.
    expect(entityIds(await h.ask('customer orders taken'))).toEqual(['service.orders'])
  })

  it('drops a chunk whose input the canonical files hold at another revision', async () => {
    const h = await harness()
    await h.apply(upsert(entity('service.orders', { revision: 'r1', content: 'Takes customer orders.' })))
    h.records.splice(0, 1, entity('service.orders', { revision: 'r2', content: 'Takes customer orders.' }))
    const answer = await h.ask('customer orders')
    expect(entityIds(answer)).toEqual([])
    expect(answer.diagnostics).toEqual([expect.objectContaining({ code: 'stale-native-records' })])
  })

  it('answers nothing, without error, before anything is filed', async () => {
    const h = await harness()
    const answer = await h.ask('anything')
    expect(answer.blocks).toEqual([])
    expect(h.fake.requests).not.toContain('POST /api/v1/search')
  })

  describe('with a completion search', () => {
    it('adds cognee\'s answer as a derived fact citing the entities of the chunks it used', async () => {
      const h = await harness({ completion: 'GRAPH_COMPLETION' })
      await h.apply(upsert(entity('service.orders', { title: 'Orders service', content: 'Owned by the payments team.' })))
      h.fake.completion = 'The orders service is owned by the payments team.'
      const answer = await h.ask('who owns the orders service')
      expect(answer.blocks[0]).toEqual({ kind: 'facts', id: 'answer', title: 'cognee\'s answer', evidenceIds: ['cognee-answer'] })
      expect(answer.evidence.find((item) => item.id === 'cognee-answer')).toEqual({
        id: 'cognee-answer',
        kind: 'derived-fact',
        text: 'The orders service is owned by the payments team.',
        canonicalRefs: [{ kind: 'entity', id: 'service.orders', revision: 'sha256:service.orders', span: { path: '.docket/service.orders.md' } }],
        derivation: { engine: 'cognee' }
      })
      expect(h.adapter.describe().resultKinds).toContain('facts')
    })

    it('keeps the passages when the completion fails', async () => {
      const h = await harness({ completion: 'RAG_COMPLETION' })
      await h.apply(upsert(entity('service.orders', { content: 'Takes customer orders.' })))
      h.fake.completion = null
      const answer = await h.ask('customer orders')
      expect(entityIds(answer)).toEqual(['service.orders'])
      expect(answer.diagnostics).toEqual([expect.objectContaining({ code: 'cognee-completion-failed', message: expect.stringMatching(/LLM unavailable/) })])
    })
  })

  describe('status', () => {
    it('is ready with the dataset\'s size and the engine version', async () => {
      const h = await harness()
      expect(await h.adapter.status()).toMatchObject({ state: 'ready', engineVersion: '1.6.8-local', message: expect.stringMatching(/not created yet/) })
      await h.apply(upsert(entity('service.orders', { content: 'Takes customer orders.' })))
      expect(await h.adapter.status()).toMatchObject({ state: 'ready', message: `dataset "${DATASET}" at ${URL_}: 1 data item`, checkpoint: `checkpoint-${batches}` })
    })

    it('is unavailable when the server is down, or refuses the key', async () => {
      const down = await harness()
      down.fake.down = true
      expect(await down.adapter.status()).toMatchObject({ state: 'unavailable', message: expect.stringMatching(/cognee at http:\/\/cognee.test:8000/) })

      const locked = await harness({}, startFakeCognee({ apiKey: 'k-123' }))
      expect(await locked.adapter.status()).toMatchObject({ state: 'unavailable', message: expect.stringMatching(/401.*apiKeyEnv/) })
    })

    it('sends the key from the variable apiKeyEnv names, and never shows it', async () => {
      const h = await harness({ apiKeyEnv: 'MY_COGNEE_KEY' }, startFakeCognee({ apiKey: 'k-123' }), { MY_COGNEE_KEY: 'k-123' })
      const status = await h.adapter.status()
      expect(status.state).toBe('ready')
      expect(JSON.stringify(status)).not.toContain('k-123')
      expect((await h.apply(upsert(entity('service.orders', { content: 'Takes orders.' })))).failed).toEqual([])
    })

    it('is degraded on a cognee major it was not tested against', async () => {
      const h = await harness({}, startFakeCognee({ version: '2.0.0' }))
      expect(await h.adapter.status()).toMatchObject({ state: 'degraded', message: expect.stringMatching(/2\.0\.0 is not the 1\.6\.8/) })
    })
  })

  it('identifies content by the MD5 cognee uses', () => {
    expect(contentHash('# Payments team\nteam\n\nThe payments team runs checkout, billing and the orders service. Its lead is Maria Lopez.\n')).toBe(
      '6f0c0557d7d1ff50531189d4c6ac55a4'
    )
  })
})

/*
 * The same adapter against a real cognee server, when COGNEE_TEST_URL names
 * one (and COGNEE_TEST_API_KEY its key, if it needs one) - see the README's
 * local recipe. It cognifies with the server's own models, so it takes
 * minutes and never runs by default.
 */
const LIVE_URL = process.env.COGNEE_TEST_URL
describe.skipIf(!LIVE_URL)('cognee adapter against a real cognee server', () => {
  it('projects, answers, revises, removes and resets', { timeout: 15 * 60_000 }, async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'docket-cognee-live-'))
    const records: CanonicalInput[] = []
    const env: Record<string, string> = process.env.COGNEE_TEST_API_KEY ? { COGNEE_TEST_API_KEY: process.env.COGNEE_TEST_API_KEY } : {}
    const services = fakeServices({ stateRoot, records, env })
    const dataset = `docket-live-${Date.now()}`
    const adapter = await cognee.create(cognee.validateConfig({ url: LIVE_URL, apiKeyEnv: 'COGNEE_TEST_API_KEY', dataset, completion: 'GRAPH_COMPLETION' }), services)
    const apply = async (checkpoint: string, ...changes: RecordChange[]) => {
      for (const change of changes) {
        const at = records.findIndex((record) => record.id === (change.operation === 'upsert' ? change.record.id : change.id))
        if (at >= 0) records.splice(at, 1)
        if (change.operation === 'upsert') records.push(change.record)
      }
      return adapter.projection!.apply({ batchId: checkpoint, scope: SAMPLE_SCOPE, checkpoint, changes })
    }
    try {
      expect((await adapter.status()).state).toBe('ready')
      const payments = entity('team.payments', { title: 'Payments team', type: 'team', content: 'Runs checkout and billing. Its lead is Maria Lopez.' })
      const orders = entity('service.orders', {
        title: 'Orders service',
        type: 'service',
        content: 'Takes customer orders and stores them in Postgres.',
        links: [entityLink({ rel: 'owned_by', target: 'team.payments' })]
      })
      const search = entity('service.search', { title: 'Search service', type: 'service', content: 'Indexes the product catalogue for shoppers.' })
      expect((await apply('c1', upsert(payments), upsert(orders), upsert(search))).failed).toEqual([])

      const first = await adapter.query!.ask(sampleAskRequest({ question: 'Which service stores customer orders in Postgres?' }))
      expect(entityIds(first)[0]).toBe('service.orders')
      expect(first.blocks[0]?.kind).toBe('facts')

      const revised = entity('service.orders', { ...orders, revision: 'r2', content: 'Takes customer orders and refunds them. Stores them in Postgres.' })
      expect((await apply('c2', upsert(revised))).failed).toEqual([])
      const second = await adapter.query!.ask(sampleAskRequest({ question: 'Which service refunds customer orders?' }))
      expect(second.evidence.find((item) => item.canonicalRefs[0]?.id === 'service.orders')?.canonicalRefs[0]?.revision).toBe('r2')

      expect((await apply('c3', remove(search))).failed).toEqual([])
      expect(entityIds(await adapter.query!.ask(sampleAskRequest({ question: 'product catalogue for shoppers' })))).not.toContain('service.search')
      expect((await adapter.status()).message).toMatch(/: 2 data items$/)
    } finally {
      await adapter.projection!.reset(SAMPLE_SCOPE)
      await adapter.close()
    }
    expect((await adapter.status()).message).toMatch(/: 0 data items$/)
  })
})
