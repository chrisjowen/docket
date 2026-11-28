// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes, randomInt, randomUUID } from 'node:crypto'

import { OPERATIONS, operation, type Operation, type OperationId } from '@docket/api'
import { SESSION_COOKIE, createSession, csrfToken, issueApiToken, tokenHash, tokenResolver } from '@docket/platform-auth'
import { insertSpace, insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { memoryBucketStore, rateLimiter } from '@docket/platform-limits'
import { postgresProvisioner } from '@docket/platform-provisioner'
import { upsertGitHubUser } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import type { RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { memoryMailer } from '../mail'
import { rateLimiter as addressLimiter } from '../rate-limit'
import type { Runtime } from '../runtime'

let runtime: Runtime
const mailer = memoryMailer()
vi.mock('../runtime', () => ({ getRuntime: () => runtime, initRuntime: () => undefined, RuntimeUnavailable: class extends Error {} }))
const { handle } = await import('../../../hooks.server')
const { handleApiV1 } = await import('./v1')

type Credential = { session: string } | { bearer: string } | null

/**
 * The `/api/v1` contract (tenancy v2 §3.5; open-source plan §1), through the
 * app's own hooks and the API's one route: a browser session (cookie, and
 * the CSRF token on every call that is not a GET) and a bearer token resolve
 * to the same principal and the same capabilities; refusals, read-only and
 * docket-limited credentials, and accounts the caller is not in; and each
 * answer checked against its operation's published schema.
 */
describe.skipIf(!TEST_PG_URL)('the /api/v1 contract, by browser session and by bearer token', () => {
  let org: TestOrg
  let other: { orgId: string; userId: string; login: string }
  const slug = () => `o-${org.orgId}`
  const otherSlug = () => `o-${other.orgId}`
  const ids: Record<string, string> = {}
  const sessions: Record<string, string> = {}
  const tokens: Record<string, string> = {}
  let payments = ''

  const human = (login: string) =>
    org.router.withPlatform((tx) => upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login, name: null, avatarUrl: null, emails: [] }))

  async function member(name: string, role: string | null, place: { kind: 'account' | 'space' | 'docket'; id: string | null } = { kind: 'account', id: null }, flags: { guest?: boolean } = {}) {
    const user = await human(`${name}${org.orgId.slice(0, 6)}`)
    await org.db.admin.query('INSERT INTO platform.memberships (org_id, user_id, guest) VALUES ($1, $2, $3)', [org.orgId, user.id, flags.guest ?? false])
    if (role) {
      await org.db.admin.query(
        'INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [`g_${name}_${org.orgId}`, org.orgId, user.id, place.kind, place.id, role],
      )
    }
    return user.id
  }

  const session = async (userId: string) => (await org.router.withPlatform((tx) => createSession(tx, { userId, ip: null, userAgent: null }))).id
  const token = (userId: string, input: { readOnly?: boolean; dockets?: string[] | null; orgId?: string } = {}) =>
    org.router.withPlatform(async (tx) =>
      (await issueApiToken(tx, { orgId: input.orgId ?? org.orgId, ownerId: userId, createdBy: userId, readOnly: input.readOnly ?? false, dockets: input.dockets ?? null, name: 'test' })).token,
    )

  /** One call through the hooks, as the browser or a client sends it. */
  async function api(as: Credential, method: string, path: string, body?: unknown, options: { csrf?: boolean } = {}) {
    const url = new URL(path, 'https://docket.example')
    const headers = new Headers({ 'user-agent': 'contract-test' })
    if (as && 'bearer' in as) headers.set('authorization', `Bearer ${as.bearer}`)
    if (as && 'session' in as && method !== 'GET' && options.csrf !== false) headers.set('x-csrf-token', csrfToken(as.session))
    if (body !== undefined) {
      headers.set('content-type', 'application/json')
      headers.set('content-length', String(Buffer.byteLength(JSON.stringify(body))))
    }
    const request = new Request(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    const cookie = as && 'session' in as ? as.session : undefined
    const event = {
      url,
      request,
      params: { path: url.pathname.replace(/^\/api\/v1\/?/, '') },
      route: { id: '/api/v1/[...path]' },
      locals: {},
      cookies: { get: (name: string) => (name === SESSION_COOKIE ? cookie : undefined), delete: () => undefined },
      getClientAddress: () => '192.0.2.20',
    } as unknown as RequestEvent
    const response = await handle({ event, resolve: (resolved: RequestEvent) => handleApiV1(resolved) } as never)
    const text = await response.text()
    return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : null, headers: response.headers }
  }

  /** The answer matches the operation's published response schema. */
  function conforms(id: OperationId, body: unknown) {
    const schema = (operation(id) as Operation).response
    if (!schema) return
    const result = schema.safeParse(body)
    expect(result.success, `${id}: ${JSON.stringify(result.error?.issues ?? [])}`).toBe(true)
  }

  const asSession = (name: string): Credential => ({ session: sessions[name] as string })
  const asToken = (name: string): Credential => ({ bearer: tokens[name] as string })

  beforeAll(async () => {
    org = await createTestOrg({ everyoneReadsGeneral: false })
    other = await org.addOrg()
    payments = (await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Payments', slug: 'payments', createdBy: org.userId }))).id
    const eng = await org.withOrg(({ tx }) => insertSpace(tx, { name: 'Engineering', slug: 'eng', createdBy: org.userId }))
    await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Platform', slug: 'platform', createdBy: org.userId, spaceId: eng.id }))
    ids.owner = org.userId
    ids.admin = await member('admin', 'admin')
    ids.writer = await member('writer', 'writer')
    ids.reader = await member('reader', 'reader')
    ids.guest = await member('guest', 'reader', { kind: 'docket', id: payments }, { guest: true })
    ids.engAdmin = await member('engadmin', 'admin', { kind: 'space', id: eng.id })
    for (const name of ['owner', 'admin', 'writer', 'reader', 'guest', 'engAdmin']) {
      sessions[name] = await session(ids[name] as string)
      tokens[name] = await token(ids[name] as string)
    }
    tokens.ownerReadOnly = await token(org.userId, { readOnly: true })
    tokens.ownerPayments = await token(org.userId, { dockets: [payments] })
    tokens.otherOwner = await token(other.userId, { orgId: other.orgId })
    sessions.otherOwner = await session(other.userId)

    runtime = {
      router: org.router,
      keyring: org.keyring,
      origin: 'https://docket.example',
      tokens: tokenResolver({ platform: (fn) => org.router.withPlatform(fn), ttlMs: 0 }),
      frameAncestors: "'none'",
      platformAdmins: new Set<string>(),
      maxOrgs: 100,
      provisioner: postgresProvisioner({ admin: org.db.admin, keys: {} as never, appRole: org.db.appRole }),
      mailer,
    } as unknown as Runtime
  })
  beforeEach(() => {
    const at = Date.now()
    runtime.limiter = rateLimiter({ store: memoryBucketStore({ now: () => at }), now: () => at })
    runtime.refusedAuth = addressLimiter({ limit: 1000, windowMs: 60_000 })
  })
  afterAll(() => org?.drop())

  it('routes exactly the operations the shared definition lists', async () => {
    for (const each of OPERATIONS as readonly Operation[]) expect(each.path.startsWith('/api/v1/'), each.id).toBe(true)
    expect((await api(asToken('owner'), 'GET', '/api/v1/nowhere')).body).toMatchObject({ error: 'not_found' })
    const wrong = await api(asToken('owner'), 'POST', `/api/v1/accounts/${slug()}/usage`)
    expect(wrong.status).toBe(405)
    expect(wrong.headers.get('allow')).toBe('GET')
  })

  it('answers the same principal and capabilities to a session and to a token', async () => {
    const bySession = await api(asSession('writer'), 'GET', '/api/v1/me')
    const byToken = await api(asToken('writer'), 'GET', '/api/v1/me')
    expect(bySession.status).toBe(200)
    conforms('me.get', bySession.body)
    conforms('me.get', byToken.body)
    expect(bySession.body).toMatchObject({ via: 'session', user: { id: ids.writer }, credential: null })
    expect(bySession.body?.csrf).toBe(csrfToken(sessions.writer as string))
    expect(byToken.body).toMatchObject({ via: 'token', user: { id: ids.writer }, csrf: null, credential: { read_only: false, dockets: null, account: slug() } })
    for (const path of [`/api/v1/accounts/${slug()}`, `/api/v1/accounts/${slug()}/dockets`, `/api/v1/accounts/${slug()}/spaces`]) {
      const a = await api(asSession('writer'), 'GET', path)
      const b = await api(asToken('writer'), 'GET', path)
      expect(a.status, path).toBe(200)
      expect(b.body, path).toEqual(a.body)
    }
    const account = await api(asToken('writer'), 'GET', `/api/v1/accounts/${slug()}`)
    conforms('accounts.get', account.body)
    expect(account.body).toMatchObject({ caps: ['read', 'write', 'propose'], mcp_url: `https://docket.example/mcp/${slug()}` })
  })

  it('asks for credentials, and refuses an unknown token', async () => {
    const none = await api(null, 'GET', '/api/v1/me')
    expect(none.status).toBe(401)
    expect(none.body).toMatchObject({ error: 'unauthenticated' })
    const bad = await api({ bearer: 'dkt_pat_00000000000000000000000000000000000000000000' }, 'GET', '/api/v1/me')
    expect(bad.status).toBe(401)
    expect(bad.body).toMatchObject({ error: 'invalid_token' })
    expect(bad.body?.request_id).toEqual(expect.any(String))
  })

  it('needs the CSRF token on a session’s changes, never on a bearer’s', async () => {
    const body = { who: 'everyone', place: 'docket:payments', role: 'reader' }
    const refused = await api(asSession('owner'), 'POST', `/api/v1/accounts/${slug()}/grants`, body, { csrf: false })
    expect(refused.status).toBe(403)
    expect(refused.body).toMatchObject({ error: 'csrf' })
    const made = await api(asSession('owner'), 'POST', `/api/v1/accounts/${slug()}/grants`, body)
    expect(made.status).toBe(201)
    conforms('grants.create', made.body)
    expect(made.body).toMatchObject({ who: { kind: 'everyone' }, place: { ref: 'docket:payments' }, role: { id: 'reader' }, may_change: true })
    const gone = await api(asToken('owner'), 'DELETE', `/api/v1/accounts/${slug()}/grants/${made.body?.id}`)
    expect(gone.status).toBe(204)
  })

  it('gives access only where the caller manages it, and only what they hold', async () => {
    const reader = await api(asToken('reader'), 'POST', `/api/v1/accounts/${slug()}/grants`, { who: 'everyone', place: 'docket:payments', role: 'reader' })
    expect(reader.status).toBe(403)
    expect(reader.body).toMatchObject({ error: 'forbidden' })
    // An admin on Engineering gives access there, never on the account or another space's docket.
    const writerLogin = `writer${org.orgId.slice(0, 6)}`
    const there = await api(asSession('engAdmin'), 'POST', `/api/v1/accounts/${slug()}/grants`, { who: writerLogin, place: 'space:eng', role: 'writer', add: ['publish'] })
    expect(there.status).toBe(201)
    expect(there.body).toMatchObject({ add: ['publish'], label: 'Writer + Publish ontology changes' })
    expect((await api(asSession('engAdmin'), 'POST', `/api/v1/accounts/${slug()}/grants`, { who: writerLogin, place: 'account', role: 'admin' })).status).toBe(403)
    expect((await api(asSession('engAdmin'), 'POST', `/api/v1/accounts/${slug()}/grants`, { who: writerLogin, place: 'docket:payments', role: 'reader' })).status).toBe(403)
    // One user, one extra capability, then taken back.
    const adjusted = await api(asToken('engAdmin'), 'PATCH', `/api/v1/accounts/${slug()}/grants/${there.body?.id}`, { add: ['decide'] })
    expect(adjusted.status).toBe(200)
    expect(adjusted.body).toMatchObject({ add: ['decide'] })
    const explained = await api(asToken('writer'), 'GET', `/api/v1/accounts/${slug()}/access?place=docket:platform`)
    conforms('access.explain', explained.body)
    expect(explained.body?.caps).toContain('decide')
    expect(explained.body?.because).toEqual(expect.arrayContaining([expect.stringContaining('Engineering (space)')]))
    expect((await api(asToken('engAdmin'), 'DELETE', `/api/v1/accounts/${slug()}/grants/${there.body?.id}`)).status).toBe(204)
    // The writer saw their own grant; the reader sees none of anyone else's.
    const readerGrants = await api(asToken('reader'), 'GET', `/api/v1/accounts/${slug()}/grants`)
    conforms('grants.list', readerGrants.body)
    expect((readerGrants.body?.grants as { who: { id?: string } }[]).every((grant) => grant.who.id === ids.reader)).toBe(true)
  })

  it('lets a read-only token read and nothing else, and a docket-limited one act only on its docket', async () => {
    expect((await api(asToken('ownerReadOnly'), 'GET', `/api/v1/accounts/${slug()}/grants`)).status).toBe(200)
    const write = await api(asToken('ownerReadOnly'), 'POST', `/api/v1/accounts/${slug()}/spaces`, { name: 'Nope', slug: 'nope' })
    expect(write.status).toBe(403)
    expect(write.body).toMatchObject({ error: 'read_only' })
    // The owner's token for Payments alone: the owner's capabilities there, nothing on the account or elsewhere.
    const limited = asToken('ownerPayments')
    const account = await api(limited, 'GET', `/api/v1/accounts/${slug()}`)
    expect(account.body).toMatchObject({ caps: [] })
    expect((await api(limited, 'POST', `/api/v1/accounts/${slug()}/spaces`, { name: 'Nope', slug: 'nope' })).status).toBe(403)
    expect((await api(limited, 'POST', `/api/v1/accounts/${slug()}/grants`, { who: 'everyone', place: 'docket:platform', role: 'reader' })).status).toBe(403)
    const onIt = await api(limited, 'POST', `/api/v1/accounts/${slug()}/grants`, { who: 'everyone', place: 'docket:payments', role: 'reader' })
    expect(onIt.status).toBe(201)
    expect((await api(limited, 'DELETE', `/api/v1/accounts/${slug()}/grants/${onIt.body?.id}`)).status).toBe(204)
    expect((await api(limited, 'PATCH', `/api/v1/accounts/${slug()}`, { name: 'Renamed' })).status).toBe(403)
  })

  it('keeps a credential made before scopes went to what it had: reads only, and a docket address grant off the API', async () => {
    // An API token from before platform migration 0015, capped at reading and writing content.
    const legacy = await token(org.userId, { dockets: [payments] })
    await org.db.admin.query("UPDATE platform.api_tokens SET legacy_scopes = ARRAY['docket:read', 'docket:write'] WHERE token_hash = $1", [tokenHash(legacy)])
    const me = await api({ bearer: legacy }, 'GET', '/api/v1/me')
    expect(me.body?.credential).toMatchObject({ read_only: true })
    expect((await api({ bearer: legacy }, 'GET', `/api/v1/accounts/${slug()}/dockets/payments`)).status).toBe(200)
    for (const [method, path, body] of [
      ['DELETE', `/api/v1/accounts/${slug()}/dockets/payments`, undefined],
      ['POST', `/api/v1/accounts/${slug()}/grants`, { who: 'everyone', place: 'docket:payments', role: 'reader' }],
      ['POST', `/api/v1/accounts/${slug()}/invites`, { to: 'someone@example.com', place: 'docket:payments', role: 'reader' }],
    ] as const) {
      const refused = await api({ bearer: legacy }, method, path, body)
      expect(refused.status, `${method} ${path}`).toBe(403)
      expect(refused.body).toMatchObject({ error: 'read_only' })
    }
    // An OAuth grant made before named connections is bound to one docket's MCP address, not to the API.
    const raw = randomBytes(32).toString('base64url')
    const grantId = randomUUID()
    const resource = `https://docket.example/mcp/${slug()}/payments`
    await org.db.admin.query(
      `INSERT INTO platform.oauth_store (model, id_hash, payload, grant_id, account_id, client_id, resource, expires_at) VALUES
         ('Grant', $1, '{}', $2, $3, 'client', $4, now() + interval '1 day'),
         ('AccessToken', $5, $6, $2, $3, 'client', $4, now() + interval '15 minutes')`,
      [
        tokenHash(`grant:${grantId}`),
        grantId,
        org.userId,
        resource,
        tokenHash(raw),
        { accountId: org.userId, clientId: 'client', aud: resource, scope: 'docket:read docket:write', grantId, exp: Math.floor(Date.now() / 1000) + 900, extra: { org_id: org.orgId, workspace_id: payments } },
      ],
    )
    const bound = await api({ bearer: raw }, 'GET', `/api/v1/accounts/${slug()}/dockets/payments`)
    expect(bound.status).toBe(401)
    expect(bound.body).toMatchObject({ error: 'invalid_token' })
    expect((await api({ bearer: raw }, 'DELETE', `/api/v1/accounts/${slug()}/dockets/payments`)).status).toBe(401)
  })

  it('keeps every account to its own members and its own tokens (cross-account isolation)', async () => {
    for (const as of [asToken('owner'), asSession('owner')]) {
      for (const path of [`/api/v1/accounts/${otherSlug()}`, `/api/v1/accounts/${otherSlug()}/grants`, `/api/v1/accounts/${otherSlug()}/dockets`]) {
        const answer = await api(as, 'GET', path)
        expect(answer.status, path).toBe(404)
        expect(answer.body).toMatchObject({ error: 'not_found' })
      }
      expect((await api(as, 'POST', `/api/v1/accounts/${otherSlug()}/spaces`, { name: 'Mine', slug: 'mine' })).status).toBe(404)
    }
    // The other account's owner, with a token of theirs, reaches nothing here, and lists only their own account.
    expect((await api(asToken('otherOwner'), 'GET', `/api/v1/accounts/${slug()}/dockets`)).status).toBe(404)
    const listed = await api(asToken('otherOwner'), 'GET', '/api/v1/accounts')
    conforms('accounts.list', listed.body)
    expect((listed.body?.accounts as { slug: string }[]).map((each) => each.slug)).toEqual([otherSlug()])
    // A grant of this account is no grant of the other's.
    const grant = await api(asToken('owner'), 'POST', `/api/v1/accounts/${slug()}/grants`, { who: 'everyone', place: 'docket:payments', role: 'reader' })
    expect((await api(asToken('otherOwner'), 'DELETE', `/api/v1/accounts/${otherSlug()}/grants/${grant.body?.id}`)).status).toBe(404)
    expect((await api(asToken('owner'), 'DELETE', `/api/v1/accounts/${slug()}/grants/${grant.body?.id}`)).status).toBe(204)
  })

  it('mints a personal token only from the owner’s own browser session', async () => {
    const byToken = await api(asToken('writer'), 'POST', '/api/v1/me/tokens', { account: slug(), name: 'laptop' })
    expect(byToken.status).toBe(403)
    const made = await api(asSession('writer'), 'POST', '/api/v1/me/tokens', { account: slug(), name: 'laptop', read_only: true, dockets: ['payments'] })
    expect(made.status).toBe(201)
    conforms('me.tokens.create', made.body)
    expect(made.body?.token).toMatch(/^dkt_pat_/)
    const listed = await api({ bearer: made.body?.token as string }, 'GET', `/api/v1/me/tokens?account=${slug()}`)
    conforms('me.tokens.list', listed.body)
    expect(listed.body?.tokens).toEqual(expect.arrayContaining([expect.objectContaining({ id: made.body?.id, read_only: true, dockets: [expect.objectContaining({ slug: 'payments' })] })]))
    const renamed = await api(asSession('writer'), 'PATCH', `/api/v1/me/tokens/${made.body?.id}`, { name: 'work laptop' })
    expect(renamed.body).toMatchObject({ name: 'work laptop' })
    expect((await api(asSession('writer'), 'DELETE', `/api/v1/me/tokens/${made.body?.id}`)).status).toBe(204)
    expect((await api({ bearer: made.body?.token as string }, 'GET', '/api/v1/me')).status).toBe(401)
  })

  it('validates requests against the schema, naming what is wrong', async () => {
    const bad = await api(asToken('owner'), 'POST', `/api/v1/accounts/${slug()}/grants`, { who: 'everyone', place: 'docket:Pay', role: 'reader', add: ['fly'] })
    expect(bad.status).toBe(400)
    expect(bad.body).toMatchObject({ error: 'invalid_request' })
    expect((bad.body?.issues as { path: string }[]).map((issue) => issue.path)).toEqual(expect.arrayContaining(['body.place', 'body.add.0']))
  })

  it('makes spaces, dockets, roles, invites and system accounts with the app’s own checks, audited with who and through what', async () => {
    const owner = asToken('owner')
    expect((await api(asToken('writer'), 'POST', `/api/v1/accounts/${slug()}/spaces`, { name: 'Legal', slug: 'legal' })).status).toBe(403)
    const space = await api(owner, 'POST', `/api/v1/accounts/${slug()}/spaces`, { name: 'Legal', slug: 'legal', description: 'Contracts' })
    expect(space.status).toBe(201)
    conforms('spaces.create', space.body)
    expect((await api(owner, 'PATCH', `/api/v1/accounts/${slug()}/spaces/legal`, { name: 'Legal & Compliance' })).body).toMatchObject({ name: 'Legal & Compliance' })

    const writerLogin = `writer${org.orgId.slice(0, 6)}`
    const docket = await api(owner, 'POST', `/api/v1/accounts/${slug()}/dockets`, { space: 'legal', name: 'Contracts', template: 'blank', grants: [{ who: writerLogin, role: 'writer' }] })
    expect(docket.status, JSON.stringify(docket.body)).toBe(201)
    conforms('dockets.create', docket.body)
    expect(docket.body).toMatchObject({ slug: 'contracts', space: { slug: 'legal' } })
    const seen = await api(asToken('writer'), 'GET', `/api/v1/accounts/${slug()}/dockets/contracts`)
    expect(seen.body?.caps).toEqual(['read', 'write', 'propose'])
    // A guest sees only the dockets it holds something on.
    const guest = await api(asToken('guest'), 'GET', `/api/v1/accounts/${slug()}/dockets`)
    expect((guest.body?.dockets as { slug: string }[]).map((each) => each.slug)).toEqual(['payments'])
    expect((await api(asToken('guest'), 'GET', `/api/v1/accounts/${slug()}/dockets/contracts`)).status).toBe(404)
    // An admin on Engineering sees that a Legal docket exists, and may not read it.
    expect((await api(asToken('engAdmin'), 'GET', `/api/v1/accounts/${slug()}/dockets/contracts`)).status).toBe(403)

    const moved = await api(owner, 'PATCH', `/api/v1/accounts/${slug()}/dockets/contracts`, { name: 'Contracts 2027', space: 'eng' })
    expect(moved.body).toMatchObject({ name: 'Contracts 2027', space: { slug: 'eng' } })
    expect((await api(asToken('writer'), 'DELETE', `/api/v1/accounts/${slug()}/dockets/contracts`)).status).toBe(403)
    expect((await api(owner, 'DELETE', `/api/v1/accounts/${slug()}/dockets/contracts`)).status).toBe(204)

    const role = await api(owner, 'POST', `/api/v1/accounts/${slug()}/roles`, { name: 'Schema editor', caps: ['read', 'write', 'publish'] })
    expect(role.status).toBe(201)
    conforms('roles.create', role.body)
    expect((await api(asToken('engAdmin'), 'POST', `/api/v1/accounts/${slug()}/roles`, { name: 'Nope', caps: ['read'] })).status).toBe(403)
    expect((await api(owner, 'PUT', `/api/v1/accounts/${slug()}/roles/reader`, { name: 'Reading', caps: ['read', 'write'] })).status).toBe(403)
    expect((await api(owner, 'DELETE', `/api/v1/accounts/${slug()}/roles/${role.body?.id}`)).status).toBe(204)

    const invite = await api(asSession('engAdmin'), 'POST', `/api/v1/accounts/${slug()}/invites`, { to: 'newcomer', place: 'space:eng', role: 'writer' })
    expect(invite.status).toBe(201)
    conforms('invites.create', invite.body)
    expect((await api(asSession('engAdmin'), 'POST', `/api/v1/accounts/${slug()}/invites`, { to: 'another', place: 'account', role: 'reader' })).status).toBe(403)
    // The invite is a link, returned once; an invite by email is also emailed (tenancy v2 §6).
    expect(invite.body?.link).toMatch(/^https:\/\/docket\.example\/invite\/dki_[\w-]{32}$/)
    expect(invite.body?.emailed_to).toBeNull()
    const sent = mailer.sent.length
    const byEmail = await api(asToken('engAdmin'), 'POST', `/api/v1/accounts/${slug()}/invites`, { to: 'Pat@Example.com', place: 'space:eng', role: 'reader' })
    expect(byEmail.status).toBe(201)
    expect(byEmail.body).toMatchObject({ to: 'pat@example.com', emailed_to: 'pat@example.com' })
    expect(mailer.sent.slice(sent)).toEqual([expect.objectContaining({ to: 'pat@example.com', text: expect.stringContaining(String(byEmail.body?.link)) })])
    const resent = await api(asToken('engAdmin'), 'POST', `/api/v1/accounts/${slug()}/invites/${byEmail.body?.id}/resend`)
    expect(resent.status).toBe(200)
    conforms('invites.resend', resent.body)
    expect(resent.body?.link).not.toBe(byEmail.body?.link)
    expect(mailer.sent.at(-1)?.text).toContain(String(resent.body?.link))
    expect((await api(asToken('writer'), 'POST', `/api/v1/accounts/${slug()}/invites/${byEmail.body?.id}/resend`)).status).toBe(403)
    const invites = await api(asToken('engAdmin'), 'GET', `/api/v1/accounts/${slug()}/invites`)
    expect((invites.body?.invites as { id: string }[]).map((each) => each.id)).toContain(invite.body?.id)
    // A list never carries a link: it was shown once.
    expect((invites.body?.invites as Record<string, unknown>[]).every((each) => !('link' in each))).toBe(true)
    expect((await api(asToken('engAdmin'), 'DELETE', `/api/v1/accounts/${slug()}/invites/${invite.body?.id}`)).status).toBe(204)

    const system = await api(asToken('engAdmin'), 'POST', `/api/v1/accounts/${slug()}/system-accounts`, { name: `ci-${org.orgId.slice(0, 6)}`, grants: [{ place: 'space:eng', role: 'writer' }] })
    expect(system.status, JSON.stringify(system.body)).toBe(201)
    conforms('system-accounts.create', system.body)
    expect((await api(asToken('engAdmin'), 'POST', `/api/v1/accounts/${slug()}/system-accounts`, { name: `ci2-${org.orgId.slice(0, 6)}`, grants: [{ place: 'account', role: 'reader' }] })).status).toBe(403)
    const minted = await api(asToken('engAdmin'), 'POST', `/api/v1/accounts/${slug()}/system-accounts/${system.body?.id}/tokens`, { name: 'actions', days: 365 })
    expect(minted.status).toBe(201)
    expect(minted.body?.token).toMatch(/^dkt_sys_/)
    // The system account's own token reads what its grants reach, and acts as itself.
    const itself = await api({ bearer: minted.body?.token as string }, 'GET', '/api/v1/me')
    expect(itself.body).toMatchObject({ user: { kind: 'service' }, via: 'token' })
    const reach = await api({ bearer: minted.body?.token as string }, 'GET', `/api/v1/accounts/${slug()}/dockets/platform`)
    expect(reach.body?.caps).toEqual(['read', 'write', 'propose'])
    expect((await api(asToken('engAdmin'), 'DELETE', `/api/v1/accounts/${slug()}/system-accounts/${system.body?.id}/tokens/${minted.body?.id}`)).status).toBe(204)
    // Removing one takes managing access on the whole account, as in the app.
    expect((await api(asToken('engAdmin'), 'DELETE', `/api/v1/accounts/${slug()}/system-accounts/${system.body?.id}`)).status).toBe(403)
    expect((await api(owner, 'DELETE', `/api/v1/accounts/${slug()}/system-accounts/${system.body?.id}`)).status).toBe(204)

    // Who did it, and through what: the owner's token.
    const log = await api(asSession('owner'), 'GET', `/api/v1/accounts/${slug()}/audit?action=api.spaces.create`)
    conforms('audit.list', log.body)
    expect(log.body?.events).toContainEqual(expect.objectContaining({ action: 'api.spaces.create', outcome: 'ok', actor: `token:${(tokens.owner as string).slice(0, 16)}` }))
    const refusals = await api(asSession('owner'), 'GET', `/api/v1/accounts/${slug()}/audit?action=api.roles.create`)
    expect(new Set((refusals.body?.events as { outcome: string }[]).map((event) => event.outcome))).toEqual(new Set(['denied', 'ok']))
    expect((await api(asToken('writer'), 'GET', `/api/v1/accounts/${slug()}/audit`)).status).toBe(403)
    const usage = await api(owner, 'GET', `/api/v1/accounts/${slug()}/usage`)
    conforms('usage.get', usage.body)
  })

  it('lists users and system accounts, keeps the user list from guests, and leaves ownership to owners', async () => {
    const members = await api(asToken('reader'), 'GET', `/api/v1/accounts/${slug()}/members`)
    conforms('members.list', members.body)
    expect((members.body?.members as { id: string; role: string }[]).find((each) => each.id === ids.owner)?.role).toBe('Owner')
    expect((await api(asToken('guest'), 'GET', `/api/v1/accounts/${slug()}/members`)).status).toBe(403)
    expect((await api(asToken('admin'), 'PATCH', `/api/v1/accounts/${slug()}/members/${ids.admin}`, { owner: true })).status).toBe(403)
    const made = await api(asSession('owner'), 'PATCH', `/api/v1/accounts/${slug()}/members/${ids.admin}`, { owner: true })
    expect(made.body).toMatchObject({ owner: true, role: 'Owner' })
    expect((await api(asSession('owner'), 'PATCH', `/api/v1/accounts/${slug()}/members/${ids.admin}`, { owner: false })).body).toMatchObject({ owner: false })
    const renamed = await api(asSession('owner'), 'PATCH', `/api/v1/accounts/${slug()}`, { name: 'Acme Corp' })
    expect(renamed.body).toMatchObject({ name: 'Acme Corp', owner: true })
  })

  it('lets an owner alone transfer the account to another person, or delete it', async () => {
    const third = await org.addOrg()
    const acct = `o-${third.orgId}`
    const heir = await human(`heir${third.orgId.slice(0, 6)}`)
    await org.db.admin.query('INSERT INTO platform.memberships (org_id, user_id) VALUES ($1, $2)', [third.orgId, heir.id])
    await org.db.admin.query(
      "INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id) VALUES ($1, $2, $3, 'account', NULL, 'admin')",
      [`g_heir_${third.orgId}`, third.orgId, heir.id],
    )
    const founder: Credential = { session: await session(third.userId) }
    const admin: Credential = { session: await session(heir.id) }
    const adminToken: Credential = { bearer: await token(heir.id, { orgId: third.orgId }) }

    // An admin who is not an owner may do neither, by session or by token.
    for (const as of [admin, adminToken]) {
      const taken = await api(as, 'PATCH', `/api/v1/accounts/${acct}`, { owner: heir.login })
      expect(taken.status).toBe(403)
      expect(taken.body).toMatchObject({ error: 'forbidden' })
      expect((await api(as, 'DELETE', `/api/v1/accounts/${acct}`)).status).toBe(403)
    }
    expect((await api(founder, 'PATCH', `/api/v1/accounts/${acct}`, {})).status).toBe(400)

    const handed = await api(founder, 'PATCH', `/api/v1/accounts/${acct}`, { owner: heir.login })
    expect(handed.status).toBe(200)
    conforms('accounts.update', handed.body)
    expect(handed.body).toMatchObject({ owner: false })
    expect((await api(admin, 'GET', `/api/v1/accounts/${acct}`)).body).toMatchObject({ owner: true })
    expect((await api(founder, 'GET', `/api/v1/accounts/${acct}`)).body).toMatchObject({ owner: false })
    expect((await api(founder, 'DELETE', `/api/v1/accounts/${acct}`)).status).toBe(403)

    const deleted = await api(admin, 'DELETE', `/api/v1/accounts/${acct}`)
    expect(deleted.status).toBe(204)
    expect((await api(admin, 'GET', `/api/v1/accounts/${acct}`)).status).toBe(404)
    // Its tokens stopped working: they are no longer credentials at all.
    expect((await api(adminToken, 'GET', `/api/v1/accounts/${acct}`)).status).toBe(401)
    const { rows } = await org.db.admin.query<{ status: string }>('SELECT status FROM platform.orgs WHERE id = $1', [third.orgId])
    expect(rows[0]?.status).toBe('deleted')
  })

  it("lets the platform operator alone list accounts, set an account's limits and suspend it, by their own session", async () => {
    runtime.platformAdmins = new Set([other.login])
    const operator = asSession('otherOwner')
    // Anyone else, and any token, is refused: even the operator's own.
    expect((await api(asSession('owner'), 'GET', '/api/v1/operator/accounts')).status).toBe(403)
    expect((await api(asToken('otherOwner'), 'GET', '/api/v1/operator/accounts')).status).toBe(403)

    const listed = await api(operator, 'GET', '/api/v1/operator/accounts')
    expect(listed.status).toBe(200)
    conforms('operator.accounts.list', listed.body)
    const mine = (listed.body?.accounts as { slug: string }[]).find((each) => each.slug === slug())
    expect(mine).toMatchObject({ owners: [org.login], status: 'active', limits: { max_members: null, max_dockets: null } })
    // Nothing of an account's content: not even its dockets' names.
    expect(JSON.stringify(listed.body)).not.toMatch(/Payments|Platform|Engineering/)

    // Its own docket limit holds it below what it has: what it has stays, nothing new is made.
    const limited = await api(operator, 'PATCH', `/api/v1/operator/accounts/${slug()}`, { max_dockets: 1 })
    expect(limited.status).toBe(200)
    conforms('operator.accounts.update', limited.body)
    const refused = await api(asToken('owner'), 'POST', `/api/v1/accounts/${slug()}/dockets`, { space: 'general', name: 'One more', template: 'blank' })
    expect(refused.status).toBe(403)
    expect(refused.body).toMatchObject({ error: 'forbidden', error_description: 'This account holds at most 1 dockets.' })
    expect((await api(operator, 'PATCH', `/api/v1/operator/accounts/${slug()}`, { max_dockets: null })).body).toMatchObject({ limits: { max_dockets: null } })
    expect((await api(operator, 'PATCH', `/api/v1/operator/accounts/${slug()}`, {})).status).toBe(400)
    expect((await api(operator, 'PATCH', '/api/v1/operator/accounts/no-such-account', { max_members: 3 })).status).toBe(404)

    // Suspended, the account is not served to anyone, its own owner's token included; resumed, it is again.
    const suspended = await api(operator, 'PATCH', `/api/v1/operator/accounts/${otherSlug()}`, { suspended: true, reason: 'Test' })
    expect(suspended.body).toMatchObject({ status: 'suspended', suspended: { by: other.login, reason: 'Test' } })
    expect((await api(asToken('otherOwner'), 'GET', `/api/v1/accounts/${otherSlug()}`)).status).toBe(401)
    expect((await api(operator, 'GET', `/api/v1/accounts/${otherSlug()}`)).status).toBe(404)
    expect((await api(operator, 'PATCH', `/api/v1/operator/accounts/${otherSlug()}`, { suspended: false })).body).toMatchObject({ status: 'active', suspended: null })
    expect((await api(asToken('otherOwner'), 'GET', `/api/v1/accounts/${otherSlug()}`)).status).toBe(200)

    // Each change is in the platform's own log, with who made it.
    const { rows } = await org.db.admin.query<{ action: string; actor: string }>(
      "SELECT action, actor FROM platform.audit_event WHERE action = 'api.operator.accounts.update' AND outcome = 'ok' ORDER BY seq",
    )
    expect(rows.length).toBeGreaterThanOrEqual(4)
    expect(new Set(rows.map((row) => row.actor))).toEqual(new Set([`user:${other.userId}`]))
  })
})
