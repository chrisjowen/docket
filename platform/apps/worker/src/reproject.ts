// SPDX-License-Identifier: AGPL-3.0-only
import { CLOUD_PROJECTIONS, enqueue } from '@docket/platform-canonical-store'
import { ADAPTER_VERSION } from '@docket/platform-projections'
import type { TenantRouter } from '@docket/platform-tenancy'

import { activeOrgs, type Logger } from './outbox.js'

/**
 * Re-projects every workspace whose Neo4j or mem0 was projected by another
 * docket release. A manifest vouches only for the release that wrote it
 * (`projectionFingerprint`), so the next pass resets the instance and
 * projects it again - with what the new release writes, mem0's embedded text
 * for one - but a pass runs only when something wakes it. This asks for one:
 * a `recheck` for each such workspace that has none waiting. Re-embedding
 * runs on the in-cluster embedder, so it spends no AI budget. Safe to repeat:
 * once replayed, a manifest names this release.
 */
export async function reprojectOutdated(router: TenantRouter, log: Logger, version: string = ADAPTER_VERSION): Promise<number> {
  let asked = 0
  for (const orgId of await activeOrgs(router)) {
    try {
      asked += await router.withTenant(orgId, async (tx) => {
        const { rows } = await tx.query<{ workspace_id: string }>(
          `SELECT DISTINCT m.workspace_id FROM adapter_manifests m
            WHERE m.instance_id = ANY($1) AND m.manifest->'definition'->>'version' IS DISTINCT FROM $2
              AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.workspace_id = m.workspace_id AND o.kind = 'recheck' AND o.processed_at IS NULL)
            ORDER BY m.workspace_id`,
          [CLOUD_PROJECTIONS, version],
        )
        for (const row of rows) await enqueue(tx, row.workspace_id, 'recheck')
        return rows.length
      })
    } catch (error) {
      log.error(`reproject org=${orgId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (asked > 0) log.info(`reproject: ${asked} workspace(s) projected by another docket release asked to re-project with ${version}`)
  return asked
}
