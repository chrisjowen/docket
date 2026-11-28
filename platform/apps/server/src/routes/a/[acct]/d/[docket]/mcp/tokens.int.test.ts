// SPDX-License-Identifier: AGPL-3.0-only
import { randomInt, randomUUID } from 'node:crypto'

import { insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { accessOf, createServiceAccount, upsertGitHubUser, type Access } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import type { RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Runtime } from '$lib/server/runtime'

let runtime: Runtime
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))
const { load, actions } = await import('./+page.server')

// Real Postgres roles, migrations and grants; only the process runtime is injected.
describe.skipIf(!TEST_PG_URL)("tokens on a docket's MCP page", () => {
  let org: TestOrg
  let slug: string
  const wsSlug = 'alpha'
  let wsId: string
  let serviceAccountId: string
  const users: Record<string, { id: string; login: string }> = {}

  /** A member holding `role` on the whole account. */
  async function member(name: string, role: string) {
    const user = await org.router.withPlatform((tx) => upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login: `${name}-${org.orgId.slice(0, 4)}`, name: null, avatarUrl: null, emails: [] }))
    await org.db.app.query('INSERT INTO platform.memberships (org_id, user_id) VALUES ($1, $2)', [org.orgId, user.id])
    users[name] = { id: user.id, login: user.login }
    await grant(name, null, role)
  }
  /** A role on the account (`docket` null) or on one docket. */
  const grant = (name: string, docket: string | null, role: string) =>
    org.db.app.query('INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id) VALUES ($1, $2, $3, $4, $5, $6)', [
      `g_${randomUUID()}`,
      org.orgId,
      users[name]!.id,
      docket ? 'docket' : 'account',
      docket,
      role,
    ])

  function event(name: string, form?: FormData): RequestEvent {
    const url = new URL(`https://docket.example/a/${slug}/d/${wsSlug}/mcp`)
    return {
      params: { acct: slug, docket: wsSlug },
      locals: { user: { ...users[name]!, name: null, avatarUrl: null, emails: [], allowlisted: false }, startedAt: performance.now(), requestId: randomUUID() },
      url,
      request: form ? new Request(url, { method: 'POST', body: form }) : new Request(url),
      getClientAddress: () => '192.0.2.1',
    } as unknown as RequestEvent
  }

  function createTokenForm(extra: Record<string, string> = {}) {
    const form = new FormData()
    form.set('days', '7')
    form.set('name', 'test')
    for (const [key, value] of Object.entries(extra)) form.set(key, value)
    return form
  }

  beforeAll(async () => {
    org = await createTestOrg()
    slug = `o-${org.orgId}`
    users.owner = { id: org.userId, login: org.login }
    runtime = {
      router: org.router,
      keyring: org.keyring,
      origin: 'https://docket.example',
      limiter: { check: async () => ({ allowed: true, remaining: 1, resetAt: new Date() }) },
    } as unknown as Runtime
    // A writer made admin of just this one docket, and a reader.
    await member('developer', 'writer')
    await member('reader', 'reader')
    wsId = (await org.withOrg((ctx) => insertWorkspace(ctx.tx, { name: 'Alpha', slug: wsSlug, createdBy: org.userId }))).id
    await grant('developer', wsId, 'admin')
    const owner = (await org.router.withPlatform((tx) => accessOf(tx, org.orgId, org.userId))) as Access
    const service = await org.router.withPlatform((tx) => createServiceAccount(tx, { orgId: org.orgId, name: 'ci-bot', description: null, actorId: org.userId, actor: owner }))
    serviceAccountId = service.id
    users['ci-bot'] = { id: service.id, login: 'ci-bot' }
    await grant('ci-bot', null, 'reader')
  })
  afterAll(() => org?.drop())

  const tokenOf = async (prefix: string) =>
    (await org.db.admin.query<{ owner_id: string; read_only: boolean; dockets: string[] | null }>('SELECT owner_id, read_only, dockets FROM platform.api_tokens WHERE prefix = $1', [prefix])).rows[0]

  it('makes a personal token for this docket alone, whatever owner a form names', async () => {
    const result = (await actions.createToken!(event('developer', createTokenForm({ owner: serviceAccountId })) as never)) as { created?: { token: string; prefix: string } }
    expect(result.created?.token).toMatch(/^dkt_pat_/)
    expect(await tokenOf(result.created!.prefix)).toEqual({ owner_id: users.developer!.id, read_only: false, dockets: [wsId] })
  })

  it("makes a read-only member's token read-only, and one asked for read-only", async () => {
    const reader = (await actions.createToken!(event('reader', createTokenForm()) as never)) as { created?: { prefix: string } }
    expect(await tokenOf(reader.created!.prefix)).toMatchObject({ owner_id: users.reader!.id, read_only: true })
    const narrowed = (await actions.createToken!(event('developer', createTokenForm({ readOnly: 'on' })) as never)) as { created?: { prefix: string } }
    expect(await tokenOf(narrowed.created!.prefix)).toMatchObject({ read_only: true })
  })

  it("lists for a docket's admin everyone's tokens that reach it, and lets them revoke those that reach it alone", async () => {
    const data = (await load(event('developer') as never)) as { tokens: { id: string; owner: string; revocable: boolean; mine: boolean }[] }
    const others = data.tokens.filter((token) => !token.mine)
    expect(others.length).toBeGreaterThan(0)
    expect(others.every((token) => token.revocable)).toBe(true)
    const target = others[0]!
    const form = new FormData()
    form.set('token', target.id)
    const revoked = (await actions.revokeToken!(event('developer', form) as never)) as { flash?: string }
    expect(revoked.flash).toMatch(/^Revoked/)

    // A reader sees and revokes only their own.
    const reader = (await load(event('reader') as never)) as { tokens: { mine: boolean }[] }
    expect(reader.tokens.every((token) => token.mine)).toBe(true)
  })
})
