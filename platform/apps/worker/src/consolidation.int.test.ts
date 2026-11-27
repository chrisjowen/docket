// SPDX-License-Identifier: AGPL-3.0-only
import { recordUsage, type AiDeps } from '@docket/platform-ai'
import { putDocument } from '@docket/platform-canonical-store'
import { createTestOrg, readFixture, type TestOrg } from '@docket/platform-canonical-store/testing'
import { recentRuns } from '@docket/platform-consolidation'
import { enrichmentAiActor, ensureEnrichmentOntology, requestRun, saveSettings } from '@docket/platform-enrichment'
import { createWorkspace } from '@docket/platform-ontology-service'
import { startFakeEmbedder } from '@docket/platform-projections/testing'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { consolidationLoop } from './consolidation.js'
import { enrichmentLoop } from './enrichment.js'

describe.skipIf(!TEST_PG_URL)('consolidationLoop', () => {
  let org: TestOrg
  let workspaceId: string
  const lines: string[] = []
  const log = { info: (line: string) => void lines.push(line), error: (line: string) => void lines.push(`error ${line}`) }
  let clock = new Date('2026-11-05T09:00:00.000Z')

  beforeAll(async () => {
    org = await createTestOrg()
    const fixture = await readFixture()
    workspaceId = await org.withOrg(async (ctx) => {
      const publisher = { actor: `user:${org.userId}`, login: org.login }
      const { workspace } = await createWorkspace(ctx, { name: 'Platform', slug: 'platform', start: { importYaml: fixture.ontology }, publisher })
      for (const document of fixture.documents) {
        await putDocument(ctx, { workspaceId: workspace.id, ...document, origin: 'repo', originRef: 'conn1:.docket', actor: 'system:repo-sync' })
      }
      await ensureEnrichmentOntology(ctx, workspace.id, publisher)
      return workspace.id
    })
    await org.db.admin.query("UPDATE platform.orgs SET status = 'active' WHERE id = $1", [org.orgId])
  })
  afterAll(() => org?.drop())

  const options = { ai: null, log, now: () => clock }
  const consolidation = () => consolidationLoop({ router: org.router, keyring: org.keyring, ...options })

  it('runs once enrichment is on and every four hours after, and follows each finished enrichment run with one run', async () => {
    expect(await consolidation().tick()).toEqual([])
    await org.withOrg((ctx) =>
      saveSettings(ctx.tx, workspaceId, { enabled: true, schedule: 'nightly', monthlyLimitUsd: 2, capUsd: 20, by: `user:${org.userId}`, now: clock }),
    )
    // On the schedule: none has run yet, so one runs now, following no enrichment run.
    const [scheduled] = await consolidation().tick()
    expect(scheduled?.status).toBe('ok')
    expect(await consolidation().tick()).toEqual([])
    await org.withOrg((ctx) => requestRun(ctx.tx, workspaceId, `user:${org.userId}`, clock))
    const [enriched] = await enrichmentLoop({ router: org.router, keyring: org.keyring, ...options }).tick()
    expect(enriched?.status).toBe('ok')

    const [followed] = await consolidation().tick()
    expect(followed?.status).toBe('ok')
    expect(followed?.summary?.aiStopped).toBe('off')
    expect(lines.some((line) => line.startsWith('consolidation ') && line.includes('status=ok'))).toBe(true)
    expect(await consolidation().tick()).toEqual([])
    const runs = await org.withOrg((ctx) => recentRuns(ctx.tx, workspaceId))
    expect(runs.map((run) => run.enrichmentRunId === null).sort()).toEqual([false, true])

    // Four hours on, the schedule runs it again; a shorter interval is the worker's to set.
    clock = new Date(clock.getTime() + 4 * 3_600_000)
    expect(await consolidation().tick()).toHaveLength(1)
    clock = new Date(clock.getTime() + 3_600_000)
    expect(await consolidation().tick()).toEqual([])
    expect(await consolidationLoop({ router: org.router, keyring: org.keyring, ...options, everyMs: 3_600_000 }).tick()).toHaveLength(1)
  })

  it('costs a run by its own AI calls, while spend from enrichment on the same actor still counts against the shared limit', async () => {
    clock = new Date(clock.getTime() + 60_000)
    await org.withOrg((ctx) => requestRun(ctx.tx, workspaceId, `user:${org.userId}`, clock))
    const [enriched] = await enrichmentLoop({ router: org.router, keyring: org.keyring, ...options }).tick()
    expect(enriched?.status).toBe('ok')

    const ai = {
      platform: (fn: Parameters<typeof org.router.withPlatform>[0]) => org.router.withPlatform(fn),
      caps: { assertWithinCap: async () => {} },
      keys: { key: async () => 'test-key' },
      client: {
        async chat() {
          // An enrichment run on the same actor spends a dollar while this call is in flight.
          await org.router.withPlatform((tx) =>
            recordUsage(tx, { orgId: org.orgId, workspaceId, actor: enrichmentAiActor(workspaceId), purpose: 'enrichment', model: 'other', promptTokens: 0, completionTokens: 0, costUsd: 1 }),
          )
          const text = 'Orders takes and tracks customer orders for the Commerce team, and leans on Payments to charge every card.'
          return { text, model: 'test/cheap-model', generationId: null, usage: { promptTokens: 10, completionTokens: 20, costUsd: 0.01 } }
        },
      },
    } as unknown as AiDeps

    const embedder = await startFakeEmbedder()
    const [followed] = await consolidationLoop({ router: org.router, keyring: org.keyring, ...options, ai, embedder })
      .tick()
      .finally(() => embedder.close())
    expect(followed?.status).toBe('limited')
    expect(followed?.summary).toEqual(expect.objectContaining({ aiCalls: 2, summarized: 2, failed: 0, aiStopped: 'limit' }))
    expect(followed?.costUsd).toBeCloseTo(0.02, 6)
    const [stored] = await org.withOrg((ctx) => recentRuns(ctx.tx, workspaceId, 1))
    expect(stored?.costUsd).toBeCloseTo(0.02, 6)
    const models = await org.withOrg(async (ctx) => {
      const { rows } = await ctx.tx.query<{ model: string }>('SELECT DISTINCT model FROM consolidation_summaries WHERE run_id = $1', [stored?.id])
      return rows.map((row) => row.model)
    })
    expect(models).toEqual(['test/cheap-model'])
  })
})
