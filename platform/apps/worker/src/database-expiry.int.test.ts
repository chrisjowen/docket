// SPDX-License-Identifier: AGPL-3.0-only
import { pendingDeletions, workspaceBySlug } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { createWorkspace } from '@docket/platform-ontology-service'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expireDatabases } from './database-expiry.js'

// No projections needed: the existing workspace_deletions pipeline owns their purge.
describe.skipIf(!TEST_PG_URL)('database grace expiry', () => {
  let org: TestOrg
  beforeAll(async () => { org = await createTestOrg() })
  afterAll(() => org?.drop())

  it('retains grace rows until 30 days, then cascades through the normal deletion path and frees their identities', async () => {
    const now = new Date()
    const workspace = await org.withOrg(async (ctx) => {
      const { workspace } = await createWorkspace(ctx, { name: 'Grace', slug: 'grace', start: { template: 'blank' }, publisher: { actor: `user:${org.userId}`, login: org.login } })
      await ctx.tx.query('UPDATE workspaces SET owner_ref = $2, deleted_at = $3, deleted_by = $4 WHERE id = $1', [workspace.id, 'owner:grace', now, `user:${org.userId}`])
      return workspace
    })
    expect(await expireDatabases(org.router, org.keyring, org.orgId, new Date(now.getTime() + 30 * 86400000 - 1))).toBe(0)
    const retained = await org.withOrg(async ({ tx }) => (await tx.query('SELECT 1 FROM ontology_versions WHERE workspace_id = $1', [workspace.id])).rowCount)
    expect(retained).toBe(1)
    const afterGrace = new Date(now.getTime() + 30 * 86400000)
    expect(await expireDatabases(org.router, org.keyring, org.orgId, afterGrace)).toBe(1)
    expect(await expireDatabases(org.router, org.keyring, org.orgId, afterGrace)).toBe(0)
    expect(await org.withOrg(({ tx }) => workspaceBySlug(tx, 'grace'))).toBeNull()
    expect(await org.withOrg(async ({ tx }) => (await tx.query('SELECT 1 FROM ontology_versions WHERE workspace_id = $1', [workspace.id])).rowCount)).toBe(0)
    expect(await org.withOrg(({ tx }) => pendingDeletions(tx, afterGrace))).toContainEqual(expect.objectContaining({ workspaceId: workspace.id, slug: 'grace' }))
    await org.withOrg(async (ctx) => {
      const { workspace: replacement } = await createWorkspace(ctx, { name: 'Replacement', slug: 'grace', start: { template: 'blank' }, publisher: { actor: `user:${org.userId}`, login: org.login } })
      await ctx.tx.query('UPDATE workspaces SET owner_ref = $2 WHERE id = $1', [replacement.id, 'owner:grace'])
      expect(replacement.id === workspace.id).toBe(false)
    })
  })
})
