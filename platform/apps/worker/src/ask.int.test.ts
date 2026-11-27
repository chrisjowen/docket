// SPDX-License-Identifier: AGPL-3.0-only
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { AdapterAnswer } from '@chrisjowen/docket/contracts'
import { AiCapReached, aiCaps, openRouterClient, openRouterKeys, openRouterModels, setCap, type AiDeps, type OrgAiKeys } from '@docket/platform-ai'
import { searchWorkspace } from '@docket/platform-projections'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { UnknownWorkspace, workspaceAsker } from './ask.js'
import { createHarness, fixtureDocument, HAVE_STACK, type Harness } from './testing.js'

const TEAM = '.docket/resources/team/commerce.md'
const LEDGER = '.docket/resources/datasource/ledger-db.md'
const CYPHER = 'MATCH (n:Memory {scope: $scope}) WHERE n.stub = false RETURN n.id AS id ORDER BY id'
const COST_USD = 0.25

/** OpenRouter's chat and key endpoints, answering every chat with the Cypher above and recording who called. */
async function fakeOpenRouter() {
  const chats: { authorization: string | undefined; model: string }[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { model?: string }
      if (req.method === 'POST' && req.url === '/chat/completions') {
        chats.push({ authorization: req.headers.authorization, model: body.model ?? '' })
        res.end(
          JSON.stringify({
            id: `gen-${chats.length}`,
            model: body.model,
            choices: [{ message: { content: CYPHER } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, cost: COST_USD },
          }),
        )
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

const entityIds = (answer: AdapterAnswer) => answer.blocks.flatMap((block) => (block.kind === 'entities' ? block.entities.map((e) => e.ref.id) : []))

describe.skipIf(!HAVE_STACK)('asking a workspace with the org’s models', () => {
  let h: Harness
  let openrouter: Awaited<ReturnType<typeof fakeOpenRouter>>

  const platform: AiDeps['platform'] = (fn) => h.org.router.withPlatform(fn)
  const keysFor = (config: { provisioningKey?: string; apiKey?: string }) =>
    openRouterKeys({ platform, keysFor: (id) => h.org.keyring.forOrg(id) }, config, (options) =>
      openRouterClient({ ...options, apiBase: openrouter.url }),
    )
  const askerWith = (keys: OrgAiKeys) => {
    const deps: AiDeps = {
      platform,
      caps: aiCaps({ platform, notifyOwners: async () => undefined }),
      keys,
      client: openRouterClient({ apiBase: openrouter.url }),
    }
    return workspaceAsker({ router: h.org.router, storeAccess: async () => h.access, modelsFor: (orgId, context) => openRouterModels(deps, orgId, context) })
  }
  const usage = () =>
    platform(async (tx) => {
      const { rows } = await tx.query<{ workspace_id: string; actor: string; purpose: string; cost_usd: string }>(
        'SELECT workspace_id, actor, purpose, cost_usd FROM platform.ai_usage WHERE org_id = $1 ORDER BY id',
        [h.org.orgId],
      )
      return rows.map((row) => ({ ...row, cost_usd: Number(row.cost_usd) }))
    })
  const question = (actor: string) => ({ orgId: h.org.orgId, workspaceId: h.workspaceId, question: 'which teams and datasources are there?', actor })

  beforeAll(async () => {
    h = await createHarness()
    openrouter = await fakeOpenRouter()
    for (const path of [TEAM, LEDGER]) await h.write(path, await fixtureDocument(path))
    expect(await h.reconciler().reconcile(h.org.orgId, h.workspaceId)).toMatchObject({ failed: 0 })
  })
  afterAll(async () => {
    await openrouter?.close()
    await h?.close()
  })

  it("answers with Cypher the model wrote on the org's own key, and meters the call", async () => {
    const { mode, keys } = keysFor({ provisioningKey: 'sk-or-prov' })
    expect(mode).toBe('per-org')
    if (!keys) throw new Error('no keys')
    expect(await keys.ensure(h.org.orgId)).toBe('created')

    const answer = await askerWith(keys)(question('user:per-org'))
    expect(entityIds(answer).sort()).toEqual(['datasource.ledger-db', 'team.commerce'])
    expect(answer.diagnostics.map((d) => d.code)).not.toContain('cypher-fallback')
    // The adapter first has the model pick a query template; none fits this one, so the model writes Cypher: two calls, both metered.
    const call = { authorization: 'Bearer sk-or-org', model: 'anthropic/claude-haiku-5.5' }
    expect(openrouter.chats).toEqual([call, call])
    const metered = { workspace_id: h.workspaceId, actor: 'user:per-org', purpose: 'cypher', cost_usd: COST_USD }
    expect(await usage()).toEqual([metered, metered])

    await keys.revoke(h.org.orgId)
  })

  it('shares the platform key when there is no provisioning key, and refuses at 100% of the cap while search still answers', async () => {
    const { mode, keys } = keysFor({ apiKey: 'sk-or-shared' })
    expect(mode).toBe('shared')
    if (!keys) throw new Error('no keys')
    const ask = askerWith(keys)

    expect(entityIds(await ask(question('user:shared'))).sort()).toEqual(['datasource.ledger-db', 'team.commerce'])
    expect(openrouter.chats.at(-1)).toEqual({ authorization: 'Bearer sk-or-shared', model: 'anthropic/claude-haiku-5.5' })
    expect((await usage()).map((row) => row.actor)).toEqual(['user:per-org', 'user:per-org', 'user:shared', 'user:shared'])

    // Four calls have cost $1.00: a $1.00 cap is spent.
    await platform((tx) => setCap(tx, h.org.orgId, 4 * COST_USD, h.org.userId))
    const before = openrouter.chats.length
    await expect(ask(question('user:shared'))).rejects.toBeInstanceOf(AiCapReached)
    expect(openrouter.chats).toHaveLength(before)
    expect(await usage()).toHaveLength(4)

    const searched = await searchWorkspace({ orgId: h.org.orgId, workspaceId: h.workspaceId, access: h.access, question: 'commerce' })
    const neo4j = searched.find(({ instance }) => instance === 'neo4j')
    expect(neo4j?.error).toBeUndefined()
    expect(entityIds(neo4j?.answer as AdapterAnswer)).toContain('team.commerce')
  })

  it("refuses a workspace that is not the org's before calling a model", async () => {
    const { keys } = keysFor({ apiKey: 'sk-or-shared' })
    if (!keys) throw new Error('no keys')
    const before = openrouter.chats.length
    await expect(askerWith(keys)({ ...question('user:x'), workspaceId: 'not-a-workspace' })).rejects.toBeInstanceOf(UnknownWorkspace)
    expect(openrouter.chats).toHaveLength(before)
  })
})
