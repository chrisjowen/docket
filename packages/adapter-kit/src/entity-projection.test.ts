import { assertAdapterContract, fakeServices } from '@docket/contracts/testing'
import { describe, expect, it, vi } from 'vitest'

import { entityProjectionDefinition, type EntityProjection } from './entity-projection.js'

const definitionFor = (projection: EntityProjection) =>
  entityProjectionDefinition<{ label: string }>({
    name: projection.name,
    version: '1.2.3',
    rebuild: 'deterministic',
    validateConfig: (input) => {
      const label = (input as { label?: unknown } | undefined)?.label
      if (typeof label !== 'string') throw new Error('label is required')
      return { label }
    },
    createProjection: () => projection
  })

describe('entity projection definitions', () => {
  it('hold the adapter contract, answering a search with one entities block', async () => {
    const ids = new Set<string>()
    const projection: EntityProjection = {
      name: 'memory',
      upsert: async (entity) => void ids.add(entity.id),
      remove: async (id) => void ids.delete(id),
      reset: async () => ids.clear(),
      search: async (_query, limit) => ({ hits: [...ids].slice(0, limit).map((id) => ({ id, score: 1 })), note: 'all of it' })
    }
    const report = await assertAdapterContract(definitionFor(projection), {
      config: { label: 'memory' },
      invalidConfig: {}
    })
    expect(report.checks.every((check) => check.ok)).toBe(true)
  })

  it('initialise the projection against the project and report the package version', async () => {
    const init = vi.fn(async () => {})
    const adapter = await definitionFor({ name: 'probe', init, upsert: async () => {}, remove: async () => {} }).create(
      { label: 'probe' },
      fakeServices({ projectRoot: '/repo' })
    )
    expect(init).toHaveBeenCalledWith({ projectRoot: '/repo' })
    expect(adapter.describe()).toEqual({ name: 'probe', version: '1.2.3', inputs: ['entity'], resultKinds: [], rebuild: 'deterministic' })
    expect(adapter.query).toBeUndefined()
  })

  it('close a projection whose init fails and rethrow its error', async () => {
    const close = vi.fn(async () => {})
    const projection: EntityProjection = {
      name: 'neo4j',
      init: async () => {
        throw new Error('no schema privileges')
      },
      upsert: async () => {},
      remove: async () => {},
      close
    }
    await expect(definitionFor(projection).create({ label: 'x' }, fakeServices({ projectRoot: '/repo' }))).rejects.toThrow(
      'no schema privileges'
    )
    expect(close).toHaveBeenCalledTimes(1)
  })
})
