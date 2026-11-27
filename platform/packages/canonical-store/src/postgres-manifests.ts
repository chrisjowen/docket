// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from '@docket/platform-tenancy'

import type { AdapterManifest, ManifestStore } from './docket.js'

/**
 * Docket's `ManifestStore` over Postgres: one row per adapter instance of the
 * workspace (adapter-spec §8). A manifest holds ids, hashes and the
 * checkpoint, never document text, so it is stored as it is.
 */
export function postgresManifests(tx: Tx, workspaceId: string): ManifestStore {
  return {
    async read(instanceId) {
      const { rows } = await tx.query<{ manifest: AdapterManifest }>(
        'SELECT manifest FROM adapter_manifests WHERE workspace_id = $1 AND instance_id = $2',
        [workspaceId, instanceId],
      )
      return rows[0]?.manifest
    },
    async write(instanceId, manifest) {
      await tx.query(
        `INSERT INTO adapter_manifests (workspace_id, instance_id, manifest) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, instance_id) DO UPDATE SET manifest = EXCLUDED.manifest, updated_at = now()`,
        [workspaceId, instanceId, JSON.stringify({ ...manifest, adapter: instanceId })],
      )
    },
    async list() {
      const { rows } = await tx.query<{ instance_id: string }>(
        'SELECT instance_id FROM adapter_manifests WHERE workspace_id = $1 ORDER BY instance_id',
        [workspaceId],
      )
      return rows.map((row) => row.instance_id)
    },
    async remove(instanceId) {
      await tx.query('DELETE FROM adapter_manifests WHERE workspace_id = $1 AND instance_id = $2', [workspaceId, instanceId])
    },
  }
}
