// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { membershipBySlug } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Runtime } from '$lib/server/runtime'

let runtime: Runtime
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))
const page = await import('./+page.server')
const console_ = await import('../+page.server')

// The operator console's page (tenancy v2 phase 6.3) against real Postgres: for the platform's operators alone.
describe.skipIf(!TEST_PG_URL)('the operator console page', () => {
  let org: TestOrg
  let operator: { id: string; login: string }

  function event(who: { id: string; login: string }, form?: Record<string, string>): RequestEvent {
    const url = new URL('https://docket.example/admin/accounts')
    let body: FormData | undefined
    if (form) {
      body = new FormData()
      for (const [key, value] of Object.entries(form)) body.append(key, value)
    }
    return {
      params: {},
      locals: { user: { ...who, name: null, avatarUrl: null, emails: [], allowlisted: false }, startedAt: performance.now(), requestId: randomUUID() },
      url,
      request: body ? new Request(url, { method: 'POST', body }) : new Request(url),
      getClientAddress: () => '192.0.2.1',
    } as unknown as RequestEvent
  }
  async function outcome(call: () => unknown): Promise<{ status: number; location?: string; data?: any }> {
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
    const other = await org.addOrg()
    operator = { id: other.userId, login: other.login }
    runtime = { router: org.router, keyring: org.keyring, origin: 'https://docket.example', maxOrgs: 8, platformAdmins: new Set([other.login]) } as unknown as Runtime
  })
  afterAll(() => org?.drop())

  it('is not there for anyone but an operator, an account owner included', async () => {
    const owner = { id: org.userId, login: org.login }
    expect(await outcome(() => page.load(event(owner) as never))).toEqual({ status: 404 })
    expect(await outcome(() => console_.load(event(owner) as never))).toEqual({ status: 404 })
    expect((await outcome(() => page.actions.suspend!(event(owner, { account: `o-${org.orgId}` }) as never))).status).toBe(404)
    expect(await outcome(() => console_.load(event(operator) as never))).toEqual({ status: 307, location: '/admin/accounts' })
  })

  it('lists the accounts, sets limits, and suspends and resumes one', async () => {
    const slug = `o-${org.orgId}`
    const listed = (await outcome(() => page.load(event(operator) as never))).data
    expect(listed.platform).toEqual({ live: 2, max: 8 })
    expect(listed.accounts.find((each: { slug: string }) => each.slug === slug)).toMatchObject({ owners: [org.login], people: 1, status: 'active' })

    expect((await outcome(() => page.actions.limits!(event(operator, { account: slug, max_members: '40', max_dockets: '' }) as never))).data).toMatchObject({
      flash: "Set Test org's limits.",
    })
    expect((await outcome(() => page.load(event(operator) as never))).data.accounts.find((each: { slug: string }) => each.slug === slug).limits).toEqual({
      maxMembers: 40,
      maxDockets: null,
    })
    expect((await outcome(() => page.actions.limits!(event(operator, { account: slug, max_members: 'many' }) as never))).data).toMatchObject({ status: 400 })

    await outcome(() => page.actions.suspend!(event(operator, { account: slug, reason: 'Abuse report' }) as never))
    expect(await org.router.withPlatform((tx) => membershipBySlug(tx, slug, org.userId))).toBeNull()
    const shown = (await outcome(() => page.load(event(operator) as never))).data.accounts.find((each: { slug: string }) => each.slug === slug)
    expect(shown).toMatchObject({ status: 'suspended', suspended: { by: operator.login, reason: 'Abuse report' } })
    await outcome(() => page.actions.resume!(event(operator, { account: slug }) as never))
    expect(await org.router.withPlatform((tx) => membershipBySlug(tx, slug, org.userId))).not.toBeNull()

    const { rows } = await org.db.admin.query<{ actor: string }>("SELECT actor FROM platform.audit_event WHERE action = 'operator.account.update' ORDER BY seq")
    expect(rows.map((row) => row.actor)).toEqual([`user:${operator.id}`, `user:${operator.id}`, `user:${operator.id}`])
  })
})
