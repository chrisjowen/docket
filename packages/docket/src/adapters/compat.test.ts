import { fakeServices } from '@docket/contracts/testing'
import { describe, expect, it, vi } from 'vitest'

const projection = vi.hoisted(() => ({
  name: 'neo4j',
  init: vi.fn(async () => {
    throw new Error('no schema privileges')
  }),
  close: vi.fn(async () => undefined)
}))

vi.mock('../projection/registry.js', () => ({ createProjection: () => projection }))

const { compatDefinitions } = await import('./compat.js')

describe('compatibility definitions', () => {
  it('close a projection whose init fails and rethrow its error', async () => {
    const { neo4j } = compatDefinitions({ projectRoot: '/repo', memoryRoot: '/repo/.docket', stateRoot: '/repo/.docket/.index' })
    const config = neo4j.validateConfig({ type: 'neo4j', url: 'bolt://localhost:7687' })

    await expect(neo4j.create(config, fakeServices({ projectRoot: '/repo' }))).rejects.toThrow('no schema privileges')
    expect(projection.close).toHaveBeenCalledTimes(1)
  })
})
