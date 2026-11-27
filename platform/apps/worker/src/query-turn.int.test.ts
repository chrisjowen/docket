// SPDX-License-Identifier: AGPL-3.0-only
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { aiCaps, meteredTurns, openRouterClient, openRouterKeys, setCap, type AiDeps, type OrgAiKeys } from '@docket/platform-ai'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseTurn, queryService, type QueryServiceDeps } from './query.js'

const HAVE_PG = Boolean(TEST_PG_URL)
const COST_USD = 0.01

/**
 * A fake OpenRouter standing in for the real one: the first turn of a
 * question asks for a look-up, the one after it (once a tool answered)
 * writes the final answer in OpenUI Lang.
 */
async function fakeOpenRouter() {
  const chats: { authorization: string | undefined; model: string; toolResult: boolean }[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { model?: string; messages?: { role: string }[] }
      if (req.method === 'POST' && req.url === '/chat/completions') {
        const toolResult = (body.messages ?? []).some((message) => message.role === 'tool')
        chats.push({ authorization: req.headers.authorization, model: body.model ?? '', toolResult })
        const message = toolResult
          ? { content: 'root = Answer([p])\np = Prose("Acme owns the orders service.")' }
          : { content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'docket_search', arguments: '{"workspace":"acme","query":"orders"}' } }] }
        res.end(JSON.stringify({ id: `gen-${chats.length}`, model: body.model, choices: [{ message }], usage: { prompt_tokens: 120, completion_tokens: 30, cost: COST_USD } }))
        return
      }
      if (req.method === 'POST' && req.url === '/keys') {
        res.end(JSON.stringify({ key: 'sk-or-org', data: { hash: 'org-hash' } }))
        return
      }
      if (req.method === 'DELETE' && req.url === '/keys/org-hash') {
        res.end('{}')
        return
      }
      res.statusCode = 404
      res.end(JSON.stringify({ error: { message: `no ${req.method} ${req.url}` } }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { url, chats, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

const TURN_TOOLS = [
  { name: 'docket_search', description: 'Search.', parameters: { type: 'object', properties: { workspace: { type: 'string' }, query: { type: 'string' } } } },
]

describe.skipIf(!HAVE_PG)("the Ask page agent's turn, on the org's own model", () => {
  let org: TestOrg
  let openrouter: Awaited<ReturnType<typeof fakeOpenRouter>>
  const platform: AiDeps['platform'] = (fn) => org.router.withPlatform(fn)

  const serviceWith = (keys: OrgAiKeys) => {
    const deps: AiDeps = { platform, caps: aiCaps({ platform, notifyOwners: async () => undefined }), keys, client: openRouterClient({ apiBase: openrouter.url }) }
    return queryService({
      turns: (orgId: string, context: { actor: string; purpose: 'agent' | 'ontology' }) => meteredTurns(deps, orgId, { actor: context.actor }, 'synthesis', context.purpose),
      log: { info: () => undefined, error: console.error },
    } as unknown as QueryServiceDeps)
  }
  const usage = () =>
    platform(async (tx) => {
      const { rows } = await tx.query<{ purpose: string; cost_usd: string }>('SELECT purpose, cost_usd FROM platform.ai_usage WHERE org_id = $1 ORDER BY id', [org.orgId])
      return rows.map((row) => ({ ...row, cost_usd: Number(row.cost_usd) }))
    })

  beforeAll(async () => {
    org = await createTestOrg()
    openrouter = await fakeOpenRouter()
  })
  afterAll(async () => {
    await openrouter?.close()
    await org?.drop()
  })

  it("asks the model, over the OpenRouter wire shape, on the org's own key, and meters the call as `agent`", async () => {
    const { keys } = openRouterKeys({ platform, keysFor: (id) => org.keyring.forOrg(id) }, { provisioningKey: 'sk-or-prov' }, (options) =>
      openRouterClient({ ...options, apiBase: openrouter.url }),
    )
    if (!keys) throw new Error('no keys')
    expect(await keys.ensure(org.orgId)).toBe('created')
    const service = serviceWith(keys)
    const base = { orgId: org.orgId, actor: `user:${org.userId}`, userId: org.userId, tools: TURN_TOOLS }

    const first = await service.turn(parseTurn({ ...base, messages: [{ role: 'user', content: 'Who owns orders?' }], toolChoice: 'auto', maxTokens: 400 }))
    if ('unavailable' in first) throw new Error(`expected a reply, got ${first.unavailable}`)
    expect(first.toolCalls).toEqual([{ id: 'call-1', name: 'docket_search', arguments: '{"workspace":"acme","query":"orders"}' }])
    expect(openrouter.chats.at(-1)).toMatchObject({ authorization: 'Bearer sk-or-org', toolResult: false })
    const toolCall = first.toolCalls[0]
    if (!toolCall) throw new Error('expected a tool call')

    const second = await service.turn(
      parseTurn({
        ...base,
        messages: [
          { role: 'user', content: 'Who owns orders?' },
          { role: 'assistant', content: '', toolCalls: first.toolCalls },
          { role: 'tool', toolCallId: toolCall.id, content: 'Docket acme:\n[{"id":"team.commerce"}]' },
        ],
        toolChoice: 'none',
        maxTokens: 400,
      }),
    )
    if ('unavailable' in second) throw new Error(`expected a reply, got ${second.unavailable}`)
    expect(second.content).toContain('Acme owns the orders service.')
    expect(openrouter.chats.at(-1)).toMatchObject({ toolResult: true })

    expect(await usage()).toEqual([
      { purpose: 'agent', cost_usd: COST_USD },
      { purpose: 'agent', cost_usd: COST_USD },
    ])
    await keys.revoke(org.orgId)
  })

  it('refuses once the cap is reached, with why, instead of calling the model', async () => {
    const { keys } = openRouterKeys({ platform, keysFor: (id) => org.keyring.forOrg(id) }, { apiKey: 'sk-or-shared' }, (options) =>
      openRouterClient({ ...options, apiBase: openrouter.url }),
    )
    if (!keys) throw new Error('no keys')
    const service = serviceWith(keys)
    await platform((tx) => setCap(tx, org.orgId, 0, org.userId))
    const before = openrouter.chats.length

    const reply = await service.turn(
      parseTurn({ orgId: org.orgId, actor: `user:${org.userId}`, userId: org.userId, tools: TURN_TOOLS, messages: [{ role: 'user', content: 'Who owns orders?' }] }),
    )
    expect(reply).toMatchObject({ unavailable: 'cap-reached' })
    expect(openrouter.chats).toHaveLength(before)
  })
})
