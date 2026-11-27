// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openProjections, type StoreAccess } from './adapters.js'

const projection = { init: vi.fn<() => Promise<void>>(), close: vi.fn(async () => undefined) }

vi.mock('@chrisjowen/docket/adapters/neo4j', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createNeo4jProjection: () => projection,
}))

const access = {
  neo4j: { url: 'bolt://neo4j.test:7687', username: 'org_test', password: 'secret' },
} as unknown as StoreAccess

const neo4jError = (code: string) => Object.assign(new Error(code), { code })

describe('openProjections on Neo4j', () => {
  beforeEach(() => {
    projection.init.mockReset()
    projection.close.mockClear()
  })

  it('opens once a concurrent caller has created the same index first', async () => {
    projection.init.mockRejectedValueOnce(neo4jError('Neo.ClientError.Schema.EquivalentSchemaRuleAlreadyExists')).mockResolvedValueOnce()

    const opened = await openProjections({ orgId: 'org_test', workspaceId: 'ws1', access, only: ['neo4j'] })

    expect(opened.neo4j).toBeDefined()
    expect(projection.init).toHaveBeenCalledTimes(2)
  })

  it('fails on any other init error', async () => {
    projection.init.mockRejectedValue(neo4jError('Neo.ClientError.Security.Unauthorized'))

    await expect(openProjections({ orgId: 'org_test', workspaceId: 'ws1', access, only: ['neo4j'] })).rejects.toThrow('Unauthorized')
    expect(projection.init).toHaveBeenCalledTimes(1)
    expect(projection.close).toHaveBeenCalled()
  })

  it('fails when the retry fails too', async () => {
    projection.init.mockRejectedValue(neo4jError('Neo.ClientError.Schema.EquivalentSchemaRuleAlreadyExists'))

    await expect(openProjections({ orgId: 'org_test', workspaceId: 'ws1', access, only: ['neo4j'] })).rejects.toThrow('EquivalentSchemaRule')
    expect(projection.init).toHaveBeenCalledTimes(2)
  })
})
