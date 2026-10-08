import { describe, expect, it } from 'vitest'

import { assertAdapterContract, checkAdapterContract, fakeServices } from './testing.js'
import type { AdapterDefinition, CanonicalInput, MemoryAdapter } from './types.js'

interface FakeConfig {
  label: string
}

/** A small in-memory adapter that honours the whole contract. */
const fakeDefinition = (tamper: (adapter: MemoryAdapter) => MemoryAdapter = (adapter) => adapter): AdapterDefinition<FakeConfig> => ({
  apiVersion: 1,
  name: 'fake-memory',
  validateConfig(input) {
    if (typeof input !== 'object' || input === null || typeof (input as FakeConfig).label !== 'string') {
      throw new Error('label is required')
    }
    return input as FakeConfig
  },
  async create(_config, services) {
    const records = new Map<string, CanonicalInput>()
    return tamper({
      describe: () => ({ name: 'fake-memory', version: '1.0.0', inputs: ['entity'], resultKinds: ['entities'], rebuild: 'deterministic' }),
      status: async () => ({ state: 'ready', message: `${records.size} records` }),
      projection: {
        async apply(batch) {
          for (const change of batch.changes) {
            if (change.operation === 'upsert') records.set(change.record.id, change.record)
            else records.delete(change.id)
          }
          return {
            batchId: batch.batchId,
            applied: batch.changes.map((change) => (change.operation === 'upsert' ? change.record.id : change.id)),
            failed: []
          }
        },
        async reset() {
          records.clear()
        }
      },
      query: {
        async ask(request) {
          return {
            interpretation: { description: 'every record', assumptions: [] },
            blocks: [
              {
                kind: 'entities',
                id: 'all',
                evidenceIds: [],
                entities: [...records.values()].map((record) => ({ ref: { kind: record.kind, id: record.id } }))
              }
            ],
            evidence: [],
            coverage: { mode: 'exhaustive', truncated: false, scope: request.context.scope },
            diagnostics: []
          }
        }
      },
      close: async () => {
        services.logger.debug('closed')
      }
    })
  }
})

describe('checkAdapterContract', () => {
  it('passes an adapter that honours the contract', async () => {
    const report = await assertAdapterContract(fakeDefinition(), { config: { label: 'x' }, invalidConfig: {} })
    expect(report.checks.map((check) => check.name)).toEqual([
      'definition envelope',
      'validateConfig accepts the config',
      'validateConfig rejects the invalid config',
      'create resolves to an adapter',
      'describe',
      'status',
      'projection.apply acknowledges every change',
      'projection.apply replays the same batch',
      'projection.reset',
      'query.ask returns a valid answer',
      'close'
    ])
  })

  it('reports an adapter that answers outside the scope asked', async () => {
    const definition = fakeDefinition((adapter) => ({
      ...adapter,
      query: { ask: async (request) => ({ ...(await adapter.query!.ask(request)), coverage: { mode: 'unknown', truncated: false, scope: 'elsewhere' } }) }
    }))
    const report = await checkAdapterContract(definition, { config: { label: 'x' } })
    expect(report.ok).toBe(false)
    expect(report.checks.find((check) => !check.ok)?.message).toMatch(/coverage.scope is "elsewhere"/)
    // Close still runs after a failed check.
    expect(report.checks.at(-1)).toEqual({ name: 'close', ok: true })
  })

  it('reports a receipt that leaves changes unacknowledged', async () => {
    const definition = fakeDefinition((adapter) => ({
      ...adapter,
      projection: { ...adapter.projection!, apply: async (batch) => ({ batchId: batch.batchId, applied: [], failed: [] }) }
    }))
    await expect(assertAdapterContract(definition, { config: { label: 'x' } })).rejects.toThrow(
      /projection.apply acknowledges every change: the receipt does not acknowledge service.orders, service.retired/
    )
  })

  it('reports answer blocks of kinds the adapter does not declare', async () => {
    const definition = fakeDefinition((adapter) => ({
      ...adapter,
      describe: () => ({ ...adapter.describe(), resultKinds: ['passages'] })
    }))
    await expect(assertAdapterContract(definition, { config: { label: 'x' } })).rejects.toThrow(
      /the answer has entities blocks the adapter does not declare/
    )
  })

  it('stops at a rejected config without creating anything', async () => {
    const report = await checkAdapterContract(fakeDefinition(), { config: {} })
    expect(report.checks).toEqual([
      { name: 'definition envelope', ok: true },
      { name: 'validateConfig accepts the config', ok: false, message: 'label is required' }
    ])
  })
})

describe('fakeServices', () => {
  it('serves canonical records read-only and records log lines', async () => {
    const services = fakeServices({ env: { TOKEN: 't' } })
    expect(await services.secrets.getEnv('TOKEN')).toBe('t')
    expect(await services.canonical.list('entity')).toEqual([])
    services.logger.warn('careful', { id: 'x' })
    expect(services.logged).toEqual([{ level: 'warn', message: 'careful', details: { id: 'x' } }])
  })
})
