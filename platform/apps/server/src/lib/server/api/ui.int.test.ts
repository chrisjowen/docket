// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes, randomInt, randomUUID } from 'node:crypto'

import { API_VERSION, operation, type Operation, type OperationId } from '@docket/api'
import { SESSION_COOKIE, createSession, csrfToken, issueApiToken, tokenHash, tokenResolver } from '@docket/platform-auth'
import { insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { memoryBucketStore, rateLimiter } from '@docket/platform-limits'
import { upsertGitHubUser } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import type { RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { rateLimiter as addressLimiter } from '../rate-limit'
import type { Runtime } from '../runtime'

let runtime: Runtime
vi.mock('../runtime', () => ({ getRuntime: () => runtime, initRuntime: () => undefined, RuntimeUnavailable: class extends Error {} }))
const { handle } = await import('../../../hooks.server')
const { handleApiV1 } = await import('./v1')

type Credential = { session: string } | { bearer: string } | null
type Body = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON answers, checked against their schemas

/**
 * The `/api/v1` operations the web UI (`packages/docket-ui/cloud`) calls to draw
 * a docket's Access tab and the app's frame around it - `me.get`,
 * `accounts.navigation`, `accounts.search`, `dockets.get`, `dockets.summary`,
 * `access.explain`, `access.who`, `roles.list`, `grants.list` and the grant
 * changes - through the app's hooks and the API's one route, with a browser
 * session (its CSRF token on every change) and with API and OAuth tokens:
 * refusals, read-only and docket-limited credentials, and each answer checked
 * against its operation's published schema.
 */
describe.skipIf(!TEST_PG_URL)("the web UI's /api/v1 calls, by browser session and by bearer token", () => {
  let org: TestOrg
  let main = ''
  const slug = () => `o-${org.orgId}`
  const ids: Record<string, string> = {}
  const logins: Record<string, string> = {}
  const sessions: Record<string, string> = {}
  const tokens: Record<string, string> = {}

  const human = (login: string) =>
    org.router.withPlatform((tx) => upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login, name: null, avatarUrl: null, emails: [] }))

  /** A member holding `role` on the whole account (or nothing), and `onMain` on the docket main. */
  async function member(name: string, role: string | null, options: { guest?: boolean; onMain?: string } = {}) {
    const user = await human(`${name}${org.orgId.slice(0, 6)}`)
    await org.db.admin.query('INSERT INTO platform.memberships (org_id, user_id, guest) VALUES ($1, $2, $3)', [org.orgId, user.id, options.guest ?? false])
    const grant = (kind: string, id: string | null, roleId: string) =>
      org.db.admin.query('INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id) VALUES ($1, $2, $3, $4, $5, $6)', [
        `g_${randomUUID()}`,
        org.orgId,
        user.id,
        kind,
        id,
        roleId,
      ])
    if (role) await grant('account', null, role)
    if (options.onMain) await grant('docket', main, options.onMain)
    ids[name] = user.id
    logins[name] = user.login
  }

  const session = async (userId: string) => (await org.router.withPlatform((tx) => createSession(tx, { userId, ip: null, userAgent: null }))).id
  const token = (userId: string, input: { readOnly?: boolean; dockets?: string[] | null } = {}) =>
    org.router.withPlatform(async (tx) =>
      (await issueApiToken(tx, { orgId: org.orgId, ownerId: userId, createdBy: userId, readOnly: input.readOnly ?? false, dockets: input.dockets ?? null, name: 'test' })).token,
    )

  /** An OAuth access token for the account's MCP address, from a named connection reaching every docket. */
  async function oauthToken(userId: string) {
    const raw = randomBytes(32).toString('base64url')
    const grantId = randomUUID()
    const resource = `https://docket.example/mcp/${slug()}`
    await org.db.admin.query(
      'INSERT INTO platform.oauth_connections (grant_id, org_id, user_id, client_id, name, read_only, dockets) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [grantId, org.orgId, userId, 'client', 'Claude Code', false, null],
    )
    await org.db.admin.query(
      `INSERT INTO platform.oauth_store (model, id_hash, payload, grant_id, account_id, client_id, resource, expires_at) VALUES
         ('Grant', $1, '{}', $2, $3, 'client', $4, now() + interval '1 day'),
         ('AccessToken', $5, $6, $2, $3, 'client', $4, now() + interval '15 minutes')`,
      [
        tokenHash(`grant:${grantId}`),
        grantId,
        userId,
        resource,
        tokenHash(raw),
        { accountId: userId, clientId: 'client', aud: resource, scope: 'docket:read docket:write', grantId, exp: Math.floor(Date.now() / 1000) + 900, extra: { org_id: org.orgId } },
      ],
    )
    return raw
  }

  /** One call through the hooks, as the web UI (or a client) sends it. */
  async function api(as: Credential, method: string, path: string, body?: unknown, options: { csrf?: string | false } = {}) {
    const url = new URL(path, 'https://docket.example')
    const headers = new Headers({ 'user-agent': 'ui-contract-test' })
    if (as && 'bearer' in as) headers.set('authorization', `Bearer ${as.bearer}`)
    if (as && 'session' in as && method !== 'GET' && options.csrf !== false) headers.set('x-csrf-token', options.csrf ?? csrfToken(as.session))
    if (body !== undefined) {
      headers.set('content-type', 'application/json')
      headers.set('content-length', String(Buffer.byteLength(JSON.stringify(body))))
    }
    const cookie = as && 'session' in as ? as.session : undefined
    const event = {
      url,
      request: new Request(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
      params: { path: url.pathname.replace(/^\/api\/v1\/?/, '') },
      route: { id: '/api/v1/[...path]' },
      locals: {},
      cookies: { get: (name: string) => (name === SESSION_COOKIE ? cookie : undefined), delete: () => undefined },
      getClientAddress: () => '192.0.2.30',
    } as unknown as RequestEvent
    const response = await handle({ event, resolve: (resolved: RequestEvent) => handleApiV1(resolved) } as never)
    const text = await response.text()
    return { status: response.status, body: (text ? JSON.parse(text) : null) as Body, headers: response.headers }
  }

  /** The answer matches the operation's published response schema. */
  function conforms(id: OperationId, body: unknown) {
    const schema = (operation(id) as Operation).response
    if (!schema) return
    const result = schema.safeParse(body)
    expect(result.success, `${id}: ${JSON.stringify(result.error?.issues ?? [])}`).toBe(true)
  }

  const as = (name: string): Credential => ({ session: sessions[name] as string })
  const bearer = (name: string): Credential => ({ bearer: tokens[name] as string })
  const acct = (path = '') => `/api/v1/accounts/${slug()}${path}`

  beforeAll(async () => {
    // Who reaches what from grants alone: without General's default Reader for everyone.
    org = await createTestOrg({ everyoneReadsGeneral: false })
    main = (await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Main', slug: 'main', createdBy: org.userId }))).id
    await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Other', slug: 'other', createdBy: org.userId }))
    ids.owner = org.userId
    logins.owner = org.login
    await member('admin', 'admin')
    await member('writer', 'writer')
    // A guest holding Reader on main alone, and a member holding nothing.
    await member('guest', null, { guest: true, onMain: 'reader' })
    await member('nobody', null)
    const outsider = await human(`outsider${org.orgId.slice(0, 6)}`)
    ids.outsider = outsider.id
    for (const name of ['owner', 'admin', 'writer', 'guest', 'nobody', 'outsider']) sessions[name] = await session(ids[name] as string)
    for (const name of ['admin', 'writer', 'guest']) tokens[name] = await token(ids[name] as string)
    tokens.adminReadOnly = await token(ids.admin as string, { readOnly: true })
    tokens.writerMain = await token(ids.writer as string, { dockets: [main] })
    tokens.writerOAuth = await oauthToken(ids.writer as string)

    runtime = {
      router: org.router,
      keyring: org.keyring,
      origin: 'https://docket.example',
      tokens: tokenResolver({ platform: (fn) => org.router.withPlatform(fn), ttlMs: 0 }),
      caps: { status: async () => ({ spentUsd: 1.5, capUsd: 20, fraction: 0.075, warnedAt: null }) },
      platformAdmins: new Set<string>([logins.admin as string]),
      frameAncestors: "'none'",
    } as unknown as Runtime
  })
  beforeEach(() => {
    const at = Date.now()
    runtime.limiter = rateLimiter({ store: memoryBucketStore({ now: () => at }), now: () => at })
    runtime.refusedAuth = addressLimiter({ limit: 1000, windowMs: 60_000 })
  })
  afterAll(() => org?.drop())

  it('me.get: who is calling, the session’s CSRF token, and the API version every answer carries', async () => {
    const admin = await api(as('admin'), 'GET', '/api/v1/me')
    expect(admin.status).toBe(200)
    conforms('me.get', admin.body)
    expect(admin.body).toMatchObject({ via: 'session', csrf: csrfToken(sessions.admin as string), platform_admin: true, accounts: [{ slug: slug() }] })
    expect(admin.headers.get('x-docket-api-version')).toBe(API_VERSION)
    expect((await api(as('writer'), 'GET', '/api/v1/me')).body).toMatchObject({ platform_admin: false })
    expect((await api(bearer('admin'), 'GET', '/api/v1/me')).body).toMatchObject({ via: 'token', csrf: null, platform_admin: false })
    expect(await api(null, 'GET', '/api/v1/me')).toMatchObject({ status: 401, body: { error: 'unauthenticated' } })
  })

  describe('accounts.navigation', () => {
    it('draws the sidebar a member sees: their role, the spaces, and the dockets numbered across the account', async () => {
      const writer = await api(as('writer'), 'GET', acct('/navigation'))
      expect(writer.status).toBe(200)
      conforms('accounts.navigation', writer.body)
      expect(writer.body).toMatchObject({ account: { slug: slug() }, owner: false, manages_access: false, ai: { cap_usd: 20 } })
      expect(writer.body.caps).toContain('write')
      expect(writer.body.dockets.map((docket: Body) => docket.slug).sort()).toEqual(['main', 'other'])
      expect(writer.body.spaces.map((space: Body) => space.slug)).toEqual(['general'])
      // A guest sees only the docket it holds something on; numbers stay the account's.
      const guest = (await api(as('guest'), 'GET', acct('/navigation'))).body
      expect(guest.dockets).toEqual([expect.objectContaining({ slug: 'main', open: true, number: writer.body.dockets.find((docket: Body) => docket.slug === 'main').number })])
    })

    it('answers a token as its owner, and one limited to a docket with that docket alone', async () => {
      const writer = (await api(as('writer'), 'GET', acct('/navigation'))).body
      for (const name of ['writer', 'writerOAuth']) expect((await api(bearer(name), 'GET', acct('/navigation'))).body).toEqual(writer)
      const limited = (await api(bearer('writerMain'), 'GET', acct('/navigation'))).body
      expect(limited.dockets.filter((docket: Body) => docket.open).map((docket: Body) => docket.slug)).toEqual(['main'])
      expect(limited.caps).toEqual([])
    })

    it('is 404 outside the account, and 401 signed out', async () => {
      expect(await api(as('outsider'), 'GET', acct('/navigation'))).toMatchObject({ status: 404, body: { error: 'not_found' } })
      expect(await api(null, 'GET', acct('/navigation'))).toMatchObject({ status: 401 })
    })
  })

  describe('accounts.search', () => {
    it('answers whoever reads a docket, and refuses whoever reads none', async () => {
      const found = await api(as('guest'), 'GET', acct('/search?q='))
      expect(found).toMatchObject({ status: 200, body: { records: [], groups: { notes: [], memory: [], exhibits: [], entries: [] } } })
      conforms('accounts.search', found.body)
      expect((await api(bearer('writer'), 'GET', acct('/search?q=&ws=main,other'))).status).toBe(200)
      expect(await api(as('nobody'), 'GET', acct('/search?q=orders'))).toMatchObject({ status: 403, body: { error: 'forbidden' } })
      expect(await api(as('outsider'), 'GET', acct('/search?q=orders'))).toMatchObject({ status: 404 })
    })
  })

  describe('dockets.get and dockets.summary', () => {
    it("draw a docket's header for whoever reads it, by session or token", async () => {
      for (const who of [as('writer'), bearer('writer'), bearer('writerOAuth'), bearer('writerMain'), as('guest')]) {
        const docket = await api(who, 'GET', acct('/dockets/main'))
        expect(docket.status).toBe(200)
        conforms('dockets.get', docket.body)
        const summary = await api(who, 'GET', acct('/dockets/main/summary'))
        expect(summary).toMatchObject({ status: 200, body: { docket: 'main', documents: 0, drafts: 0, schema: null } })
        conforms('dockets.summary', summary.body)
      }
      expect((await api(as('guest'), 'GET', acct('/dockets/main'))).body.caps).toEqual(['read'])
    })

    it('refuse what the caller may not reach: 404 unseen, 403 seen but unread', async () => {
      expect(await api(as('nobody'), 'GET', acct('/dockets/main/summary'))).toMatchObject({ status: 403, body: { error: 'forbidden' } })
      expect(await api(as('guest'), 'GET', acct('/dockets/other/summary'))).toMatchObject({ status: 404 })
      // A token limited to main holds nothing on other, which its owner, not a guest, still sees: as dockets.get answers.
      expect(await api(bearer('writerMain'), 'GET', acct('/dockets/other/summary'))).toMatchObject({ status: 403 })
      expect(await api(bearer('writerMain'), 'GET', acct('/dockets/other'))).toMatchObject({ status: 403 })
      expect(await api(as('outsider'), 'GET', acct('/dockets/main/summary'))).toMatchObject({ status: 404 })
      expect(await api({ bearer: 'dkt_pat_not-a-real-token' }, 'GET', acct('/dockets/main/summary'))).toMatchObject({ status: 401, body: { error: 'invalid_token' } })
    })
  })

  describe("a docket's Access tab", () => {
    it('access.explain: what the caller may do on the docket and why', async () => {
      const writer = await api(as('writer'), 'GET', acct('/access?place=docket:main'))
      expect(writer.status).toBe(200)
      conforms('access.explain', writer.body)
      expect(writer.body.caps).toEqual(['read', 'write', 'propose'])
      expect(writer.body.because).toEqual([expect.stringMatching(/^Writer on .* \(the whole account\)$/)])
      expect((await api(as('owner'), 'GET', acct('/access?place=docket:main'))).body).toMatchObject({ owner: true })
    })

    it('access.who: who reaches the docket, the grants on the bigger places, and whom the caller may give access', async () => {
      for (const who of [as('admin'), bearer('admin'), bearer('adminReadOnly')]) {
        const { status, body } = await api(who, 'GET', acct('/access/who?place=docket:main'))
        expect(status).toBe(200)
        conforms('access.who', body)
        expect(body.reach.map((row: Body) => row.login)).toEqual(expect.arrayContaining([logins.owner, logins.admin, logins.writer, logins.guest]))
        expect(body.reach.map((row: Body) => row.login)).not.toContain(logins.nobody)
        expect(body.covering.map((grant: Body) => grant.who.login).sort()).toEqual([logins.admin, logins.writer].sort())
        expect(body.covering.every((grant: Body) => grant.may_change === false && grant.place.kind === 'account')).toBe(true)
        expect(body.candidates.map((candidate: Body) => candidate.ref)).toEqual(expect.arrayContaining(['everyone', ids.nobody]))
      }
      expect(await api(as('writer'), 'GET', acct('/access/who?place=docket:main'))).toMatchObject({ status: 403, body: { error: 'forbidden' } })
      expect(await api(as('guest'), 'GET', acct('/access/who?place=docket:other'))).toMatchObject({ status: 404 })
      expect(await api(as('outsider'), 'GET', acct('/access/who?place=docket:main'))).toMatchObject({ status: 404 })
    })

    it('grants.list and roles.list: the grants on the docket, and the roles to give', async () => {
      const grants = await api(as('admin'), 'GET', acct('/grants?place=docket:main'))
      conforms('grants.list', grants.body)
      expect(grants.body.grants).toEqual([expect.objectContaining({ who: expect.objectContaining({ login: logins.guest }), may_change: true })])
      const roles = await api(as('admin'), 'GET', acct('/roles'))
      conforms('roles.list', roles.body)
      expect(roles.body.roles.map((role: Body) => role.id)).toEqual(expect.arrayContaining(['reader', 'writer', 'admin']))
    })

    it('grants.create, grants.replace and grants.delete: give, change and take away a grant on the docket', async () => {
      const given = await api(as('admin'), 'POST', acct('/grants'), { who: ids.nobody, place: 'docket:main', role: 'writer', add: ['publish'] })
      expect(given.status).toBe(201)
      conforms('grants.create', given.body)
      expect(given.body).toMatchObject({ label: 'Writer + Publish ontology changes', place: { ref: 'docket:main' }, may_change: true })
      // The grant reaches its holder straight away.
      expect((await api(as('nobody'), 'GET', acct('/dockets/main/summary'))).status).toBe(200)
      const changed = await api(as('admin'), 'PUT', acct(`/grants/${given.body.id}`), { role: 'reader' })
      expect(changed).toMatchObject({ status: 200, body: { label: 'Reader' } })
      expect((await api(as('admin'), 'DELETE', acct(`/grants/${given.body.id}`))).status).toBe(204)
      expect(await api(as('admin'), 'DELETE', acct(`/grants/${given.body.id}`))).toMatchObject({ status: 404 })
      expect((await api(as('nobody'), 'GET', acct('/dockets/main/summary'))).status).toBe(403)
    })

    it('refuses a change without the session’s own CSRF token, from a read-only token, and from whoever does not manage access', async () => {
      const body = { who: 'everyone', place: 'docket:main', role: 'admin' }
      expect(await api(as('admin'), 'POST', acct('/grants'), body, { csrf: false })).toMatchObject({ status: 403, body: { error: 'csrf' } })
      expect(await api(as('admin'), 'POST', acct('/grants'), body, { csrf: csrfToken(sessions.writer as string) })).toMatchObject({ status: 403, body: { error: 'csrf' } })
      expect(await api(bearer('adminReadOnly'), 'POST', acct('/grants'), body)).toMatchObject({ status: 403, body: { error: 'read_only' } })
      for (const who of [as('writer'), bearer('writer'), bearer('writerOAuth')]) expect(await api(who, 'POST', acct('/grants'), body)).toMatchObject({ status: 403, body: { error: 'forbidden' } })
      expect(await api(as('outsider'), 'POST', acct('/grants'), body)).toMatchObject({ status: 404 })
      const grants = (await api(as('admin'), 'GET', acct('/grants?place=docket:main'))).body.grants as Body[]
      expect(grants.some((grant) => grant.who.kind === 'everyone')).toBe(false)
    })
  })
})
