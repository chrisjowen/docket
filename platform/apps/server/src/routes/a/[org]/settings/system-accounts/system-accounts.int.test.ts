// SPDX-License-Identifier: AGPL-3.0-only
import { randomInt, randomUUID } from 'node:crypto'

import { tokenResolver } from '@docket/platform-auth'
import { insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { upsertGitHubUser } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Runtime } from '$lib/server/runtime'

let runtime: Runtime
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))
const list = await import('./+page.server')
const detail = await import('./[id]/+page.server')
const layout = await import('../../+layout.server')

// Settings › System accounts against real Postgres: the one place to make one and issue its tokens.
describe.skipIf(!TEST_PG_URL)('Settings › System accounts', () => {
  let org: TestOrg
  let slug: string
  let alpha: string
  let beta: string
  const users: Record<string, { id: string; login: string }> = {}

  /** A member holding `role` on the account (`docket` null) or on one docket. */
  async function member(name: string, role: string, docket: string | null = null) {
    const user = await org.router.withPlatform((tx) => upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login: `${name}-${org.orgId.slice(0, 4)}`, name: null, avatarUrl: null, emails: [] }))
    await org.db.app.query('INSERT INTO platform.memberships (org_id, user_id) VALUES ($1, $2)', [org.orgId, user.id])
    await org.db.app.query('INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id) VALUES ($1, $2, $3, $4, $5, $6)', [
      `g_${randomUUID()}`,
      org.orgId,
      user.id,
      docket ? 'docket' : 'account',
      docket,
      role,
    ])
    users[name] = { id: user.id, login: user.login }
  }

  function event(name: string, params: Record<string, string> = {}, form?: Record<string, string | string[]>): RequestEvent {
    const url = new URL(`https://docket.example/a/${slug}/settings/system-accounts`)
    let body: FormData | undefined
    if (form) {
      body = new FormData()
      for (const [key, value] of Object.entries(form)) for (const one of [value].flat()) body.append(key, one)
    }
    return {
      params: { org: slug, ...params },
      locals: { user: { ...users[name]!, name: null, avatarUrl: null, emails: [], allowlisted: false }, startedAt: performance.now(), requestId: randomUUID() },
      url,
      request: body ? new Request(url, { method: 'POST', body }) : new Request(url),
      getClientAddress: () => '192.0.2.1',
    } as unknown as RequestEvent
  }

  /** Runs an action that answers with a redirect, and returns where it went. */
  async function redirected(run: () => unknown): Promise<string> {
    try {
      await run()
    } catch (thrown) {
      if (isRedirect(thrown)) return thrown.location
      throw thrown
    }
    throw new Error('no redirect')
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
      caps: { status: async () => ({ spentUsd: 0, capUsd: 10, fraction: 0, warnedAt: null }) },
    } as unknown as Runtime
    alpha = (await org.withOrg((ctx) => insertWorkspace(ctx.tx, { name: 'Alpha', slug: 'alpha', createdBy: org.userId }))).id
    beta = (await org.withOrg((ctx) => insertWorkspace(ctx.tx, { name: 'Beta', slug: 'beta', createdBy: org.userId }))).id
    await member('admin', 'admin')
    await member('editor', 'writer')
    // Admin of alpha alone: manages system accounts there, and nowhere else.
    await member('lead', 'admin', alpha)
  })
  afterAll(() => org?.drop())

  it('is for those who manage system accounts or access somewhere: a writer is refused', async () => {
    await expect(list.load(event('editor') as never)).rejects.toSatisfy((thrown: unknown) => isHttpError(thrown) && thrown.status === 403)
  })

  it('makes a system account with no person acting for it, issues it a narrowed token, and tells the owners before it expires', async () => {
    const at = await redirected(() => list.actions.create!(event('admin', {}, { name: 'github-sync', description: 'Actions', role: 'writer', place: 'account' }) as never))
    const id = /system-accounts\/([^?]+)/.exec(at)?.[1] ?? ''
    expect(id).not.toBe('')
    const { rows } = await org.db.admin.query('SELECT kind, accountable_user_id, created_by FROM platform.users WHERE id = $1', [id])
    expect(rows).toEqual([{ kind: 'service', accountable_user_id: null, created_by: users.admin!.id }])

    const shown = (await detail.load(event('admin', { id }) as never)) as { account: { name: string; access: string }; reachable: { id: string }[]; mayChange: boolean }
    expect(shown.account.name).toBe('github-sync')
    expect(shown.account.access).toMatch(/^Writer on .+ \(the whole account\)$/)
    expect(shown.mayChange).toBe(true)
    expect(shown.reachable.map((docket) => docket.id).sort()).toEqual([alpha, beta].sort())

    const minted = (await detail.actions.createToken!(event('admin', { id }, { name: 'actions', days: '10', readOnly: 'on', reach: 'chosen', docket: [alpha] }) as never)) as {
      created?: { token: string; prefix: string }
    }
    expect(minted.created?.token).toMatch(/^dkt_sys_/)
    const resolver = tokenResolver({ platform: (fn) => org.router.withPlatform(fn) })
    const resource = (workspaceId: string, s: string) => ({ orgId: org.orgId, workspaceId, url: `https://docket.example/mcp/${slug}/${s}` })
    expect(await resolver.resolveBearer(minted.created!.token, resource(alpha, 'alpha'))).toMatchObject({ userId: id, readOnly: true, credentialName: 'actions' })
    expect(await resolver.resolveBearer(minted.created!.token, resource(beta, 'beta'))).toBeNull()
    // A year at most.
    expect(((await detail.actions.createToken!(event('admin', { id }, { name: 'long', days: '366', reach: 'all' }) as never)) as { status?: number }).status).toBe(400)

    // Owners get the notice, in the shell and on the page; an admin who is not an owner does not get the shell's.
    const owner = (await layout.load(event('owner') as never)) as { tokenNotices: { expiring: number; expired: number } }
    expect(owner.tokenNotices).toEqual({ expiring: 1, expired: 0 })
    const admin = (await layout.load(event('admin') as never)) as { tokenNotices: { expiring: number } }
    expect(admin.tokenNotices.expiring).toBe(0)
    const listed = (await list.load(event('owner') as never)) as { notices: { account: string; name: string | null }[] }
    expect(listed.notices).toEqual([expect.objectContaining({ account: 'github-sync', name: 'actions' })])

    // Revoking ends it; removing the account ends the rest.
    const tokenId = ((await detail.load(event('admin', { id }) as never)) as { tokens: { id: string }[] }).tokens[0]!.id
    expect(((await detail.actions.revokeToken!(event('admin', { id }, { token: tokenId }) as never)) as { flash?: string }).flash).toMatch(/^Revoked/)
    expect(await tokenResolver({ platform: (fn) => org.router.withPlatform(fn) }).resolveBearer(minted.created!.token, resource(alpha, 'alpha'))).toBeNull()
    expect(await redirected(() => detail.actions.remove!(event('admin', { id }, {}) as never))).toBe(`/a/${slug}/settings/system-accounts`)
    const { rows: gone } = await org.db.admin.query('SELECT 1 FROM platform.users WHERE id = $1', [id])
    expect(gone).toEqual([])
  })

  it('lets a docket\'s admin make one that reaches that docket only, and never more than they hold', async () => {
    const offered = (await list.load(event('lead') as never)) as { places: { key: string }[] }
    expect(offered.places.map((place) => place.key)).toEqual([`docket:${alpha}`])
    const refused = (await list.actions.create!(event('lead', {}, { name: 'too-wide', role: 'reader', place: 'account' }) as never)) as { status?: number }
    expect(refused.status).toBe(403)
    const at = await redirected(() => list.actions.create!(event('lead', {}, { name: 'alpha-sync', role: 'writer', place: `docket:${alpha}` }) as never))
    const id = /system-accounts\/([^?]+)/.exec(at)?.[1] ?? ''
    const shown = (await detail.load(event('lead', { id }) as never)) as { reachable: { id: string }[]; mayChange: boolean }
    expect(shown.reachable.map((docket) => docket.id)).toEqual([alpha])
    expect(shown.mayChange).toBe(true)
    // Giving it beta is refused: the lead manages nothing there.
    await expect(detail.actions.give!(event('lead', { id }, { role: 'reader', place: `docket:${beta}` }) as never)).rejects.toSatisfy(
      (thrown: unknown) => isHttpError(thrown) && thrown.status === 403,
    )
  })

  it('hides a system account from a manager whose docket it does not reach, and answers 404 for its page', async () => {
    await member('outsider', 'admin', beta)
    const at = await redirected(() => list.actions.create!(event('lead', {}, { name: 'alpha-reach', role: 'writer', place: `docket:${alpha}` }) as never))
    const id = /system-accounts\/([^?]+)/.exec(at)?.[1] ?? ''

    const asOutsider = (await list.load(event('outsider') as never)) as { accounts: { id: string }[] }
    expect(asOutsider.accounts.map((account) => account.id)).not.toContain(id)
    await expect(detail.load(event('outsider', { id }) as never)).rejects.toSatisfy((thrown: unknown) => isHttpError(thrown) && thrown.status === 404)

    const asLead = (await list.load(event('lead') as never)) as { accounts: { id: string }[] }
    expect(asLead.accounts.map((account) => account.id)).toContain(id)
    await expect(detail.load(event('lead', { id }) as never)).resolves.toMatchObject({ account: { id } })
  })
})
