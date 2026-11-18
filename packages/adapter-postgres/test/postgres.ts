import { randomBytes } from 'node:crypto'

import pg from 'pg'

/**
 * Throwaway Postgres databases for the integration tests. Set
 * `DOCKET_TEST_PG_URL` to a URL of a role that may create databases, for
 * example `postgres://postgres:postgres@127.0.0.1:5432/postgres`; without it
 * the suites are skipped, except in CI, where that is an error. The semantic
 * suites need the pgvector extension there too (the pgvector/pgvector:pg17
 * image), and are skipped without it.
 */
export const TEST_PG_URL = process.env.DOCKET_TEST_PG_URL

if (!TEST_PG_URL && process.env.CI) {
  throw new Error('DOCKET_TEST_PG_URL must be set in CI: the Postgres tests would otherwise be skipped')
}

export interface TestDatabase {
  url: string
  /** Connected to the test database. */
  pool: pg.Pool
  drop(): Promise<void>
}

const urlFor = (database: string): string => {
  const url = new URL(TEST_PG_URL as string)
  url.pathname = `/${database}`
  return url.toString()
}

/** A new, empty database. */
export async function createTestDatabase(): Promise<TestDatabase> {
  if (!TEST_PG_URL) throw new Error('DOCKET_TEST_PG_URL is not set')
  const database = `docket_pgidx_${randomBytes(5).toString('hex')}`
  const root = new pg.Client({ connectionString: TEST_PG_URL })
  await root.connect()
  try {
    await root.query(`CREATE DATABASE "${database}"`)
  } finally {
    await root.end()
  }
  const url = urlFor(database)
  const pool = new pg.Pool({ connectionString: url, max: 4 })
  return {
    url,
    pool,
    async drop() {
      pool.on('error', () => undefined)
      await pool.end()
      const cleanup = new pg.Client({ connectionString: TEST_PG_URL })
      await cleanup.connect()
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
      } finally {
        await cleanup.end()
      }
    }
  }
}

/** Whether the server can give the test database pgvector. */
export async function hasPgvector(): Promise<boolean> {
  if (!TEST_PG_URL) return false
  const client = new pg.Client({ connectionString: TEST_PG_URL })
  await client.connect()
  try {
    return ((await client.query(`SELECT 1 FROM pg_available_extensions WHERE name = 'vector'`)).rowCount ?? 0) > 0
  } finally {
    await client.end()
  }
}
