import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { entityInput } from '@docket/adapter-kit/testing'
import type { AdapterAnswer, AdapterDefinition, CanonicalInput, CanonicalReader, DocumentInput, ObservationInput } from '@docket/contracts'
import { checkAdapterContract, fakeServices, sampleAskRequest, sampleEntity } from '@docket/contracts/testing'
import { describe, expect, it } from 'vitest'

import { mempalaceConfigSchema, type MempalaceConfig } from './config.js'
import mempalace from './index.js'
import { McpError, McpStdioClient, type CallOptions, type ToolClient } from './mcp-client.js'
import { createMempalaceAdapter, serverEnvironment } from './mempalace-adapter.js'
import { minilmDirectory, PalaceStore } from './palace-store.js'

/*
 * One scenario, run two ways: against a real MemPalace 3.10.0 MCP server when
 * MEMPALACE_TEST_PYTHON names a Python it is installed in, and always against
 * a session recorded from it (fixtures/mempalace-3.10.0*.json). Recording:
 *   MEMPALACE_TEST_PYTHON=/path/to/venv/bin/python MEMPALACE_RECORD_FIXTURE=1 pnpm test
 * The real run needs MemPalace's embedding model already downloaded.
 */

const FIXTURE = new URL('../fixtures/mempalace-3.10.0.json', import.meta.url)
const CONTRACT_FIXTURE = new URL('../fixtures/mempalace-3.10.0-contract.json', import.meta.url)
const PYTHON = process.env.MEMPALACE_TEST_PYTHON

interface RecordedCall {
  tool: string
  args: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string }
}

type Client = ToolClient & { serverInfo?: { version?: string } }

/** Records each call, with the temporary state directory written as `<state>`. */
const recordingClient = (client: McpStdioClient, calls: RecordedCall[], stateRoot: string): Client => ({
  serverInfo: client.serverInfo,
  async call(tool, args, options) {
    try {
      const result = await client.call(tool, args, options)
      calls.push({ tool, args, result: JSON.parse(JSON.stringify(result).replaceAll(stateRoot, '<state>')) as unknown })
      return result
    } catch (error) {
      if (error instanceof McpError) calls.push({ tool, args, error: { code: error.code, message: error.message } })
      throw error
    }
  },
  close: () => client.close()
})

const replayClient = (calls: readonly RecordedCall[]): Client => {
  let next = 0
  return {
    serverInfo: { version: '3.10.0' },
    async call(tool: string, args: Record<string, unknown>, _options?: CallOptions) {
      const call = calls[next]
      next += 1
      if (call === undefined) throw new Error(`unrecorded MemPalace call: ${tool} ${JSON.stringify(args)}`)
      expect({ tool, args }).toEqual({ tool: call.tool, args: call.args })
      if (call.error) throw new McpError(call.error.message, call.error.code)
      return call.result
    },
    close: async () => {}
  }
}

/** A home whose chromadb cache holds the model files, so the presence check passes without the model. */
const homeWithModel = async (): Promise<string> => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'docket-mempalace-home-')))
  const directory = minilmDirectory(home)
  mkdirSync(directory, { recursive: true })
  for (const file of ['config.json', 'model.onnx', 'special_tokens_map.json', 'tokenizer_config.json', 'tokenizer.json', 'vocab.txt']) {
    writeFileSync(join(directory, file), '')
  }
  return home
}

const startReal = async (stateRoot: string, calls: RecordedCall[]): Promise<Client> => {
  const config = mempalaceConfigSchema.parse({})
  return recordingClient(
    await McpStdioClient.start({
      command: PYTHON!,
      args: ['-m', 'mempalace.mcp_server', '--palace', join(stateRoot, 'palace')],
      env: serverEnvironment(config, join(stateRoot, 'mempalace')),
      cwd: stateRoot,
      startupTimeoutMs: 120_000,
      timeoutMs: 120_000
    }),
    calls,
    stateRoot
  )
}

const mutableCanonical = () => {
  const records = new Map<string, CanonicalInput>()
  const reader: CanonicalReader = {
    get: async (kind, id) => records.get(`${kind}/${id}`),
    list: async (kind) => [...records.values()].filter((record) => record.kind === kind)
  }
  return {
    reader,
    set: (record: CanonicalInput) => records.set(`${record.kind}/${record.id}`, record),
    delete: (kind: string, id: string) => records.delete(`${kind}/${id}`)
  }
}

const LONG_TEXT = Array.from({ length: 30 }, (_, index) =>
  index === 20
    ? 'Paragraph 20: we chose Postgres for the ledger because of serializable isolation.'
    : `Paragraph ${index}: the orders service talks to billing about invoice number ${index}.`
).join('\n')

const orders = (revision: string, content: string) =>
  entityInput({ id: 'service.orders', title: 'Orders', revision, scope: 'default', path: '.docket/resources/services/orders.md', content })
