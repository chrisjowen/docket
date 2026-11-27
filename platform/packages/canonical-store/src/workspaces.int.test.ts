// SPDX-License-Identifier: AGPL-3.0-only
import { hashContent } from '@chrisjowen/docket'
import { LIMITS, adminDatabaseLimit, mintMasterKey } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  WorkspaceError,
  countMemberWorkspaces,
  deleteWorkspace,
  enqueue,
  insertWorkspace,
  listWorkspaces,
  pendingDeletions,
  putDocument,
  recordIngest,
  recordPurge,
} from './index.js'
import { createTestOrg, readFixture, type Fixture, type TestOrg } from './testing.js'

/** The org-schema tables that hold rows for a workspace, each by its workspace_id. */
const WORKSPACE_TABLES = [
  'documents',
  'ontology_versions',
  'adapter_manifests',
  'outbox',
  'projection_status',
  'repo_connections',
  'ingest_events',
] as const

describe.skipIf(!TEST_PG_URL)('deleteWorkspace', () => {
  let org: TestOrg
  let fixture: Fixture

  beforeAll(async () => {
    org = await createTestOrg()
    fixture = await readFixture()
  })
  afterAll(() => org?.drop())

  /** A workspace with everything a used one holds: an ontology, documents with revisions, a repo connection, activity, an outbox. */
  async function seeded(slug: string): Promise<string> {
    return org.withOrg(async (ctx) => {
      const workspace = await insertWorkspace(ctx.tx, { name: slug, slug, createdBy: org.userId })
      await ctx.tx.query(
        `INSERT INTO ontology_versions (workspace_id, number, status, yaml, yaml_hash, source, author, published_at, published_by)
         VALUES ($1, 1, 'published', $2, $3, 'import', $4, now(), $4)`,
        [workspace.id, fixture.ontology, hashContent(fixture.ontology), org.userId],
      )
      for (const document of fixture.documents) {
        await putDocument(ctx, { workspaceId: workspace.id, ...document, origin: 'cloud', actor: org.userId })
      }
      const first = fixture.documents[0]
      if (first) await putDocument(ctx, { workspaceId: workspace.id, path: first.path, raw: `${first.raw}\nEdited.\n`, origin: 'cloud', actor: org.userId })
      await ctx.tx.query(
        `INSERT INTO repo_connections (id, workspace_id, installation_id, repo_id, repo_full_name, branch, path, created_by)
         VALUES ($1, $2, 1, 2, 'acme/platform', 'main', '.docket/', $3)`,
        [`c${workspace.id}`.slice(0, 40), workspace.id, org.userId],
      )
      await ctx.tx.query(
        `INSERT INTO adapter_manifests (workspace_id, instance_id, manifest) VALUES ($1, 'neo4j', '{}'), ($1, 'mem0', '{}')`,
        [workspace.id],
      )
      await ctx.tx.query(`INSERT INTO projection_status (workspace_id, instance_id) VALUES ($1, 'neo4j')`, [workspace.id])
      await recordIngest(ctx, { workspaceId: workspace.id, channel: 'ui', actor: org.userId, actorLabel: org.login, action: 'remember', outcome: 'ok', requestId: 'req-seed' })
      await enqueue(ctx.tx, workspace.id, 'rebuild')
      return workspace.id
    })
  }

  const rowsFor = (workspaceId: string) =>
    org.withOrg(async ({ tx }) => {
      const counts: Record<string, number> = {}
      for (const table of WORKSPACE_TABLES) {
        const { rows } = await tx.query<{ count: string }>(`SELECT count(*) FROM ${table} WHERE workspace_id = $1`, [workspaceId])
        counts[table] = Number(rows[0]?.count ?? 0)
      }
      const { rows } = await tx.query<{ count: string }>(
        'SELECT count(*) FROM document_revisions r WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = r.document_id)',
      )
      counts.orphanRevisions = Number(rows[0]?.count ?? 0)
      return counts
    })

  it('removes the workspace and every row of it in the org schema, as the org role, and leaves the others alone', async () => {
    const doomed = await seeded('doomed')
    const kept = await seeded('kept')
    const before = await rowsFor(doomed)
    for (const table of WORKSPACE_TABLES) expect(before[table], table).toBeGreaterThan(0)

    const result = await org.withOrg((ctx) => deleteWorkspace(ctx, { workspaceId: doomed, deletedBy: `user:${org.userId}` }))
    expect(result.workspace).toMatchObject({ id: doomed, slug: 'doomed' })
    expect(result.connections).toEqual([`c${doomed}`.slice(0, 40)])

    const after = await rowsFor(doomed)
    expect(after).toEqual({ ...Object.fromEntries(WORKSPACE_TABLES.map((table) => [table, 0])), orphanRevisions: 0 })
    const others = await rowsFor(kept)
    for (const table of WORKSPACE_TABLES) expect(others[table], table).toBe(before[table])
    expect((await org.withOrg(({ tx }) => listWorkspaces(tx))).map((workspace) => workspace.slug)).toEqual(['kept'])
  })

  it('records the deletion for the worker until its projections are purged, backing off after a failure', async () => {
    const workspaceId = await seeded('purged')
    await org.withOrg((ctx) => deleteWorkspace(ctx, { workspaceId, deletedBy: `user:${org.userId}` }))
    const now = new Date(Date.now() + 1_000)
    const pending = await org.withOrg(({ tx }) => pendingDeletions(tx, now))
    expect(pending).toContainEqual(expect.objectContaining({ workspaceId, slug: 'purged', failures: 0 }))

    await org.withOrg(({ tx }) => recordPurge(tx, workspaceId, { at: now, error: 'neo4j unreachable', retryAt: new Date(now.getTime() + 30_000) }))
    expect((await org.withOrg(({ tx }) => pendingDeletions(tx, now))).map((d) => d.workspaceId)).not.toContain(workspaceId)
    const later = await org.withOrg(({ tx }) => pendingDeletions(tx, new Date(now.getTime() + 31_000)))
    expect(later).toContainEqual(expect.objectContaining({ workspaceId, failures: 1 }))

    await org.withOrg(({ tx }) => recordPurge(tx, workspaceId, { at: now }))
    expect((await org.withOrg(({ tx }) => pendingDeletions(tx, new Date(now.getTime() + 31_000)))).map((d) => d.workspaceId)).not.toContain(workspaceId)
  })

  it('refuses a workspace the org does not have', async () => {
    await expect(org.withOrg((ctx) => deleteWorkspace(ctx, { workspaceId: 'nosuch', deletedBy: 'user:x' }))).rejects.toBeInstanceOf(WorkspaceError)
  })
})

