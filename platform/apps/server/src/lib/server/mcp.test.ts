// SPDX-License-Identifier: AGPL-3.0-only
import type { Principal } from '@docket/platform-auth'
import { memoryBucketStore, rateLimiter as bucketLimiter } from '@docket/platform-limits'
import type { SearchGraph } from '@docket/platform-mcp-tools'
import type { RequestEvent } from '@sveltejs/kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rateLimiter } from './rate-limit'

/** Every query the endpoint makes, and the audit events it writes. */
const queries: string[] = []
const audited: { action: string; outcome: string; target: string[]; ip: string | null }[] = []
const tx = {
  async query(sql: string, params: unknown[] = []) {
    queries.push(sql)
    if (sql.includes('FROM audit_head FOR UPDATE')) return { rows: [{ hash: '0'.repeat(64) }] }
    if (sql.includes('INSERT INTO audit_event')) audited.push({ ip: params[5] as string | null, action: params[7] as string, target: params[8] as string[], outcome: params[10] as string })
    // Only the org `busy` exists, with its workspace `main`, where every caller is a member.
    if (sql.includes('FROM platform.orgs') && params[0] === 'busy') return { rows: [{ id: 'orgbusy' }] }
    if (sql.includes('FROM workspaces WHERE slug')) return { rows: [{ id: 'wsmain', slug: 'main', name: 'Main', ontology_mcp_roles: [] }] }
    if (sql.includes('FROM platform.memberships')) return { rows: [{ role: 'viewer', account_role: 'read_only', permission: 'read' }] }
    return { rows: [] }
  },
}
const graph: SearchGraph = {
  schema: 'docket-search.v1',
  query: 'orders',
  project: { name: 'Main', root: 'main' },
  matches: [],
  nodes: [],
  links: [],
  paths: [],
  omitted: 0,
  types: [],
  sources: [],
  index: { synced: true, behind: 0 },
  viewer: null,
  warnings: [],
}
/** A bearer `ok-<id>` resolves to the API token `<id>`; every other bearer is refused. */
const principal = (bearer: string): Principal | null =>
  bearer.startsWith('ok-')
    ? { userId: 'u1', orgId: 'orgbusy', workspaceId: 'wsmain', scopes: ['docket:read'], via: 'token', tokenId: bearer.slice(3), actor: `token:${bearer.slice(3)}`, expiresAt: new Date(8.64e15) }
    : null
const runtime = {
  origin: 'https://docket.example',
  router: { withPlatform: <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx), withTenant: <T>(_org: string, fn: (t: typeof tx) => Promise<T>) => fn(tx) },
  tokens: { resolveBearer: async (bearer: string) => principal(bearer) },
  refusedAuth: rateLimiter({ limit: 3, windowMs: 60_000 }),
  limiter: bucketLimiter({ store: memoryBucketStore() }),
  query: { search: async () => graph, ask: async () => Promise.reject(new Error('not used')) },
}
vi.mock('./runtime', () => ({ getRuntime: () => runtime }))

const { handleMcp } = await import('./mcp')

