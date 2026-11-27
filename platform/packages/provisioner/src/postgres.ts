// SPDX-License-Identifier: AGPL-3.0-only
import type { KeyService } from '@docket/platform-keys'
import {
  ORG_SCHEMA_VERSION,
  ident,
  migrateOrg,
  orgRole,
  orgSchema,
  transaction,
  type OrgRef,
  type Tx,
} from '@docket/platform-tenancy'
import type pg from 'pg'

import type { StoreBinding, TenantProvisioner } from './port.js'

export class ProvisionError extends Error {
  override name = 'ProvisionError'
}

export interface PostgresProvisionerOptions {
  /** A pool connected as the migration owner: owns the database and may create roles. */
  admin: pg.Pool
  /** Wraps each org's data key. */
  keys: KeyService
  /** The login role requests connect as (`docket_app`). */
  appRole: string
}

async function orgStatus(tx: Tx, orgId: string): Promise<{ status: string; schema_version: number } | undefined> {
  const { rows } = await tx.query<{ status: string; schema_version: number }>(
    'SELECT status, schema_version FROM platform.orgs WHERE id = $1 FOR UPDATE',
    [orgId],
  )
  return rows[0]
}

async function roleExists(tx: Tx, role: string): Promise<boolean> {
  const { rowCount } = await tx.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])
  return (rowCount ?? 0) > 0
}

/**
 * The Postgres side of an org (§5.1, §7.3): a schema and a login-less role of
 * its own, the org migrations, the request role's non-inheriting membership in
 * the org role, and a fresh data key wrapped by the KEK. One transaction, so
 * a failure leaves nothing half made.
 */
export function postgresProvisioner(options: PostgresProvisionerOptions): TenantProvisioner {
  const { admin, keys } = options
  const app = ident(options.appRole)

  return {
    provision(org: OrgRef): Promise<StoreBinding> {
      const schema = orgSchema(org.orgId)
      const role = orgRole(org.orgId)
      return transaction(admin, async (tx) => {
        const current = await orgStatus(tx, org.orgId)
        if (!current) throw new ProvisionError(`org ${org.orgId} is not recorded`)
        if (current.status === 'deleted') throw new ProvisionError(`org ${org.orgId} is deleted`)

        if (!(await roleExists(tx, role))) {
          await tx.query(`CREATE ROLE ${ident(role)} NOLOGIN NOINHERIT`)
        }
        await tx.query(`CREATE SCHEMA IF NOT EXISTS ${ident(schema)}`)
        await tx.query(`REVOKE ALL ON SCHEMA ${ident(schema)} FROM PUBLIC`)
        await migrateOrg(tx, org.orgId, { appRole: options.appRole })
        // The request role may SET ROLE to the org but inherits none of its privileges.
        await tx.query(`GRANT ${ident(role)} TO ${app} WITH INHERIT FALSE, SET TRUE`)

        const { rowCount } = await tx.query('SELECT 1 FROM platform.org_keys WHERE org_id = $1', [org.orgId])
        if (!rowCount) {
          const { wrapped, kekId } = await keys.wrapNewKey(org.orgId)
          await tx.query('INSERT INTO platform.org_keys (org_id, version, wrapped, kek_id) VALUES ($1, 1, $2, $3)', [
            org.orgId,
            Buffer.from(wrapped),
            kekId,
          ])
        }
        if (current.status === 'provisioning') {
          await tx.query("UPDATE platform.orgs SET status = 'active' WHERE id = $1", [org.orgId])
        }
        return { store: 'postgres', target: schema }
      })
    },

    async bind(org) {
      const schema = orgSchema(org.orgId)
      const { rows } = await admin.query<{ status: string }>('SELECT status FROM platform.orgs WHERE id = $1', [
        org.orgId,
      ])
      if (rows[0]?.status !== 'active') throw new ProvisionError(`org ${org.orgId} is not active`)
      return { store: 'postgres', target: schema }
    },

    async suspend(org) {
      // Postgres cannot scale one schema to zero; a suspended org is refused by the tenant router.
      await admin.query("UPDATE platform.orgs SET status = 'suspended' WHERE id = $1 AND status = 'active'", [
        org.orgId,
      ])
    },

    deprovision(org, mode) {
      const schema = orgSchema(org.orgId)
      const role = orgRole(org.orgId)
      return transaction(admin, async (tx) => {
        const current = await orgStatus(tx, org.orgId)
        if (!current) throw new ProvisionError(`org ${org.orgId} is not recorded`)
        await tx.query("UPDATE platform.orgs SET status = 'deleted', deleted_at = coalesce(deleted_at, now()) WHERE id = $1", [
          org.orgId,
        ])
        if (await roleExists(tx, role)) {
          await tx.query(`REVOKE ${ident(role)} FROM ${app}`)
        }
        if (mode === 'shred') {
          // Crypto-shredding: without the wrapped keys, every copy of the org's rows, backups included, is unreadable.
          await tx.query('DELETE FROM platform.org_keys WHERE org_id = $1', [org.orgId])
          await tx.query('DELETE FROM platform.memberships WHERE org_id = $1', [org.orgId])
          await tx.query('DELETE FROM platform.invites WHERE org_id = $1', [org.orgId])
          await tx.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`)
          await tx.query("DELETE FROM platform.schema_migrations WHERE schema_name = $1", [schema])
          if (await roleExists(tx, role)) await tx.query(`DROP ROLE ${ident(role)}`)
        }
      })
    },

    async health(org) {
      const role = orgRole(org.orgId)
      const { rows } = await admin.query<{ status: string; schema_version: number; member: boolean }>(
        `SELECT o.status, o.schema_version,
                EXISTS (SELECT 1 FROM pg_auth_members am
                          JOIN pg_roles r ON r.oid = am.roleid AND r.rolname = $2
                          JOIN pg_roles m ON m.oid = am.member AND m.rolname = $3) AS member
           FROM platform.orgs o WHERE o.id = $1`,
        [org.orgId, role, options.appRole],
      )
      const row = rows[0]
      if (!row || row.status !== 'active' || !row.member) return 'down'
      return row.schema_version < ORG_SCHEMA_VERSION ? 'degraded' : 'ok'
    },
  }
}
