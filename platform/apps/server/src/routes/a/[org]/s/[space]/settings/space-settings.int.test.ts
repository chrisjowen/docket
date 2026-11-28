// SPDX-License-Identifier: AGPL-3.0-only
import { randomInt, randomUUID } from 'node:crypto'

import { aiCaps } from '@docket/platform-ai'
import { argsDigest } from '@docket/platform-audit'
import { insertSpace, insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { upsertGitHubUser } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Runtime } from '$lib/server/runtime'

let runtime: Runtime
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))
const env: Record<string, string | undefined> = {}
vi.mock('$env/dynamic/private', () => ({ env }))
const settingsPage = await import('./+page.server')
const accountSettings = await import('../../../settings/+page.server')

// A space's Settings (tenancy v2 §5) against real Postgres: only Change settings on the space reaches them, everything
// chosen stays within the account's limits, and a space's own key is never shown or recorded again.
describe.skipIf(!TEST_PG_URL)("a space's settings", () => {
  let org: TestOrg
  let slug: string
  let engineering: string
  const users: Record<string, { id: string; login: string }> = {}

  async function member(name: string) {
    const user = await org.router.withPlatform((tx) =>
      upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login: `${name}-${org.orgId.slice(0, 4)}`, name: null, avatarUrl: null, emails: [] }),
    )
    await org.db.app.query('INSERT INTO platform.memberships (org_id, user_id) VALUES ($1, $2)', [org.orgId, user.id])
    users[name] = { id: user.id, login: user.login }
  }
  const grant = (name: string, kind: 'account' | 'space', place: string | null, role: string, add: string[] = []) =>
    org.db.app.query('INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id, add_caps) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
      `g_${randomUUID()}`,
      org.orgId,
      users[name]!.id,
      kind,
      place,
      role,
      add,
    ])

  function event(name: string, path: string, params: Record<string, string> = {}, form?: Record<string, string | string[]>): RequestEvent {
    const url = new URL(`https://docket.example/a/${slug}${path}`)
    let body: FormData | undefined
    if (form) {
      body = new FormData()
      for (const [key, value] of Object.entries(form)) for (const each of Array.isArray(value) ? value : [value]) body.append(key, each)
    }
    return {
      params: { org: slug, ...params },
      locals: { user: { ...users[name]!, name: null, avatarUrl: null, emails: [], allowlisted: false }, startedAt: performance.now(), requestId: randomUUID() },
      url,
      request: body ? new Request(url, { method: 'POST', body }) : new Request(url),
      getClientAddress: () => '192.0.2.1',
    } as unknown as RequestEvent
  }
  const at = (name: string, form?: Record<string, string | string[]>) => event(name, '/s/engineering/settings', { space: 'engineering' }, form)

  async function outcome(call: () => unknown): Promise<{ status: number; location?: string; data?: unknown }> {
    try {
      return { status: 200, data: await call() }
    } catch (thrown) {
      if (isHttpError(thrown)) return { status: thrown.status }
      if (isRedirect(thrown)) return { status: thrown.status, location: thrown.location }
      throw thrown
    }
  }

  beforeAll(async () => {
    org = await createTestOrg()
    slug = `o-${org.orgId}`
    users.owner = { id: org.userId, login: org.login }
    runtime = {
      router: org.router,
      keyring: org.keyring,
      origin: 'https://docket.example',
      caps: aiCaps({ platform: (fn) => org.router.withPlatform(fn), notifyOwners: async () => undefined }),
    } as unknown as Runtime
    engineering = (await org.withOrg(({ tx }) => insertSpace(tx, { name: 'Engineering', slug: 'engineering', createdBy: org.userId }))).id
    await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Payments', slug: 'payments', createdBy: org.userId, spaceId: engineering }))
    for (const name of ['lead', 'writer', 'tuner', 'elsewhere']) await member(name)
    await grant('lead', 'space', engineering, 'admin')
    await grant('writer', 'space', engineering, 'writer')
    // Writer, plus the one capability, given on Engineering alone.
    await grant('tuner', 'space', engineering, 'writer', ['settings'])
    await grant('elsewhere', 'space', 'general', 'admin')
  })
  afterAll(() => org?.drop())

  it('takes Change settings on the space, from whatever grant gives it', async () => {
    expect((await outcome(() => settingsPage.load(at('writer') as never))).status).toBe(403)
    expect((await outcome(() => settingsPage.load(at('elsewhere') as never))).status).toBe(403)
    expect((await outcome(() => settingsPage.actions.models!(at('writer', { cypher: '', synthesis: '' }) as never))).status).toBe(403)
    expect((await outcome(() => settingsPage.actions.ownGraph!(at('writer') as never))).status).toBe(403)
    for (const name of ['lead', 'tuner', 'owner']) expect((await outcome(() => settingsPage.load(at(name) as never))).status).toBe(200)
  })

  it("saves the space's models and slice within the account's limits", async () => {
    // The owner lets spaces choose between two answer models.
    const owner = await outcome(() =>
      accountSettings.actions.ai!(
        event('owner', '/settings', {}, {
          cap: '10',
          cypher: 'anthropic/claude-haiku-5.5',
          synthesis: 'openai/gpt-4.1',
          allowed_synthesis: ['openai/gpt-4.1', 'anthropic/claude-sonnet-5.5'],
        }) as never,
      ),
    )
    expect(owner.data).toEqual({ flash: 'Saved: $10.00 a month.' })

    const outside = await outcome(() => settingsPage.actions.models!(at('tuner', { cypher: '', synthesis: 'google/gemini-3.8-flash' }) as never))
    expect(outside.data).toMatchObject({ status: 400 })
    const tooMuch = await outcome(() => settingsPage.actions.models!(at('tuner', { cypher: '', synthesis: '', slice: '12' }) as never))
    expect(tooMuch.data).toMatchObject({ status: 400, data: { problem: expect.stringMatching(/at most the account's monthly cap, \$10.00/) } })
    const saved = await outcome(() => settingsPage.actions.models!(at('tuner', { cypher: '', synthesis: 'anthropic/claude-sonnet-5.5', slice: '4' }) as never))
    expect(saved.data).toEqual({ flash: "Saved Engineering's models and its $4.00 monthly slice." })

    const page = (await settingsPage.load(at('lead') as never)) as unknown as {
      models: { use: string; model: string; from: string; choices: string[] }[]
      budget: { sliceUsd: number; accountCapUsd: number }
    }
    expect(page.models.find((slot) => slot.use === 'synthesis')).toMatchObject({ model: 'anthropic/claude-sonnet-5.5', from: 'space', choices: ['anthropic/claude-sonnet-5.5', 'openai/gpt-4.1'] })
    expect(page.models.find((slot) => slot.use === 'cypher')).toMatchObject({ model: 'anthropic/claude-haiku-5.5', from: 'account' })
    expect(page.budget).toMatchObject({ sliceUsd: 4, accountCapUsd: 10 })
  })

  it("keeps the space's own key sealed: the page and the audit log carry only its provider and last four characters", async () => {
    const set = await outcome(() => settingsPage.actions.setKey!(at('lead', { provider: 'anthropic', key: 'sk-ant-api03-very-secret-WXYZ' }) as never))
    expect(set.data).toEqual({ flash: 'Engineering now pays for AI with its own Anthropic key (…WXYZ).' })
    const page = await settingsPage.load(at('lead') as never)
    expect(JSON.stringify(page)).not.toContain('very-secret')
    expect((page as unknown as { key: unknown }).key).toMatchObject({ provider: 'anthropic', hint: 'WXYZ', createdBy: users.lead!.login })
    // The audit log keeps a digest of what was recorded: the space, the provider and the last four characters, nothing more.
    const audit = await org.withOrg(({ tx }) => tx.query<{ args_digest: string }>("SELECT args_digest FROM audit_event WHERE action = 'space.key.set'"))
    expect(audit.rows.map((row) => row.args_digest)).toEqual([argsDigest({ space: engineering, provider: 'anthropic', hint: 'WXYZ' })])

    // A key for a provider that serves nothing the account allows is refused, and nothing is kept.
    const owner = await outcome(() =>
      accountSettings.actions.ai!(
        event('owner', '/settings', {}, { cap: '10', cypher: 'google/gemini-3.5-flash-lite', synthesis: 'openai/gpt-4.1', allowed_cypher: ['google/gemini-3.5-flash-lite'] }) as never,
      ),
    )
    expect(owner.status).toBe(200)
    const refused = await outcome(() => settingsPage.actions.setKey!(at('lead', { provider: 'openai', key: 'sk-openai-0000-1111' }) as never))
    expect(refused.data).toMatchObject({ status: 400, data: { problem: expect.stringMatching(/served by OpenAI/) } })
    expect((await settingsPage.load(at('lead') as never) as unknown as { key: { provider: string } }).key.provider).toBe('anthropic')

    expect((await outcome(() => settingsPage.actions.removeKey!(at('lead') as never))).data).toEqual({ flash: `Engineering pays for AI on Test org's key again.` })
    expect((await settingsPage.load(at('lead') as never) as unknown as { key: unknown }).key).toBeNull()
  })

  it("asks for the space's own Neo4j while the box has room, and gives it back", async () => {
    env.DOCKET_NEO4J_POD_CAPACITY = '2'
    try {
      // The account's own pod takes one of the two.
      await org.db.app.query("INSERT INTO platform.stores (id, org_id, kind, status) VALUES ('st00000000000000aa', $1, 'neo4j', 'ready')", [org.orgId])
      const before = (await settingsPage.load(at('lead') as never)) as unknown as { storage: { pods: { left: number; capacity: number }; graph: unknown } }
      expect(before.storage.pods).toEqual({ used: 1, capacity: 2, left: 1 })
      expect(before.storage.graph).toBeNull()

      expect((await outcome(() => settingsPage.actions.ownGraph!(at('lead') as never))).data).toMatchObject({ flash: expect.stringMatching(/Asked for Engineering's own Neo4j/) })
      const after = (await settingsPage.load(at('lead') as never)) as unknown as { storage: { pods: { left: number }; graph: { status: string } } }
      expect(after.storage.graph.status).toBe('requested')
      expect(after.storage.pods.left).toBe(0)
      // Asking again changes nothing.
      expect((await outcome(() => settingsPage.actions.ownGraph!(at('lead') as never))).data).toEqual({ flash: 'Engineering already has its own Neo4j.' })

      expect((await outcome(() => settingsPage.actions.sharedGraph!(at('lead') as never))).data).toMatchObject({ flash: expect.stringMatching(/go back to Test org's Neo4j/) })
      const retiring = (await settingsPage.load(at('lead') as never)) as unknown as { storage: { pods: { left: number }; graph: { status: string } } }
      expect(retiring.storage.graph.status).toBe('retiring')

      // With the box full, a space cannot take another pod.
      await org.db.app.query("INSERT INTO platform.stores (id, org_id, kind, space_id, status) VALUES ('st00000000000000bb', $1, 'neo4j', 'general', 'ready')", [org.orgId])
      const full = await outcome(() => settingsPage.actions.ownGraph!(at('lead') as never))
      expect(full.data).toMatchObject({ status: 409 })
    } finally {
      delete env.DOCKET_NEO4J_POD_CAPACITY
    }
  })
})
