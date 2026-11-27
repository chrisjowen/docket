// SPDX-License-Identifier: AGPL-3.0-only
import type { Principal } from '@docket/platform-auth'
import { memoryBucketStore, rateLimiter as bucketLimiter } from '@docket/platform-limits'
import type { RequestEvent } from '@sveltejs/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { rateLimiter } from './rate-limit'
import { accessRows } from './testing-access'

/** The audit events the pipeline writes. */
const audited: { action: string; outcome: string; actor: string; target: string[] }[] = []
let role: string | null = 'editor'
const tx = {
  async query(sql: string, params: unknown[] = []) {
    if (sql.includes('FROM audit_head FOR UPDATE')) return { rows: [{ hash: '0'.repeat(64) }] }
    if (sql.includes('INSERT INTO audit_event')) audited.push({ actor: params[4] as string, action: params[7] as string, target: params[8] as string[], outcome: params[10] as string })
    // The org `acme` has the workspace `main`; `other` is a workspace nobody's token is for.
    if (sql.includes('FROM platform.orgs') && params[0] === 'acme') return { rows: [{ id: 'orgacme' }] }
    if (sql.includes('FROM workspaces WHERE slug')) return { rows: [{ id: params[0] === 'main' ? 'wsmain' : 'wsother', slug: params[0], name: 'Main' }] }
    const access = accessRows(sql, role)
    if (access) return { rows: access }
    return { rows: [] }
  },
}

/**
 * `api-<id>` is an API token and `oauth-<id>` an OAuth access token, both for
 * acme/main with docket:read only; `elsewhere` is live for another workspace.
 */
const principal = (bearer: string): Principal | null => {
  const [kind, id] = bearer.split('-') as [string, string]
  if (kind !== 'api' && kind !== 'oauth') return null
  return {
    userId: 'u1',
    orgId: 'orgacme',
    workspaceId: 'wsmain',
    scopes: ['docket:read'],
    via: kind === 'api' ? 'token' : 'oauth',
    tokenId: id,
    actor: kind === 'api' ? `token:${id}` : `oauth:docket-cli/user:u1`,
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
  }
}
const runtime = {
  origin: 'https://docket.example',
  router: { withPlatform: <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx), withTenant: <T>(_org: string, fn: (t: typeof tx) => Promise<T>) => fn(tx) },
  tokens: {
    resolveBearer: async (bearer: string, resource: { workspaceId: string }) => (resource.workspaceId === 'wsmain' ? principal(bearer) : null),
    isLive: async (bearer: string) => bearer === 'elsewhere' || principal(bearer) !== null,
  },
  refusedAuth: rateLimiter({ limit: 100, windowMs: 60_000 }),
  limiter: bucketLimiter({ store: memoryBucketStore() }),
  keyring: { forOrg: async () => ({}) },
}
vi.mock('./runtime', () => ({ getRuntime: () => runtime }))

const { CliError, cliJson, handleCli } = await import('./cli-api')

function request(options: { bearer?: string | null; org?: string; ws?: string; query?: string; method?: string; body?: string; type?: string } = {}): RequestEvent {
  const org = options.org ?? 'acme'
  const ws = options.ws ?? 'main'
  const url = new URL(`https://docket.example/api/o/${org}/w/${ws}/me${options.query ?? ''}`)
  const headers: Record<string, string> = {}
  if (options.bearer !== null) headers.authorization = `Bearer ${options.bearer ?? 'api-tok1'}`
  if (options.type) headers['content-type'] = options.type
  return {
    url,
    params: { org, ws },
    request: new Request(url, { method: options.method ?? 'GET', headers, ...(options.body !== undefined ? { body: options.body } : {}) }),
    locals: { requestId: 'req', startedAt: performance.now() },
    getClientAddress: () => '192.0.2.40',
  } as unknown as RequestEvent
}

const ok = () => Promise.resolve(cliJson(200, { ok: true }))
const challenge = (extra = '') => `Bearer resource_metadata="https://docket.example/.well-known/oauth-protected-resource/mcp/acme/main"${extra}`

