// SPDX-License-Identifier: AGPL-3.0-only
import { randomInt, randomUUID } from 'node:crypto'

import { insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { upsertGitHubUser } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import type { RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Runtime } from '$lib/server/runtime'

let runtime: Runtime
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))
const page = await import('./+page.server')

// Users (tenancy v2 §3) against real Postgres: what a docket-only manager may see and do there.
describe.skipIf(!TEST_PG_URL)('Users page', () => {
  let org: TestOrg
  let slug: string
  let alpha: string
  const users: Record<string, { id: string; login: string }> = {}

  /** A member holding `role` on the account (`docket` null) or on one docket, with an email if given one. */
  async function member(name: string, role: string | null, docket: string | null = null, email: string | null = null) {
    const user = await org.router.withPlatform((tx) =>
      upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login: `${name}-${org.orgId.slice(0, 4)}`, name: null, avatarUrl: null, emails: email ? [email] : [] }),
    )
    await org.db.app.query('INSERT INTO platform.memberships (org_id, user_id) VALUES ($1, $2)', [org.orgId, user.id])
    if (role) {
      await org.db.app.query('INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id) VALUES ($1, $2, $3, $4, $5, $6)', [
        `g_${randomUUID()}`,
        org.orgId,
        user.id,
        docket ? 'docket' : 'account',
        docket,
        role,
      ])
    }
    users[name] = { id: user.id, login: user.login }
  }

  function event(name: string, form?: Record<string, string>): RequestEvent {
    const url = new URL(`https://docket.example/o/${slug}/members`)
    const body = form ? new FormData() : undefined
    if (form && body) for (const [key, value] of Object.entries(form)) body.append(key, value)
    return {
      params: { org: slug },
      locals: { user: { ...users[name]!, name: null, avatarUrl: null, emails: [], allowlisted: false }, startedAt: performance.now(), requestId: randomUUID() },
      url,
      request: body ? new Request(url, { method: 'POST', body }) : new Request(url),
      getClientAddress: () => '192.0.2.1',
    } as unknown as RequestEvent
  }

  beforeAll(async () => {
    org = await createTestOrg()
    slug = `o-${org.orgId}`
    users.owner = { id: org.userId, login: org.login }
    runtime = { router: org.router, keyring: org.keyring, origin: 'https://docket.example' } as unknown as Runtime
    alpha = (await org.withOrg((ctx) => insertWorkspace(ctx.tx, { name: 'Alpha', slug: 'alpha', createdBy: org.userId }))).id
    // Admin of alpha alone: manages access there, and nowhere else.
    await member('lead', 'admin', alpha)
    await member('carol', null, null, 'carol@example.com')
  })
  afterAll(() => org?.drop())

  it("shows a docket-only manager only the invites for places they manage, and no other member's email", async () => {
    await page.actions.invite!(event('owner', { who: 'wide-target', role: 'writer', place: 'account' }) as never)
    await page.actions.invite!(event('lead', { who: 'alpha-target', role: 'writer', place: `docket:${alpha}` }) as never)

    const asLead = (await page.load(event('lead') as never)) as {
      invites: { githubLogin: string | null }[]
      people: { login: string; email: string | null }[]
    }
    expect(asLead.invites.map((invite) => invite.githubLogin)).toEqual(['alpha-target'])
    expect(asLead.people.find((person) => person.login === users.carol!.login)?.email).toBeNull()

    const asOwner = (await page.load(event('owner') as never)) as {
      invites: { githubLogin: string | null }[]
      people: { login: string; email: string | null }[]
    }
    expect(asOwner.invites.map((invite) => invite.githubLogin).sort()).toEqual(['alpha-target', 'wide-target'])
    expect(asOwner.people.find((person) => person.login === users.carol!.login)?.email).toBe('carol@example.com')
  })
})
