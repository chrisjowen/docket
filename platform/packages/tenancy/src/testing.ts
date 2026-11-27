// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto'

import pg from 'pg'

import { ident } from './db.js'
import { migratePlatform } from './migrate.js'

/**
 * A throwaway Postgres database shaped like production for tests: a
 * migration owner that may create roles (CNPG's `docket`), a request role with
 * no privileges of its own (`docket_app`), and the platform migrations applied.
 *
 * Set `DOCKET_TEST_PG_URL` to a superuser URL, for example
 * `postgres://postgres:postgres@127.0.0.1:55432/postgres`.
 */
export interface TestDatabase {
  name: string
  adminRole: string
  appRole: string
  /** Connected as the migration owner. */
  admin: pg.Pool
  /** Connected as the request role. */
  app: pg.Pool
  /** Connected as the superuser, for tampering the way an attacker with disk access would. */
  superuser: pg.Pool
  /** A connection string for one of the two roles. */
  url(role: 'admin' | 'app'): string
  drop(): Promise<void>
}

export const TEST_PG_URL = process.env.DOCKET_TEST_PG_URL

if (!TEST_PG_URL && process.env.CI) {
  throw new Error('DOCKET_TEST_PG_URL must be set in CI: the Postgres tests would otherwise be skipped')
}

function withCredentials(base: string, database: string, user?: string, password?: string): string {
  const url = new URL(base)
  url.pathname = `/${database}`
  if (user) {
    url.username = user
    url.password = password ?? ''
  }
  return url.toString()
}

export async function createTestDatabase(): Promise<TestDatabase> {
  if (!TEST_PG_URL) throw new Error('DOCKET_TEST_PG_URL is not set')
  const tag = `t${randomBytes(5).toString('hex')}`
  const adminRole = `${tag}_owner`
  const appRole = `${tag}_app`
  const password = randomBytes(12).toString('hex')

  const root = new pg.Client({ connectionString: TEST_PG_URL })
  await root.connect()
  try {
    await root.query(`CREATE ROLE ${ident(adminRole)} LOGIN CREATEROLE PASSWORD '${password}'`)
    await root.query(`CREATE ROLE ${ident(appRole)} LOGIN PASSWORD '${password}'`)
    await root.query(`CREATE DATABASE ${ident(tag)} OWNER ${ident(adminRole)}`)
  } finally {
    await root.end()
  }

  const url = (role: 'admin' | 'app') =>
    withCredentials(TEST_PG_URL, tag, role === 'admin' ? adminRole : appRole, password)
  const admin = new pg.Pool({ connectionString: url('admin'), max: 4 })
  const app = new pg.Pool({ connectionString: url('app'), max: 4 })
  const superuser = new pg.Pool({ connectionString: withCredentials(TEST_PG_URL, tag), max: 2 })
  await migratePlatform(admin, { appRole })

  return {
    name: tag,
    adminRole,
    appRole,
    admin,
    app,
    superuser,
    url,
    async drop() {
      const { rows } = await admin.query<{ rolname: string }>(
        `SELECT r.rolname FROM pg_roles r JOIN platform.orgs o ON r.rolname = 'org_' || o.id`,
      )
      // end() resolves before its clients' sockets close, so the forced drop
      // below can terminate one mid-close (57P01): that is expected here.
      for (const pool of [admin, app, superuser]) pool.on('error', () => undefined)
      await Promise.all([admin.end(), app.end(), superuser.end()])
      const cleanup = new pg.Client({ connectionString: TEST_PG_URL })
      await cleanup.connect()
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${ident(tag)} WITH (FORCE)`)
        for (const { rolname } of rows) await cleanup.query(`DROP ROLE IF EXISTS ${ident(rolname)}`)
        await cleanup.query(`DROP ROLE IF EXISTS ${ident(appRole)}`)
        await cleanup.query(`DROP ROLE IF EXISTS ${ident(adminRole)}`)
      } finally {
        await cleanup.end()
      }
    },
  }
}
