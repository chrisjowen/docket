// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'

import type { Tx } from './db.js'

export interface MasterKeyPrincipal {
  id: string
  orgId: string
  orgSlug: string
  adminId: string
  databaseLimit: number
}

/** Look up the hash on every call; the lock serialises a call with ops revocation. */
export async function lookupMasterKey(tx: Tx, bearer: string): Promise<MasterKeyPrincipal | null> {
  if (!/^dmk_[0-9A-Za-z]{43}$/.test(bearer)) return null
  const { rows } = await tx.query<{ id: string; org_id: string; slug: string; org_admin_id: string; admin_database_limit: number }>(
    `SELECT k.id, k.org_id, o.slug, o.org_admin_id, o.admin_database_limit
       FROM platform.org_master_keys k JOIN platform.orgs o ON o.id = k.org_id
      WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND k.expires_at > now()
        AND o.status = 'active' AND o.org_admin_id IS NOT NULL FOR UPDATE OF k FOR SHARE OF o`,
    [createHash('sha256').update(bearer).digest('hex')],
  )
  const row = rows[0]
  return row ? { id: row.id, orgId: row.org_id, orgSlug: row.slug, adminId: row.org_admin_id, databaseLimit: row.admin_database_limit } : null
}
