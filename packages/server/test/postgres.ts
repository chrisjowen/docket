import { randomBytes } from 'node:crypto'

import pg from 'pg'

import { defaultAad, localKeyCodec, plaintextCodec } from '../src/codecs.js'
import { hashContent } from '../src/docket.js'
import type { DocumentCodec, StoreContext, StoreLimits, StoreRunner } from '../src/ports.js'
import { ident, insertWorkspace, migrate, postgresStore } from '../src/postgres/index.js'

/**
 * Throwaway Postgres stores for the integration tests. Set
 * `DOCKET_TEST_PG_URL` to a URL of a role that may create databases, for
 * example `postgres://postgres:postgres@127.0.0.1:5432/postgres`; without it
 * the suites are skipped, except in CI, where that is an error.
 */
export const TEST_PG_URL = process.env.DOCKET_TEST_PG_URL

if (!TEST_PG_URL && process.env.CI) {
  throw new Error('DOCKET_TEST_PG_URL must be set in CI: the Postgres tests would otherwise be skipped')
}

/** The two shapes every store suite runs against: a single-tenant store, and one tenant's store as Docket Cloud keeps it. */
export interface StoreKind {
  name: string
  /** The schema the store's tables go in. */
  schema: () => string
  codec: () => DocumentCodec
}

export const STORE_KINDS: readonly StoreKind[] = [
  { name: 'a plain schema with the plaintext codec', schema: () => 'public', codec: () => plaintextCodec() },
  {
    name: 'a templated schema with a local-key codec',
    schema: () => `org_${randomBytes(5).toString('hex')}`,
    // Docket Cloud binds each body to its organisation as well: so does this.
    codec: () => localKeyCodec({ key: randomBytes(32), keyVersion: 3, aad: (ref) => `orgtest|${defaultAad(ref)}` })
  }
]

export interface TestStore {
  kind: StoreKind
  schema: string
  codec: DocumentCodec
  /** Connected to the test database, outside any store's search path. */
  pool: pg.Pool
  store: StoreRunner
  /** Runs `fn` in one transaction in the store. */
  as<T>(fn: (ctx: StoreContext) => Promise<T>): Promise<T>
  /** The same store, held to `limits`. */
  limited(limits: StoreLimits): StoreRunner
  drop(): Promise<void>
}

function urlFor(database: string): string {
  const url = new URL(TEST_PG_URL as string)
  url.pathname = `/${database}`
  return url.toString()
}

/** A new database with the store's schema migrated into it. */
export async function createTestStore(kind: StoreKind): Promise<TestStore> {
  if (!TEST_PG_URL) throw new Error('DOCKET_TEST_PG_URL is not set')
  const database = `docket_t${randomBytes(5).toString('hex')}`
  const root = new pg.Client({ connectionString: TEST_PG_URL })
  await root.connect()
  try {
    await root.query(`CREATE DATABASE ${ident(database)}`)
  } finally {
    await root.end()
  }
  const pool = new pg.Pool({ connectionString: urlFor(database), max: 6 })
  const schema = kind.schema()
  const codec = kind.codec()
  await migrate(pool, { schema })
  const store = postgresStore({ pool, schema, codec })
  return {
    kind,
    schema,
    codec,
    pool,
    store,
    as: (fn) => store.run(fn),
    limited: (limits) => postgresStore({ pool, schema, codec, limits }),
    async drop() {
      // end() resolves before its clients' sockets close, so the forced drop can cut one mid-close.
      pool.on('error', () => undefined)
      await pool.end()
      const cleanup = new pg.Client({ connectionString: TEST_PG_URL })
      await cleanup.connect()
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${ident(database)} WITH (FORCE)`)
      } finally {
        await cleanup.end()
      }
    }
  }
}

/** The fixture's ontology published as v1 of a new workspace, the way an import publishes it, straight into the table. */
export async function seedWorkspace(ctx: StoreContext, input: { slug: string; ontology: string; createdBy?: string }): Promise<string> {
  const createdBy = input.createdBy ?? 'user:owner'
  const workspace = await insertWorkspace(ctx.tx, { name: input.slug, slug: input.slug, createdBy })
  await ctx.tx.query(
    `INSERT INTO ontology_versions (workspace_id, number, status, yaml, yaml_hash, source, author, published_at, published_by)
     VALUES ($1, 1, 'published', $2, $3, 'import', $4, now(), $4)`,
    [workspace.id, input.ontology, hashContent(input.ontology), createdBy]
  )
  return workspace.id
}
