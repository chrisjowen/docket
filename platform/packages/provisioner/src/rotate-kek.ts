// SPDX-License-Identifier: AGPL-3.0-only
import type { KeyService } from '@docket/platform-keys'
import { transaction } from '@docket/platform-tenancy'
import type pg from 'pg'

export interface RewrapResult {
  /** Data keys moved under the current KEK by this run. */
  rewrapped: number
  /** Data keys still under another KEK afterwards, by KEK id; empty once a rotation is complete. */
  remaining: Record<string, number>
}

/**
 * Moves every org's data keys under the current KEK (ops/runbooks/rotate-kek.md).
 * The data keys themselves do not change, so no document is re-encrypted.
 * Runs as the migration owner, which owns `platform.org_keys` (the request
 * role may only read and add rows), in one transaction: a failure moves none.
 * Keys under a KEK the service does not know are left as they are and
 * reported in `remaining`.
 */
export async function rewrapOrgKeys(admin: pg.Pool, keys: KeyService): Promise<RewrapResult> {
  return transaction(admin, async (tx) => {
    const { rows } = await tx.query<{ org_id: string; version: number; wrapped: Buffer; kek_id: string }>(
      'SELECT org_id, version, wrapped, kek_id FROM platform.org_keys WHERE kek_id = ANY($1::text[]) ORDER BY org_id, version FOR UPDATE',
      [keys.otherKekIds],
    )
    for (const row of rows) {
      const moved = await keys.rewrap(row.org_id, new Uint8Array(row.wrapped), row.kek_id)
      await tx.query('UPDATE platform.org_keys SET wrapped = $3, kek_id = $4 WHERE org_id = $1 AND version = $2', [
        row.org_id,
        row.version,
        Buffer.from(moved.wrapped),
        moved.kekId,
      ])
    }
    const { rows: left } = await tx.query<{ kek_id: string; n: number }>(
      'SELECT kek_id, count(*)::int AS n FROM platform.org_keys WHERE kek_id <> $1 GROUP BY kek_id ORDER BY kek_id',
      [keys.kekId],
    )
    return { rewrapped: rows.length, remaining: Object.fromEntries(left.map((row) => [row.kek_id, row.n])) }
  })
}