const billing = entityInput({ id: 'service.billing', title: 'Billing', revision: 'b1', scope: 'default', content: 'Issues invoices for every order.' })
const ledgerDoc: DocumentInput = {
  kind: 'document',
  id: 'doc.ledger',
  revision: 'd1',
  scope: 'default',
  text: LONG_TEXT,
  source: { path: 'docs/ledger.md', startLine: 1, endLine: 30 },
  entityRefs: ['service.orders']
}
const deploy: ObservationInput = {
  kind: 'observation',
  id: 'obs.deploy-1',
  revision: 'o1',
  scope: 'default',
  text: 'Deployed orders 1.4 to production.',
  sources: [{ path: 'logs/deploys.md', startLine: 3 }],
  entityRefs: ['service.orders'],
  observedAt: '2026-10-01T09:00:00Z',
  eventAt: '2026-09-30T17:00:00Z'
}

const ask = (question: string, maxResults = 5) => {
  const request = sampleAskRequest({ question })
  return { ...request, context: { ...request.context, scope: 'default' }, budget: { ...request.budget, maxResults } }
}

const found = (answer: AdapterAnswer) =>
  answer.evidence.map((item) => `${item.canonicalRefs[0]?.kind} ${item.canonicalRefs[0]?.id}@${item.canonicalRefs[0]?.revision}`)

const scenario = async (palaceClient: Client, stateRoot: string, home: string) => {
  const canonical = mutableCanonical()
  const services = { ...fakeServices({ projectRoot: stateRoot, stateRoot, scope: 'default' }), canonical: canonical.reader }
  const config: MempalaceConfig = mempalaceConfigSchema.parse({ wing: 'docket-test' })
  const connect = async () => palaceClient
  const adapter = createMempalaceAdapter(config, services, { version: 'test', connect, home })
  const store = new PalaceStore(connect, 'docket-test')
  const drawers = async () => (await store.list()).map((record) => `${record.identity.kind} ${record.identity.id}@${record.identity.revision}`).sort()
  const outcome: Record<string, unknown> = {}

  outcome.statusBefore = await adapter.status()
  const firstRecords = [orders('r1', 'Takes and fulfils customer orders.'), billing, ledgerDoc, deploy]
  for (const record of firstRecords) canonical.set(record)
  const first = { batchId: 'b1', scope: 'default', checkpoint: 'c1', changes: firstRecords.map((record) => ({ operation: 'upsert' as const, record })) }
  outcome.firstReceipt = await adapter.projection!.apply(first)
  outcome.drawersAfterFirst = await drawers()
  outcome.replayReceipt = await adapter.projection!.apply(first)
  outcome.drawersAfterReplay = await drawers()

  outcome.ordersQuestion = found(await adapter.query!.ask(ask('Which service takes customer orders?', 1)))
  const ledger = await adapter.query!.ask(ask('Why did we choose Postgres for the ledger?', 3))
  outcome.ledgerQuestion = found(ledger)
  outcome.ledgerPassage = ledger.evidence.some((item) => item.text.includes('Paragraph 20: we chose Postgres'))
  outcome.headerShown = ledger.evidence.some((item) => item.text.startsWith('docket '))
  const deployAnswer = await adapter.query!.ask(ask('When was orders deployed to production?', 5))
  outcome.deployTimes = deployAnswer.evidence.filter((item) => item.kind === 'observation').map((item) => [item.observedAt, item.eventAt])

  canonical.set(orders('r2', 'Takes customer orders and publishes them to Kafka.'))
  canonical.delete('document', 'doc.ledger')
  outcome.secondReceipt = await adapter.projection!.apply({
    batchId: 'b2',
    scope: 'default',
    checkpoint: 'c2',
    changes: [
      { operation: 'upsert', record: orders('r2', 'Takes customer orders and publishes them to Kafka.') },
      { operation: 'remove', kind: 'document', id: 'doc.ledger', revision: 'd1' }
    ]
  })
  outcome.drawersAfterSecond = await drawers()
  outcome.ledgerAfterRemove = found(await adapter.query!.ask(ask('Why did we choose Postgres for the ledger?', 5)))
  outcome.kafkaQuestion = found(await adapter.query!.ask(ask('Which service publishes orders to Kafka?', 1)))

  // A second instance filing into another wing of the same palace, through the same server: one writer per palace.
  const otherServices = { ...fakeServices({ projectRoot: stateRoot, stateRoot: join(stateRoot, 'other'), scope: 'default' }), canonical: canonical.reader }
  const other = createMempalaceAdapter(mempalaceConfigSchema.parse({ wing: 'docket-other' }), otherServices, { version: 'test', connect, home })
  const zebra = entityInput({ id: 'service.zebra', title: 'Zebra', revision: 'z1', scope: 'default', content: 'Zebra crossings for kafka.' })
  canonical.set(zebra)
  await other.projection!.apply({ batchId: 'o1', scope: 'default', checkpoint: 'oc1', changes: [{ operation: 'upsert', record: zebra }] })
  outcome.defaultSeesOther = found(await adapter.query!.ask(ask('zebra crossings', 5)))
  await adapter.projection!.reset('default')
  outcome.drawersAfterReset = await drawers()
  outcome.otherAfterReset = found(await other.query!.ask(ask('zebra crossings', 5)))
  outcome.statusAfter = await adapter.status()
  return outcome
}

