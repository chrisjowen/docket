// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'

import type pg from 'pg'

import { ident, transaction, type Tx } from './db.js'
import { ORG_MIGRATIONS, PLATFORM_MIGRATIONS, type Migration } from './migrations.js'
import { orgRole, orgSchema } from './names.js'

export class MigrationError extends Error {
  override name = 'MigrationError'
}

/** Serialises every migration run across replicas. */
const MIGRATION_LOCK = "hashtext('docket-cloud:migrate')"

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex')
}

function fill(sql: string, values: Record<string, string>): string {
  return sql.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = values[key]
    if (value === undefined) throw new MigrationError(`migration placeholder {{${key}}} has no value`)
    return value
  })
}

async function ensureLedger(tx: Tx): Promise<void> {
  await tx.query('CREATE SCHEMA IF NOT EXISTS platform')
  await tx.query(`CREATE TABLE IF NOT EXISTS platform.schema_migrations (
    schema_name text NOT NULL,
    version integer NOT NULL,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (schema_name, version)
  )`)
}

/** Applies the migrations a schema is missing and refuses one whose applied text has changed. */
async function apply(
  tx: Tx,
  schemaName: string,
  migrations: readonly Migration[],
  values: Record<string, string>,
): Promise<number> {
  const { rows } = await tx.query<{ version: number; checksum: string }>(
    'SELECT version, checksum FROM platform.schema_migrations WHERE schema_name = $1',
    [schemaName],
  )
  const applied = new Map(rows.map((row) => [row.version, row.checksum]))
  let count = 0
  for (const migration of migrations) {
    const sum = checksum(migration.sql)
    const seen = applied.get(migration.version)
    if (seen !== undefined) {
      if (seen !== sum) {
        throw new MigrationError(`${schemaName} migration ${migration.name} changed after it was applied`)
      }
      continue
    }
    await tx.query(fill(migration.sql, values))
    await tx.query(
      'INSERT INTO platform.schema_migrations (schema_name, version, name, checksum) VALUES ($1, $2, $3, $4)',
      [schemaName, migration.version, migration.name, sum],
    )
    count += 1
  }
  return count
}

export interface MigrateOptions {
  /** The login role requests connect as (`docket_app`, §5.1). */
  appRole: string
}

/**
 * Brings the platform schema up to date. Runs as the migration owner (the role
 * that owns the database and may create roles), under an advisory lock, so
 * replicas starting together apply each migration once.
 */
export async function migratePlatform(admin: pg.Pool, options: MigrateOptions): Promise<number> {
  return transaction(admin, async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`)
    await ensureLedger(tx)
    return apply(tx, 'platform', PLATFORM_MIGRATIONS, { app_role: ident(options.appRole) })
  })
}

/**
 * Brings one org schema up to date inside the caller's (migration owner's)
 * transaction, and records the version on the org row.
 */
export async function migrateOrg(tx: Tx, orgId: string, options: MigrateOptions): Promise<number> {
  await tx.query(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`)
  const schema = orgSchema(orgId)
  const count = await apply(tx, schema, ORG_MIGRATIONS, {
    schema: ident(schema),
    org_role: ident(orgRole(orgId)),
    org_id: orgId,
    app_role: ident(options.appRole),
  })
  const version = ORG_MIGRATIONS.at(-1)?.version ?? 0
  await tx.query('UPDATE platform.orgs SET schema_version = $2 WHERE id = $1', [orgId, version])
  return count
}

/** Migrates every live org whose schema is behind this build, one transaction per org. */
export async function migrateBehindOrgs(admin: pg.Pool, options: MigrateOptions): Promise<string[]> {
  const version = ORG_MIGRATIONS.at(-1)?.version ?? 0
  const { rows } = await admin.query<{ id: string }>(
    "SELECT id FROM platform.orgs WHERE status IN ('active', 'suspended') AND schema_version < $1 ORDER BY id",
    [version],
  )
  for (const { id } of rows) {
    await transaction(admin, (tx) => migrateOrg(tx, id, options))
  }
  return rows.map((row) => row.id)
}
