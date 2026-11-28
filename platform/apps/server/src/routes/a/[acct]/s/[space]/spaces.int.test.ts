// SPDX-License-Identifier: AGPL-3.0-only
import { randomInt, randomUUID } from 'node:crypto'

import { insertWorkspace, listSpaces, listWorkspaces } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { accessOf, capsAt, docketPlace, listGrants, openInvitesOf, spacePlace, upsertGitHubUser } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { memoryMailer } from '$lib/server/mail'
import type { Runtime } from '$lib/server/runtime'

let runtime: Runtime
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))
const newSpace = await import('../../spaces/new/+page.server')
const spacePage = await import('./+page.server')
const spaceAccessPage = await import('./access/+page.server')
const newDocket = await import('./new/+page.server')
const oldNewDocket = await import('../../dockets/new/+server')
const orgLayout = await import('../../+layout.server')

// Spaces (tenancy v2 phase 3) against real Postgres: who makes spaces and adds dockets to them, and what a role on one reaches.
describe.skipIf(!TEST_PG_URL)('spaces', () => {
  let org: TestOrg
  let slug: string
  const users: Record<string, { id: string; login: string }> = {}

  async function member(name: string) {
    const user = await org.router.withPlatform((tx) =>
      upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login: `${name}-${org.orgId.slice(0, 4)}`, name: null, avatarUrl: null, emails: [] }),
    )
    await org.db.app.query('INSERT INTO platform.memberships (org_id, user_id) VALUES ($1, $2)', [org.orgId, user.id])
    users[name] = { id: user.id, login: user.login }
  }
  const grant = (name: string, kind: 'account' | 'space' | 'docket', place: string | null, role: string) =>
    org.db.app.query('INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id) VALUES ($1, $2, $3, $4, $5, $6)', [
      `g_${randomUUID()}`,
      org.orgId,
      users[name]!.id,
      kind,
      place,
      role,
    ])

  function event(name: string, path: string, params: Record<string, string> = {}, form?: Record<string, string | string[]>): RequestEvent {
    const url = new URL(`https://docket.example/a/${slug}${path}`)
    let body: FormData | undefined
    if (form) {
      body = new FormData()
      for (const [key, value] of Object.entries(form)) for (const each of Array.isArray(value) ? value : [value]) body.append(key, each)
    }
    return {
      params: { acct: slug, ...params },
      locals: { user: { ...users[name]!, name: null, avatarUrl: null, emails: [], allowlisted: false }, startedAt: performance.now(), requestId: randomUUID() },
      url,
      request: body ? new Request(url, { method: 'POST', body }) : new Request(url),
      getClientAddress: () => '192.0.2.1',
    } as unknown as RequestEvent
  }

  /** How a call ends: 200, an error's status, or a redirect's status and location. */
  async function outcome(call: () => unknown): Promise<{ status: number; location?: string; data?: unknown }> {
    try {
      return { status: 200, data: await call() }
    } catch (thrown) {
      if (isHttpError(thrown)) return { status: thrown.status }
      if (isRedirect(thrown)) return { status: thrown.status, location: thrown.location }
      throw thrown
    }
  }

  const caps = async (name: string, docketSlug: string) => {
    const ws = (await org.withOrg(({ tx }) => listWorkspaces(tx))).find((each) => each.slug === docketSlug)!
    return [...capsAt(await org.router.withPlatform((tx) => accessOf(tx, org.orgId, users[name]!.id)), docketPlace(ws.id))].sort()
  }

  beforeAll(async () => {
    org = await createTestOrg()
    slug = `o-${org.orgId}`
    users.owner = { id: org.userId, login: org.login }
    runtime = {
      router: org.router,
      keyring: org.keyring,
      origin: 'https://docket.example',
      caps: { status: async () => ({ spentUsd: 0, capUsd: 10, fraction: 0, warnedAt: null }) },
      mailer: memoryMailer(),
    } as unknown as Runtime
    await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Handbook', slug: 'handbook', createdBy: org.userId }))
    for (const name of ['admin', 'lead', 'writer', 'carol', 'dana']) await member(name)
    await grant('admin', 'account', null, 'admin')
    await grant('writer', 'space', 'general', 'writer')
  })
  afterAll(() => org?.drop())

  it('admins on the account make spaces; nobody else does', async () => {
    expect(await outcome(() => newSpace.load(event('writer', '/spaces/new') as never))).toEqual({ status: 403 })
    expect((await outcome(() => newSpace.actions.default!(event('writer', '/spaces/new', {}, { name: 'Sneaky', slug: 'sneaky' }) as never))).status).toBe(403)
    expect(await outcome(() => newSpace.actions.default!(event('admin', '/spaces/new', {}, { name: 'Engineering', slug: 'engineering', description: 'Platform and payments' }) as never))).toEqual({
      status: 303,
      location: `/a/${slug}/s/engineering/access`,
    })
    const spaces = await org.withOrg(({ tx }) => listSpaces(tx))
    expect(spaces.map((space) => [space.slug, space.general])).toEqual([
      ['general', true],
      ['engineering', false],
    ])
    // A taken address is a problem to fix, not an error.
    expect((await outcome(() => newSpace.actions.default!(event('admin', '/spaces/new', {}, { name: 'Again', slug: 'engineering' }) as never))).data).toMatchObject({
      status: 400,
      data: { problem: 'A space already has that address.' },
    })
  })

  it('New docket takes Create dockets on its space, puts the docket there, and gives its initial access as the creator', async () => {
    const eng = (await org.withOrg(({ tx }) => listSpaces(tx))).find((space) => space.slug === 'engineering')!
    // Lead is Admin on Engineering alone.
    await grant('lead', 'space', eng.id, 'admin')
    const at = (space: string) => ['/s/' + space + '/new', { space }] as const
    expect((await outcome(() => newDocket.load(event('lead', ...at('engineering')) as never))).status).toBe(200)
    expect((await outcome(() => newDocket.load(event('lead', ...at('general')) as never))).status).toBe(403)
    expect((await outcome(() => newDocket.load(event('writer', ...at('engineering')) as never))).status).toBe(403)
    expect((await outcome(() => newDocket.load(event('writer', ...at('nowhere')) as never))).status).toBe(404)

    // Lead may give what they hold on Engineering, to people and to everyone.
    const loaded = (await outcome(() => newDocket.load(event('lead', ...at('engineering')) as never))).data as {
      initialAccess: { gives: boolean; people: { id: string }[]; roles: { id: string }[] }
    }
    expect(loaded.initialAccess.gives).toBe(true)
    expect(loaded.initialAccess.people.map((person) => person.id)).toContain('everyone')
    expect(loaded.initialAccess.roles.map((role) => role.id)).toEqual(['reader', 'writer', 'admin'])

    const made = await outcome(() =>
      newDocket.actions.default!(
        event('lead', ...at('engineering'), { name: 'Payments', slug: 'payments', start: 'template', template: 'sdlc', access_who: [users.carol!.id], access_role: ['reader'] }) as never,
      ),
    )
    expect(made).toEqual({ status: 303, location: `/a/${slug}/d/payments/ontology` })
    const payments = (await org.withOrg(({ tx }) => listWorkspaces(tx))).find((each) => each.slug === 'payments')!
    expect(payments.spaceId).toBe(eng.id)
    const given = await org.router.withPlatform((tx) => listGrants(tx, org.orgId, { place: docketPlace(payments.id) }))
    expect(given.map((each) => [each.who, each.role.id])).toEqual([[{ kind: 'user', id: users.carol!.id }, 'reader']])

    // A role on the space covers the docket; General's grants do not; the initial grant adds Carol.
    expect((await caps('lead', 'payments')).length).toBe(12)
    expect(await caps('writer', 'payments')).toEqual([])
    expect(await caps('carol', 'payments')).toEqual(['read'])
    // Everyone reads General, by default; the lead too.
    expect(await caps('dana', 'handbook')).toEqual(['read'])

    // Nobody gives initial access they do not hold, nor to someone not offered.
    const refused = await outcome(() =>
      newDocket.actions.default!(
        event('lead', ...at('engineering'), { name: 'Incidents', slug: 'incidents', start: 'template', template: 'sdlc', access_who: ['not-a-member'], access_role: ['reader'] }) as never,
      ),
    )
    expect(refused.data).toMatchObject({ status: 400, data: { problem: 'Choose who gets access, and a role you can give them here.' } })
    expect((await org.withOrg(({ tx }) => listWorkspaces(tx))).some((each) => each.slug === 'incidents')).toBe(false)
  })

  it("a space's access page gives roles on the space, and whoever manages access there invites new people into it", async () => {
    const params = { space: 'engineering' }
    const reach = (await outcome(() => spaceAccessPage.load(event('lead', '/s/engineering/access', params) as never))).data as {
      manages: boolean
      reach: { login: string; because: string[] }[]
      invites: boolean
    }
    expect(reach.manages).toBe(true)
    expect(reach.invites).toBe(true)
    expect(reach.reach.find((row) => row.login === users.lead!.login)?.because).toEqual(['Admin on this space'])
    expect(reach.reach.find((row) => row.login === users.admin!.login)?.because).toEqual([`Admin on Test org (the whole account)`])

    await spaceAccessPage.actions.give!(event('lead', '/s/engineering/access', params, { who: users.dana!.id, role: 'writer' }) as never)
    expect(await caps('dana', 'payments')).toEqual(['propose', 'read', 'write'])

    const invited = await outcome(() => spaceAccessPage.actions.invite!(event('lead', '/s/engineering/access', params, { who: 'newcomer', role: 'reader' }) as never))
    expect(invited.data).toMatchObject({
      flash: 'Invited @newcomer as Reader on Engineering. Pass the link on to them: it works once, for 7 days.',
      invited: { to: '@newcomer', gives: 'Reader on Engineering', emailedTo: null, link: expect.stringMatching(/^https:\/\/docket\.example\/invite\/dki_[\w-]{32}$/) },
    })
    const invites = await org.router.withPlatform((tx) => openInvitesOf(tx, org.orgId))
    const eng = (await org.withOrg(({ tx }) => listSpaces(tx))).find((space) => space.slug === 'engineering')!
    expect(invites.map((invite) => [invite.githubLogin, invite.place])).toEqual([['newcomer', spacePlace(eng.id)]])

    // A Writer on General neither manages nor invites there.
    const asWriter = (await outcome(() => spaceAccessPage.load(event('writer', '/s/general/access', { space: 'general' }) as never))).data as { manages: boolean; invites: boolean }
    expect(asWriter).toMatchObject({ manages: false, invites: false })
    expect((await outcome(() => spaceAccessPage.actions.invite!(event('writer', '/s/general/access', { space: 'general' }, { who: 'x', role: 'reader' }) as never))).status).toBe(403)
  })

  it('lists spaces and their dockets for the sidebar, and keeps the old New docket address', async () => {
    const layout = (await outcome(() => orgLayout.load(event('lead', '') as never))).data as {
      spaces: { slug: string; create: boolean }[]
      dockets: { slug: string; spaceId: string; open: boolean }[]
      createsSpaces: boolean
      createsDockets: boolean
    }
    expect(layout.spaces.map((space) => [space.slug, space.create])).toEqual([
      ['general', false],
      ['engineering', true],
    ])
    expect(layout.createsSpaces).toBe(false)
    expect(layout.createsDockets).toBe(true)
    expect((await outcome(() => spacePage.load(event('lead', '/s/engineering', { space: 'engineering' }) as never))).data).toMatchObject({
      inSpace: [{ slug: 'payments', open: true }],
      you: 'Admin',
    })
    // The old address opens New docket where the member may add one: General first, else the first such space.
    expect(await outcome(() => oldNewDocket.GET(event('owner', '/workspaces/new') as never))).toEqual({ status: 303, location: `/a/${slug}/s/general/new` })
    expect(await outcome(() => oldNewDocket.GET(event('lead', '/workspaces/new') as never))).toEqual({ status: 303, location: `/a/${slug}/s/engineering/new` })
    expect(await outcome(() => oldNewDocket.GET(event('writer', '/workspaces/new') as never))).toEqual({ status: 403 })
  })
})
