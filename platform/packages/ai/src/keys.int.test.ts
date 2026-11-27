// SPDX-License-Identifier: AGPL-3.0-only
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { AiCapReached, aiCaps, setCap } from './caps.js'
import { openRouterKeys } from './keys.js'
import { openRouterModels } from './models.js'
import type { OpenRouterClient } from './openrouter-client.js'
import { recordUsage } from './usage.js'

function fakeClient(): OpenRouterClient {
  return {
    chat: vi.fn<OpenRouterClient['chat']>(async () => ({
      text: 'ok',
      model: 'anthropic/claude-haiku-5.5',
      generationId: 'g',
      usage: { promptTokens: 1, completionTokens: 1, costUsd: 1 },
    })),
    turn: vi.fn<OpenRouterClient['turn']>(async () => Promise.reject(new Error('not used'))),
    createKey: vi.fn(async ({ limitUsd }: { name: string; limitUsd: number }) => ({ key: `sk-or-org-${limitUsd}`, hash: 'h1' })),
    updateKeyLimit: vi.fn(async () => undefined),
    deleteKey: vi.fn(async () => undefined),
  }
}

describe.skipIf(!TEST_PG_URL)('openRouterKeys', () => {
  let org: TestOrg
  const deps = (): Parameters<typeof openRouterKeys>[0] => ({
    platform: (fn) => org.router.withPlatform(fn),
    keysFor: (id) => org.keyring.forOrg(id),
  })

  beforeAll(async () => {
    org = await createTestOrg()
    await org.router.withPlatform((tx) => setCap(tx, org.orgId, 2, org.userId))
  })
  afterAll(() => org?.drop())

  it('is off with no key configured', () => {
    expect(openRouterKeys(deps(), {}, () => fakeClient())).toEqual({ mode: 'off', keys: null })
  })

  it('gives each org its own capped key when a provisioning key is configured', async () => {
    const client = fakeClient()
    const made = vi.fn(() => client)
    const { mode, keys } = openRouterKeys(deps(), { provisioningKey: 'prov', apiKey: 'shared' }, made)
    expect(mode).toBe('per-org')
    expect(made).toHaveBeenCalledWith({ provisioningKey: 'prov', appUrl: undefined })
    expect(await keys?.ensure(org.orgId)).toBe('created')
    expect(client.createKey).toHaveBeenCalledWith({ name: `docket-cloud org_${org.orgId}`, limitUsd: 2 })
    expect(await keys?.key(org.orgId)).toBe('sk-or-org-2')
  })

  it('shares the platform key without provisioning, and still enforces the cap from recorded usage', async () => {
    const other = await createTestOrg()
    try {
      await other.router.withPlatform((tx) => setCap(tx, other.orgId, 2, other.userId))
      const client = fakeClient()
      const { mode, keys } = openRouterKeys(
        { platform: (fn) => other.router.withPlatform(fn), keysFor: (id) => other.keyring.forOrg(id) },
        { apiKey: 'sk-or-shared' },
        () => client,
      )
      expect(mode).toBe('shared')
      expect(await keys?.ensure(other.orgId)).toBe('shared')
      expect(client.createKey).not.toHaveBeenCalled()
      expect(await keys?.key(other.orgId)).toBe('sk-or-shared')

      const caps = aiCaps({ platform: (fn) => other.router.withPlatform(fn), notifyOwners: async () => undefined })
      const models = openRouterModels({ platform: (fn) => other.router.withPlatform(fn), caps, keys: keys as NonNullable<typeof keys>, client }, other.orgId, { actor: 'user:x' })
      expect(await models.cypher?.chat([{ role: 'user', content: 'q' }])).toBe('ok')
      expect(client.chat).toHaveBeenCalledWith('sk-or-shared', expect.anything())
      // The call above cost $1; another $1 reaches the $2 cap.
      await other.router.withPlatform((tx) =>
        recordUsage(tx, { orgId: other.orgId, actor: 'x', purpose: 'cypher', model: 'm', promptTokens: 0, completionTokens: 0, costUsd: 1 }),
      )
      await expect(models.cypher?.chat([{ role: 'user', content: 'q' }])).rejects.toBeInstanceOf(AiCapReached)
      expect(client.chat).toHaveBeenCalledTimes(1)
    } finally {
      await other.drop()
    }
  })
})
