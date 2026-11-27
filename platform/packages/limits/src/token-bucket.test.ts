// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { rateLimiter, type Refusal } from './limiter.js'
import { mcpRateLimit, type McpMessage, type McpRefusal } from './mcp.js'
import { RATE_LIMITS, askLimits, mcpLimits, oauthLimits, tokenCreateLimits, type Caller } from './quotas.js'
import { memoryBucketStore, perMinute, type BucketStore } from './token-bucket.js'

const search = (id: number): McpMessage => ({
  id,
  method: 'tools/call',
  params: { name: 'docket_search', arguments: { query: 'orders' } },
})

function clock(start = Date.parse('2026-11-04T10:00:00Z')) {
  let at = start
  return { now: () => at, advance: (ms: number) => (at += ms) }
}

/** A store that counts how often it is asked. */
function counted(store: BucketStore) {
  const counter = { calls: 0 }
  return {
    counter,
    store: {
      take: (requests, cost) => {
        counter.calls += 1
        return store.take(requests, cost)
      },
    } satisfies BucketStore,
  }
}

describe('token buckets', () => {
  it('allows a burst of 120, refuses the 121st with a retry, and refills evenly', async () => {
    const time = clock()
    const limiter = rateLimiter({ store: memoryBucketStore(time), now: time.now })
    const limits = [{ scope: 'token', key: 't', rule: perMinute(120) }]
    for (let i = 0; i < 120; i += 1) expect(await limiter.check(limits)).toEqual({ allowed: true })
    expect(await limiter.check(limits)).toMatchObject({ allowed: false, retryAfterSeconds: 1, cached: false })

    time.advance(30_000)
    let passed = 0
    while ((await limiter.check(limits)).allowed) passed += 1
    expect(passed).toBe(60)
  })

  it('takes from every bucket or from none', async () => {
    const time = clock()
    const limiter = rateLimiter({ store: memoryBucketStore(time), now: time.now })
    const token = { scope: 'token', key: 'token', rule: perMinute(10) }
    const org = { scope: 'org', key: 'org', rule: perMinute(2) }
    expect((await limiter.check([token, org])).allowed).toBe(true)
    expect((await limiter.check([token, org])).allowed).toBe(true)
    expect(await limiter.check([token, org])).toMatchObject({ allowed: false, limit: { scope: 'org' } })
    // The org's refusal spent none of the token's tokens: 8 are left of 10.
    let passed = 0
    while ((await limiter.check([token])).allowed) passed += 1
    expect(passed).toBe(8)
  })

  it('refuses from memory until the retry time, without asking the store', async () => {
    const time = clock()
    const { store, counter } = counted(memoryBucketStore(time))
    const limiter = rateLimiter({ store, now: time.now })
    const limits = [{ scope: 'token', key: 't', rule: perMinute(1) }]
    await limiter.check(limits)
    expect(await limiter.check(limits)).toMatchObject({ allowed: false, retryAfterSeconds: 60, cached: false })
    const asked = counter.calls
    for (let i = 0; i < 50; i += 1) expect(await limiter.check(limits)).toMatchObject({ allowed: false, cached: true })
    expect(counter.calls).toBe(asked)
    time.advance(60_000)
    expect((await limiter.check(limits)).allowed).toBe(true)
  })
})

