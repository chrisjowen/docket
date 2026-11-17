import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readFixture, type Fixture } from '../../test/fixture.js'
import { STORE_KINDS, TEST_PG_URL, createTestStore, seedWorkspace, type TestStore } from '../../test/postgres.js'
import { memoryProjections, type MemoryProjections } from '../../test/projections.js'
import type { StoreScope } from '../ports.js'
import { deleteWorkspace, putDocument } from '../postgres/index.js'
import { dueWorkspaces, outboxLoop } from './outbox.js'
import { reconciler } from './reconcile.js'
import type { Reranker } from './reranker.js'
import { QueryFailure, queryService, type QueryEvent } from './search.js'

const quiet = { info: () => undefined, error: () => undefined }

/** Waits for `check` to hold, checking every 25 ms, at most `ms`. */
async function until(check: () => boolean | Promise<boolean>, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('the runtime loops over $name', (kind) => {
  let test: TestStore
  let fixture: Fixture
  let scope: StoreScope
  let workspaceId: string
  let projections: MemoryProjections

  const raw = (path: string) => fixture.documents.find((document) => document.path === path)?.raw as string
  const write = (workspace: string, path: string) => test.as((ctx) => putDocument(ctx, { workspaceId: workspace, path, raw: raw(path), origin: 'cloud', actor: 'user:owner' }))
  const held = (instance: string, workspace = workspaceId) => [...projections.held(instance, workspace).keys()].sort()

  beforeAll(async () => {
    test = await createTestStore(kind)
    fixture = await readFixture()
    scope = { id: 'store', store: test.store }
    workspaceId = await test.as((ctx) => seedWorkspace(ctx, { slug: 'platform', ontology: fixture.ontology }))
    projections = memoryProjections()
  })
  afterAll(() => test?.drop())

  describe('the outbox loop', () => {
    it('drains the outbox at start, on a kick and on a notification, and purges a deleted workspace', async () => {
      const loop = outboxLoop({
        scopes: { scopes: async () => [scope] },
        pool: test.pool,
        reconciler: reconciler({ projections }),
        instances: projections.instances,
        log: quiet,
        intervalMs: 60_000
      })
      await write(workspaceId, '.docket/resources/team/commerce.md')
      loop.start()
      try {
        await until(() => held('graph').includes('team.commerce') && held('memories').includes('team.commerce'))

        await write(workspaceId, '.docket/resources/team/discovery.md')
        loop.kick()
        await until(() => held('graph').includes('team.discovery') && held('memories').includes('team.discovery'))

        // A notification on the channel wakes it too, as a trigger on the outbox would send one.
        await write(workspaceId, '.docket/resources/datasource/ledger-db.md')
        await test.pool.query('NOTIFY docket_outbox')
        await until(() => held('graph').includes('datasource.ledger-db') && held('memories').includes('datasource.ledger-db'))

        const doomed = await test.as((ctx) => seedWorkspace(ctx, { slug: 'doomed', ontology: fixture.ontology }))
        await write(doomed, '.docket/resources/team/commerce.md')
        loop.kick()
        await until(() => held('graph', doomed).length === 1 && held('memories', doomed).length === 1)
        await test.as(({ tx }) => deleteWorkspace(tx, { workspaceId: doomed, deletedBy: 'user:owner' }))
        loop.kick()
        await until(() => held('graph', doomed).length === 0 && held('memories', doomed).length === 0)
        expect(loop.lastSweep()).toBeInstanceOf(Date)
      } finally {
        await loop.stop()
      }
    })

    it('leaves a workspace another process is projecting, and one backing off after a failure', async () => {
      await write(workspaceId, '.docket/resources/service/orders.md')
      expect(await dueWorkspaces(test.store, projections.instances, new Date())).toEqual([workspaceId])

      // Another process holds the workspace's lock: this one leaves it.
      const other = await test.pool.connect()
      await other.query('SELECT pg_advisory_lock(hashtext($1))', [`docket-cloud:reconcile:store:${workspaceId}`])
      const loop = outboxLoop({ scopes: { scopes: async () => [scope] }, pool: test.pool, reconciler: reconciler({ projections }), instances: projections.instances, log: quiet, intervalMs: 60_000 })
      try {
        loop.start()
        await until(() => loop.lastSweep() !== null)
        expect(held('graph')).not.toContain('service.orders')
      } finally {
        await loop.stop()
        await other.query('SELECT pg_advisory_unlock_all()')
        other.release()
      }

      // A failing instance backs the workspace off until its retry time.
      projections.fail('graph', { connect: 'refused' })
      await reconciler({ projections }).reconcile(scope, workspaceId)
      expect(await dueWorkspaces(test.store, projections.instances, new Date())).toEqual([])
      expect(await dueWorkspaces(test.store, ['memories'], new Date())).toEqual([workspaceId])
      expect(await dueWorkspaces(test.store, projections.instances, new Date(Date.now() + 60 * 60_000))).toEqual([workspaceId])
      projections.fail('graph', {})
      await reconciler({ projections }).reconcile(scope, workspaceId)
      expect(held('graph')).toContain('service.orders')
    })
  })

  describe('the query service', () => {
    const events: QueryEvent[] = []
    beforeAll(async () => {
      for (const path of ['.docket/resources/team/commerce.md', '.docket/resources/team/discovery.md', '.docket/resources/service/orders.md']) await write(workspaceId, path)
      projections.fail('graph', {})
      await reconciler({ projections }).reconcile(scope, workspaceId)
    })
    /** A re-ranker that reads the Commerce team's record, and no other, as answering. */
    const reranker: Reranker = { model: 'test', score: async (_query, texts) => texts.map((text) => (text.startsWith('team: Commerce') ? 8 : -10)) }
    const service = (models?: Parameters<typeof queryService>[0]['models']) =>
      queryService({
        store: () => test.store,
        projections: async (query) => ({ adapters: projections.adapters(query.workspaceId), close: async () => undefined }),
        instances: projections.instances,
        reranker,
        signals: { graph: 'lexical', memories: 'semantic' },
        ...(models ? { models } : {}),
        observe: (event) => void events.push(event),
        log: quiet
      })

    it('answers a search with what is relevant, from every projection, and says how the index stands', async () => {
      const found = await service().search({ workspaceId, query: 'commerce team', limit: 5, userId: 'u-1' })
      expect(found.matches.map((match) => match.id)).toEqual(['team.commerce'])
      // Seeded straight into the store, it has no activity for the timeline to find.
      expect(found.matches[0]).toMatchObject({ foundIn: ['facts'], foundBy: ['graph', 'memories'] })
      expect(found.project).toEqual({ name: 'platform', root: 'platform' })
      expect(found.index).toEqual({ synced: true, behind: 0 })
      expect(found.sources.map((source) => source.name)).toEqual(['graph', 'memories'])
      expect(events.at(-1)).toMatchObject({ tool: 'search', outcome: 'answered', query: { query: 'commerce team' } })
      expect(events.at(-1)?.asked?.read.entities.length).toBeGreaterThan(0)
    })

    it('answers a question about someone never recorded with nothing', async () => {
      const found = await service().search({ workspaceId, query: 'who is Sophia', limit: 5, userId: 'u-1' })
      expect(found.matches).toEqual([])
    })

    it('answers ask with what the projections found, and a model’s summary when one is set up', async () => {
      const without = await service().ask({ workspaceId, question: 'who owns orders', actor: 'token:bot', userId: 'u-1' })
      expect(without.notice).toBe('AI is not set up on this server, so here is what the projections found; search still works.')
      expect(without.answer.results.map((result) => result.adapter)).toEqual(['graph', 'memories'])

      const prompts: unknown[] = []
      const summarised = await service(() => ({
        synthesis: {
          model: 'test-model',
          chat: async (prompt) => {
            prompts.push(prompt)
            return ' Commerce owns orders [team.commerce]. '
          }
        }
      })).ask({ workspaceId, question: 'who owns orders', actor: 'token:bot', userId: 'u-1' })
      expect(summarised.notice).toBeUndefined()
      expect(summarised.answer.synthesis).toMatchObject({ text: 'Commerce owns orders [team.commerce].', model: 'test-model', citedEntities: ['team.commerce'] })
      expect(prompts).toHaveLength(1)

      const capped = await service(() => ({
        synthesis: { model: 'test-model', chat: async () => Promise.reject(Object.assign(new Error('cap'), { name: 'AiCapReached' })) }
      })).ask({ workspaceId, question: 'who owns orders', actor: 'token:bot', userId: 'u-1' })
      expect(capped.notice).toBe('AI budget for this month reached — search still works; ask an owner to raise the cap.')
      expect(events.at(-1)).toMatchObject({ tool: 'ask', outcome: 'answered' })
    })

    it('refuses a workspace that is not there, observing nothing', async () => {
      const before = events.length
      await expect(service().search({ workspaceId: 'nosuch', query: 'orders', limit: 5, userId: 'u-1' })).rejects.toBeInstanceOf(QueryFailure)
      expect(events).toHaveLength(before)
    })
  })
})
