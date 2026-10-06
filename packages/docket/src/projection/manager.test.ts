import { describe, expect, it, vi } from 'vitest'

import { entityOf, makeDocument } from '../../test/entities.js'
import { ProjectionManager } from './manager.js'
import type { MemoryProjection } from './projection.js'
import { createProjection, createProjections } from './registry.js'

const document = entityOf(makeDocument({ id: 'agent.a', title: 'A', path: '.docket/a.md' }))

function fakeProjection(name: string, overrides: Partial<MemoryProjection> = {}): MemoryProjection {
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

describe('ProjectionManager', () => {
  it('fans every operation out to all projections', async () => {
    const a = fakeProjection('a')
    const b = fakeProjection('b')
    const manager = new ProjectionManager([a, b])
    const context = { projectRoot: '/repo', memoryRoot: '/repo/.docket', stateRoot: '/repo/.docket/.index' }

    await manager.init(context)
    await manager.upsert(document)
    await manager.remove('agent.a')
    await manager.reset()
    await manager.close()

    for (const projection of [a, b]) {
      expect(projection.init).toHaveBeenCalledWith(context)
      expect(projection.upsert).toHaveBeenCalledWith(document)
      expect(projection.remove).toHaveBeenCalledWith('agent.a')
      expect(projection.reset).toHaveBeenCalled()
      expect(projection.close).toHaveBeenCalled()
    }
  })

  it('tolerates projections without optional hooks', async () => {
    const minimal: MemoryProjection = {
      name: 'minimal',
      upsert: vi.fn(async () => {}),
      remove: vi.fn(async () => {})
    }
    const manager = new ProjectionManager([minimal])

    await expect(
      manager.init({ projectRoot: '/repo', memoryRoot: '/repo/.docket', stateRoot: '/repo/.docket/.index' })
    ).resolves.toBeUndefined()
    await expect(manager.reset()).resolves.toBeUndefined()
  })

  it('reports a failing projection without stopping the others', async () => {
    const boom = new Error('boom')
    const failing = fakeProjection('failing', { upsert: vi.fn(async () => { throw boom }) })
    const healthy = fakeProjection('healthy')
    const manager = new ProjectionManager([failing, healthy])

    await expect(manager.upsert(document)).rejects.toThrow(/projection upsert failed: failing/)
    expect(healthy.upsert).toHaveBeenCalledWith(document)
  })
})

describe('registry', () => {
  it('creates the built-in projections', () => {
    expect(createProjection({ type: 'jsonl', output: '.docket/.index' }).name).toBe('jsonl')
    expect(
      createProjection({ type: 'mem0', mode: 'oss', config: {} }).name
    ).toBe('mem0')
    expect(createProjections([{ type: 'jsonl', output: '.docket/.index' }])).toHaveLength(1)
  })

  it('rejects an unknown projection type', () => {
    expect(() =>
      createProjection({ type: 'kuzu', output: 'x' } as unknown as { type: 'jsonl'; output: string })
    ).toThrow(/Unknown projection type "kuzu"/)
  })
})