describe.skipIf(!TEST_PG_URL)('insertWorkspace limits', () => {
  let org: TestOrg

  beforeAll(async () => {
    org = await createTestOrg()
  })
  afterAll(() => org?.drop())

  it('holds member creates to the beta limit and the org admin API to the org limit ops set at mint', async () => {
    const create = (slug: string, maxWorkspaces?: number) =>
      org.withOrg(({ tx }) =>
        insertWorkspace(tx, { name: slug, slug, createdBy: org.userId, ...(maxWorkspaces !== undefined ? { maxWorkspaces } : {}) }),
      )
    await org.router.withPlatform((tx) => mintMasterKey(tx, { orgId: org.orgId, databaseLimit: LIMITS.workspacesPerOrg + 2 }))
    const limit = await org.router.withPlatform((tx) => adminDatabaseLimit(tx, org.orgId))
    expect(limit).toBe(LIMITS.workspacesPerOrg + 2)

    for (let i = 0; i < LIMITS.workspacesPerOrg; i += 1) await create(`ui-${i}`)
    await expect(create('ui-over')).rejects.toMatchObject({ code: 'limit' })

    await create('admin-a', limit)
    await create('admin-b', limit)
    await expect(create('admin-over', limit)).rejects.toMatchObject({ code: 'limit', message: expect.stringContaining(`${limit} databases`) })
    expect(await org.withOrg(({ tx }) => listWorkspaces(tx))).toHaveLength(limit)
  })
})

describe.skipIf(!TEST_PG_URL)('insertWorkspace limits with the org admin API', () => {
  let org: TestOrg

  beforeAll(async () => {
    org = await createTestOrg()
  })
  afterAll(() => org?.drop())

  it("leaves the API's databases out of the members' beta limit, and counts every workspace to the org limit", async () => {
    const limit = LIMITS.workspacesPerOrg + 3
    // What the org admin API's create does: the org's limit, then the caller's owner_ref, in one transaction.
    const viaApi = (slug: string) =>
      org.withOrg(async ({ tx }) => {
        const workspace = await insertWorkspace(tx, { name: slug, slug, createdBy: 'token:mk_test', maxWorkspaces: limit })
        await tx.query('UPDATE workspaces SET owner_ref = $2 WHERE id = $1', [workspace.id, `team:${slug}`])
      })
    const byMember = (slug: string) => org.withOrg(({ tx }) => insertWorkspace(tx, { name: slug, slug, createdBy: org.userId }))

    for (let i = 0; i < LIMITS.workspacesPerOrg; i += 1) await viaApi(`api-${i}`)
    expect(await org.withOrg(({ tx }) => countMemberWorkspaces(tx))).toBe(0)
    for (let i = 0; i < LIMITS.workspacesPerOrg; i += 1) await byMember(`ui-${i}`)
    expect(await org.withOrg(({ tx }) => countMemberWorkspaces(tx))).toBe(LIMITS.workspacesPerOrg)
    await expect(byMember('ui-over')).rejects.toMatchObject({ code: 'limit', message: expect.stringContaining('in the beta') })
    // The org's limit counts the members' workspaces as well as its own.
    await expect(viaApi('api-over')).rejects.toMatchObject({ code: 'limit', message: expect.stringContaining(`${limit} databases`) })
  })
})
