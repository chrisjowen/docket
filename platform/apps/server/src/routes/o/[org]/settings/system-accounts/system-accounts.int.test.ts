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

  async function member(name: string, role: string) {
    const user = await org.router.withPlatform((tx) => upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login: `${name}-${org.orgId.slice(0, 4)}`, name: null, avatarUrl: null, emails: [] }))
    await org.db.app.query('INSERT INTO platform.memberships (org_id, user_id, role) VALUES ($1, $2, $3)', [org.orgId, user.id, role])
    users[name] = { id: user.id, login: user.login }
  }

  function event(name: string, params: Record<string, string> = {}, form?: Record<string, string | string[]>): RequestEvent {
    const url = new URL(`https://docket.example/o/${slug}/settings/system-accounts`)
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
    await member('admin', 'admin')
    await member('editor', 'editor')
    alpha = (await org.withOrg((ctx) => insertWorkspace(ctx.tx, { name: 'Alpha', slug: 'alpha', createdBy: org.userId }))).id
    beta = (await org.withOrg((ctx) => insertWorkspace(ctx.tx, { name: 'Beta', slug: 'beta', createdBy: org.userId }))).id
  })
  afterAll(() => org?.drop())

  it('is for those who manage access: an editor is refused', async () => {
    await expect(list.load(event('editor') as never)).rejects.toSatisfy((thrown: unknown) => isHttpError(thrown) && thrown.status === 403)
  })

  it('makes a system account with no person acting for it, issues it a narrowed token, and tells the owners before it expires', async () => {
    const at = await redirected(() => list.actions.create!(event('admin', {}, { name: 'github-sync', description: 'Actions', role: 'editor' }) as never))
    const id = /system-accounts\/([^?]+)/.exec(at)?.[1] ?? ''
    expect(id).not.toBe('')
    const { rows } = await org.db.admin.query('SELECT kind, accountable_user_id, created_by FROM platform.users WHERE id = $1', [id])
    expect(rows).toEqual([{ kind: 'service', accountable_user_id: null, created_by: users.admin!.id }])

    const shown = (await detail.load(event('admin', { id }) as never)) as { account: { name: string; access: string }; dockets: { id: string }[]; mayChange: boolean }
    expect(shown.account).toMatchObject({ name: 'github-sync', access: 'Writer: reads and writes every docket' })
    expect(shown.mayChange).toBe(true)
    expect(shown.dockets.map((docket) => docket.id).sort()).toEqual([alpha, beta].sort())

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
    expect(await redirected(() => detail.actions.remove!(event('admin', { id }, {}) as never))).toBe(`/o/${slug}/settings/system-accounts`)
    const { rows: gone } = await org.db.admin.query('SELECT 1 FROM platform.users WHERE id = $1', [id])
    expect(gone).toEqual([])
  })
})
