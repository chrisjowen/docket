// SPDX-License-Identifier: AGPL-3.0-only
import type pg from 'pg'

import { ident, transaction, type Tx } from './db.js'
import { ORG_SCHEMA_VERSION } from './migrations.js'
import { orgRole, orgSchema } from './names.js'

/** The org cannot be served: it is not active, or its schema is behind this build (§5.1). */
export class OrgUnavailable extends Error {
  override name = 'OrgUnavailable'
  constructor(
    readonly orgId: string,
    readonly reason: 'missing' | 'inactive' | 'schema-behind',
  ) {
    super(`org ${orgId} is unavailable (${reason})`)
  }
}

/**
 * Per-org connection routing (§3 step 6, §5.1). Requests connect as the
 * request role, which inherits nothing from the org roles it belongs to; only
 * `SET LOCAL ROLE org_<id>` gives a transaction one org's privileges, so a
 * routing bug cannot read across orgs.
 */
export interface TenantRouter {
  /** Runs `fn` as the request role, with `search_path = platform`. */
  withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
  /** Runs `fn` as `org_<id>`, with `search_path = org_<id>`. */
  withTenant<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T>
  /**
   * Switches the rest of a `withPlatform` transaction to the org, for a change
   * to platform rows (a membership) whose audit event belongs in the org's log.
   */
  enterTenant(tx: Tx, orgId: string): Promise<void>
}

async function enter(tx: Tx, orgId: string): Promise<void> {
  const schema = orgSchema(orgId)
  const { rows } = await tx.query<{ status: string; schema_version: number }>(
    'SELECT status, schema_version FROM platform.orgs WHERE id = $1',
    [orgId],
  )
  const org = rows[0]
  if (!org) throw new OrgUnavailable(orgId, 'missing')
  if (org.status !== 'active') throw new OrgUnavailable(orgId, 'inactive')
  if (org.schema_version < ORG_SCHEMA_VERSION) throw new OrgUnavailable(orgId, 'schema-behind')
  await tx.query(`SET LOCAL ROLE ${ident(orgRole(orgId))}`)
  await tx.query(`SET LOCAL search_path = ${ident(schema)}`)
}

export function tenantRouter(pool: pg.Pool): TenantRouter {
  return {
    withPlatform(fn) {
      return transaction(pool, async (tx) => {
        await tx.query('SET LOCAL search_path = platform')
        return fn(tx)
      })
    },
    withTenant(orgId, fn) {
      return transaction(pool, async (tx) => {
        await enter(tx, orgId)
        return fn(tx)
      })
    },
    enterTenant: enter,
  }
}
