// SPDX-License-Identifier: AGPL-3.0-only
import { putDocument } from '@docket/platform-canonical-store'
import { createTestOrg, readFixture, type TestOrg } from '@docket/platform-canonical-store/testing'
import { ensureEnrichmentOntology, recentRuns, requestRun, saveSettings } from '@docket/platform-enrichment'
import { createWorkspace } from '@docket/platform-ontology-service'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { enrichmentLoop } from './enrichment.js'

describe.skipIf(!TEST_PG_URL)('enrichmentLoop', () => {
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

  const loop = () => enrichmentLoop({ router: org.router, keyring: org.keyring, ai: null, log, now: () => clock })

  it('runs nothing while enrichment is off, even when asked', async () => {
    expect(await loop().tick()).toEqual([])
    await expect(org.withOrg((ctx) => requestRun(ctx.tx, workspaceId, `user:${org.userId}`))).rejects.toThrow(/Turn enrichment on/)
  })

  it('runs a workspace when asked, then on its schedule, and not in between', async () => {
    await org.withOrg((ctx) =>
      saveSettings(ctx.tx, workspaceId, { enabled: true, schedule: 'nightly', monthlyLimitUsd: 2, capUsd: 20, by: `user:${org.userId}`, now: clock }),
    )
    await org.withOrg((ctx) => requestRun(ctx.tx, workspaceId, `user:${org.userId}`, clock))
    const [asked] = await loop().tick()
    expect(asked?.status).toBe('ok')
    expect(Object.values(asked?.summary?.written ?? {}).reduce((sum, n) => sum + n, 0)).toBeGreaterThan(0)
    expect(lines.some((line) => line.includes('status=ok') && line.includes('manual'))).toBe(true)

    expect(await loop().tick()).toEqual([])
    clock = new Date('2026-11-06T02:00:00.000Z')
    const [scheduled] = await loop().tick()
    expect(scheduled?.status).toBe('ok')
    const runs = await org.withOrg((ctx) => recentRuns(ctx.tx, workspaceId))
    expect(runs.map((run) => run.trigger).sort()).toEqual(['manual', 'schedule'])
  })
})
