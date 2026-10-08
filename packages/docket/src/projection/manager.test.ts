import { entityProjectionAdapter, type EntityProjection } from '@docket/adapter-kit'
import type { MemoryAdapter } from '@docket/contracts'
import { describe, expect, it, vi } from 'vitest'

import { entityOf, makeDocument } from '../../test/entities.js'
import { toEntityInput } from '../adapters/compat.js'
import type { AdapterSlot } from '../adapters/docket.js'
import { ProjectionManager } from './manager.js'

const document = entityOf(makeDocument({ id: 'agent.a', title: 'A', path: '.docket/a.md' }))
/** What a projection receives for `document`. */
const input = toEntityInput(document, 'default')

const projectionAdapter = (projection: EntityProjection): MemoryAdapter =>
  entityProjectionAdapter(projection, { version: '0.0.0' })

function fakeProjection(name: string, overrides: Partial<EntityProjection> = {}): EntityProjection {
  return {
    name,
    init: vi.fn(async () => {}),
    upsert: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    reset: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    ...overrides
  }
}

const managed = (...projections: EntityProjection[]) =>
  projections.map((projection) => ({ id: projection.name, adapter: projectionAdapter(projection) }))

const slot = (id: string, create: () => Promise<MemoryAdapter>): AdapterSlot => ({
  id,
  name: id,
  source: 'registration',
  roles: ['projection', 'query'],
  create
})

describe('ProjectionManager', () => {
  it('fans every operation out to all adapters', async () => {
    const a = fakeProjection('a')
    const b = fakeProjection('b')
    const manager = new ProjectionManager(managed(a, b))

    await manager.upsert(document)
    await manager.remove('agent.a', document.hash)
    await manager.reset()
    await manager.close()

    for (const projection of [a, b]) {
      expect(projection.upsert).toHaveBeenCalledWith(input)
      expect(projection.remove).toHaveBeenCalledWith('agent.a')
      expect(projection.reset).toHaveBeenCalled()
      expect(projection.close).toHaveBeenCalled()
    }
  })

  it('tolerates projections without optional hooks', async () => {
    const minimal: EntityProjection = {
      name: 'minimal',
      upsert: vi.fn(async () => {}),
      remove: vi.fn(async () => {})
    }
    const manager = new ProjectionManager(managed(minimal))

    await expect(manager.flush()).resolves.toBeUndefined()
    await expect(manager.reset()).resolves.toBeUndefined()
    await expect(manager.close()).resolves.toBeUndefined()
  })

  it('reports a failing adapter without stopping the others', async () => {
    const boom = new Error('boom')
    const failing = fakeProjection('failing', { upsert: vi.fn(async () => { throw boom }) })
    const healthy = fakeProjection('healthy')
    const manager = new ProjectionManager(managed(failing, healthy))

    await expect(manager.upsert(document)).rejects.toThrow(/projection upsert failed: failing/)
    expect(healthy.upsert).toHaveBeenCalledWith(input)
  })

  it('treats failed and unacknowledged changes as failures', async () => {
    const adapter = projectionAdapter(fakeProjection('partial'))
    const manager = new ProjectionManager([
      {
        id: 'partial',
        adapter: {
          ...adapter,
          projection: { ...adapter.projection!, apply: async (batch) => ({ batchId: batch.batchId, applied: [], failed: [] }) }
        }
      },
      {
        id: 'refusing',
        adapter: {
          ...adapter,
          projection: {
            ...adapter.projection!,
            apply: async (batch) => ({ batchId: batch.batchId, applied: [], failed: [{ id: 'agent.a', retryable: true, message: 'busy' }] })
          }
        }
      }
    ])

    const failure = await manager.upsert(document).catch((cause: unknown) => cause)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).message).toBe('projection upsert failed: partial, refusing')
    expect((failure as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      'agent.a: not acknowledged',
      'agent.a: busy'
    ])
  })

  it('delivers only the input kinds an adapter declares', async () => {
    const projection = fakeProjection('documents-only')
    const adapter = projectionAdapter(projection)
    const manager = new ProjectionManager([
      { id: 'documents-only', adapter: { ...adapter, describe: () => ({ ...adapter.describe(), inputs: ['document'] }) } }
    ])

    await manager.upsert(document)
    expect(projection.upsert).not.toHaveBeenCalled()
  })

  it('opens slots, closing the ones that started when another fails', async () => {
    const started = fakeProjection('started')
    await expect(
      ProjectionManager.open([
        slot('started', async () => projectionAdapter(started)),
        slot('broken', async () => { throw new Error('unreachable') })
      ])
    ).rejects.toThrow('projection init failed: broken')
    expect(started.close).toHaveBeenCalled()
  })

  it('skips slots not enabled for projection', async () => {
    const create = vi.fn(async () => projectionAdapter(fakeProjection('query-only')))
    await ProjectionManager.open([{ ...slot('query-only', create), roles: ['query'] }])
    expect(create).not.toHaveBeenCalled()
  })
})
