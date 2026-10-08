import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { entityInput } from '@docket/adapter-kit/testing'
import type { AdapterAnswer, AdapterDefinition, CanonicalInput, CanonicalReader, DocumentInput, ObservationInput } from '@docket/contracts'
import { checkAdapterContract, fakeServices, sampleAskRequest, sampleEntity } from '@docket/contracts/testing'
import { describe, expect, it } from 'vitest'

import { memvidConfigSchema, type MemvidConfig } from './config.js'
import memvid from './index.js'
import { createMemvidAdapter } from './memvid-adapter.js'
import { MemvidStore } from './memvid-store.js'
import { spawnRunner, type CommandResult, type CommandRunner } from './runner.js'

/*
 * One scenario, run two ways: against the real memvid CLI when
 * MEMVID_TEST_COMMAND names it, and always against a session recorded from
 * that CLI (fixtures/memvid-cli-2.0.160*.json). Recording:
 *   MEMVID_TEST_COMMAND=memvid MEMVID_RECORD_FIXTURE=1 pnpm test
 */

const FIXTURE = new URL('../fixtures/memvid-cli-2.0.160.json', import.meta.url)
const CONTRACT_FIXTURE = new URL('../fixtures/memvid-cli-2.0.160-contract.json', import.meta.url)
const COMMAND = process.env.MEMVID_TEST_COMMAND

interface RecordedCall extends CommandResult {
  args: string[]
  input?: string
}

const normalizer = (stateRoot: string) => (text: string) =>
  text.replaceAll(stateRoot, '<state>').replace(/\.memory\.mv2\.\d+\.[0-9a-f]+\.mv2/g, '<creating>')

const recordingRunner = (run: CommandRunner, normalize: (text: string) => string, calls: RecordedCall[]): CommandRunner =>
  async (args, options) => {
    const result = await run(args, options)
    calls.push({
      args: args.map(normalize),
      ...(options.input !== undefined ? { input: options.input } : {}),
      code: result.code,
      stdout: normalize(result.stdout),
      stderr: normalize(result.stderr)
    })
    return result
  }

const replayRunner = (calls: readonly RecordedCall[], normalize: (text: string) => string): CommandRunner => {
  let next = 0
  return async (args, options) => {
    const call = calls[next]
    next += 1
    const actual = args.map(normalize)
    if (call === undefined) throw new Error(`unrecorded memvid call: ${actual.join(' ')}`)
    expect(actual).toEqual(call.args)
    expect(options.input).toEqual(call.input)
    // The one effect on disk the adapter looks for: the file `create` made.
    if (args[0] === 'create' && call.code === 0) writeFileSync(args[1]!, '')
    return { code: call.code, stdout: call.stdout, stderr: call.stderr }
  }
}

/** A canonical store the scenario changes as it goes, as the files would. */
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

