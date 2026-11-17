import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readFixture, type Fixture } from '../../test/fixture.js'
import { STORE_KINDS, TEST_PG_URL, createTestStore, seedWorkspace, type TestStore } from '../../test/postgres.js'
import {
  WorkspaceError,
  deleteWorkspace,
  enqueue,
  insertWorkspace,
  listWorkspaces,
  ontologyMcpRoles,
  pendingDeletions,
  putDocument,
  recordIngest,
  recordPurge,
  setOntologyMcpRoles,
  workspaceById,
  workspaceBySlug
} from './index.js'

/** The tables that hold rows for a workspace, each by its workspace_id. */
const WORKSPACE_TABLES = ['documents', 'ontology_versions', 'adapter_manifests', 'outbox', 'projection_status', 'ingest_events'] as const

describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('workspaces over $name', (kind) => {
  let test: TestStore
  let fixture: Fixture

  beforeAll(async () => {
    test = await createTestStore(kind)
    fixture = await readFixture()
  })
  afterAll(() => test?.drop())

  /** A workspace with everything a used one holds: an ontology, documents with revisions, manifests, activity, an outbox. */
  const seeded = (slug: string): Promise<string> =>
    test.as(async (ctx) => {
      const workspaceId = await seedWorkspace(ctx, { slug, ontology: fixture.ontology })
      for (const document of fixture.documents) await putDocument(ctx, { workspaceId, ...document, origin: 'cloud', actor: 'user:owner' })
      const first = fixture.documents[0]
      if (first) await putDocument(ctx, { workspaceId, path: first.path, raw: `${first.raw}\nEdited.\n`, origin: 'cloud', actor: 'user:owner' })
      await ctx.tx.query(`INSERT INTO adapter_manifests (workspace_id, instance_id, manifest) VALUES ($1, 'neo4j', '{}'), ($1, 'mem0', '{}')`, [workspaceId])
      await ctx.tx.query(`INSERT INTO projection_status (workspace_id, instance_id) VALUES ($1, 'neo4j')`, [workspaceId])
      await recordIngest(ctx, { workspaceId, channel: 'ui', actor: 'user:owner', actorLabel: 'owner', action: 'remember', outcome: 'ok', requestId: 'req-seed' })
      await enqueue(ctx.tx, workspaceId, 'rebuild')
      return workspaceId
    })

  const rowsFor = (workspaceId: string) =>
    test.as(async ({ tx }) => {
      const counts: Record<string, number> = {}
      for (const table of WORKSPACE_TABLES) {
        const { rows } = await tx.query<{ count: string }>(`SELECT count(*) FROM ${table} WHERE workspace_id = $1`, [workspaceId])
        counts[table] = Number(rows[0]?.count ?? 0)
      }
      const { rows } = await tx.query<{ count: string }>('SELECT count(*) FROM document_revisions r WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = r.document_id)')
      counts.orphanRevisions = Number(rows[0]?.count ?? 0)
      return counts
    })

  it('finds a workspace by id and by slug, and refuses a bad name, a bad slug or one already taken', async () => {
    const workspace = await test.as(({ tx }) => insertWorkspace(tx, { name: '  Lookups ', slug: 'lookups', createdBy: 'user:owner' }))
    expect(workspace).toMatchObject({ slug: 'lookups', name: 'Lookups', createdBy: 'user:owner', ontologyMcpRoles: [] })
    expect(workspace.id).toMatch(/^[a-z0-9]{12}$/)
    expect(await test.as(({ tx }) => workspaceById(tx, workspace.id))).toEqual(workspace)
    expect(await test.as(({ tx }) => workspaceBySlug(tx, 'lookups'))).toEqual(workspace)
    for (const [name, slug] of [
      ['', 'blank'],
      ['Bad', 'Not A Slug'],
      ['Bad', 'two--hyphens'],
      ['Bad', 'new']
    ] as const) {
      await expect(test.as(({ tx }) => insertWorkspace(tx, { name, slug, createdBy: 'user:owner' }))).rejects.toMatchObject({ code: 'invalid' })
    }
    await expect(test.as(({ tx }) => insertWorkspace(tx, { name: 'Again', slug: 'lookups', createdBy: 'user:owner' }))).rejects.toMatchObject({ code: 'conflict' })
  })

  it('removes the workspace and every row of it, and leaves the others alone', async () => {
    const doomed = await seeded('doomed')
    const kept = await seeded('kept')
    const before = await rowsFor(doomed)
    for (const table of WORKSPACE_TABLES) expect(before[table], table).toBeGreaterThan(0)

    expect(await test.as(({ tx }) => deleteWorkspace(tx, { workspaceId: doomed, deletedBy: 'user:owner' }))).toMatchObject({ id: doomed, slug: 'doomed' })
    expect(await rowsFor(doomed)).toEqual({ ...Object.fromEntries(WORKSPACE_TABLES.map((table) => [table, 0])), orphanRevisions: 0 })
    const others = await rowsFor(kept)
    for (const table of WORKSPACE_TABLES) expect(others[table], table).toBe(before[table])
    expect((await test.as(({ tx }) => listWorkspaces(tx))).map((workspace) => workspace.slug)).not.toContain('doomed')
    await expect(test.as(({ tx }) => deleteWorkspace(tx, { workspaceId: 'nosuch', deletedBy: 'user:x' }))).rejects.toBeInstanceOf(WorkspaceError)
  })

  it('records the deletion for the worker until its projections are purged, backing off after a failure', async () => {
    const workspaceId = await seeded('purged')
    await test.as(({ tx }) => deleteWorkspace(tx, { workspaceId, deletedBy: 'user:owner' }))
    const now = new Date(Date.now() + 1_000)
    expect(await test.as(({ tx }) => pendingDeletions(tx, now))).toContainEqual(expect.objectContaining({ workspaceId, slug: 'purged', failures: 0 }))

    await test.as(({ tx }) => recordPurge(tx, workspaceId, { at: now, error: 'neo4j unreachable', retryAt: new Date(now.getTime() + 30_000) }))
    expect((await test.as(({ tx }) => pendingDeletions(tx, now))).map((d) => d.workspaceId)).not.toContain(workspaceId)
    expect(await test.as(({ tx }) => pendingDeletions(tx, new Date(now.getTime() + 31_000)))).toContainEqual(expect.objectContaining({ workspaceId, failures: 1 }))

    await test.as(({ tx }) => recordPurge(tx, workspaceId, { at: now }))
    expect((await test.as(({ tx }) => pendingDeletions(tx, new Date(now.getTime() + 31_000)))).map((d) => d.workspaceId)).not.toContain(workspaceId)
  })

  it('lets only owners, admins and editors publish the ontology over MCP, as the workspace sets it', async () => {
    const workspaceId = await test.as((ctx) => seedWorkspace(ctx, { slug: 'roles', ontology: fixture.ontology }))
    expect(await test.as(({ tx }) => ontologyMcpRoles(tx, workspaceId))).toEqual([])
    await expect(test.as(({ tx }) => setOntologyMcpRoles(tx, workspaceId, ['viewer']))).rejects.toMatchObject({ code: 'invalid' })
    expect(await test.as(({ tx }) => setOntologyMcpRoles(tx, workspaceId, ['editor', 'owner']))).toEqual(['owner', 'editor'])
    expect(await test.as(({ tx }) => ontologyMcpRoles(tx, workspaceId))).toEqual(['owner', 'editor'])
    await expect(test.as(({ tx }) => setOntologyMcpRoles(tx, 'nosuch', ['owner']))).rejects.toMatchObject({ code: 'not-found' })
  })

  it('holds the store to a workspace limit when one is set, even under concurrent creates', async () => {
    const count = (await test.as(({ tx }) => listWorkspaces(tx))).length
    const limit = count + 2
    const results = await Promise.allSettled(
      ['l-one', 'l-two', 'l-three', 'l-four'].map((slug) => test.as(({ tx }) => insertWorkspace(tx, { name: slug, slug, createdBy: 'user:owner', maxWorkspaces: limit })))
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2)
    expect(results.filter((result) => result.status === 'rejected').map((result) => (result as PromiseRejectedResult).reason)).toEqual([
      expect.objectContaining({ code: 'limit', message: `This store holds at most ${limit} workspaces.` }),
      expect.objectContaining({ code: 'limit' })
    ])
  })
})
