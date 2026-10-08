import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  ApplyReceipt,
  CanonicalInput,
  InputKind,
  MemoryAdapter,
  ProjectionBatch,
  RecordChange
} from '@docket/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { entitiesOf, makeDocument } from '../../test/entities.js'
import type { AdapterSlot } from '../adapters/docket.js'
import { init } from '../commands/init.js'
import { stateRootOf, type ResolvedConfig } from '../config/config.js'
import { loadConfig } from '../config/loader.js'
import { adapterManifestPath, emptyRecords, readAdapterManifest } from '../manifest/adapter-manifest.js'
import { manifestPath, writeManifest } from '../manifest/manifest.js'
import type { MemoryDocument } from '../model/index.js'
import { canonicalState, type CanonicalState } from '../sync/inputs.js'
import { BATCH_SIZE, ProjectionManager, selectSlots } from './manager.js'

/** What a fake engine holds: one record per (kind, id), however often a change is replayed. */
interface Store {
  records: Map<string, CanonicalInput>
  batches: ProjectionBatch[]
  resets: string[]
  flushes: number
  closed: boolean
}

const newStore = (): Store => ({ records: new Map(), batches: [], resets: [], flushes: 0, closed: false })

const key = (kind: InputKind, id: string): string => `${kind}:${id}`

const changeId = (change: RecordChange): string => (change.operation === 'upsert' ? change.record.id : change.id)

/** Applies every change idempotently, keyed by identity, unless `apply` is overridden. */
const fakeAdapter = (
  inputs: InputKind[],
  store: Store,
  overrides: {
    apply?: (batch: ProjectionBatch) => Promise<ApplyReceipt>
    flush?: () => Promise<void>
    reset?: (scope: string) => Promise<void>
  } = {}
): MemoryAdapter => ({
  describe: () => ({ name: 'fake', version: '1.0.0', inputs, resultKinds: [], rebuild: 'deterministic' }),
  status: async () => ({ state: 'ready', message: 'fake' }),
  projection: {
    apply:
      overrides.apply ??
      (async (batch) => {
        store.batches.push(batch)
        for (const change of batch.changes) {
          if (change.operation === 'upsert') store.records.set(key(change.record.kind, change.record.id), change.record)
          else store.records.delete(key(change.kind, change.id))
        }
        return { batchId: batch.batchId, applied: batch.changes.map(changeId), failed: [] }
      }),
    flush:
      overrides.flush ??
      (async () => {
        store.flushes += 1
      }),
    reset:
      overrides.reset ??
      (async (scope) => {
        store.resets.push(scope)
        store.records.clear()
      })
  },
  close: async () => {
    store.closed = true
  }
})

const slotOf = (
  id: string,
  create: () => Promise<MemoryAdapter>,
  overrides: Partial<AdapterSlot> = {}
): AdapterSlot => ({
  id,
  name: 'fake',
  source: 'registration',
  roles: ['projection', 'query'],
  fingerprint: `fingerprint-${id}`,
  scope: 'default',
  create,
  ...overrides
})

const ORDERS = makeDocument({
  id: 'service.orders',
  title: 'Orders',
  path: '.docket/orders.md',
  hash: 'sha256:orders-1',
  content: '\nTakes orders.\n',
  bodyLine: 5,
  evidence: [{ source: 'code', path: 'src/orders.ts', lines: '3-9' }]
})
const BILLING = makeDocument({ id: 'service.billing', title: 'Billing', path: '.docket/billing.md' })

const stateOf = (...documents: MemoryDocument[]): CanonicalState =>
  canonicalState(entitiesOf(documents), documents, 'default')

let resolved: ResolvedConfig

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-manager-'))
  await init({ cwd: root })
  resolved = await loadConfig(root)
})

const open = (slots: AdapterSlot[], fresh?: ReadonlySet<string>): Promise<ProjectionManager> =>
  ProjectionManager.open(slots, {
    resolved,
    legacyFingerprint: 'legacy-fingerprint',
    configured: slots.map((slot) => slot.id),
    fresh
  })

/** One pass, as `docket sync` runs it. */
const pass = async (slots: AdapterSlot[], state: CanonicalState, fresh?: ReadonlySet<string>) => {
  const manager = await open(slots, fresh)
  await manager.apply(state, new Set())
  await manager.commit()
  await manager.close()
  return manager.reports()
}

const kinds = (store: Store): string[] => [...store.records.keys()].map((entry) => entry.split(':')[0]!).sort()

