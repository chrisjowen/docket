// SPDX-License-Identifier: AGPL-3.0-only
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { aiCaps, openRouterClient, openRouterKeys, openRouterModels, type AiDeps } from '@docket/platform-ai'
import { listQueryTraces } from '@docket/platform-canonical-store'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { queryService, QueryFailure } from './query.js'
import { createHarness, fixtureDocument, HAVE_STACK, type Harness } from './testing.js'

const TEAM = '.docket/resources/team/commerce.md'
const LEDGER = '.docket/resources/datasource/ledger-db.md'
const CYPHER = 'MATCH (n:Memory {scope: $scope}) WHERE n.stub = false RETURN n.id AS id ORDER BY id'

/** OpenRouter answering every chat with the Cypher above, at a quarter of a dollar a call. */
async function fakeOpenRouter() {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { model?: string }
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          id: 'gen-1',
          model: body.model,
          choices: [{ message: { content: CYPHER } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.25 },
        }),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe.skipIf(!HAVE_STACK)('query traces', () => {
  let h: Harness
  let openrouter: Awaited<ReturnType<typeof fakeOpenRouter>>
  const errors: string[] = []
  const traces = () => h.org.withOrg((ctx) => listQueryTraces(ctx, h.workspaceId))

  const service = (withModels: boolean) => {
    const platform: AiDeps['platform'] = (fn) => h.org.router.withPlatform(fn)
    const { keys } = openRouterKeys({ platform, keysFor: (id) => h.org.keyring.forOrg(id) }, { apiKey: 'sk-or-shared' }, (options) =>
      openRouterClient({ ...options, apiBase: openrouter.url }),
    )
    if (!keys) throw new Error('no keys')
    const deps: AiDeps = { platform, caps: aiCaps({ platform, notifyOwners: async () => undefined }), keys, client: openRouterClient({ apiBase: openrouter.url }) }
    return queryService({
      router: h.org.router,
      keyring: h.org.keyring,
      storeAccess: async () => h.access,
      models: (orgId, context) => (withModels ? openRouterModels(deps, orgId, context) : null),
      reranker: null,
      log: { info: () => undefined, error: (message) => errors.push(message) },
    })
  }

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

  it('keeps a search: both stores asked with their template queries, what each returned, and no cost', async () => {
    await service(false).search({ orgId: h.org.orgId, workspaceId: h.workspaceId, query: 'commerce', limit: 10, actor: 'token:dkt_live_abc', userId: 'u-alice' })
    const [trace] = await traces()
    expect(trace).toMatchObject({ tool: 'search', actor: 'token:dkt_live_abc', userId: 'u-alice', outcome: 'answered', costUsd: 0 })
    const detail = trace?.detail
    expect(detail?.question).toBe('commerce')
    expect(detail?.read).toMatchObject({ exhibits: 2, indexSynced: true, indexBehind: 0 })
    expect(detail?.stores.map((store) => [store.adapter, store.state, store.query?.by])).toEqual([
      ['neo4j', 'answered', 'template'],
      ['mem0', 'answered', 'template'],
    ])
    const graph = detail?.stores.find((store) => store.adapter === 'neo4j')
    expect(graph?.query?.text).toContain('db.index.fulltext')
    expect(graph?.hits).toContainEqual({ id: 'team.commerce', title: expect.any(String), type: 'team' })
    expect(detail?.calls).toEqual([])
    expect(detail?.answer.synthesis).toBeUndefined()
  })

  it("keeps an ask: the model-written Cypher with the model's name, the summary's model, and each call's cost", async () => {
    // docket 0.8.0's Neo4j adapter first has the model pick a query template; none fits here, so it writes Cypher: two calls.
    await service(true).ask({ orgId: h.org.orgId, workspaceId: h.workspaceId, question: 'which teams and datasources are there?', actor: 'user:alice', userId: 'alice' })
    const [trace] = await traces()
    expect(trace).toMatchObject({ tool: 'ask', actor: 'user:alice', userId: 'alice', outcome: 'answered', costUsd: 0.75 })
    const graph = trace?.detail?.stores.find((store) => store.adapter === 'neo4j')
    // The query as it ran: the model's, with the row limit the guard adds.
    expect(graph?.query).toEqual({ text: `${CYPHER}\nLIMIT 21`, by: 'model', model: 'anthropic/claude-haiku-5.5' })
    expect(graph?.rows).toBe(2)
    expect(trace?.detail?.calls.map((call) => [call.purpose, call.model, call.costUsd])).toEqual([
      ['cypher', 'anthropic/claude-haiku-5.5', 0.25],
      ['cypher', 'anthropic/claude-haiku-5.5', 0.25],
      ['synthesis', 'anthropic/claude-sonnet-5.5', 0.25],
    ])
    expect(trace?.detail?.answer.synthesis?.model).toBe('anthropic/claude-sonnet-5.5')
  })

  it('keeps a question that failed with its error, and none for a workspace that does not exist', async () => {
    const before = (await traces()).length
    const broken = queryService({
      router: h.org.router,
      keyring: h.org.keyring,
      storeAccess: () => Promise.reject(new Error('pod asleep')),
      models: () => null,
      reranker: null,
      log: { info: () => undefined, error: () => undefined },
    })
    await expect(broken.search({ orgId: h.org.orgId, workspaceId: h.workspaceId, query: 'commerce', limit: 5, userId: 'u-bob' })).rejects.toThrow('pod asleep')
    const [failed] = await traces()
    expect(failed).toMatchObject({ tool: 'search', outcome: 'failed', actor: 'unknown', userId: 'u-bob' })
    expect(failed?.detail?.error).toBe('pod asleep')

    await expect(service(false).search({ orgId: h.org.orgId, workspaceId: 'nosuchws', query: 'x', limit: 5, userId: 'u-alice' })).rejects.toBeInstanceOf(QueryFailure)
    expect(await traces()).toHaveLength(before + 1)
  })

  it('seals the question with the org’s key and keeps no document text', async () => {
    const rows = await h.org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ detail_ciphertext: Buffer }>('SELECT detail_ciphertext FROM query_traces WHERE workspace_id = $1', [h.workspaceId])
      return rows
    })
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.detail_ciphertext.toString('utf8')).not.toContain('commerce')
    const body = (await fixtureDocument(TEAM)).split('---').at(-1)?.trim().split('\n')[0] ?? ''
    expect(body.length).toBeGreaterThan(10)
    expect(JSON.stringify(await traces())).not.toContain(body)
    expect(errors).toEqual([])
  })
})
