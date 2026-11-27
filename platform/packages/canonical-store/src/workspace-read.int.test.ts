// SPDX-License-Identifier: AGPL-3.0-only
import { webcrypto } from 'node:crypto'

import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { hashContent, insertWorkspace, putDocument, retireDocument, type StoreContext } from './index.js'
import { createTestOrg, readFixture, FIXTURE_ROOT, type TestOrg } from './testing.js'
import { createWorkspaceReadCache } from './workspace-read.js'

describe.skipIf(!TEST_PG_URL)('validated workspace read cache', () => {
  let org: TestOrg
  let workspaceId: string
  let raw: string
  let path: string
  let ontology: string
  let clock = 0

  beforeAll(async () => {
    org = await createTestOrg()
    const fixture = await readFixture(FIXTURE_ROOT)
    ontology = fixture.ontology
    const document = fixture.documents[0]!
    raw = document.raw
    path = document.path
    workspaceId = await org.withOrg(async (ctx) => {
      const workspace = await insertWorkspace(ctx.tx, { name: 'Cache', slug: 'cache', createdBy: org.userId })
      await ctx.tx.query(
        `INSERT INTO ontology_versions (workspace_id, number, status, yaml, yaml_hash, source, author, published_at, published_by)
         VALUES ($1, 1, 'published', $2, $3, 'import', $4, now(), $4)`,
        [workspace.id, ontology, hashContent(ontology), org.userId],
      )
      await putDocument(ctx, { workspaceId: workspace.id, raw, path, origin: 'repo', actor: org.userId })
      return workspace.id
    })
  })
  afterAll(() => org?.drop())

  it('reuses validation across transactions and isolates caller mutations', async () => {
    const read = createWorkspaceReadCache()
    const first = await org.withOrg((ctx) => read(ctx, workspaceId))
    const expected = structuredClone(first)
    first.entities.length = 0
    first.documents.length = 0
    await org.withOrg(async (ctx) => {
      const query = vi.spyOn(ctx.tx, 'query')
      try {
        expect(await read(ctx, workspaceId)).toEqual(expected)
        expect(query).toHaveBeenCalledTimes(1)
      } finally { query.mockRestore() }
    })
  })

  it('expires reads and bypasses entries larger than the budget', async () => {
    for (const options of [{ maxBytes: 1 }, { maxEntries: 0 }, { ttlMs: 1, now: () => clock }]) {
      const read = createWorkspaceReadCache(options)
      await org.withOrg((ctx) => read(ctx, workspaceId))
      clock += 10
      await org.withOrg(async (ctx) => {
        const query = vi.spyOn(ctx.tx, 'query')
        try {
          expect((await read(ctx, workspaceId)).entities).toHaveLength(1)
          expect(query.mock.calls.length).toBeGreaterThan(1)
        } finally { query.mockRestore() }
      })
    }
  })

  it('evicts the least recently used workspace at the entry limit', async () => {
    const read = createWorkspaceReadCache({ maxEntries: 1 })
    const other = await org.withOrg(async (ctx) => {
      const workspace = await insertWorkspace(ctx.tx, { name: 'Other', slug: 'other', createdBy: org.userId })
      await ctx.tx.query(
        `INSERT INTO ontology_versions (workspace_id, number, status, yaml, yaml_hash, source, author, published_at, published_by)
         VALUES ($1, 1, 'published', $2, $3, 'import', $4, now(), $4)`,
        [workspace.id, ontology, hashContent(ontology), org.userId],
      )
      return workspace.id
    })
    await org.withOrg((ctx) => read(ctx, workspaceId))
    expect((await org.withOrg((ctx) => read(ctx, other))).entities).toHaveLength(0)
    await org.withOrg(async (ctx) => {
      const query = vi.spyOn(ctx.tx, 'query')
      try {
        expect((await read(ctx, workspaceId)).entities).toHaveLength(1)
        expect(query.mock.calls.length).toBeGreaterThan(1)
      } finally { query.mockRestore() }
    })
  })

  it('does not return uncommitted changes after a rollback', async () => {
    const read = createWorkspaceReadCache()
    await expect(org.withOrg(async (ctx) => {
      await putDocument(ctx, { workspaceId, raw: `${raw}\nRolled back notes.\n`, path, origin: 'repo', actor: org.userId })
      expect((await read(ctx, workspaceId)).files.get(path)).toContain('Rolled back notes.')
      throw new Error('rollback')
    })).rejects.toThrow('rollback')
    expect((await org.withOrg((ctx) => read(ctx, workspaceId))).files.get(path)).toBe(raw)
  })

  it('invalidates when the index checkpoint changes', async () => {
    const read = createWorkspaceReadCache()
    await org.withOrg((ctx) => read(ctx, workspaceId))
    await org.withOrg((ctx) => ctx.tx.query(
      `INSERT INTO projection_status (workspace_id, instance_id, checkpoint) VALUES ($1, 'neo4j', 'changed')`, [workspaceId],
    ))
    await org.withOrg(async (ctx) => {
      const query = vi.spyOn(ctx.tx, 'query')
      try {
        await read(ctx, workspaceId)
        expect(query.mock.calls.length).toBeGreaterThan(1)
      } finally { query.mockRestore() }
    })
  })

  it('requires the same decryption keys on a hit', async () => {
    const read = createWorkspaceReadCache()
    await org.withOrg((ctx) => read(ctx, workspaceId))
    const wrongKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['decrypt'])
    await org.withOrg(async (ctx) => {
      const wrong: StoreContext = { ...ctx, keys: { ...ctx.keys, key: () => wrongKey } }
      expect((await read(wrong, workspaceId)).entities).toHaveLength(0)
      expect((await read(ctx, workspaceId)).entities).toHaveLength(1)
      const missing: StoreContext = { ...ctx, keys: { ...ctx.keys, key: (version) => {
        if (version !== undefined) throw new Error('Missing historical key')
        return ctx.keys.key()
      } } }
      const unreadable = await read(missing, workspaceId)
      expect(unreadable.entities).toHaveLength(0)
      expect(unreadable.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true)
    })
  })

  it('invalidates when the published ontology changes', async () => {
    const read = createWorkspaceReadCache()
    await org.withOrg((ctx) => read(ctx, workspaceId))
    await org.withOrg((ctx) => ctx.tx.query(
      `UPDATE ontology_versions SET yaml = $2, yaml_hash = $3 WHERE workspace_id = $1 AND status = 'published'`,
      [workspaceId, `${ontology}\n# Revised ontology\n`, hashContent(`${ontology}\n# Revised ontology\n`)],
    ))
    await org.withOrg(async (ctx) => {
      const query = vi.spyOn(ctx.tx, 'query')
      try {
        expect((await read(ctx, workspaceId)).entities).toHaveLength(1)
        expect(query.mock.calls.length).toBeGreaterThan(1)
      } finally { query.mockRestore() }
    })
  })

  it('sees document edits and retirement before projections advance', async () => {
    const read = createWorkspaceReadCache()
    await org.withOrg((ctx) => read(ctx, workspaceId))
    await org.withOrg((ctx) => putDocument(ctx, { workspaceId, raw: `${raw}\nNew narrative notes.\n`, path, origin: 'repo', actor: org.userId }))
    expect((await org.withOrg((ctx) => read(ctx, workspaceId))).files.get(path)).toContain('New narrative notes.')
    await org.withOrg((ctx) => retireDocument(ctx.tx, { workspaceId, path }))
    expect((await org.withOrg((ctx) => read(ctx, workspaceId))).entities).toHaveLength(0)
  })
})