describe('the OAuth and token-creation limits (§19)', () => {
  it('gives an address 120 OAuth requests a minute and 60 client registrations, each its own bucket', async () => {
    const time = clock()
    const limiter = rateLimiter({ store: memoryBucketStore(time), now: time.now })
    for (let i = 0; i < 60; i += 1) expect((await limiter.check(oauthLimits('registration', '203.0.113.9', null))).allowed).toBe(true)
    const registration = await limiter.check(oauthLimits('registration', '203.0.113.9', null))
    expect(registration).toMatchObject({ allowed: false, limit: { what: 'client registrations', scope: 'address' } })
    for (let i = 0; i < 120; i += 1) expect((await limiter.check(oauthLimits(i % 2 ? 'authorization' : 'device_authorization', '203.0.113.9', null))).allowed).toBe(true)
    expect(await limiter.check(oauthLimits('jwks', '203.0.113.9', null))).toMatchObject({ allowed: false, limit: { what: 'OAuth requests', scope: 'address' } })
    expect((await limiter.check(oauthLimits('authorization', '198.51.100.4', null))).allowed).toBe(true)
    expect((await limiter.check(oauthLimits('token', '203.0.113.9', 'claude'))).allowed).toBe(true)
  })

  it('gives an address 1200 token and revocation requests a minute across clients, and each known client there 600 of its own', async () => {
    const time = clock()
    const store = memoryBucketStore(time)
    const limiter = rateLimiter({ store, now: time.now })
    for (let i = 0; i < 600; i += 1) expect((await limiter.check(oauthLimits(i % 2 ? 'token' : 'revocation', '203.0.113.9', 'claude'))).allowed).toBe(true)
    expect(await limiter.check(oauthLimits('token', '203.0.113.9', 'claude'))).toMatchObject({ allowed: false, limit: { what: 'token requests', scope: 'client and address' } })
    // Another client from the same shared address, and the same client elsewhere, have their own.
    expect((await limiter.check(oauthLimits('token', '203.0.113.9', 'chatgpt'))).allowed).toBe(true)
    expect((await limiter.check(oauthLimits('token', '198.51.100.4', 'claude'))).allowed).toBe(true)
    for (let i = 0; i < 1200; i += 1) expect((await limiter.check(oauthLimits('token', '203.0.113.9', null))).allowed).toBe(true)
    expect(await limiter.check(oauthLimits('revocation', '203.0.113.9', null))).toMatchObject({ allowed: false, limit: { what: 'token requests', scope: 'address' } })
    expect((await limiter.check(oauthLimits('revocation', '198.51.100.4', null))).allowed).toBe(true)
  })

  it('takes overridden OAuth rules', async () => {
    const time = clock()
    const limiter = rateLimiter({ store: memoryBucketStore(time), now: time.now })
    const rules = { token: perMinute(2), tokenAddress: perMinute(3), other: perMinute(1), registration: perMinute(1) }
    for (let i = 0; i < 2; i += 1) expect((await limiter.check(oauthLimits('token', '203.0.113.9', 'c', rules))).allowed).toBe(true)
    expect((await limiter.check(oauthLimits('token', '203.0.113.9', 'c', rules))).allowed).toBe(false)
    for (let i = 0; i < 3; i += 1) expect((await limiter.check(oauthLimits('token', '203.0.113.9', null, rules))).allowed).toBe(true)
    expect((await limiter.check(oauthLimits('token', '203.0.113.9', null, rules))).allowed).toBe(false)
    expect((await limiter.check(oauthLimits('registration', '203.0.113.9', null, rules))).allowed).toBe(true)
    expect((await limiter.check(oauthLimits('registration', '203.0.113.9', null, rules))).allowed).toBe(false)
  })

  it('gives a person 10 new API tokens a minute', async () => {
    const time = clock()
    const limiter = rateLimiter({ store: memoryBucketStore(time), now: time.now })
    for (let i = 0; i < 10; i += 1) expect((await limiter.check(tokenCreateLimits('u1'))).allowed).toBe(true)
    const refused = await limiter.check(tokenCreateLimits('u1'))
    expect(refused).toMatchObject({ allowed: false, retryAfterSeconds: 6 })
    expect((await limiter.check(tokenCreateLimits('u2'))).allowed).toBe(true)
    time.advance(6_000)
    expect((await limiter.check(tokenCreateLimits('u1'))).allowed).toBe(true)
  })

  it('gives a person 20 questions a minute on the Ask page', async () => {
    const time = clock()
    const limiter = rateLimiter({ store: memoryBucketStore(time), now: time.now })
    for (let i = 0; i < 20; i += 1) expect((await limiter.check(askLimits('u1'))).allowed).toBe(true)
    expect(await limiter.check(askLimits('u1'))).toMatchObject({ allowed: false, retryAfterSeconds: 3, limit: { scope: 'person', what: 'questions' } })
    expect((await limiter.check(askLimits('u2'))).allowed).toBe(true)
  })
})