const LONG_TEXT = Array.from({ length: 60 }, (_, index) =>
  index === 40
    ? 'Paragraph 40: we chose Postgres for the ledger because of serializable isolation.'
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
  source: { path: 'docs/ledger.md', startLine: 1, endLine: 60 },
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

const ask = (question: string) => ({ ...sampleAskRequest({ question }), context: { ...sampleAskRequest().context, scope: 'default' } })

const found = (answer: AdapterAnswer) =>
  answer.evidence.map((item) => `${item.canonicalRefs[0]?.kind} ${item.canonicalRefs[0]?.id}@${item.canonicalRefs[0]?.revision}`)

/** Drives one adapter instance - and a second on the same file in another namespace - through the projection lifecycle. */
const scenario = async (run: CommandRunner, stateRoot: string) => {
  const canonical = mutableCanonical()
  const services = { ...fakeServices({ projectRoot: stateRoot, stateRoot, scope: 'default' }), canonical: canonical.reader }
  const config = memvidConfigSchema.parse({ command: 'memvid' })
  const adapter = createMemvidAdapter(config, services, { version: 'test', run })
  const store = new MemvidStore({ file: join(stateRoot, 'memory.mv2'), namespace: 'default', run, timeoutMs: 30_000, lockTimeoutMs: 5_000 })
  const frames = async () => (await store.list()).map((record) => `${record.identity.kind} ${record.identity.id}@${record.identity.revision}`).sort()
  const outcome: Record<string, unknown> = {}

  outcome.statusBefore = await adapter.status()

  for (const record of [orders('r1', 'Takes and fulfils customer orders.'), billing, ledgerDoc, deploy]) canonical.set(record)
  const first = {
    batchId: 'b1',
    scope: 'default',
    checkpoint: 'c1',
    changes: [orders('r1', 'Takes and fulfils customer orders.'), billing, ledgerDoc, deploy].map((record) => ({ operation: 'upsert' as const, record }))
  }
  outcome.firstReceipt = await adapter.projection!.apply(first)
  outcome.framesAfterFirst = await frames()
  outcome.replayReceipt = await adapter.projection!.apply(first)
  outcome.framesAfterReplay = await frames()

  const ordersAnswer = await adapter.query!.ask(ask('Which service takes customer orders?'))
  outcome.ordersQuestion = found(ordersAnswer)
  outcome.ordersPassage = ordersAnswer.evidence[0]?.text
  const ledger = await adapter.query!.ask(ask('Why did we choose Postgres for the ledger?'))
  outcome.ledgerQuestion = found(ledger)
  outcome.ledgerPassage = ledger.evidence.find((item) => item.canonicalRefs[0]?.id === 'doc.ledger')?.text.includes('Paragraph 40: we chose Postgres')
  const deployAnswer = await adapter.query!.ask(ask('When was orders deployed to production?'))
  outcome.deployTimes = deployAnswer.evidence
    .filter((item) => item.kind === 'observation')
    .map((item) => [item.observedAt, item.eventAt])

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
  outcome.framesAfterSecond = await frames()
  outcome.ledgerAfterRemove = found(await adapter.query!.ask(ask('Why did we choose Postgres for the ledger?')))
  outcome.kafkaQuestion = found(await adapter.query!.ask(ask('Which service publishes to Kafka?')))

  const otherServices = { ...fakeServices({ projectRoot: stateRoot, stateRoot: join(stateRoot, 'other'), scope: 'default' }), canonical: canonical.reader }
  const other = createMemvidAdapter({ ...config, file: join(stateRoot, 'memory.mv2'), namespace: 'other' }, otherServices, { version: 'test', run })
  const zebra = entityInput({ id: 'service.zebra', title: 'Zebra', revision: 'z1', scope: 'default', content: 'Zebra crossings for kafka.' })
  canonical.set(zebra)
  await other.projection!.apply({ batchId: 'o1', scope: 'default', checkpoint: 'oc1', changes: [{ operation: 'upsert', record: zebra }] })
  outcome.defaultSeesOther = found(await adapter.query!.ask(ask('zebra')))
  await adapter.projection!.reset('default')
  outcome.framesAfterReset = await frames()
  outcome.otherAfterReset = found(await other.query!.ask(ask('zebra crossings')))
  outcome.statusAfter = await adapter.status()
  return outcome
}

const expectOutcome = (outcome: Record<string, unknown>) => {
  expect(outcome.statusBefore).toMatchObject({ state: 'ready', message: expect.stringContaining('No memory file') })
  expect(outcome.firstReceipt).toEqual({
    batchId: 'b1',
    applied: ['service.orders', 'service.billing', 'doc.ledger', 'obs.deploy-1'],
    failed: []
  })
  const firstFrames = ['document doc.ledger@d1', 'entity service.billing@b1', 'entity service.orders@r1', 'observation obs.deploy-1@o1']
  expect(outcome.framesAfterFirst).toEqual(firstFrames)
  expect(outcome.replayReceipt).toMatchObject({ applied: ['service.orders', 'service.billing', 'doc.ledger', 'obs.deploy-1'] })
  expect(outcome.framesAfterReplay).toEqual(firstFrames)
  expect((outcome.ordersQuestion as string[])[0]).toBe('entity service.orders@r1')
  // The passage, without the title, URI and metadata lines memvid appends to it (and with its blank lines dropped).
  expect(outcome.ordersPassage).toBe('# Orders\nservice service.orders\nTakes and fulfils customer orders.')
  expect(outcome.ledgerQuestion).toContain('document doc.ledger@d1')
  expect(outcome.ledgerPassage).toBe(true)
  // Times come from the canonical observation, not from when memvid stored it.
  expect(outcome.deployTimes).toEqual([['2026-10-01T09:00:00Z', '2026-09-30T17:00:00Z']])
  expect(outcome.secondReceipt).toEqual({ batchId: 'b2', applied: ['service.orders', 'doc.ledger'], failed: [] })
  expect(outcome.framesAfterSecond).toEqual(['entity service.billing@b1', 'entity service.orders@r2', 'observation obs.deploy-1@o1'])
  // The removed document's chunk frames went with it.
  expect(outcome.ledgerAfterRemove).not.toContain('document doc.ledger@d1')
  expect((outcome.kafkaQuestion as string[])[0]).toBe('entity service.orders@r2')
  expect(outcome.defaultSeesOther).toEqual([])
  expect(outcome.framesAfterReset).toEqual([])
  expect(outcome.otherAfterReset).toEqual(['entity service.zebra@z1'])
  expect(outcome.statusAfter).toMatchObject({ state: 'ready', engineVersion: expect.stringMatching(/^memvid-cli 2\./) })
}

/** The shared contract check, with the adapter driving `run`. */
const contractCheck = async (run: CommandRunner, stateRoot: string) => {
  const definition: AdapterDefinition<MemvidConfig> = {
    ...memvid,
    create: async (config, services) => createMemvidAdapter(config, services, { version: 'test', run })
  }
  return checkAdapterContract(definition, {
    config: {},
    invalidConfig: { namespace: 'a/b' },
    services: fakeServices({ projectRoot: stateRoot, stateRoot, records: [sampleEntity()] })
  })
}

const expectContract = (report: Awaited<ReturnType<typeof contractCheck>>) => {
  expect(report.checks.filter((check) => !check.ok)).toEqual([])
  expect(report.checks.map((check) => check.name)).toEqual(
    expect.arrayContaining(['projection.apply replays the same batch', 'projection.reset', 'query.ask returns a valid answer'])
  )
}

describe('memvid adapter against a recorded memvid-cli 2.0.160 session', () => {
  it('holds the adapter contract', async () => {
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'docket-memvid-contract-')))
    const calls = JSON.parse(readFileSync(CONTRACT_FIXTURE, 'utf8')) as RecordedCall[]
    expectContract(await contractCheck(replayRunner(calls, normalizer(stateRoot)), stateRoot))
  })

  it('replays, updates, deletes chunked frames, keeps namespaces apart and resets only its own', async () => {
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'docket-memvid-replay-')))
    const calls = JSON.parse(readFileSync(FIXTURE, 'utf8')) as RecordedCall[]
    expectOutcome(await scenario(replayRunner(calls, normalizer(stateRoot)), stateRoot))
  })
})

describe.skipIf(!COMMAND)('memvid adapter against the real memvid CLI', () => {
  it('holds the adapter contract', { timeout: 120_000 }, async () => {
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'docket-memvid-contract-')))
    const calls: RecordedCall[] = []
    const run = recordingRunner(spawnRunner(COMMAND!, stateRoot), normalizer(stateRoot), calls)
    expectContract(await contractCheck(run, stateRoot))
    if (process.env.MEMVID_RECORD_FIXTURE === '1') writeFileSync(CONTRACT_FIXTURE, `${JSON.stringify(calls, null, 2)}\n`)
  })

  it('runs the same scenario end to end', { timeout: 120_000 }, async () => {
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'docket-memvid-cli-')))
    const calls: RecordedCall[] = []
    const run = recordingRunner(spawnRunner(COMMAND!, stateRoot), normalizer(stateRoot), calls)
    expectOutcome(await scenario(run, stateRoot))
    if (process.env.MEMVID_RECORD_FIXTURE === '1') writeFileSync(FIXTURE, `${JSON.stringify(calls, null, 2)}\n`)
  })
})
