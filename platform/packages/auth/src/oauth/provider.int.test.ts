// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { tenantRouter, type TenantRouter, type Tx } from '@docket/platform-tenancy'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseMcpResourceUrl } from '../principal.js'
import { tokenResolver } from '../tokens/lookup.js'
import { approveConsent, denyConsent, describeConsent, interactionCookieValid, newGrantId } from './consent.js'
import { ConnectionError, createConnection } from './connections.js'
import { DEVICE_CODE_GRANT, PAGE_CSP, createOAuthServer, oauthCookieKeys, type OAuthEndpoint, type OAuthServer } from './provider.js'
import { authorizationServerMetadata } from './resource-metadata.js'

/** Just enough of a cookie jar for one browser: names to values, paths ignored. */
function jar() {
  const cookies = new Map<string, string>()
  return {
    take(response: Response) {
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(';')
        const at = pair?.indexOf('=') ?? -1
        if (pair && at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1))
      }
    },
    header: () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
    get: (name: string) => cookies.get(name),
  }
}

const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata'
const WEB_APP = 'https://app.example/oauth/metadata'

/** Claude Code's metadata document as claude.ai serves it: loopback redirects without a port, and no application_type. */
const METADATA_DOCUMENTS: Record<string, Record<string, unknown>> = {
  [CLAUDE_CODE]: {
    client_id: CLAUDE_CODE,
    client_name: 'Claude Code',
    client_uri: 'https://claude.ai',
    redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  },
  [WEB_APP]: {
    client_id: WEB_APP,
    client_name: 'A web app',
    redirect_uris: ['https://app.example/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  },
}

describe.skipIf(!TEST_PG_URL)('the OAuth authorization server', () => {
  let db: TestDatabase
  let router: TenantRouter
  let oauth: OAuthServer
  let server: Server
  let origin = ''
  const keys = oauthCookieKeys(randomBytes(32))
  const platform = <T>(fn: (tx: Tx) => Promise<T>) => router.withPlatform(fn)
  const workspaces: Record<string, string> = { platform: 'ws1', data: 'ws2' }
  /** Whether the next pending device poll is within the interval; a test turns it off to see `slow_down`. */
  let pollAllowed = true
  /** The endpoint the rate limit refuses, and what it was asked about; a test sets it to see a 429. */
  let refuse: OAuthEndpoint | null = null
  const limited: OAuthEndpoint[] = []
  /** The client each token or revocation request was counted against, after its address. */
  const named: string[] = []
  /** Token and revocation requests a minute from the test's one address, across clients; a test lowers it. */
  let tokenCeiling = Infinity
  let tokenRequests = 0

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
    await db.admin.query(`
      INSERT INTO platform.users (id, kind, github_id, login) VALUES ('u-1', 'human', 1, 'alice');
      INSERT INTO platform.orgs (id, slug, name, status, created_by) VALUES ('orga', 'acme', 'Acme', 'active', 'u-1');
      INSERT INTO platform.memberships (org_id, user_id) VALUES ('orga', 'u-1');
      INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id) VALUES ('g1', 'orga', 'u-1', 'docket', 'ws1', 'writer');
    `)
    server = createServer((req, res) => oauth.callback(req, res))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    oauth = createOAuthServer({
      issuer: origin,
      platform,
      cookieKeys: keys,
      isHuman: async (id) => id === 'u-1',
      resourceFor: async (url) => {
        const parsed = parseMcpResourceUrl(origin, url)
        const workspaceId = parsed?.orgSlug === 'acme' ? workspaces[parsed.workspaceSlug] : undefined
        return workspaceId ? { orgId: 'orga', workspaceId } : null
      },
      devicePoll: async () => pollAllowed,
      // Metadata documents, served as their clients publish them.
      fetch: async (input) => {
        const document = METADATA_DOCUMENTS[String(input instanceof Request ? input.url : input)]
        return document
          ? new Response(JSON.stringify(document), { headers: { 'content-type': 'application/json' } })
          : new Response('not found', { status: 404 })
      },
      rateLimit: async (endpoint, _req, clientId) => {
        if (clientId) {
          expect(['token', 'revocation']).toContain(endpoint)
          named.push(clientId)
          return null
        }
        limited.push(endpoint)
        if ((endpoint === 'token' || endpoint === 'revocation') && ++tokenRequests > tokenCeiling) {
          return { message: 'Rate limit reached: at most 5 token requests a minute per address.', retryAfterSeconds: 12 }
        }
        return endpoint === refuse ? { message: 'Rate limit reached: at most 60 client registrations a minute per address.', retryAfterSeconds: 6 } : null
      },
    })
  }, 60_000)

  afterAll(async () => {
    server?.close()
    await db?.drop()
  })

  const form = (fields: Record<string, string>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  })

  async function register() {
    const response = await fetch(`${origin}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Test client',
        redirect_uris: ['http://127.0.0.1:9/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    })
    const body = (await response.json()) as { client_id: string }
    expect(response.status, JSON.stringify(body)).toBe(201)
    return body.client_id
  }

  /** The browser's part: authorize, consent, resume; returns the code. */
  async function authorize(clientId: string, resource: string, verifier: string) {
    const browser = jar()
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://127.0.0.1:9/callback',
      response_type: 'code',
      scope: 'docket:read docket:write',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource,
      state: 'st',
    })
    const start = await fetch(`${origin}/oauth/authorize?${query}`, { redirect: 'manual' })
    browser.take(start)
    const consentAt = new URL(start.headers.get('location') ?? '', origin)
    expect(consentAt.pathname).toMatch(/^\/oauth\/consent\/[\w-]+$/)
    const uid = consentAt.pathname.split('/').pop() as string

    expect(interactionCookieValid({ get: browser.get }, uid, keys)).toBe(true)
    expect(interactionCookieValid({ get: browser.get }, 'someone-else', keys)).toBe(false)
    expect(interactionCookieValid({ get: browser.get }, uid, oauthCookieKeys(randomBytes(32)))).toBe(false)

    const consent = await describeConsent(oauth.provider, uid)
    expect(consent).toMatchObject({ clientName: 'Test client', redirectHost: '127.0.0.1:9', localApp: true, resource, requested: ['docket:read', 'docket:write'] })
    // As the consent page does: the named connection, here one that reads only, is written before the grant it names.
    const grantId = newGrantId()
    await platform((tx) => createConnection(tx, { grantId, orgId: 'orga', userId: 'u-1', clientId, name: 'Test client — Mac', readOnly: true, dockets: ['ws1'] }))
    const { continueTo: returnTo } = await approveConsent(oauth.provider, uid, { accountId: 'u-1', resource, grantId })
    const resumed = await fetch(returnTo, { redirect: 'manual', headers: { cookie: browser.header() } })
    expect(resumed.status).toBe(303)
    const back = new URL(resumed.headers.get('location') ?? '', origin)
    expect(back.origin + back.pathname, back.toString()).toBe('http://127.0.0.1:9/callback')
    expect(back.origin + back.pathname).toBe('http://127.0.0.1:9/callback')
    expect(back.searchParams.get('state')).toBe('st')
    return back.searchParams.get('code') as string
  }

  it('issues an opaque token for one workspace only, through code + PKCE + resource', async () => {
    const clientId = await register()
    const resource = `${origin}/mcp/acme/platform`
    const verifier = randomBytes(32).toString('base64url')
    const code = await authorize(clientId, resource, verifier)

    const wrong = await fetch(`${origin}/oauth/token`, form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: 'http://127.0.0.1:9/callback', code_verifier: 'x'.repeat(43), resource }))
    expect(wrong.status).toBe(400)

    const code2 = await authorize(clientId, resource, verifier)
    const exchanged = await fetch(`${origin}/oauth/token`, form({ grant_type: 'authorization_code', code: code2, client_id: clientId, redirect_uri: 'http://127.0.0.1:9/callback', code_verifier: verifier, resource }))
    expect(exchanged.status).toBe(200)
    const tokens = (await exchanged.json()) as { access_token: string; refresh_token: string; expires_in: number; scope: string; token_type: string }
    // The token carries what the client asked for; the connection decides what it can do.
    expect(tokens).toMatchObject({ expires_in: 900, scope: 'docket:read docket:write', token_type: 'Bearer' })
    expect(tokens.access_token.split('.')).toHaveLength(1)

    // Nothing in the store holds a usable token.
    const { rows } = await db.superuser.query('SELECT id_hash, payload::text FROM platform.oauth_store')
    expect(JSON.stringify(rows)).not.toContain(tokens.access_token)
    expect(JSON.stringify(rows)).not.toContain(tokens.refresh_token)

    const resolver = tokenResolver({ platform })
    const here = await resolver.resolveBearer(tokens.access_token, { url: resource, orgId: 'orga', workspaceId: 'ws1' })
    expect(here).toMatchObject({
      userId: 'u-1',
      via: 'oauth',
      clientId,
      readOnly: true,
      dockets: ['ws1'],
      credentialName: 'Test client — Mac',
      scopes: ['docket:read', 'ontology:read'],
      actor: `oauth:${clientId}/conn:${here?.tokenId}/user:u-1`,
    })
    expect(await resolver.resolveBearer(tokens.access_token, { url: `${origin}/mcp/acme/data`, orgId: 'orga', workspaceId: 'ws2' })).toBeNull()

    // Refresh tokens rotate: the new one works once, the old one never again.
    const refreshed = await fetch(`${origin}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }))
    expect(refreshed.status).toBe(200)
    const next = (await refreshed.json()) as { access_token: string; refresh_token: string }
    expect(next.refresh_token).not.toBe(tokens.refresh_token)
    const replay = await fetch(`${origin}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }))
    expect(replay.status).toBe(400)

    // Revoking the token ends it.
    const fresh = tokenResolver({ platform })
    const revoked = await fetch(`${origin}/oauth/revoke`, form({ token: next.access_token, client_id: clientId }))
    expect(revoked.status).toBe(200)
    expect(await fresh.resolveBearer(next.access_token, { url: resource, orgId: 'orga', workspaceId: 'ws1' })).toBeNull()
  })

  it('refuses a connection naming a docket its owner cannot reach', async () => {
    await expect(
      platform((tx) =>
        createConnection(tx, { grantId: `g-${randomBytes(8).toString('hex')}`, orgId: 'orga', userId: 'u-1', clientId: 'test-client', name: 'Test', readOnly: false, dockets: ['ws2'] }),
      ),
    ).rejects.toBeInstanceOf(ConnectionError)
  })

  it('approves the grant under exactly the id its connection was already written for, so a grant can never go live before its narrowing row', async () => {
    const clientId = await register()
    const resource = `${origin}/mcp/acme/platform`
    const verifier = randomBytes(32).toString('base64url')
    const browser = jar()
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://127.0.0.1:9/callback',
      response_type: 'code',
      scope: 'docket:read docket:write',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource,
      state: 'st',
    })
    const start = await fetch(`${origin}/oauth/authorize?${query}`, { redirect: 'manual' })
    browser.take(start)
    const uid = new URL(start.headers.get('location') ?? '', origin).pathname.split('/').pop() as string
    const grantId = newGrantId()
    // As the consent page does: the connection is written under this id before the grant that will carry it exists.
    await platform((tx) => createConnection(tx, { grantId, orgId: 'orga', userId: 'u-1', clientId, name: 'Pre-written', readOnly: true, dockets: ['ws1'] }))
    const { continueTo } = await approveConsent(oauth.provider, uid, { accountId: 'u-1', resource, grantId })
    const resumed = await fetch(continueTo, { redirect: 'manual', headers: { cookie: browser.header() } })
    const code = new URL(resumed.headers.get('location') ?? '', origin).searchParams.get('code') as string
    const exchanged = await fetch(`${origin}/oauth/token`, form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: 'http://127.0.0.1:9/callback', code_verifier: verifier, resource }))
    const tokens = (await exchanged.json()) as { access_token: string }
    const bound = await tokenResolver({ platform }).resolveBearer(tokens.access_token, { url: resource, orgId: 'orga', workspaceId: 'ws1' })
    expect(bound).toMatchObject({ readOnly: true, dockets: ['ws1'], scopes: ['docket:read', 'ontology:read'], tokenId: grantId, credentialName: 'Pre-written' })
  })

  it('never trades a code or a refresh token granted for one workspace for a token on another (tenancy design §5.2)', async () => {
    const clientId = await register()
    const resource = `${origin}/mcp/acme/platform`
    const other = `${origin}/mcp/acme/data`
    const verifier = randomBytes(32).toString('base64url')
    const exchange = async (code: string, asked: string) =>
      fetch(`${origin}/oauth/token`, form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: 'http://127.0.0.1:9/callback', code_verifier: verifier, resource: asked }))

    const crossed = await exchange(await authorize(clientId, resource, verifier), other)
    expect(crossed.status).toBe(400)
    expect(await crossed.json()).toMatchObject({ error: 'invalid_target' })

    const issued = await exchange(await authorize(clientId, resource, verifier), resource)
    expect(issued.status).toBe(200)
    const { refresh_token } = (await issued.json()) as { refresh_token: string }
    const refreshed = await fetch(`${origin}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token, client_id: clientId, resource: other }))
    expect(refreshed.status).toBe(400)
    expect(await refreshed.json()).toMatchObject({ error: 'invalid_target' })
    // Nothing the server stored is bound to the other workspace.
    const { rows } = await db.superuser.query("SELECT model FROM platform.oauth_store WHERE resource = $1 AND model <> 'Grant'", [other])
    expect(rows).toEqual([])
  })

  it("takes a loopback redirect on any port for a native client's metadata document, as Claude Code signs in (RFC 8252 §7.3)", async () => {
    const authorizeAt = (clientId: string, redirectUri: string) =>
      fetch(
        `${origin}/oauth/authorize?${new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'docket:read',
          code_challenge: createHash('sha256').update(randomBytes(32).toString('base64url')).digest('base64url'),
          code_challenge_method: 'S256',
          resource: `${origin}/mcp/acme/platform`,
          state: 'st',
        })}`,
        { redirect: 'manual' },
      )
    for (const redirect of ['http://localhost:53123/callback', 'http://127.0.0.1:61001/callback', 'http://localhost/callback']) {
      const start = await authorizeAt(CLAUDE_CODE, redirect)
      expect(start.status, `${redirect}: ${await start.clone().text()}`).toBe(303)
      expect(new URL(start.headers.get('location') ?? '', origin).pathname).toMatch(/^\/oauth\/consent\/[\w-]+$/)
    }
    // Only the port varies: another path or host is still refused, and a web client's redirect must match exactly.
    for (const [client, redirect] of [
      [CLAUDE_CODE, 'http://localhost:53123/elsewhere'],
      [CLAUDE_CODE, 'http://evil.example:53123/callback'],
      [WEB_APP, 'https://app.example:8443/callback'],
    ] as const) {
      const refused = await authorizeAt(client, redirect)
      expect(refused.status, redirect).toBe(400)
      expect(await refused.text()).toContain('redirect_uri did not match')
    }
  })

  it('rate limits token and revocation requests by address, and by the client they name only when it exists', async () => {
    const clientId = await register()
    named.length = 0
    const known = await fetch(`${origin}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: 'nope', client_id: clientId }))
    expect(known.status).toBe(400)
    expect(await known.json()).toMatchObject({ error: 'invalid_grant' })
    const basic = await fetch(`${origin}/oauth/token`, {
      ...form({ grant_type: 'refresh_token', refresh_token: 'nope' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:secret`).toString('base64')}` },
    })
    expect(basic.status).toBe(401)
    const unknown = await fetch(`${origin}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: 'nope', client_id: 'no-such-client' }))
    expect(unknown.status).toBe(401)
    const anonymous = await fetch(`${origin}/oauth/revoke`, form({ token: 'nope' }))
    expect(anonymous.status).toBe(400)
    expect(named).toEqual([clientId, clientId])
  })

  it('refuses a flood of made-up client ids from one address at the address limit, counting none per client', async () => {
    named.length = 0
    tokenRequests = 0
    tokenCeiling = 5
    try {
      const statuses: number[] = []
      for (let i = 0; i < 8; i += 1) {
        const response = await fetch(`${origin}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: 'x', client_id: randomBytes(8).toString('hex') }))
        statuses.push(response.status)
        if (response.status === 429) expect(response.headers.get('retry-after')).toBe('12')
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429, 429])
      expect(named).toEqual([])
    } finally {
      tokenCeiling = Infinity
    }
  })

  it('refuses a resource that is no workspace', async () => {
    const clientId = await register()
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://127.0.0.1:9/callback',
      response_type: 'code',
      scope: 'docket:read',
      code_challenge: createHash('sha256').update('v'.repeat(43)).digest('base64url'),
      code_challenge_method: 'S256',
      resource: `${origin}/mcp/acme/nope`,
    })
    const response = await fetch(`${origin}/oauth/authorize?${query}`, { redirect: 'manual' })
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('error')).toBe('invalid_target')
  })

  it('rate limits every endpoint before it does any work (§19)', async () => {
    limited.length = 0
    refuse = 'registration'
    const clients = async () => (await db.superuser.query("SELECT count(*)::int AS n FROM platform.oauth_store WHERE model = 'Client'")).rows[0].n as number
    const before = await clients()
    try {
      const response = await fetch(`${origin}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'Flood', redirect_uris: ['http://127.0.0.1:9/callback'], token_endpoint_auth_method: 'none' }),
      })
      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe('6')
      expect(await response.json()).toEqual({ error: 'rate_limited', error_description: expect.stringContaining('client registrations') })
      expect(await clients()).toBe(before)

      refuse = 'code_verification'
      const page = await fetch(`${origin}/oauth/device`)
      expect(page.status).toBe(429)
      expect(page.headers.get('content-type')).toMatch(/^text\/plain/)
    } finally {
      refuse = null
    }
    await register()
    expect(limited).toEqual(['registration', 'code_verification', 'registration'])
  })

  it('takes no client authentication that makes it fetch a URL, and never fetches a sector_identifier_uri', async () => {
    let fetched = 0
    const target = createServer((_req, res) => {
      fetched += 1
      res.writeHead(200, { 'content-type': 'application/json' }).end('["http://127.0.0.1:9/callback"]')
    })
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
    const at = `http://127.0.0.1:${(target.address() as AddressInfo).port}`
    try {
      const registerWith = (fields: Record<string, unknown>) =>
        fetch(`${origin}/oauth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ client_name: 'Fetcher', redirect_uris: ['http://127.0.0.1:9/callback'], ...fields }),
        })
      for (const method of ['private_key_jwt', 'client_secret_jwt']) {
        const refused = await registerWith({ token_endpoint_auth_method: method, jwks_uri: `${at}/jwks` })
        expect(refused.status, method).toBe(400)
        expect(((await refused.json()) as { error: string }).error).toBe('invalid_client_metadata')
      }
      // A fetch of this would fail (.invalid never resolves) and refuse the registration.
      const sector = await registerWith({ token_endpoint_auth_method: 'none', sector_identifier_uri: 'https://sector.invalid/uris' })
      expect(sector.status, await sector.clone().text()).toBe(201)
      expect(fetched).toBe(0)
    } finally {
      target.close()
    }
  })

  it('serves the endpoints its metadata names', async () => {
    const metadata = authorizationServerMetadata(origin)
    const own = (await (await fetch(`${origin}/.well-known/openid-configuration`)).json()) as Record<string, unknown>
    for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint', 'jwks_uri', 'device_authorization_endpoint'] as const) {
      expect(metadata[key], key).toBe(own[key])
    }
    expect(own.code_challenge_methods_supported).toEqual(['S256'])
    expect(own.token_endpoint_auth_methods_supported).toEqual(metadata.token_endpoint_auth_methods_supported)
    expect(own.client_id_metadata_document_supported).toBe(true)
    expect(metadata.device_authorization_endpoint).toBe(`${origin}/oauth/device/auth`)
    expect(metadata.grant_types_supported).toContain(DEVICE_CODE_GRANT)
    expect(own.grant_types_supported).toContain(DEVICE_CODE_GRANT)
  })

  describe('the device authorization grant (RFC 8628) for docket-cli', () => {
    const resource = () => `${origin}/mcp/acme/platform`
    const start = async () => {
      const response = await fetch(`${origin}/oauth/device/auth`, form({ client_id: 'docket-cli', scope: 'docket:read docket:write ontology:read ontology:propose', resource: resource() }))
      expect(response.status).toBe(200)
      return (await response.json()) as { device_code: string; user_code: string; verification_uri: string; verification_uri_complete: string; expires_in: number; interval: number }
    }
    const poll = (deviceCode: string) =>
      fetch(`${origin}/oauth/token`, form({ grant_type: DEVICE_CODE_GRANT, device_code: deviceCode, client_id: 'docket-cli', resource: resource() }))
    const field = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? ''

    /** The browser's part: the code entry page, its confirmation, and on to the consent screen; returns the interaction uid. */
    async function enterCode(browser: ReturnType<typeof jar>, userCode: string): Promise<string> {
      const opened = await fetch(`${origin}/oauth/device?${new URLSearchParams({ user_code: userCode })}`, { headers: { cookie: browser.header() } })
      browser.take(opened)
      // The pages this server renders itself carry the web app's CSP (§19); this one's auto-submit script by its hash.
      expect(opened.headers.get('content-security-policy')).toMatch(/script-src 'self' 'sha256-[\w+/=]+'/)
      const xsrf = field(await opened.text(), 'xsrf')
      expect(xsrf).not.toBe('')
      const confirm = await fetch(`${origin}/oauth/device`, { ...form({ xsrf, user_code: userCode }), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: browser.header() } })
      browser.take(confirm)
      expect(confirm.headers.get('content-security-policy')).toBe(PAGE_CSP)
      const page = await confirm.text()
      expect(page).toContain(userCode)
      const confirmed = await fetch(`${origin}/oauth/device`, {
        ...form({ xsrf: field(page, 'xsrf'), user_code: userCode, confirm: 'yes' }),
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: browser.header() },
        redirect: 'manual',
      })
      browser.take(confirmed)
      const consentAt = new URL(confirmed.headers.get('location') ?? '', origin)
      expect(consentAt.pathname).toMatch(/^\/oauth\/consent\/[\w-]+$/)
      return consentAt.pathname.split('/').pop() as string
    }

    it('starts with a code, an interval, and the code entry page', async () => {
      const started = await start()
      expect(started).toMatchObject({ verification_uri: `${origin}/oauth/device`, expires_in: 600, interval: 5 })
      expect(started.user_code).toMatch(/^[B-DF-HJ-NP-TV-XZ]{4}-[B-DF-HJ-NP-TV-XZ]{4}$/)
      expect(started.verification_uri_complete).toBe(`${origin}/oauth/device?user_code=${encodeURIComponent(started.user_code)}`)
    })

    it('answers authorization_pending, slow_down for a device polling too fast, and tokens once approved', async () => {
      const started = await start()
      const pending = await poll(started.device_code)
      expect(pending.status).toBe(400)
      expect(await pending.json()).toMatchObject({ error: 'authorization_pending' })
      pollAllowed = false
      expect(await (await poll(started.device_code)).json()).toMatchObject({ error: 'slow_down' })
      pollAllowed = true

      const browser = jar()
      const uid = await enterCode(browser, started.user_code)
      expect(interactionCookieValid({ get: browser.get }, uid, keys)).toBe(true)
      const consent = await describeConsent(oauth.provider, uid)
      expect(consent).toMatchObject({ clientId: 'docket-cli', clientName: 'docket CLI', device: true, preRegistered: true, resource: resource() })
      expect(consent?.requested).toEqual(['docket:read', 'docket:write', 'ontology:read', 'ontology:propose'])
      const grantId = newGrantId()
      await platform((tx) => createConnection(tx, { grantId, orgId: 'orga', userId: 'u-1', clientId: 'docket-cli', name: 'docket CLI', readOnly: false, dockets: ['ws1'] }))
      const { continueTo: returnTo } = await approveConsent(oauth.provider, uid, { accountId: 'u-1', resource: resource(), grantId })
      const resumed = await fetch(returnTo, { headers: { cookie: browser.header() } })
      expect(resumed.status).toBe(200)
      expect(await resumed.text()).toContain('Your terminal is signed in')

      const issued = await poll(started.device_code)
      expect(issued.status).toBe(200)
      const tokens = (await issued.json()) as { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string }
      expect(tokens).toMatchObject({ expires_in: 900, token_type: 'Bearer', scope: 'docket:read docket:write ontology:read ontology:propose' })
      expect(tokens.refresh_token).toEqual(expect.any(String))
      const principal = await tokenResolver({ platform }).resolveBearer(tokens.access_token, { url: resource(), orgId: 'orga', workspaceId: 'ws1' })
      expect(principal).toMatchObject({ userId: 'u-1', via: 'oauth', clientId: 'docket-cli', readOnly: false, credentialName: 'docket CLI' })
      // A device code works once.
      expect(await (await poll(started.device_code)).json()).toMatchObject({ error: 'invalid_grant' })

      // The store holds neither the device code nor the user code.
      const { rows } = await db.superuser.query('SELECT payload::text, uid FROM platform.oauth_store')
      expect(JSON.stringify(rows)).not.toContain(started.device_code)
      expect(JSON.stringify(rows)).not.toContain(started.user_code.replace('-', ''))
    })

    it('answers access_denied when the user denies, and a typed code that is wrong on the entry page', async () => {
      const started = await start()
      const browser = jar()
      const uid = await enterCode(browser, started.user_code)
      const returnTo = await denyConsent(oauth.provider, uid)
      await fetch(returnTo, { headers: { cookie: browser.header() } })
      expect(await (await poll(started.device_code)).json()).toMatchObject({ error: 'access_denied' })

      const opened = await fetch(`${origin}/oauth/device`)
      browser.take(opened)
      const wrong = await fetch(`${origin}/oauth/device`, {
        ...form({ xsrf: field(await opened.text(), 'xsrf'), user_code: 'BBBB-BBBB' }),
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: browser.header() },
      })
      expect(await wrong.text()).toContain('not one this server issued')
    })

    it('is for docket-cli only: a registered client can neither take the grant nor start it', async () => {
      const registered = await fetch(`${origin}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'Not the CLI', redirect_uris: [], response_types: [], token_endpoint_auth_method: 'none', grant_types: [DEVICE_CODE_GRANT] }),
      })
      expect(registered.status).toBe(400)
      expect(await registered.json()).toMatchObject({ error: 'invalid_client_metadata' })

      const clientId = await register()
      const refused = await fetch(`${origin}/oauth/device/auth`, form({ client_id: clientId, scope: 'docket:read', resource: resource() }))
      expect(refused.status).toBe(400)
      expect(await refused.json()).toMatchObject({ error: 'invalid_request', error_description: `${DEVICE_CODE_GRANT} is not allowed for this client` })
    })
  })
})