describe('ProjectionManager', () => {
  it('delivers each instance only the input kinds it declares', async () => {
    const entities = newStore()
    const recall = newStore()
    await pass(
      [
        slotOf('graph', async () => fakeAdapter(['entity'], entities)),
        slotOf('recall', async () => fakeAdapter(['observation', 'document'], recall))
      ],
      stateOf(ORDERS)
    )

    expect(kinds(entities)).toEqual(['entity'])
    expect(kinds(recall)).toEqual(['document', 'observation'])
    for (const batch of [...entities.batches, ...recall.batches]) {
      expect(batch.scope).toBe('default')
    }
  })

  it('keeps one manifest per instance, recording only what each acknowledged', async () => {
    const store = newStore()
    const [report] = await pass([slotOf('graph', async () => fakeAdapter(['entity', 'document'], store))], stateOf(ORDERS, BILLING))

    const manifest = await readAdapterManifest(stateRootOf(resolved), 'graph')
    expect(manifest).toMatchObject({
      adapter: 'graph',
      fingerprint: 'fingerprint-graph',
      scope: 'default',
      definition: { name: 'fake', version: '1.0.0' },
      inputs: ['entity', 'document'],
      owners: { 'service.orders': ['.docket/orders.md'], 'service.billing': ['.docket/billing.md'] },
      records: {
        entity: { 'service.orders': { revision: expect.any(String) }, 'service.billing': { revision: expect.any(String) } },
        document: { '.docket/orders.md': { revision: 'sha256:orders-1', owner: 'service.orders' } },
        observation: {}
      }
    })
    expect(report?.checkpoint).toBe(manifest?.checkpoint)
    // The last batch carries the checkpoint the instance is left at.
    expect(store.batches.at(-1)?.checkpoint).toBe(manifest?.checkpoint)
  })

  it('hands an instance nothing when its manifest says it holds every revision', async () => {
    const store = newStore()
    const slots = [slotOf('graph', async () => fakeAdapter(['entity', 'observation', 'document'], store))]
    await pass(slots, stateOf(ORDERS))
    const before = await readFile(adapterManifestPath(stateRootOf(resolved), 'graph'), 'utf8')
    store.batches.length = 0

    const [report] = await pass(slots, stateOf(ORDERS))
    expect(store.batches).toEqual([])
    expect(report).toMatchObject({ origin: 'current', reset: false, upserted: [], removed: [], unchanged: 3 })
    expect(await readFile(adapterManifestPath(stateRootOf(resolved), 'graph'), 'utf8')).toBe(before)
  })

  it('upserts a changed revision and removes every record of a deleted entity, with the revision it held', async () => {
    const store = newStore()
    const slots = [slotOf('graph', async () => fakeAdapter(['entity', 'observation', 'document'], store))]
    await pass(slots, stateOf(ORDERS, BILLING))
    const held = [...store.records.values()].filter((record) => record.id.startsWith('service.orders') || record.id === '.docket/orders.md')

    const [report] = await pass(slots, stateOf({ ...BILLING, title: 'Billing and invoicing' }))

    expect(report?.upserted).toEqual([{ kind: 'entity', id: 'service.billing' }])
    expect(report?.removed.map((ref) => ref.kind)).toEqual(['document', 'observation', 'entity'])
    const removals = store.batches.at(-1)?.changes.filter((change) => change.operation === 'remove') ?? []
    expect(removals).toEqual(
      held
        .map((record) => ({ operation: 'remove', kind: record.kind, id: record.id, revision: record.revision }))
        .sort((a, b) => ['document', 'observation', 'entity'].indexOf(a.kind) - ['document', 'observation', 'entity'].indexOf(b.kind))
    )
    expect(kinds(store)).toEqual(['entity'])
  })

  it('replays what was applied but never recorded without duplicating it', async () => {
    const store = newStore()
    let flushFails = true
    const adapter = fakeAdapter(['entity', 'observation', 'document'], store, {
      flush: async () => {
        if (flushFails) throw new Error('disk full')
      }
    })
    const slots = [slotOf('graph', async () => adapter)]

    const [failed] = await pass(slots, stateOf(ORDERS))
    expect(failed?.error).toBe('could not record what it holds: disk full')
    expect((await readAdapterManifest(stateRootOf(resolved), 'graph'))?.records).toEqual(emptyRecords())
    expect((await readAdapterManifest(stateRootOf(resolved), 'graph'))?.fingerprint).not.toBe('fingerprint-graph')

    flushFails = false
    const [replayed] = await pass(slots, stateOf(ORDERS))
    expect(replayed?.error).toBeUndefined()
    expect(store.batches).toHaveLength(2)
    expect(store.batches[1]?.changes).toEqual(store.batches[0]?.changes)
    expect(store.records.size).toBe(3)
  })

  it('advances only what a receipt acknowledges, retrying the rest', async () => {
    const store = newStore()
    let attempt = 0
    const adapter = fakeAdapter(['entity', 'observation', 'document'], store, {
      apply: async (batch) => {
        attempt += 1
        store.batches.push(batch)
        const [first, ...rest] = batch.changes.map(changeId)
        // Busy the first time; the document is refused for good; one change is never mentioned.
        if (attempt === 1) {
          return {
            batchId: batch.batchId,
            applied: rest.filter((id) => id !== '.docket/orders.md').slice(1),
            failed: [
              { id: first!, retryable: true, message: 'busy' },
              { id: '.docket/orders.md', retryable: false, message: 'too large' }
            ]
          }
        }
        return { batchId: batch.batchId, applied: batch.changes.map(changeId), failed: [] }
      }
    })

    const [report] = await pass([slotOf('graph', async () => adapter)], stateOf(ORDERS))

    // The busy and the unmentioned changes were retried once, in a batch of their own.
    expect(store.batches.map((batch) => batch.changes.length)).toEqual([3, 2])
    expect(report?.failed).toEqual([{ kind: 'document', id: '.docket/orders.md', retryable: false, message: 'too large' }])
    const manifest = await readAdapterManifest(stateRootOf(resolved), 'graph')
    expect(Object.keys(manifest?.records.document ?? {})).toEqual([])
    expect(Object.keys(manifest?.records.entity ?? {})).toEqual(['service.orders'])
    expect(Object.keys(manifest?.records.observation ?? {})).toHaveLength(1)
  })

  it('keeps a failing instance from touching another, or its own manifest', async () => {
    const healthy = newStore()
    const broken = newStore()
    let down = false
    const slots = [
      slotOf('healthy', async () => fakeAdapter(['entity'], healthy)),
      slotOf('flaky', async () =>
        fakeAdapter(['entity'], broken, {
          apply: async (batch) => {
            if (down) throw new Error('connection refused')
            broken.batches.push(batch)
            return { batchId: batch.batchId, applied: batch.changes.map(changeId), failed: [] }
          }
        })
      )
    ]

    await pass(slots, stateOf(ORDERS))
    const flaky = await readAdapterManifest(stateRootOf(resolved), 'flaky')

    down = true
    const reports = await pass(slots, stateOf(ORDERS, BILLING))
    expect(reports.map((report) => [report.id, report.error])).toEqual([
      ['healthy', undefined],
      ['flaky', 'connection refused']
    ])
    // Nothing it failed to acknowledge is recorded as held, and its checkpoint stays put.
    const after = await readAdapterManifest(stateRootOf(resolved), 'flaky')
    expect(after?.records).toEqual(flaky?.records)
    expect(after?.checkpoint).toBe(flaky?.checkpoint)
    expect(Object.keys((await readAdapterManifest(stateRootOf(resolved), 'healthy'))?.records.entity ?? {}).sort()).toEqual([
      'service.billing',
      'service.orders'
    ])
  })

  it('isolates an instance that cannot even start', async () => {
    const store = newStore()
    const reports = await pass(
      [
        slotOf('unreachable', async () => {
          throw new Error('ECONNREFUSED')
        }),
        slotOf('local', async () => fakeAdapter(['entity'], store))
      ],
      stateOf(ORDERS)
    )
    expect(reports.map((report) => [report.id, report.error, report.upserted.length])).toEqual([
      ['unreachable', 'ECONNREFUSED', 0],
      ['local', undefined, 1]
    ])
  })

  it('resets only the instance whose configuration changed, in its own scope, and replays everything into it', async () => {
    const graph = newStore()
    const local = newStore()
    const slots = (graphFingerprint: string) => [
      slotOf('graph', async () => fakeAdapter(['entity'], graph), { fingerprint: graphFingerprint, scope: 'payments' }),
      slotOf('local', async () => fakeAdapter(['entity'], local))
    ]
    const first = await pass(slots('endpoint-a'), stateOf(ORDERS))
    expect(first.map((report) => [report.id, report.origin, report.reset])).toEqual([
      ['graph', 'created', true],
      ['local', 'created', true]
    ])

    const reports = await pass(slots('endpoint-b'), stateOf(ORDERS))
    expect(reports.map((report) => [report.id, report.origin, report.reset, report.upserted.length])).toEqual([
      ['graph', 'reconfigured', true, 1],
      ['local', 'current', false, 0]
    ])
    expect(graph.resets).toEqual(['payments', 'payments'])
    expect(local.resets).toEqual(['default'])
  })

  it('resets again after a reset that threw, rather than trusting what it left', async () => {
    const store = newStore()
    let resetFails = false
    const adapter = fakeAdapter(['entity', 'observation', 'document'], store, {
      reset: async (scope) => {
        if (resetFails) throw new Error('unreachable')
        store.resets.push(scope)
        store.records.clear()
      }
    })
    const slots = (fingerprint: string) => [slotOf('graph', async () => adapter, { fingerprint })]
    await pass(slots('endpoint-a'), stateOf(ORDERS, BILLING))

    resetFails = true
    const [failed] = await pass(slots('endpoint-b'), stateOf(ORDERS))
    expect([failed?.origin, failed?.error]).toEqual(['reconfigured', 'unreachable'])

    resetFails = false
    const [retried] = await pass(slots('endpoint-b'), stateOf(ORDERS))
    expect([retried?.origin, retried?.reset, retried?.upserted.length]).toEqual(['interrupted', true, 3])
    expect(store.resets).toEqual(['default', 'default'])
    expect([...store.records.keys()].some((record) => record.includes('service.billing'))).toBe(false)

    const [settled] = await pass(slots('endpoint-b'), stateOf(ORDERS))
    expect([settled?.origin, settled?.reset, settled?.upserted.length]).toEqual(['current', false, 0])
  })

  it('resets and replays everything after a rebuild whose flush failed', async () => {
    const store = newStore()
    let flushFails = false
    const adapter = fakeAdapter(['entity', 'observation', 'document'], store, {
      flush: async () => {
        if (flushFails) throw new Error('disk full')
      }
    })
    const slots = [slotOf('graph', async () => adapter)]
    await pass(slots, stateOf(ORDERS))

    flushFails = true
    const [failed] = await pass(slots, stateOf(ORDERS), new Set(['graph']))
    expect(failed?.error).toBe('could not record what it holds: disk full')
    store.records.clear()

    flushFails = false
    const [synced] = await pass(slots, stateOf(ORDERS))
    expect([synced?.origin, synced?.reset, synced?.upserted.length, synced?.unchanged]).toEqual(['interrupted', true, 3, 0])
    expect(store.records.size).toBe(3)
  })

  it('resets again after a rebuild interrupted before it recorded anything', async () => {
    const store = newStore()
    const slots = [slotOf('graph', async () => fakeAdapter(['entity', 'observation', 'document'], store))]
    await pass(slots, stateOf(ORDERS))

    const interrupted = await open(slots, new Set(['graph']))
    await interrupted.apply(stateOf(ORDERS), new Set())
    store.records.clear()

    const [synced] = await pass(slots, stateOf(ORDERS))
    expect([synced?.origin, synced?.reset, synced?.upserted.length]).toEqual(['interrupted', true, 3])
    expect(store.resets).toEqual(['default', 'default', 'default'])
    expect(store.records.size).toBe(3)
  })

  it('rebuilds only the instances asked for', async () => {
    const graph = newStore()
    const local = newStore()
    const slots = [
      slotOf('graph', async () => fakeAdapter(['entity'], graph)),
      slotOf('local', async () => fakeAdapter(['entity'], local))
    ]
    await pass(slots, stateOf(ORDERS))

    const reports = await pass(slots, stateOf(ORDERS), new Set(['local']))
    expect(reports.map((report) => [report.id, report.origin, report.upserted.length])).toEqual([
      ['graph', 'current', 0],
      ['local', 'rebuilt', 1]
    ])
    expect(graph.resets).toHaveLength(1)
    expect(local.resets).toHaveLength(2)
  })

  it('splits large passes into batches, each carrying the checkpoint it leaves the instance at', async () => {
    const store = newStore()
    const documents = Array.from({ length: BATCH_SIZE + 5 }, (_, index) =>
      makeDocument({ id: `service.s${String(index).padStart(3, '0')}`, path: `.docket/s${index}.md` })
    )
    const [report] = await pass([slotOf('graph', async () => fakeAdapter(['entity'], store))], stateOf(...documents))

    expect(store.batches.map((batch) => batch.changes.length)).toEqual([BATCH_SIZE, 5])
    const [first, last] = store.batches
    expect(first?.checkpoint).not.toBe(last?.checkpoint)
    expect(last?.checkpoint).toBe(report?.checkpoint)
  })

  it('carries the legacy shared manifest over, reprojecting no entity it vouches for', async () => {
    const state = stateOf(ORDERS)
    const [orders] = entitiesOf([ORDERS])
    const stateRoot = stateRootOf(resolved)
    await writeManifest(stateRoot, {
      version: 1,
      projections: 'legacy-fingerprint',
      documents: { 'service.orders': { path: '.docket/orders.md', hash: orders!.hash } }
    })
    const graph = newStore()
    const recall = newStore()
    const slots = [
      slotOf('graph', async () => fakeAdapter(['entity'], graph)),
      slotOf('recall', async () => fakeAdapter(['entity', 'observation', 'document'], recall))
    ]

    const reports = await pass(slots, state)

    expect(reports.map((report) => [report.id, report.origin, report.reset])).toEqual([
      ['graph', 'migrated', false],
      ['recall', 'migrated', false]
    ])
    expect(graph.batches).toEqual([])
    // Only the kinds it was never handed before are new to it.
    expect(recall.batches.flatMap((batch) => batch.changes.map((change) => (change.operation === 'upsert' ? change.record.kind : '')))).toEqual([
      'observation',
      'document'
    ])
    await expect(readFile(manifestPath(stateRoot), 'utf8')).rejects.toThrow(/ENOENT/)
  })

  it('leaves the legacy manifest for instances that have not migrated yet', async () => {
    const stateRoot = stateRootOf(resolved)
    await writeManifest(stateRoot, { version: 1, projections: 'legacy-fingerprint', documents: {} })
    const manager = await ProjectionManager.open([slotOf('graph', async () => fakeAdapter(['entity'], newStore()))], {
      resolved,
      legacyFingerprint: 'legacy-fingerprint',
      configured: ['graph', 'mem0']
    })
    await manager.apply(stateOf(ORDERS), new Set())
    await manager.commit()
    await manager.close()
    expect(await readFile(manifestPath(stateRoot), 'utf8')).toContain('legacy-fingerprint')
  })

  it('carries a renamed instance\'s manifest over to its new id', async () => {
    const store = newStore()
    await pass([slotOf('jsonl', async () => fakeAdapter(['entity'], store), { fingerprint: 'same-target' })], stateOf(ORDERS))
    store.batches.length = 0

    const [report] = await pass([slotOf('local', async () => fakeAdapter(['entity'], store), { fingerprint: 'same-target' })], stateOf(ORDERS))
    expect(report).toMatchObject({ origin: 'adopted', reset: false, upserted: [] })
    expect(store.batches).toEqual([])
    expect(await readAdapterManifest(stateRootOf(resolved), 'jsonl')).toBeUndefined()
    expect(await readAdapterManifest(stateRootOf(resolved), 'local')).toMatchObject({ adapter: 'local' })
  })

  it('treats an unreadable manifest as none', async () => {
    const store = newStore()
    const slots = [slotOf('graph', async () => fakeAdapter(['entity'], store))]
    await pass(slots, stateOf(ORDERS))
    await writeFile(adapterManifestPath(stateRootOf(resolved), 'graph'), '{ broken', 'utf8')

    const [report] = await pass(slots, stateOf(ORDERS))
    expect(report).toMatchObject({ origin: 'created', reset: true, upserted: [{ kind: 'entity', id: 'service.orders' }] })
  })

  it('skips slots not enabled for projection', async () => {
    const create = vi.fn(async () => fakeAdapter(['entity'], newStore()))
    const manager = await open([slotOf('query-only', create, { roles: ['query'] })])
    expect(manager.reports()).toEqual([])
    expect(create).not.toHaveBeenCalled()
  })
})

describe('selectSlots', () => {
  const slots = [
    slotOf('local', async () => fakeAdapter(['entity'], newStore())),
    slotOf('ask', async () => fakeAdapter(['entity'], newStore()), { roles: ['query'] })
  ]

  it('names the instances it was asked for, and refuses any it cannot sync', () => {
    expect(selectSlots(slots, ['local']).map((slot) => slot.id)).toEqual(['local'])
    expect(() => selectSlots(slots, ['graph'])).toThrow('No adapter instance "graph" is configured. Configured instances: local, ask.')
    expect(() => selectSlots(slots, ['ask'])).toThrow('Adapter "ask" is not enabled for projection; its roles are query.')
  })
})
