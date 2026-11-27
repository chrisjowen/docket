// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { searchWorkspace, type StoreAccess } from '@docket/platform-projections'
import { HAVE_TEST_STORES, TEST_STORES, startFakeEmbedder } from '@docket/platform-projections/testing'
import { qdrantProvisioner } from '@docket/platform-provisioner'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { AiCapReached, aiCaps, setCap, type AiCaps, type CapWarning } from './caps.js'
import { orgAiKeys } from './keys.js'
import { openRouterModels } from './models.js'
import type { OpenRouterClient } from './openrouter-client.js'
import { recordUsage } from './usage.js'

describe.skipIf(!TEST_PG_URL)('AI caps', () => {
  let org: TestOrg
  let caps: AiCaps
  const warnings: CapWarning[] = []

  /** Sets the month's spend: usage is append-only for the app role, so the owner clears it first. */
  const spend = async (usd: number) => {
    await org.db.admin.query('DELETE FROM platform.ai_usage WHERE org_id = $1', [org.orgId])
    await org.router.withPlatform((tx) =>
      recordUsage(tx, { orgId: org.orgId, actor: 'system:test', purpose: 'synthesis', model: 'm', promptTokens: 1, completionTokens: 1, costUsd: usd }),
    )
  }

  beforeAll(async () => {
    org = await createTestOrg()
    // Usage is recorded at now(), so the caps read the real month.
    caps = aiCaps({
      platform: (fn) => org.router.withPlatform(fn),
      notifyOwners: async (_tx, warning) => {
        warnings.push(warning)
      },
    })
    await org.router.withPlatform((tx) => setCap(tx, org.orgId, 10, org.userId))
  })
  afterAll(() => org?.drop())

  it('lets a call through at 79% of the cap, without a warning', async () => {
    await spend(7.9)
    await expect(caps.assertWithinCap(org.orgId)).resolves.toBeUndefined()
    expect(warnings).toEqual([])
    expect(await caps.status(org.orgId)).toMatchObject({ capUsd: 10, spentUsd: 7.9, warnedAt: null })
  })

  it('sends the owners one warning at 80%, and only one that month', async () => {
    await spend(8)
    await caps.assertWithinCap(org.orgId)
    await spend(9.5)
    await caps.assertWithinCap(org.orgId)
    await Promise.all([caps.assertWithinCap(org.orgId), caps.assertWithinCap(org.orgId)])
    expect(warnings).toEqual([{ orgId: org.orgId, month: new Date().toISOString().slice(0, 7), spentUsd: 8, capUsd: 10 }])
    expect((await caps.status(org.orgId)).warnedAt).toBeInstanceOf(Date)
  })

  it('refuses at 100% with the message the spec gives', async () => {
    await spend(10)
    const refused = caps.assertWithinCap(org.orgId)
    await expect(refused).rejects.toBeInstanceOf(AiCapReached)
    await expect(caps.assertWithinCap(org.orgId)).rejects.toThrow(
      'AI budget for this month reached — search still works; ask an owner to raise the cap',
    )
  })

  it('starts a new month with a clean slate', async () => {
    const nextMonth = aiCaps({ platform: (fn) => org.router.withPlatform(fn), notifyOwners: async () => undefined, now: () => new Date('2027-01-02T00:00:00Z') })
    await expect(nextMonth.assertWithinCap(org.orgId)).resolves.toBeUndefined()
  })

  it("meters each model call on the org's own key, and refuses before calling once the cap is spent", async () => {
    await spend(0)
    const chat = vi.fn<OpenRouterClient['chat']>(async () => ({
      text: 'MATCH (n) RETURN n',
      model: 'anthropic/claude-haiku-5.5',
      generationId: 'gen-1',
      usage: { promptTokens: 120, completionTokens: 30, costUsd: 0.25 },
    }))
    const client: OpenRouterClient = {
      chat,
      turn: async () => Promise.reject(new Error('not used')),
      createKey: async ({ limitUsd }) => ({ key: `sk-or-test-${limitUsd}`, hash: 'hash-1' }),
      updateKeyLimit: vi.fn(async () => undefined),
      deleteKey: async () => undefined,
    }
    const keys = orgAiKeys({ platform: (fn) => org.router.withPlatform(fn), keysFor: (id) => org.keyring.forOrg(id), client })
    expect(await keys.ensure(org.orgId)).toBe('created')
    expect(await keys.ensure(org.orgId)).toBe('current')
    const models = openRouterModels({ platform: (fn) => org.router.withPlatform(fn), caps, keys, client }, org.orgId, { actor: 'user:x' })

    expect(await models.cypher?.chat([{ role: 'user', content: 'which services use postgres?' }])).toBe('MATCH (n) RETURN n')
    // The org's own key, minted with the cap as its credit limit, and the org's cheap model.
    expect(chat).toHaveBeenCalledWith('sk-or-test-10', expect.objectContaining({ model: 'anthropic/claude-haiku-5.5' }))
    expect((await caps.status(org.orgId)).spentUsd).toBe(0.25)

    // Without a key of its own, an org uses the platform's shared key when there is one.
    const shared = orgAiKeys({ platform: (fn) => org.router.withPlatform(fn), keysFor: (id) => org.keyring.forOrg(id), client, sharedKey: 'sk-or-shared' })
    expect(await shared.key('noorgkey')).toBe('sk-or-shared')
    expect(await shared.key(org.orgId)).toBe('sk-or-test-10')
    await expect(keys.key('noorgkey')).rejects.toThrow(/AI is not set up/)

    // A raised cap raises the key's limit upstream.
    await org.router.withPlatform((tx) => setCap(tx, org.orgId, 25, org.userId))
    expect(await keys.ensure(org.orgId)).toBe('limit-updated')
    expect(client.updateKeyLimit).toHaveBeenCalledWith('hash-1', 25)

    await spend(25)
    chat.mockClear()
    await expect(models.synthesis?.chat([{ role: 'user', content: 'summarise' }])).rejects.toBeInstanceOf(AiCapReached)
    expect(chat).not.toHaveBeenCalled()
  })

  describe.skipIf(!HAVE_TEST_STORES)('the docket_search path', () => {
    let embedder: Awaited<ReturnType<typeof startFakeEmbedder>>
    const qdrant = qdrantProvisioner({ url: TEST_STORES.qdrantUrl ?? '', apiKey: TEST_STORES.qdrantApiKey, dimension: 32 })

    beforeAll(async () => {
      embedder = await startFakeEmbedder()
      await qdrant.provision({ orgId: org.orgId })
    })
    afterAll(async () => {
      await qdrant.deprovision({ orgId: org.orgId }, 'shred')
      await embedder?.close()
    })

    it('never calls assertWithinCap, and keeps answering with the budget spent', async () => {
      await spend(1_000)
      const spied = vi.spyOn(caps, 'assertWithinCap')
      const workspaceId = await org.withOrg((ctx) =>
        insertWorkspace(ctx.tx, { name: 'Search', slug: `s-${randomUUID().slice(0, 8)}`, createdBy: org.userId }).then((w) => w.id),
      )
      const access: StoreAccess = {
        neo4j: { url: TEST_STORES.neo4jUrl ?? '', username: 'neo4j', password: TEST_STORES.neo4jPassword },
        qdrant: await qdrant.access({ orgId: org.orgId }, 600),
        embedder,
      }
      const outcomes = await searchWorkspace({ orgId: org.orgId, workspaceId, access, question: 'which services use postgres?' })
      expect(outcomes.map(({ instance, error }) => ({ instance, error }))).toEqual([
        { instance: 'neo4j', error: undefined },
        { instance: 'mem0', error: undefined },
      ])
      expect(spied).not.toHaveBeenCalled()
      // The same org's model path is refused at the cap, so the spy is live.
      const models = openRouterModels(
        { platform: (fn) => org.router.withPlatform(fn), caps, keys: orgAiKeys({ platform: (fn) => org.router.withPlatform(fn), keysFor: (id) => org.keyring.forOrg(id), client: {} as OpenRouterClient }), client: {} as OpenRouterClient },
        org.orgId,
        { actor: 'user:x' },
      )
      await expect(models.cypher?.chat([{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(AiCapReached)
      expect(spied).toHaveBeenCalledTimes(1)
    })
  })
})