const expectOutcome = (outcome: Record<string, unknown>) => {
  expect(outcome.statusBefore).toMatchObject({ state: 'ready', message: expect.stringContaining('wing "docket-test": 0 drawers') })
  expect(outcome.firstReceipt).toEqual({ batchId: 'b1', applied: ['service.orders', 'service.billing', 'doc.ledger', 'obs.deploy-1'], failed: [] })
  const firstDrawers = ['document doc.ledger@d1', 'entity service.billing@b1', 'entity service.orders@r1', 'observation obs.deploy-1@o1']
  expect(outcome.drawersAfterFirst).toEqual(firstDrawers)
  expect(outcome.replayReceipt).toMatchObject({ applied: ['service.orders', 'service.billing', 'doc.ledger', 'obs.deploy-1'] })
  expect(outcome.drawersAfterReplay).toEqual(firstDrawers)
  expect(outcome.ordersQuestion).toEqual(['entity service.orders@r1'])
  expect(outcome.ledgerQuestion).toContain('document doc.ledger@d1')
  expect(outcome.ledgerPassage).toBe(true)
  expect(outcome.headerShown).toBe(false)
  expect(outcome.deployTimes).toEqual([['2026-10-01T09:00:00Z', '2026-09-30T17:00:00Z']])
  expect(outcome.secondReceipt).toEqual({ batchId: 'b2', applied: ['service.orders', 'doc.ledger'], failed: [] })
  expect(outcome.drawersAfterSecond).toEqual(['entity service.billing@b1', 'entity service.orders@r2', 'observation obs.deploy-1@o1'])
  expect(outcome.ledgerAfterRemove).not.toContain('document doc.ledger@d1')
  expect(outcome.kafkaQuestion).toEqual(['entity service.orders@r2'])
  expect(outcome.defaultSeesOther).not.toContain('entity service.zebra@z1')
  expect(outcome.drawersAfterReset).toEqual([])
  expect(outcome.otherAfterReset).toEqual(['entity service.zebra@z1'])
  expect(outcome.statusAfter).toMatchObject({ state: 'ready', engineVersion: '3.10.0', message: expect.stringContaining('0 drawers') })
}

const contractCheck = async (palaceClient: Client, stateRoot: string, home: string) => {
  const definition: AdapterDefinition<MempalaceConfig> = {
    ...mempalace,
    create: async (config, services) => createMempalaceAdapter(config, services, { version: 'test', connect: async () => palaceClient, home })
  }
  return checkAdapterContract(definition, {
    config: { wing: 'docket-contract' },
    invalidConfig: { wing: '../escape' },
    services: fakeServices({ projectRoot: stateRoot, stateRoot, records: [sampleEntity()] })
  })
}

const expectContract = (report: Awaited<ReturnType<typeof contractCheck>>) => {
  expect(report.checks.filter((check) => !check.ok)).toEqual([])
  expect(report.checks.map((check) => check.name)).toEqual(
    expect.arrayContaining(['projection.apply replays the same batch', 'projection.reset', 'query.ask returns a valid answer'])
  )
}

describe('MemPalace adapter against a recorded MemPalace 3.10.0 session', () => {
  it('holds the adapter contract', async () => {
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'docket-mempalace-contract-')))
    const calls = JSON.parse(readFileSync(CONTRACT_FIXTURE, 'utf8')) as RecordedCall[]
    expectContract(await contractCheck(replayClient(calls), stateRoot, await homeWithModel()))
  })

  it('replays, updates, deletes chunked drawers, keeps wings apart and resets only its own', async () => {
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'docket-mempalace-replay-')))
    const calls = JSON.parse(readFileSync(FIXTURE, 'utf8')) as RecordedCall[]
    expectOutcome(await scenario(replayClient(calls), stateRoot, await homeWithModel()))
  })
})

describe.skipIf(!PYTHON)('MemPalace adapter against a real MemPalace MCP server', () => {
  it('holds the adapter contract', { timeout: 300_000 }, async () => {
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'docket-mempalace-contract-')))
    const calls: RecordedCall[] = []
    const client = await startReal(stateRoot, calls)
    try {
      expectContract(await contractCheck(client, stateRoot, (await import('node:os')).homedir()))
    } finally {
      await client.close()
    }
    if (process.env.MEMPALACE_RECORD_FIXTURE === '1') writeFileSync(CONTRACT_FIXTURE, `${JSON.stringify(calls, null, 2)}\n`)
  })

  it('runs the same scenario end to end', { timeout: 300_000 }, async () => {
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'docket-mempalace-real-')))
    const calls: RecordedCall[] = []
    const client = await startReal(stateRoot, calls)
    try {
      expectOutcome(await scenario(client, stateRoot, (await import('node:os')).homedir()))
    } finally {
      await client.close()
    }
    if (process.env.MEMPALACE_RECORD_FIXTURE === '1') writeFileSync(FIXTURE, `${JSON.stringify(calls, null, 2)}\n`)
  })
})