describe('the MCP limit (pipeline step 5)', () => {
  const caller: Caller & { userId: string } = { orgId: 'org1', tokenId: 'tok1', userId: 'u1' }

  function harness() {
    const time = clock()
    const audited: McpRefusal<typeof caller>[] = []
    const refused: Refusal[] = []
    const limiter = rateLimiter({ store: memoryBucketStore(time), now: time.now, onRefused: (r) => refused.push(r) })
    const limit = mcpRateLimit<typeof caller>({
      limiter,
      isWriteTool: (name) => name === 'docket_remember',
      audit: async (denied) => {
        audited.push(denied)
      },
    })
    return { time, audited, refused, limit }
  }

  it('the 121st call in a minute gives 429 with Retry-After, as an audit denied event and an MCP tool error', async () => {
    const { audited, limit } = harness()
    for (let i = 1; i <= 120; i += 1) expect(await limit(caller, search(i))).toBeNull()
    expect(audited).toEqual([])

    const response = await limit(caller, search(121))
    expect(response?.status).toBe(429)
    expect(response?.headers.get('retry-after')).toBe('1')
    const body = await response?.json()
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 121,
      result: {
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('at most 120 calls a minute per token') }],
        structuredContent: { error: 'rate_limited', scope: 'token', limitPerMinute: 120, retryAfterSeconds: 1 },
      },
    })
    expect(audited).toHaveLength(1)
    expect(audited[0]).toMatchObject({ caller, action: 'mcp.tools/call docket_search', refusal: { limit: { scope: 'token' } } })
  })

  it('audits every refused call, cached or not, since each one authenticated', async () => {
    const { audited, limit } = harness()
    for (let i = 1; i <= 120; i += 1) await limit(caller, search(i))
    for (let i = 121; i <= 125; i += 1) expect((await limit(caller, search(i)))?.status).toBe(429)
    expect(audited).toHaveLength(5)
  })

  it('answers a refused request that is not a tool call with a JSON-RPC error', async () => {
    const { limit } = harness()
    for (let i = 1; i <= 120; i += 1) await limit(caller, search(i))
    const response = await limit(caller, { id: 'x', method: 'tools/list' })
    expect(response?.status).toBe(429)
    expect(await response?.json()).toMatchObject({ id: 'x', error: { code: -32029, data: { scope: 'token' } } })
  })

  it('limits an org to 600 calls a minute across all its tokens', async () => {
    const { audited, limit } = harness()
    for (let t = 0; t < 5; t += 1) {
      for (let i = 0; i < 120; i += 1) expect(await limit({ ...caller, tokenId: `t${t}` }, search(i))).toBeNull()
    }
    const response = await limit({ ...caller, tokenId: 't9' }, search(601))
    expect(response?.status).toBe(429)
    expect(audited[0]?.refusal.limit.scope).toBe('org')
  })

  it('counts write tools against 30 writes a minute per token as well', async () => {
    const { limit } = harness()
    const remember = (id: number): McpMessage => ({ id, method: 'tools/call', params: { name: 'docket_remember' } })
    for (let i = 1; i <= 30; i += 1) expect(await limit(caller, remember(i))).toBeNull()
    const response = await limit(caller, remember(31))
    expect(response?.status).toBe(429)
    expect(response?.headers.get('retry-after')).toBe('2')
    const body = (await response?.json()) as { result: { content: { text: string }[] } }
    expect(body.result.content[0]?.text).toContain('at most 30 writes a minute per token')
    // Reads still pass: the write refusal took nothing from the MCP buckets.
    expect(await limit(caller, search(32))).toBeNull()
  })

  it('matches the beta limits of §12', () => {
    expect(RATE_LIMITS.mcpPerToken).toEqual(perMinute(120))
    expect(RATE_LIMITS.mcpPerOrg).toEqual(perMinute(600))
    expect(RATE_LIMITS.writesPerToken).toEqual(perMinute(30))
    expect(mcpLimits(caller).map((limit) => limit.key)).toEqual(['mcp:token:tok1', 'mcp:org:org1'])
  })
})