describe('the CLI API pipeline', () => {
  beforeEach(() => {
    audited.length = 0
    role = 'editor'
    // A stopped clock: no bucket refills mid-test, however slowly a loaded machine runs it.
    const at = Date.now()
    runtime.limiter = bucketLimiter({ store: memoryBucketStore({ now: () => at }), now: () => at })
  })

  it('answers a missing or bad bearer 401 invalid_token, with the MCP challenge', async () => {
    const missing = await handleCli(request({ bearer: null }), { action: 'me' }, ok)
    expect(missing.status).toBe(401)
    expect(await missing.json()).toEqual({ error: 'invalid_token', error_description: 'Send Authorization: Bearer <token>.' })
    expect(missing.headers.get('www-authenticate')).toBe(challenge(', scope="docket:read"'))

    const bad = await handleCli(request({ bearer: 'nonsense' }), { action: 'me' }, ok)
    expect(bad.status).toBe(401)
    expect(await bad.json()).toMatchObject({ error: 'invalid_token', error_description: expect.any(String) })
    expect(bad.headers.get('www-authenticate')).toContain('error="invalid_token"')
    // A token in the URL is refused before anything else.
    for (const query of ['?access_token=x', '?token=x', '?api_key=x', '?q=dkt_live_abc']) {
      const refused = await handleCli(request({ query }), { action: 'me' }, ok)
      expect(refused.status, query).toBe(400)
      expect(await refused.json()).toMatchObject({ error: 'invalid_request' })
    }
  })

  it("answers 404 not_found, with the error field, for another workspace or org, or one that doesn't exist", async () => {
    for (const where of [{ ws: 'other' }, { org: 'globex' }, { ws: 'nope', bearer: 'elsewhere' }]) {
      const response = await handleCli(request(where), { action: 'me' }, ok)
      expect(response.status, JSON.stringify(where)).toBe(404)
      expect(await response.json()).toMatchObject({ error: 'not_found', error_description: expect.any(String) })
    }
    // A bad token learns nothing about which workspaces exist.
    expect((await handleCli(request({ org: 'globex', bearer: 'nonsense' }), { action: 'me' }, ok)).status).toBe(401)
  })

  it('answers 403 insufficient_scope when the effective scopes fall short, and for an API token on a token route', async () => {
    const short = await handleCli(request(), { action: 'documents.push', scope: 'docket:write' }, ok)
    expect(short.status).toBe(403)
    expect(await short.json()).toEqual({ error: 'insufficient_scope', error_description: 'This needs the docket:write scope.' })
    expect(short.headers.get('www-authenticate')).toContain('scope="docket:write"')

    const minted = await handleCli(request({ bearer: 'api-tok1' }), { action: 'tokens.create', oauthOnly: true }, ok)
    expect(minted.status).toBe(403)
    expect(await minted.json()).toMatchObject({ error: 'insufficient_scope' })
    expect((await handleCli(request({ bearer: 'oauth-grant1' }), { action: 'tokens.create', oauthOnly: true }, ok)).status).toBe(200)
  })

  it('answers 401 once the caller is no longer a member', async () => {
    role = null
    const response = await handleCli(request(), { action: 'me' }, ok)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'invalid_token' })
  })

  it('writes one audit event per call, cli.<route>, as the credential', async () => {
    await handleCli(request(), { action: 'me' }, ok)
    expect(audited).toEqual([{ actor: 'token:tok1', action: 'cli.me', outcome: 'ok', target: [] }])
    audited.length = 0
    await handleCli(request(), { action: 'documents.push', scope: 'docket:write' }, ok)
    expect(audited).toEqual([{ actor: 'token:tok1', action: 'cli.documents.push', outcome: 'denied', target: [] }])
    audited.length = 0
    // A route that audits in its own transaction is not audited again.
    await handleCli(request(), { action: 'tokens.revoke' }, async (call) => {
      await call.audit(tx as never, { outcome: 'ok', target: ['tok_9'] })
      return new Response(null, { status: 204 })
    })
    expect(audited).toEqual([{ actor: 'token:tok1', action: 'cli.tokens.revoke', outcome: 'ok', target: ['tok_9'] }])
  })

  it("turns a route's refusal into its status and error, and a failure into 500 server_error", async () => {
    const refused = await handleCli(request(), { action: 'tokens.create' }, () => Promise.reject(new CliError(400, 'invalid_scope', 'Not that.')))
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({ error: 'invalid_scope', error_description: 'Not that.' })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failed = await handleCli(request(), { action: 'me' }, () => Promise.reject(new Error('boom')))
    expect(failed.status).toBe(500)
    expect(await failed.json()).toMatchObject({ error: 'server_error' })
    expect(audited.map((event) => event.outcome)).toEqual(['invalid', 'error'])
  })

  it('reads a JSON object body, and refuses anything else as invalid_request', async () => {
    const read = (body: string, type?: string) =>
      handleCli(request({ method: 'POST', body, ...(type ? { type } : {}) }), { action: 'tokens.create' }, async (call) => cliJson(200, await call.json()))
    expect(await (await read('{"scopes":["docket:read"]}', 'application/json')).json()).toEqual({ scopes: ['docket:read'] })
    for (const [body, type] of [['{}', 'text/plain'], ['not json', 'application/json'], ['[1]', 'application/json']] as const) {
      const response = await read(body, type)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'invalid_request' })
    }
  })

  it('applies the MCP rate limits: the 121st call in a minute is 429 rate_limited with Retry-After', async () => {
    for (let i = 0; i < 120; i += 1) expect((await handleCli(request(), { action: 'me' }, ok)).status).toBe(200)
    const limited = await handleCli(request(), { action: 'me' }, ok)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('1')
    expect(await limited.json()).toMatchObject({ error: 'rate_limited' })
    expect(audited.at(-1)).toMatchObject({ action: 'cli.me', outcome: 'denied', target: ['rate-limit:calls-per-token'] })
  })

  it('counts a write against the 30-a-minute write limit', async () => {
    const write = () => handleCli(request(), { action: 'documents.push', write: true }, ok)
    for (let i = 0; i < 30; i += 1) expect((await write()).status).toBe(200)
    const limited = await write()
    expect(limited.status).toBe(429)
    expect(audited.at(-1)).toMatchObject({ target: ['rate-limit:writes-per-token'] })
  })
})
