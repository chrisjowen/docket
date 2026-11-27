// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { audit } from '@docket/platform-audit'
import { deleteWorkspace, lockOntologyHead, type Keyring } from '@docket/platform-canonical-store'
import { dropRoutes } from '@docket/platform-github'
import type { TenantRouter } from '@docket/platform-tenancy'

/** Finish the admin API's grace period through the normal workspace deletion path. */
export async function expireDatabases(router: TenantRouter, keyring: Keyring, orgId: string, now: Date): Promise<number> {
  const keys = await keyring.forOrg(orgId)
  return router.withTenant(orgId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM workspaces WHERE deleted_at <= $1::timestamptz - interval '30 days' ORDER BY id`, [now],
    )
    let expired = 0
    for (const row of rows) {
      // Keep publish's lock order, and recheck after waiting for another expiry sweep.
      await lockOntologyHead({ tx }, row.id, 'update')
      const locked = await tx.query("SELECT 1 FROM workspaces WHERE id = $1 AND deleted_at <= $2::timestamptz - interval '30 days' FOR UPDATE", [row.id, now])
      if (!locked.rowCount) continue
      const { workspace, connections } = await deleteWorkspace({ tx, keys }, { workspaceId: row.id, deletedBy: 'system:database-expiry' })
      await router.withPlatform((platform) => dropRoutes(platform, { orgId, connectionIds: connections }))
      await audit(tx, { orgId, workspaceId: row.id, actor: 'system:database-expiry', action: 'org.admin.database.purge',
        target: [`database:${workspace.slug}`], outcome: 'ok', requestId: randomUUID(), latencyMs: 0 })
      expired += 1
    }
    return expired
  })
}
