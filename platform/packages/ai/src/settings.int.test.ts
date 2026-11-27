// SPDX-License-Identifier: AGPL-3.0-only
import { insertSpace, insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import type { Tx } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { AiCapReached, aiCaps, setCap } from './caps.js'
import { AiNotConfigured, ProviderKeyError, orgAiKeys, spaceAiKeys } from './keys.js'
import { MODEL_ALLOWLIST, openRouterModels, type AiDeps } from './models.js'
import type { OpenRouterClient } from './openrouter-client.js'
import { SettingsError, modelChoices, providerKeyInfo, resolveAiSettings, saveAiSettings } from './settings.js'
import { recordUsage } from './usage.js'

function fakeClient(model = 'm'): OpenRouterClient {
  return {
    chat: vi.fn<OpenRouterClient['chat']>(async () => ({ text: 'ok', model, generationId: null, usage: { promptTokens: 3, completionTokens: 2, costUsd: 0 } })),
    turn: vi.fn<OpenRouterClient['turn']>(async () => Promise.reject(new Error('not used'))),
    createKey: vi.fn(async () => ({ key: 'sk-or-account', hash: 'h' })),
    updateKeyLimit: vi.fn(async () => undefined),
    deleteKey: vi.fn(async () => undefined),
  }
}

describe.skipIf(!TEST_PG_URL)('AI per space (tenancy v2 §5)', () => {
  let org: TestOrg
  let engineering: string
  let payments: string
  let handbook: string
  const platform = <T>(fn: (tx: Tx) => Promise<T>) => org.router.withPlatform(fn)

  beforeAll(async () => {
    org = await createTestOrg()
    await org.withOrg(async ({ tx }) => {
      engineering = (await insertSpace(tx, { name: 'Engineering', slug: 'engineering', createdBy: org.userId })).id
      payments = (await insertWorkspace(tx, { name: 'Payments', slug: 'payments', createdBy: org.userId, spaceId: engineering })).id
      handbook = (await insertWorkspace(tx, { name: 'Handbook', slug: 'handbook', createdBy: org.userId })).id
    })
    await platform((tx) => setCap(tx, org.orgId, 10, org.userId))
  })
  afterAll(() => org?.drop())

  it('saves each place within the limits above it, and resolves a docket from its space and the account', async () => {
    await platform((tx) =>
      saveAiSettings(tx, {
        orgId: org.orgId,
        place: { kind: 'account' },
        models: { cypher: 'anthropic/claude-haiku-5.5', synthesis: 'openai/gpt-4.1' },
        allowed: { synthesis: ['openai/gpt-4.1', 'anthropic/claude-sonnet-5.5'] },
        by: org.userId,
      }),
    )
    // A space cannot choose what the account does not let it.
    await expect(
      platform((tx) => saveAiSettings(tx, { orgId: org.orgId, place: { kind: 'space', id: engineering }, models: { synthesis: 'google/gemini-3.8-flash' }, by: org.userId })),
    ).rejects.toBeInstanceOf(SettingsError)
    // Nor take more than the account's cap.
    await expect(
      platform((tx) => saveAiSettings(tx, { orgId: org.orgId, place: { kind: 'space', id: engineering }, models: {}, monthlyUsd: 11, by: org.userId })),
    ).rejects.toThrow(/at most the account's monthly cap/)
    // An account's own choice stays inside the list it gives the places below it.
    await expect(
      platform((tx) =>
        saveAiSettings(tx, { orgId: org.orgId, place: { kind: 'account' }, models: { synthesis: 'openai/gpt-4.1' }, allowed: { synthesis: ['anthropic/claude-sonnet-5.5'] }, by: org.userId }),
      ),
    ).rejects.toThrow(/Keep openai\/gpt-4.1/)

    await platform((tx) =>
      saveAiSettings(tx, { orgId: org.orgId, place: { kind: 'space', id: engineering }, models: { synthesis: 'anthropic/claude-sonnet-5.5' }, monthlyUsd: 4, by: org.userId }),
    )
    expect(await platform((tx) => modelChoices(tx, org.orgId, payments))).toEqual({ cypher: 'anthropic/claude-haiku-5.5', synthesis: 'anthropic/claude-sonnet-5.5' })
    expect(await platform((tx) => modelChoices(tx, org.orgId, handbook))).toEqual({ cypher: 'anthropic/claude-haiku-5.5', synthesis: 'openai/gpt-4.1' })
    const resolved = await platform((tx) => resolveAiSettings(tx, org.orgId, { docketId: payments }))
    expect(resolved.spaceId).toBe(engineering)
    expect(resolved.models.synthesis.from).toBe('space')
    expect(resolved.caps).toEqual({ accountUsd: 10, spaceUsd: 4 })

    // A docket chooses within its space; clearing its choice takes the space's again.
    await platform((tx) => saveAiSettings(tx, { orgId: org.orgId, place: { kind: 'docket', id: payments }, models: { synthesis: 'openai/gpt-4.1' }, by: org.userId }))
    expect((await platform((tx) => modelChoices(tx, org.orgId, payments))).synthesis).toBe('openai/gpt-4.1')
    await platform((tx) => saveAiSettings(tx, { orgId: org.orgId, place: { kind: 'docket', id: payments }, models: {}, by: org.userId }))
    expect((await platform((tx) => modelChoices(tx, org.orgId, payments))).synthesis).toBe('anthropic/claude-sonnet-5.5')
  })

  it("seals a space's own key with the org's data key, bound to the space, and never reads it back except to call", async () => {
    const keys = spaceAiKeys({ platform: (fn) => org.router.withPlatform(fn), keysFor: (id) => org.keyring.forOrg(id) })
    await expect(platform((tx) => keys.set(tx, { orgId: org.orgId, spaceId: engineering, provider: 'anthropic', key: 'two words', by: org.userId }))).rejects.toBeInstanceOf(
      ProviderKeyError,
    )
    const info = await platform((tx) => keys.set(tx, { orgId: org.orgId, spaceId: engineering, provider: 'anthropic', key: 'sk-ant-secret-1234', by: org.userId }))
    expect(info).toMatchObject({ spaceId: engineering, provider: 'anthropic', hint: '1234' })
    expect(JSON.stringify(await platform((tx) => providerKeyInfo(tx, org.orgId, engineering)))).not.toContain('secret')
    const { rows } = await org.db.admin.query<{ ciphertext: Buffer }>('SELECT ciphertext FROM platform.provider_keys WHERE org_id = $1', [org.orgId])
    expect(rows[0]?.ciphertext.toString('latin1')).not.toContain('sk-ant')
    expect(await keys.key(org.orgId, engineering)).toEqual({ provider: 'anthropic', key: 'sk-ant-secret-1234' })

    // The sealed key moved to another space does not open there.
    await org.db.admin.query(
      `INSERT INTO platform.provider_keys (org_id, space_id, provider, ciphertext, nonce, dek_version, hint)
       SELECT org_id, 'general', provider, ciphertext, nonce, dek_version, hint FROM platform.provider_keys WHERE org_id = $1 AND space_id = $2`,
      [org.orgId, engineering],
    )
    await expect(keys.key(org.orgId, 'general')).rejects.toThrow()
    await org.db.admin.query("DELETE FROM platform.provider_keys WHERE org_id = $1 AND space_id = 'general'", [org.orgId])
  })

  it("calls a docket's models on its space's own key and provider, metered, and stops at the space's slice", async () => {
    const accountClient = fakeClient()
    const anthropic = fakeClient('claude-sonnet-5-5')
    const providerClient = vi.fn(() => anthropic)
    const caps = aiCaps({ platform: (fn) => org.router.withPlatform(fn), notifyOwners: async () => undefined })
    const deps: AiDeps = {
      platform: (fn) => org.router.withPlatform(fn),
      caps,
      keys: orgAiKeys({ platform: (fn) => org.router.withPlatform(fn), keysFor: (id) => org.keyring.forOrg(id), client: accountClient, sharedKey: 'sk-or-account' }),
      client: accountClient,
      spaceKeys: spaceAiKeys({ platform: (fn) => org.router.withPlatform(fn), keysFor: (id) => org.keyring.forOrg(id) }),
      providerClient,
    }
    // Engineering pays with its Anthropic key (set above): its docket's answers go to Anthropic, named as Anthropic names them.
    const inSpace = openRouterModels(deps, org.orgId, { workspaceId: payments, actor: 'user:x' })
    expect(await inSpace.synthesis?.chat([{ role: 'user', content: 'q' }])).toBe('ok')
    expect(providerClient).toHaveBeenCalledWith('anthropic')
    expect(anthropic.chat).toHaveBeenCalledWith('sk-ant-secret-1234', expect.objectContaining({ model: 'claude-sonnet-5-5' }))
    expect(accountClient.chat).not.toHaveBeenCalled()
    // A docket elsewhere stays on the account's key and model.
    const elsewhere = openRouterModels(deps, org.orgId, { workspaceId: handbook, actor: 'user:x' })
    await elsewhere.synthesis?.chat([{ role: 'user', content: 'q' }])
    expect(accountClient.chat).toHaveBeenCalledWith('sk-or-account', expect.objectContaining({ model: 'openai/gpt-4.1' }))

    // Every call is metered against its docket, so the space's slice holds: $4 spent stops Engineering, not the account.
    await platform((tx) =>
      recordUsage(tx, { orgId: org.orgId, workspaceId: payments, actor: 'x', purpose: 'synthesis', model: 'm', promptTokens: 0, completionTokens: 0, costUsd: 4 }),
    )
    expect((await caps.spaceStatus(org.orgId, engineering)).spentUsd).toBe(4)
    const refused = await inSpace.synthesis?.chat([{ role: 'user', content: 'q' }]).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(AiCapReached)
    expect((refused as AiCapReached).spaceId).toBe(engineering)
    expect(await elsewhere.synthesis?.chat([{ role: 'user', content: 'q' }])).toBe('ok')

    // Without a way to reach the space's provider, its calls are refused rather than put on the account's key.
    await platform((tx) => saveAiSettings(tx, { orgId: org.orgId, place: { kind: 'space', id: engineering }, models: {}, by: org.userId }))
    const { providerClient: _unused, ...withoutProvider } = deps
    const noProvider = openRouterModels(withoutProvider, org.orgId, { workspaceId: payments, actor: 'user:x' })
    await expect(noProvider.synthesis?.chat([{ role: 'user', content: 'q' }])).rejects.toBeInstanceOf(AiNotConfigured)
    expect(MODEL_ALLOWLIST.synthesis).toContain('anthropic/claude-sonnet-5.5')
  })
})

/** A client whose every call costs `costUsd`, as OpenRouter reports it. */
function costing(costUsd: number): OpenRouterClient {
  return {
    ...fakeClient(),
    chat: vi.fn<OpenRouterClient['chat']>(async () => ({ text: 'ok', model: 'm', generationId: null, usage: { promptTokens: 3, completionTokens: 2, costUsd } })),
  }
}

describe.skipIf(!TEST_PG_URL)("who pays: the account's cap holds Docket's key, a space's slice holds its dockets (tenancy v2 §5)", () => {
  const ask = [{ role: 'user' as const, content: 'q' }]
  const refusal = (promise: Promise<unknown> | undefined) => (promise ?? Promise.resolve()).then(() => null, (error: unknown) => error)
  const paidBy = async (org: TestOrg) =>
    (await org.db.admin.query<{ paid_by: string; spent: string }>('SELECT paid_by, sum(cost_usd) AS spent FROM platform.ai_usage WHERE org_id = $1 GROUP BY paid_by ORDER BY paid_by', [org.orgId])).rows.map(
      (row) => [row.paid_by, Number(row.spent)],
    )

  function depsFor(org: TestOrg, accountClient: OpenRouterClient, ownClient: OpenRouterClient) {
    const notifyOwners = vi.fn(async () => undefined)
    const caps = aiCaps({ platform: (fn) => org.router.withPlatform(fn), notifyOwners })
    const spaceKeys = spaceAiKeys({ platform: (fn) => org.router.withPlatform(fn), keysFor: (id) => org.keyring.forOrg(id) })
    const deps: AiDeps = {
      platform: (fn) => org.router.withPlatform(fn),
      caps,
      keys: orgAiKeys({ platform: (fn) => org.router.withPlatform(fn), keysFor: (id) => org.keyring.forOrg(id), client: accountClient, sharedKey: 'sk-or-account' }),
      client: accountClient,
      spaceKeys,
      providerClient: () => ownClient,
    }
    return { deps, caps, spaceKeys, notifyOwners }
  }

  let plain: TestOrg
  let mixed: TestOrg
  afterAll(async () => {
    await plain?.drop()
    await mixed?.drop()
  })

  it('an account with no own keys is capped, warned and refused on spend on its key, as before', async () => {
    plain = await createTestOrg()
    const docket = await plain.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Notes', slug: 'notes', createdBy: plain.userId }))
    await plain.router.withPlatform((tx) => setCap(tx, plain.orgId, 10, plain.userId))
    const { deps, caps, notifyOwners } = depsFor(plain, costing(4), costing(0))
    const models = openRouterModels(deps, plain.orgId, { workspaceId: docket.id, actor: 'user:x' })

    // $4 a call against a $10 cap: two calls in, $8 is 80%; the third call warns the owners once and goes ahead.
    await models.synthesis?.chat(ask)
    await models.synthesis?.chat(ask)
    expect(notifyOwners).not.toHaveBeenCalled()
    await models.synthesis?.chat(ask)
    expect(notifyOwners).toHaveBeenCalledTimes(1)
    expect((await caps.status(plain.orgId)).spentUsd).toBe(12)
    const refused = await refusal(models.synthesis?.chat(ask))
    expect(refused).toBeInstanceOf(AiCapReached)
    expect((refused as AiCapReached).spaceId).toBeNull()
    expect(notifyOwners).toHaveBeenCalledTimes(1)
    expect(await paidBy(plain)).toEqual([['account', 12]])
  })

  it("keeps a space's own OpenRouter key off the account's cap, holds it to the space's slice, and lets it run once the account's cap is spent", async () => {
    mixed = await createTestOrg()
    let ownSpace = ''
    let otherSpace = ''
    let ownDocket = ''
    let otherDocket = ''
    let accountDocket = ''
    await mixed.withOrg(async ({ tx }) => {
      ownSpace = (await insertSpace(tx, { name: 'Research', slug: 'research', createdBy: mixed.userId })).id
      otherSpace = (await insertSpace(tx, { name: 'Sales', slug: 'sales', createdBy: mixed.userId })).id
      ownDocket = (await insertWorkspace(tx, { name: 'Papers', slug: 'papers', createdBy: mixed.userId, spaceId: ownSpace })).id
      otherDocket = (await insertWorkspace(tx, { name: 'Leads', slug: 'leads', createdBy: mixed.userId, spaceId: otherSpace })).id
      accountDocket = (await insertWorkspace(tx, { name: 'Handbook', slug: 'handbook', createdBy: mixed.userId })).id
    })
    const platform = <T>(fn: (tx: Tx) => Promise<T>) => mixed.router.withPlatform(fn)
    await platform((tx) => setCap(tx, mixed.orgId, 10, mixed.userId))
    const ownClient = costing(4)
    const { deps, caps, spaceKeys, notifyOwners } = depsFor(mixed, costing(0), ownClient)
    await platform((tx) =>
      spaceKeys.set(tx, { orgId: mixed.orgId, spaceId: ownSpace, provider: 'openrouter', key: 'sk-or-research-9876', by: mixed.userId }),
    )
    await platform((tx) => saveAiSettings(tx, { orgId: mixed.orgId, place: { kind: 'space', id: ownSpace }, models: {}, monthlyUsd: 6, by: mixed.userId }))
    const on = (docketId: string) => openRouterModels(deps, mixed.orgId, { workspaceId: docketId, actor: 'user:x' })

    // $12 on Research's own key is more than the account's $10 cap, yet the account's spend is untouched and nobody is warned.
    await on(ownDocket).synthesis?.chat(ask)
    await on(ownDocket).synthesis?.chat(ask)
    expect(ownClient.chat).toHaveBeenCalledWith('sk-or-research-9876', expect.anything())
    expect((await caps.status(mixed.orgId)).spentUsd).toBe(0)
    expect((await caps.spaceStatus(mixed.orgId, ownSpace)).spentUsd).toBe(8)
    expect(await on(otherDocket).synthesis?.chat(ask)).toBe('ok')
    expect(await on(accountDocket).synthesis?.chat(ask)).toBe('ok')
    expect(notifyOwners).not.toHaveBeenCalled()

    // Research's $6 slice holds its own key: $8 spent, the next call is refused for the space.
    const sliced = await refusal(on(ownDocket).synthesis?.chat(ask))
    expect(sliced).toBeInstanceOf(AiCapReached)
    expect((sliced as AiCapReached).spaceId).toBe(ownSpace)
    expect(ownClient.chat).toHaveBeenCalledTimes(2)

    // With no slice, Research's own key runs on even once the account's key spent its whole cap.
    await platform((tx) => saveAiSettings(tx, { orgId: mixed.orgId, place: { kind: 'space', id: ownSpace }, models: {}, monthlyUsd: null, by: mixed.userId }))
    await platform((tx) =>
      recordUsage(tx, { orgId: mixed.orgId, workspaceId: accountDocket, actor: 'x', purpose: 'synthesis', model: 'm', promptTokens: 0, completionTokens: 0, costUsd: 10 }),
    )
    const capped = await refusal(on(accountDocket).synthesis?.chat(ask))
    expect(capped).toBeInstanceOf(AiCapReached)
    expect((capped as AiCapReached).spaceId).toBeNull()
    expect(await refusal(on(otherDocket).synthesis?.chat(ask))).toBeInstanceOf(AiCapReached)
    expect(await on(ownDocket).synthesis?.chat(ask)).toBe('ok')
    expect(await paidBy(mixed)).toEqual([
      ['account', 10],
      ['space', 12],
    ])
  })
})
