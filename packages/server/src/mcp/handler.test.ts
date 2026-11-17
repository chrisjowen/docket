import { describe, expect, it, vi } from 'vitest'

import type { Role } from '../auth/roles.js'
import type { Scope } from '../auth/scopes.js'
import type { AuditEventInput, AuditSink, Principal, StoreContext } from '../ports.js'
import { bearerChallenge, credentialInUrl, handleMcp, protectedResourceMetadataUrl, type McpHandlerOptions } from './handler.js'
import { SERVER_INSTRUCTIONS } from './tools/index.js'

const RESOURCE = { url: 'https://docket.test/mcp/platform', workspaceId: 'ws1' }

const principal = (scopes: Scope[]): Principal => ({ subject: 'u-alice', workspaceId: 'ws1', scopes, actor: 'token:alice', expiresAt: new Date('2027-01-01') })

/** The handler with fake ports: `token-valid` is the one credential, carrying `scopes`; its subject has `role`. */
function setup(options: { scopes?: Scope[]; role?: Role | null; overrides?: Partial<McpHandlerOptions> } = {}) {
  const events: { ctx: StoreContext | null; event: AuditEventInput }[] = []
  const sink: AuditSink = { record: vi.fn(async (ctx, event) => void events.push({ ctx, event })) }
  const refused = { blocked: vi.fn(() => null), record: vi.fn(async () => undefined) }
  const resolve = vi.fn(async (bearer: string) => (bearer === 'token-valid' ? principal(options.scopes ?? ['docket:read', 'docket:write', 'ontology:propose']) : null))
  const handlerOptions: McpHandlerOptions = {
    resourceUrl: RESOURCE.url,
    resource: RESOURCE,
    authenticator: { resolve },
    authorizer: { role: async () => (options.role === undefined ? 'editor' : options.role) },
    audit: () => sink,
    store: () => ({ run: vi.fn() }),
    query: () => ({ search: vi.fn(), ask: vi.fn() }),
    links: () => ({ viewer: 'https://docket.test/w/platform/graph', ontologyHistory: 'https://docket.test/w/platform/ontology/history' }),
    refusedCredentials: refused,
    requestId: 'req-1',
    ip: '203.0.113.9',
    userAgent: 'test-client',
    ...options.overrides
  }
  const post = (body: unknown, init: { token?: string | null; url?: string; headers?: Record<string, string> } = {}) =>
    handleMcp(
      new Request(init.url ?? RESOURCE.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? 'token-valid'}` }),
          ...init.headers
        },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      }),
      handlerOptions
    )
  return { post, events, refused, resolve }
}

const rpc = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) })

describe('the MCP handler', () => {
  it('asks for a bearer credential with a challenge naming the resource metadata', async () => {
    const { post, events } = setup()
    const response = await post(rpc('tools/list'), { token: null })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://docket.test/.well-known/oauth-protected-resource/mcp/platform", scope="docket:read"'
    )
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(events).toEqual([])
  })

  it('refuses a token in the URL before looking it up, and records the refusal', async () => {
    const { post, refused, resolve } = setup()
    const response = await post(rpc('tools/list'), { url: `${RESOURCE.url}?access_token=token-valid` })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'invalid_request' })
    expect(resolve).not.toHaveBeenCalled()
    expect(refused.record).toHaveBeenCalledWith('mcp.auth', 'invalid')
    expect(credentialInUrl(new URL('https://x.test/mcp?q=dkt_live_abc'))).toBe(true)
    expect(credentialInUrl(new URL('https://x.test/mcp?q=orders'))).toBe(false)
  })

  it('refuses a credential that does not resolve, or a workspace that is not there, as invalid_token', async () => {
    const { post, refused } = setup()
    const response = await post(rpc('tools/list'), { token: 'token-unknown' })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"')
    expect(refused.record).toHaveBeenCalledWith('mcp.auth', 'denied')

    const nowhere = setup({ overrides: { resource: null } })
    expect((await nowhere.post(rpc('tools/list'))).status).toBe(401)
    expect(nowhere.resolve).not.toHaveBeenCalled()
  })

  it('answers instead when refused credentials are being limited, with its headers', async () => {
    const { post } = setup({ overrides: { refusedCredentials: { blocked: () => new Response('slow down', { status: 429 }), record: vi.fn() } } })
    const response = await post(rpc('tools/list'))
    expect(response.status).toBe(429)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('refuses a credential whose subject no longer has a role, auditing it once as denied', async () => {
    const { post, events } = setup({ role: null })
    const response = await post(rpc('tools/list'))
    expect(response.status).toBe(401)
    expect(events.map(({ event }) => [event.action, event.outcome])).toEqual([['mcp.auth', 'denied']])
  })

  it('refuses a tool the effective scopes do not reach with 403 insufficient_scope, naming the scope, audited once', async () => {
    const { post, events } = setup({ scopes: ['docket:read'] })
    const response = await post(rpc('tools/call', { name: 'docket_remember', arguments: { id: 'service.x' } }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'insufficient_scope' })
    expect(response.headers.get('www-authenticate')).toContain('scope="docket:write"')
    expect(events).toEqual([{ ctx: null, event: expect.objectContaining({ action: 'mcp.tools/call docket_remember', outcome: 'denied', target: ['service.x'], requestId: 'req-1', ip: '203.0.113.9', userAgent: 'test-client' }) }])
  })

  it('cuts a credential to its subject’s role now: a viewer’s write scopes reach nothing', async () => {
    const { post } = setup({ role: 'viewer' })
    const response = await post(rpc('tools/call', { name: 'docket_retire', arguments: { id: 'service.x', reason: 'gone' } }))
    expect(response.status).toBe(403)
  })

  it('lists only the tools the effective scopes allow, audited once as ok', async () => {
    const { post, events } = setup({ scopes: ['docket:read'] })
    const response = await post(rpc('tools/list'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { tools: { name: string }[] } }
    expect(body.result.tools.map((tool) => tool.name)).toEqual(['docket_search', 'docket_get', 'docket_ask', 'docket_ontology'])
    expect(events.map(({ event }) => [event.action, event.outcome, event.actor, event.workspaceId])).toEqual([['mcp.tools/list', 'ok', 'token:alice', 'ws1']])
  })

  it('answers initialize with the server instructions and the deployment’s server info', async () => {
    const { post } = setup({ overrides: { serverInfo: { name: 'docket', title: 'Docket', version: '1.0.0' } } })
    const response = await post(rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }))
    const body = (await response.json()) as { result: Record<string, unknown> }
    expect(body.result.instructions).toBe(SERVER_INSTRUCTIONS)
    expect(body.result.serverInfo).toEqual({ name: 'docket', title: 'Docket', version: '1.0.0' })
  })

  it('refuses what is not one JSON-RPC message, an unknown protocol version, and accepts a notification with 202', async () => {
    const { post, events } = setup()
    expect((await post('not json')).status).toBe(400)
    expect((await post([rpc('tools/list')])).status).toBe(400)
    expect((await post({ jsonrpc: '2.0', method: 'x', params: { pad: 'x'.repeat(1024 * 1024) } })).status).toBe(413)
    expect((await post(rpc('tools/list'), { headers: { 'mcp-protocol-version': '1999-01-01' } })).status).toBe(400)
    const notified = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(notified.status).toBe(202)
    expect(await notified.text()).toBe('')
    expect(events.map(({ event }) => event.outcome)).toEqual(['invalid', 'invalid', 'invalid', 'invalid', 'ok'])
  })

  it('sends the limiter’s answer instead, which audits itself', async () => {
    const limited = new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true } }), { status: 429, headers: { 'retry-after': '3' } })
    const check = vi.fn(async () => limited)
    const { post, events } = setup({ overrides: { limiter: { check } } })
    const response = await post(rpc('tools/call', { name: 'docket_search', arguments: { query: 'x' } }))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('3')
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ actor: 'token:alice' }), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'docket_search', arguments: { query: 'x' } } })
    expect(events).toEqual([])
  })

  it('answers a tool that throws with docket’s JSON-RPC internal error, audited as an error', async () => {
    const onError = vi.fn()
    const { post, events } = setup({ overrides: { onError, query: () => ({ search: vi.fn(async () => Promise.reject(new Error('boom'))), ask: vi.fn() }) } })
    const response = await post(rpc('tools/call', { name: 'docket_search', arguments: { query: 'orders' } }))
    const body = (await response.json()) as { error?: { code: number; message: string } }
    expect(body.error).toEqual({ code: -32603, message: 'boom' })
    expect(events.map(({ event }) => event.outcome)).toEqual(['error'])
    expect(onError).not.toHaveBeenCalled()
  })

  it('points a challenge at the resource’s protected resource metadata, without quotes that would break it', () => {
    expect(protectedResourceMetadataUrl('https://docket.test/mcp/a/b')).toBe('https://docket.test/.well-known/oauth-protected-resource/mcp/a/b')
    expect(bearerChallenge('https://docket.test/mcp', { error: 'insufficient_scope', description: 'needs "x"', scope: 'docket:write' })).toBe(
      'Bearer resource_metadata="https://docket.test/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", error_description="needs x", scope="docket:write"'
    )
  })
})