function post(address: string, query = '', options: { org?: string; bearer?: string; body?: unknown } = {}): RequestEvent {
  const org = options.org ?? 'acme'
  const url = new URL(`https://docket.example/mcp/${org}/main${query}`)
  return {
    url,
    params: { org, ws: 'main' },
    request: new Request(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.bearer ?? `dkt_live_${Math.random()}`}` },
      body: JSON.stringify(options.body ?? {}),
    }),
    locals: { requestId: 'req', startedAt: performance.now() },
    getClientAddress: () => address,
  } as unknown as RequestEvent
}

describe('refused MCP credentials', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    queries.length = 0
    audited.length = 0
  })
  afterEach(() => vi.useRealTimers())

  it('are limited per client address before any lookup, with Retry-After', async () => {
    for (let i = 0; i < 3; i++) expect((await handleMcp(post('203.0.113.1'))).status).toBe(401)
    const lookups = queries.length

    const limited = await handleMcp(post('203.0.113.1'))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    expect(queries.length).toBe(lookups)
    // A token in the URL is refused too, and counts against the same address.
    expect((await handleMcp(post('203.0.113.1', '?access_token=x'))).status).toBe(429)

    // Another address is untouched, and the window passes.
    expect((await handleMcp(post('203.0.113.2'))).status).toBe(401)
    vi.setSystemTime(60_000)
    expect((await handleMcp(post('203.0.113.1'))).status).toBe(401)
  })

  it('write one platform audit event a minute per address, resource, action and outcome, marked as a burst', async () => {
    const burst = (outcome: string, ip = '198.51.100.7') => ({ ip, action: 'mcp.auth', outcome, target: ['https://docket.example/mcp/acme/main', 'burst:true', 'window:60s'] })
    await handleMcp(post('198.51.100.7'))
    await handleMcp(post('198.51.100.7'))
    expect(audited).toEqual([burst('denied')])

    // A token in the URL is a different outcome: its own burst, with no count carried over from the other.
    await handleMcp(post('198.51.100.7', '?access_token=x'))
    expect(audited).toHaveLength(2)
    expect(audited[1]).toEqual(burst('invalid'))
    expect(audited.flatMap((event) => event.target).some((part) => part.startsWith('refused:'))).toBe(false)

    // Another address starts a burst of its own; the next minute starts another.
    await handleMcp(post('198.51.100.8'))
    expect(audited[2]).toEqual(burst('denied', '198.51.100.8'))
    vi.setSystemTime(60_000)
    await handleMcp(post('198.51.100.7'))
    expect(audited).toHaveLength(4)
  })
})

describe('the MCP rate limits (§12, pipeline step 5)', () => {
  const search = (id: number) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'docket_search', arguments: { query: 'orders' } } })
  const call = (token: string, body: unknown) => handleMcp(post('192.0.2.10', '', { org: 'busy', bearer: `ok-${token}`, body }))

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    audited.length = 0
    runtime.limiter = bucketLimiter({ store: memoryBucketStore({ now: () => Date.now() }), now: () => Date.now() })
  })
  afterEach(() => vi.useRealTimers())

  it('the 121st call in a minute gives 429 with Retry-After, as an MCP tool error and an audit denied event', async () => {
    for (let i = 1; i <= 120; i += 1) expect((await call('tok1', search(i))).status).toBe(200)
    expect(audited.filter((event) => event.outcome === 'denied')).toEqual([])

    const limited = await call('tok1', search(121))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('1')
    expect(limited.headers.get('access-control-expose-headers')).toContain('retry-after')
    expect(await limited.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 121,
      result: {
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('at most 120 calls a minute per token') }],
        structuredContent: { error: 'rate_limited', scope: 'token', limitPerMinute: 120, retryAfterSeconds: 1 },
      },
    })
    expect(audited.at(-1)).toMatchObject({ action: 'mcp.tools/call docket_search', outcome: 'denied', target: ['rate-limit:calls-per-token'] })
    expect(audited).toHaveLength(121)

    // Another token is untouched, and the bucket refills: 2 calls a second.
    expect((await call('tok2', search(1))).status).toBe(200)
    vi.setSystemTime(1_000)
    expect((await call('tok1', search(122))).status).toBe(200)
  })

  it('answers a refused request that is not a tool call with a JSON-RPC error, and counts a body it cannot read', async () => {
    for (let i = 1; i <= 119; i += 1) expect((await call('tok1', search(i))).status).toBe(200)
    expect((await handleMcp(post('192.0.2.10', '', { org: 'busy', bearer: 'ok-tok1', body: [search(1)] }))).status).toBe(400)
    const limited = await call('tok1', { jsonrpc: '2.0', id: 'list', method: 'tools/list' })
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ id: 'list', error: { code: -32029, data: { scope: 'token', limitPerMinute: 120 } } })
    expect(audited.at(-1)).toMatchObject({ action: 'mcp.tools/list', outcome: 'denied' })
  })

  it('limits an org to 600 calls a minute across all its tokens', async () => {
    for (let t = 0; t < 5; t += 1) {
      for (let i = 1; i <= 120; i += 1) expect((await call(`t${t}`, search(i))).status).toBe(200)
    }
    const limited = await call('t5', search(601))
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ result: { isError: true, structuredContent: { scope: 'org', limitPerMinute: 600 } } })
    expect(audited.at(-1)).toMatchObject({ outcome: 'denied', target: ['rate-limit:calls-per-org'] })
  })
})
