// SPDX-License-Identifier: AGPL-3.0-only
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listQueryTraces, recordQueryTrace, type QueryTraceDetail } from './query-traces.js'
import { HISTORY_LIMIT, listSyncRuns, recordSyncRun } from './sync-runs.js'
import { createTestOrg, type TestOrg } from './testing.js'
import { insertWorkspace } from './workspaces.js'

const detail = (question: string): QueryTraceDetail => ({
  question,
  read: { exhibits: 1, documents: 1, indexBehind: 0, indexSynced: true },
  stores: [],
  answer: { references: [], counts: { resolved: 0, stale: 0, unresolved: 0 }, connections: 0 },
  calls: [{ purpose: 'synthesis', model: 'm', promptTokens: 1, completionTokens: 1, costUsd: 0.002 }],
})

describe.skipIf(!TEST_PG_URL)('the sync history and query traces', () => {
  let org: TestOrg
  let workspaceId: string

  beforeAll(async () => {
    org = await createTestOrg()
    workspaceId = await org.withOrg(async ({ tx }) => (await insertWorkspace(tx, { name: 'W', slug: 'main', createdBy: org.userId })).id)
  })
  afterAll(() => org?.drop())

  it(`keeps the newest ${HISTORY_LIMIT} passes, and none older than 30 days`, async () => {
    await org.withOrg(async ({ tx }) => {
      const old = new Date(Date.now() - 31 * 86_400_000)
      await tx.query('INSERT INTO sync_runs (workspace_id, started_at, finished_at, ok, instances) VALUES ($1, $2, $2, true, $3)', [workspaceId, old, '[]'])
      for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
        await recordSyncRun(tx, {
          workspaceId,
          startedAt: new Date(),
          finishedAt: new Date(),
          triggers: ['documents'],
          ok: true,
          instances: [{ id: 'neo4j', applied: i, failed: 0, reset: false, upserts: i, deletes: 0, changes: Array.from({ length: 80 }, (_, n) => ({ operation: 'upsert', kind: 'entity', id: `e${n}` })) }],
        })
      }
      const { rows } = await tx.query<{ count: string }>('SELECT count(*) FROM sync_runs WHERE workspace_id = $1', [workspaceId])
      expect(Number(rows[0]?.count)).toBe(HISTORY_LIMIT)
      const [newest] = await listSyncRuns(tx, workspaceId, 1)
      expect(newest?.instances[0]).toMatchObject({ applied: HISTORY_LIMIT + 4 })
      // The counts cover every change; only the first 50 are named.
      expect(newest?.instances[0]?.changes).toHaveLength(50)
    })
  })

  it('seals each trace, sums its cost, and keeps a bounded number', async () => {
    await org.withOrg(async (ctx) => {
      for (let i = 0; i < HISTORY_LIMIT + 3; i += 1) {
        await recordQueryTrace(ctx, { workspaceId, tool: 'ask', actor: 'user:u1', userId: 'u1', outcome: 'answered', durationMs: 12.6, detail: detail(`who owns orders? ${i}`) })
      }
      const { rows } = await ctx.tx.query<{ count: string; sealed: boolean }>(
        "SELECT count(*), bool_and(position(convert_to('who owns', 'UTF8') in detail_ciphertext) = 0) AS sealed FROM query_traces WHERE workspace_id = $1",
        [workspaceId],
      )
      expect(Number(rows[0]?.count)).toBe(HISTORY_LIMIT)
      expect(rows[0]?.sealed).toBe(true)
      const [newest] = await listQueryTraces(ctx, workspaceId, { limit: 1 })
      expect(newest).toMatchObject({ tool: 'ask', actor: 'user:u1', durationMs: 13, costUsd: 0.002 })
      expect(newest?.detail?.question).toBe(`who owns orders? ${HISTORY_LIMIT + 2}`)
    })
  })

  it('lists only the questions a member asked, through any of their credentials, when asked for theirs', async () => {
    await org.withOrg(async (ctx) => {
      const { id: other } = await insertWorkspace(ctx.tx, { name: 'Mine', slug: 'mine', createdBy: org.userId })
      const ask = (actor: string, userId: string, question: string) =>
        recordQueryTrace(ctx, { workspaceId: other, tool: 'search', actor, userId, outcome: 'answered', durationMs: 1, detail: detail(question) })
      await ask('token:dkt_live_alice', 'u-alice', 'alice by token')
      await ask('user:u-bob', 'u-bob', 'bob in person')
      await ask('oauth:claude/user:u-alice', 'u-alice', 'alice by OAuth')
      const questions = (traces: Awaited<ReturnType<typeof listQueryTraces>>) => traces.map((trace) => trace.detail?.question)
      expect(questions(await listQueryTraces(ctx, other, { askedBy: 'u-alice' }))).toEqual(['alice by OAuth', 'alice by token'])
      expect(questions(await listQueryTraces(ctx, other, { askedBy: 'u-bob' }))).toEqual(['bob in person'])
      expect(questions(await listQueryTraces(ctx, other, { askedBy: 'u-carol' }))).toEqual([])
      expect(questions(await listQueryTraces(ctx, other))).toEqual(['alice by OAuth', 'bob in person', 'alice by token'])
    })
  })
})
