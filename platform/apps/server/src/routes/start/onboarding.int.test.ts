// SPDX-License-Identifier: AGPL-3.0-only
import { randomInt, randomUUID, webcrypto } from 'node:crypto'

import { keyring, listSpaces, listWorkspaces } from '@docket/platform-canonical-store'
import { platformKeyService } from '@docket/platform-keys'
import { postgresProvisioner } from '@docket/platform-provisioner'
import { allowlist, listGrants, listMembers, openInvitesOf, spacePlace, tenantRouter, upsertGitHubUser, type TenantRouter } from '@docket/platform-tenancy'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'
import { isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { memoryMailer } from '$lib/server/mail'
import type { Runtime } from '$lib/server/runtime'

let runtime: Runtime
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))
const start = await import('./+page.server')
const space = await import('../a/[org]/start/space/+page.server')
const docket = await import('../a/[org]/start/docket/+page.server')
const newDocket = await import('../a/[org]/s/[space]/new/+page.server')
const connect = await import('../a/[org]/start/connect/+page.server')
const invite = await import('../a/[org]/start/invite/+page.server')
const invitePage = await import('../invite/[link]/+page.server')

// Signing up (tenancy v2 §6) against real Postgres, step by step: account, General and more spaces, the
// first docket on New docket, connecting, inviting by link and email, and landing in the docket's Chat.
describe.skipIf(!TEST_PG_URL)('signing up', () => {
  let db: TestDatabase
  let router: TenantRouter
  const mailer = memoryMailer()
  const slug = `acme-${randomInt(1e6, 9e6)}`
  const users: Record<string, { id: string; login: string; emails: string[]; allowlisted: boolean }> = {}

  async function person(name: string, options: { allowlisted?: boolean; emails?: string[] } = {}) {
    const login = `${name}-${slug.slice(5)}`
    const user = await router.withPlatform(async (tx) => {
      if (options.allowlisted) await allowlist(tx, [login])
      return upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login, name: null, avatarUrl: null, emails: options.emails ?? [] })
    })
    users[name] = { id: user.id, login, emails: options.emails ?? [], allowlisted: options.allowlisted ?? false }
  }

  function event(name: string | null, path: string, options: { params?: Record<string, string>; form?: Record<string, string | string[]>; parent?: unknown } = {}): RequestEvent {
    const url = new URL(`https://docket.example${path}`)
    let body: FormData | undefined
    if (options.form) {
      body = new FormData()
      for (const [key, value] of Object.entries(options.form)) for (const each of Array.isArray(value) ? value : [value]) body.append(key, each)
    }
    const user = name ? { ...users[name]!, name: null, avatarUrl: null } : null
    const cookies = new Map<string, string>()
    return {
      params: { org: slug, ...options.params },
      locals: { user, startedAt: performance.now(), requestId: randomUUID(), csrf: null },
      url,
      request: body ? new Request(url, { method: 'POST', body }) : new Request(url),
      cookies: { get: (key: string) => cookies.get(key), set: (key: string, value: string) => cookies.set(key, value), delete: (key: string) => cookies.delete(key) },
      parent: async () => options.parent ?? {},
      getClientAddress: () => '192.0.2.1',
    } as unknown as RequestEvent
  }

  /** How a call ends: 200 and its data, an error's status, or a redirect's status and location. */
  async function outcome(call: () => unknown): Promise<{ status: number; location?: string; data?: any }> {
    try {
      return { status: 200, data: await call() }
    } catch (thrown) {
      if (isHttpError(thrown)) return { status: thrown.status }
      if (isRedirect(thrown)) return { status: thrown.status, location: thrown.location }
      throw thrown
    }
  }
  const at = (step: string) => `/a/${slug}/start/${step}`

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
    const keys = await platformKeyService({ kek: webcrypto.getRandomValues(new Uint8Array(32)), kekId: 'test' })
    runtime = {
      router,
      keyring: keyring({ keys, platform: (fn) => router.withPlatform(fn) }),
      provisioner: postgresProvisioner({ admin: db.admin, keys, appRole: db.appRole }),
      origin: 'https://docket.example',
      maxOrgs: 100,
      mailer,
      secureCookies: true,
    } as unknown as Runtime
    await person('owner', { allowlisted: true })
    await person('stranger')
    await person('pat', { emails: ['pat@personal.example'] })
    await person('sam')
  })
  afterAll(() => db?.drop())

  it('steps 1 and 2: signs in first, then makes the account, its owner the one who made it; only from the beta list', async () => {
    expect(await outcome(() => start.load(event(null, '/start') as never))).toEqual({ status: 303, location: '/signin?next=%2Fstart' })
    const page = (await outcome(() => start.load(event('owner', '/start') as never))).data
    expect(page).toMatchObject({ allowlisted: true, full: false, invites: [], aiCapUsd: expect.any(Number) })

    const refused = await outcome(() => start.actions.create!(event('stranger', '/start?/create', { form: { name: 'Nope', slug: `nope-${slug}` } }) as never))
    expect(refused.data).toMatchObject({ status: 403, data: { problem: expect.stringContaining('beta list') } })

    expect(await outcome(() => start.actions.create!(event('owner', '/start?/create', { form: { name: 'Acme Wizard', slug } }) as never))).toEqual({
      status: 303,
      location: at('space'),
    })
    const orgId = (await db.admin.query('SELECT id FROM platform.orgs WHERE slug = $1', [slug])).rows[0].id as string
    expect((await router.withPlatform((tx) => listMembers(tx, orgId))).map((member) => [member.login, member.owner])).toEqual([[users.owner!.login, true]])
  })

  it('step 3: General, where everyone gets Reader unless chosen otherwise, and more spaces; only an admin of the account sets it up', async () => {
    expect((await outcome(() => space.load(event('stranger', at('space')) as never))).status).toBe(404)
    const loaded = (await outcome(() => space.load(event('owner', at('space')) as never))).data
    expect(loaded).toMatchObject({ everyone: 'reader', spaces: [{ slug: 'general', name: 'General', general: true }] })

    // A name that cannot be a space is shown, and nothing changes.
    const clash = await outcome(() => space.actions.default!(event('owner', at('space'), { form: { everyone: 'writer', space: ['Legal', 'legal!'] } }) as never))
    expect(clash.data).toMatchObject({ status: 400, data: { problem: expect.stringContaining('Two spaces') } })

    expect(await outcome(() => space.actions.default!(event('owner', at('space'), { form: { everyone: 'writer', space: ['Engineering', 'Legal', ''] } }) as never))).toEqual({
      status: 303,
      location: at('docket'),
    })
    const orgId = (await db.admin.query('SELECT id FROM platform.orgs WHERE slug = $1', [slug])).rows[0].id as string
    const spaces = await router.withTenant(orgId, listSpaces)
    expect(spaces.map((each) => each.slug)).toEqual(['general', 'engineering', 'legal'])
    const onGeneral = await router.withPlatform((tx) => listGrants(tx, orgId, { place: spacePlace('general') }))
    expect(onGeneral.filter((grant) => grant.who.kind === 'everyone').map((grant) => grant.role.id)).toEqual(['writer'])

    // Nothing for everyone takes the grant away.
    await outcome(() => space.actions.default!(event('owner', at('space'), { form: { everyone: 'none' } }) as never))
    expect((await router.withPlatform((tx) => listGrants(tx, orgId, { place: spacePlace('general') }))).some((grant) => grant.who.kind === 'everyone')).toBe(false)
    await outcome(() => space.actions.default!(event('owner', at('space'), { form: { everyone: 'reader' } }) as never))
    expect((await outcome(() => space.load(event('owner', at('space')) as never))).data.everyone).toBe('reader')
  })

  it('step 4: the same New docket page, from General, which then goes on to step 5', async () => {
    expect(await outcome(() => docket.load(event('owner', at('docket')) as never))).toEqual({ status: 307, location: `/a/${slug}/s/general/new?start=1` })
    const newPage = `/a/${slug}/s/general/new?start=1`
    expect((await outcome(() => newDocket.load(event('owner', newPage, { params: { space: 'general' } }) as never))).data).toMatchObject({ onboarding: true })
    expect(
      await outcome(() =>
        newDocket.actions.default!(event('owner', newPage, { params: { space: 'general' }, form: { name: 'Payments', slug: 'payments', start: 'template', template: 'sdlc' } }) as never),
      ),
    ).toEqual({ status: 303, location: `${at('connect')}?docket=payments` })
    // Outside signing up, New docket still opens the docket's schema.
    expect(
      await outcome(() =>
        newDocket.actions.default!(
          event('owner', `/a/${slug}/s/general/new`, { params: { space: 'general' }, form: { name: 'Handbook', slug: 'handbook', start: 'template', template: 'sdlc' } }) as never,
        ),
      ),
    ).toEqual({ status: 303, location: `/a/${slug}/d/handbook/ontology` })
  })

  it("step 5: connect an AI client at the account's one MCP address", async () => {
    expect((await outcome(() => connect.load(event('owner', `${at('connect')}?docket=payments`) as never))).data).toEqual({
      endpoint: `https://docket.example/mcp/${slug}`,
      docket: 'payments',
    })
  })

  it('step 6: invites one row each, all or none, by link and by email; step 7 lands in the docket’s Chat', async () => {
    const page = `${at('invite')}?docket=payments`
    const loaded = (await outcome(() => invite.load(event('owner', page) as never))).data
    expect(loaded.done).toBe(`/a/${slug}/d/payments/ask`)
    expect(loaded.places.map((place: { key: string }) => place.key)).toContain('space:general')
    const payments = loaded.firstDocket.place as string

    // A row that cannot be an invite sends none of them.
    const bad = await outcome(() =>
      invite.actions.default!(event('owner', page, { form: { who: ['pat@corp.example', 'not a login!'], role: ['reader', 'writer'], place: ['space:general', payments] } }) as never),
    )
    expect(bad.data).toMatchObject({ status: 400, data: { problem: expect.stringMatching(/^Row 2 \(not a login!\)/) } })
    const orgId = (await db.admin.query('SELECT id FROM platform.orgs WHERE slug = $1', [slug])).rows[0].id as string
    expect(await router.withPlatform((tx) => openInvitesOf(tx, orgId))).toEqual([])

    const sent = await outcome(() =>
      invite.actions.default!(
        event('owner', page, { form: { who: ['pat@corp.example', users.sam!.login, ''], role: ['reader', 'writer', 'reader'], place: ['space:general', payments, 'account'] } }) as never,
      ),
    )
    const invited = sent.data.invited as { to: string; gives: string; link: string; emailedTo: string | null }[]
    expect(invited.map((each) => [each.to, each.gives, each.emailedTo])).toEqual([
      ['pat@corp.example', 'Reader on General (space)', 'pat@corp.example'],
      [`@${users.sam!.login}`, 'Writer on Payments (docket)', null],
    ])
    expect(mailer.sent).toEqual([
      expect.objectContaining({ to: 'pat@corp.example', subject: `@${users.owner!.login} invited you to Acme Wizard on Docket`, text: expect.stringContaining(invited[0]!.link) }),
    ])

    // Pat opens the emailed link signed out, signs in as whoever GitHub knows them by, and joins.
    const link = invited[0]!.link.split('/invite/')[1]!
    const signedOut = (await outcome(() => invitePage.load(event(null, `/invite/${link}`, { params: { link } }) as never))).data
    expect(signedOut).toMatchObject({ signedIn: false, next: `/invite/${link}`, invite: { accountName: 'Acme Wizard', gives: 'Reader on General (space)', state: 'open', mine: false } })
    expect((await outcome(() => invitePage.load(event('pat', `/invite/${link}`, { params: { link } }) as never))).data.invite.mine).toBe(true)
    expect(await outcome(() => invitePage.actions.accept!(event('pat', `/invite/${link}?/accept`, { params: { link }, form: {} }) as never))).toEqual({
      status: 303,
      location: `/a/${slug}/s/general`,
    })
    expect((await router.withPlatform((tx) => listMembers(tx, orgId))).map((member) => member.login)).toContain(users.pat!.login)
    // It worked once.
    expect((await outcome(() => invitePage.actions.accept!(event('stranger', `/invite/${link}?/accept`, { params: { link }, form: {} }) as never))).data).toMatchObject({
      status: 400,
    })
    expect((await outcome(() => invitePage.load(event('stranger', `/invite/${link}`, { params: { link } }) as never))).data.invite.state).toBe('accepted')

    // An invite to a login is that login's: anyone else holding its link is refused, and Sam lands in the docket.
    const samLink = invited[1]!.link.split('/invite/')[1]!
    expect((await outcome(() => invitePage.load(event('stranger', `/invite/${samLink}`, { params: { link: samLink } }) as never))).data.invite.mine).toBe(false)
    expect((await outcome(() => invitePage.actions.accept!(event('stranger', `/invite/${samLink}?/accept`, { params: { link: samLink }, form: {} }) as never))).data).toMatchObject({
      status: 403,
    })
    expect(await outcome(() => invitePage.actions.accept!(event('sam', `/invite/${samLink}?/accept`, { params: { link: samLink }, form: {} }) as never))).toEqual({
      status: 303,
      location: `/a/${slug}/d/payments/overview`,
    })
    // A link that is not one opens nothing.
    expect((await outcome(() => invitePage.load(event(null, '/invite/nonsense', { params: { link: 'nonsense' } }) as never))).data).toMatchObject({ invite: null })
    const dockets = await router.withTenant(orgId, listWorkspaces)
    expect(dockets.map((each) => each.slug).sort()).toEqual(['handbook', 'payments'])
  })

  it('lets an open invite skip ahead: accepted on the account step, it lands in its account', async () => {
    const orgId = (await db.admin.query('SELECT id FROM platform.orgs WHERE slug = $1', [slug])).rows[0].id as string
    await outcome(() => invite.actions.default!(event('owner', at('invite'), { form: { who: [users.stranger!.login], role: ['reader'], place: ['account'] } }) as never))
    const page = (await outcome(() => start.load(event('stranger', '/start') as never))).data
    expect(page.allowlisted).toBe(false)
    expect(page.invites).toEqual([expect.objectContaining({ accountName: 'Acme Wizard', gives: 'Reader on Acme Wizard (the whole account)' })])
    expect(await outcome(() => start.actions.accept!(event('stranger', '/start?/accept', { form: { invite: page.invites[0].id } }) as never))).toEqual({
      status: 303,
      location: `/a/${slug}`,
    })
    expect((await router.withPlatform((tx) => listMembers(tx, orgId))).map((member) => member.login)).toContain(users.stranger!.login)
    // A member who is not an admin of the whole account does not set it up.
    expect((await outcome(() => space.load(event('stranger', at('space')) as never))).status).toBe(403)
    expect((await outcome(() => invite.load(event('stranger', at('invite')) as never))).status).toBe(403)
  })
})
