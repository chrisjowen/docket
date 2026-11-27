// SPDX-License-Identifier: AGPL-3.0-only
import { AiCapReached, type UsageRecord } from '@docket/platform-ai'
import { describe, expect, it } from 'vitest'

import { gatewayCall, type GatewayDeps } from './cognify-gateway.js'
import type { CognifyLease } from './cognify-lease.js'

const KEY = 'gateway-key-for-tests'
const LEASE: CognifyLease = { orgId: 'orgacme', workspaceId: 'wsmain', monthlyLimitUsd: 2, startedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), stuckAt: null }

function deps(overrides: { lease?: CognifyLease | null; capped?: boolean; spent?: number; upstream?: { status: number; body: unknown } } = {}) {
  const recorded: UsageRecord[] = []
  const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = []
  const upstream = overrides.upstream ?? {
    status: 200,
    body: { id: 'gen-1', model: 'anthropic/claude-haiku-5.5', choices: [{ message: { content: '{"nodes":[]}' } }], usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.0004 } },
  }
  const value: GatewayDeps = {
    key: KEY,
    lease: async () => (overrides.lease === undefined ? LEASE : overrides.lease),
    ai: {
      assertWithinCap: async (orgId) => {
        if (overrides.capped) throw new AiCapReached(orgId, 20, 20)
      },
      spent: async () => overrides.spent ?? 0,
      apiKey: 'platform-key',
      model: async () => 'anthropic/claude-haiku-5.5',
      record: async (usage) => void recorded.push(usage),
    },
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> })
      return new Response(JSON.stringify(upstream.body), { status: upstream.status })
    }) as typeof fetch,
  }
  return { value, recorded, sent }
}

const call = (body: unknown = { model: 'openai/anything', messages: [{ role: 'user', content: 'extract the graph' }], stream: true }, authorization = `Bearer ${KEY}`) => ({
  method: 'POST',
  path: '/v1/chat/completions',
  authorization,
  body: JSON.stringify(body),
})

describe('the cognify gateway', () => {
  it("sends cognee's call to OpenRouter on the platform's key, never an org's, with the org's model, with privacy routing, unstreamed, and meters it to the workspace", async () => {
    const { value, recorded, sent } = deps()
    const reply = await gatewayCall(value, call())
    expect(reply.status).toBe(200)
    expect(JSON.parse(reply.body)).toMatchObject({ choices: [{ message: { content: '{"nodes":[]}' } }] })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.headers.authorization).toBe('Bearer platform-key')
    expect(sent[0]?.body).toMatchObject({ model: 'anthropic/claude-haiku-5.5', stream: false, provider: { data_collection: 'deny', zdr: true }, usage: { include: true } })
    expect(sent[0]?.body.messages).toEqual([{ role: 'user', content: 'extract the graph' }])
    expect(recorded).toEqual([
      expect.objectContaining({ orgId: 'orgacme', workspaceId: 'wsmain', actor: 'cognee:wsmain', purpose: 'cognify', promptTokens: 120, completionTokens: 30, costUsd: 0.0004 }),
    ])
  })

  it('refuses a call while no cognify holds the lease: cognee spends nothing on its own', async () => {
    const { value, sent } = deps({ lease: null })
    expect((await gatewayCall(value, call())).status).toBe(403)
    expect(sent).toEqual([])
  })

  it("refuses at the org's cap and at the workspace's cognee limit, before any model is called", async () => {
    const capped = deps({ capped: true })
    const atCap = await gatewayCall(capped.value, call())
    expect(atCap.status).toBe(429)
    expect(atCap.body).toContain('AI budget for this month reached')
    const limited = deps({ spent: 2 })
    const atLimit = await gatewayCall(limited.value, call())
    expect(atLimit.status).toBe(429)
    expect(atLimit.body).toContain("cognee's monthly AI limit of $2.00")
    expect([...capped.sent, ...limited.sent]).toEqual([])
  })

  it('refuses a caller without the shared key, and any other path', async () => {
    const { value, sent } = deps()
    expect((await gatewayCall(value, call(undefined, 'Bearer wrong'))).status).toBe(401)
    expect((await gatewayCall(value, call(undefined, ''))).status).toBe(401)
    expect((await gatewayCall(value, { ...call(), path: '/v1/embeddings' })).status).toBe(404)
    expect(sent).toEqual([])
  })

  it("passes on OpenRouter's refusal without the request, and meters nothing", async () => {
    const { value, recorded } = deps({ upstream: { status: 402, body: { error: { message: 'Key limit exceeded' } } } })
    const reply = await gatewayCall(value, call())
    expect(reply.status).toBe(402)
    expect(reply.body).toContain('Key limit exceeded')
    expect(reply.body).not.toContain('extract the graph')
    expect(recorded).toEqual([])
  })

  it('refuses when AI is off on the server', async () => {
    const { value } = deps()
    expect((await gatewayCall({ ...value, ai: null }, call())).status).toBe(503)
  })
})
