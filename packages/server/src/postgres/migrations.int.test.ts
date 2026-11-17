import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_PG_URL, createTestStore, type TestStore } from '../../test/postgres.js'
import { plaintextCodec } from '../codecs.js'
import { CORE_MIGRATIONS, MigrationError, migrate, migrateSchema, postgresStore, transaction } from './index.js'

describe.skipIf(!TEST_PG_URL)('the store migrations', () => {
  let test: TestStore
  beforeAll(async () => {
    test = await createTestStore({ name: 'public', schema: () => 'public', codec: () => plaintextCodec() })
  })
  afterAll(() => test?.drop())

  const tables = async (schema: string) => {
    const { rows } = await test.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name",
      [schema]
    )
    return rows.map((row) => row.table_name)
  }

  const CORE_TABLES = [
    'adapter_manifests',
    'docket_migrations',
    'document_revisions',
    'documents',
    'ingest_events',
    'ontology_versions',
    'outbox',
    'projection_status',
    'supersessions',
    'sync_runs',
    'workspace_deletions',
    'workspaces'
  ]

  it('make the core tables and record each migration in the schema’s own ledger', async () => {
    expect(await tables('public')).toEqual(CORE_TABLES)
    const { rows } = await test.pool.query('SELECT version, name FROM public.docket_migrations ORDER BY version')
    expect(rows).toEqual(CORE_MIGRATIONS.map(({ version, name }) => ({ version, name })))
  })

  it('apply nothing the second time, and run concurrently without applying anything twice', async () => {
    expect(await migrate(test.pool)).toBe(0)
    const applied = await Promise.all([migrate(test.pool, { schema: 'tenant_a' }), migrate(test.pool, { schema: 'tenant_a' }), migrate(test.pool, { schema: 'tenant_b' })])
    expect(applied.sort()).toEqual([0, 1, 1])
    expect(await tables('tenant_a')).toEqual(CORE_TABLES)
  })

  it('keep each schema’s store apart: a store sees only its own schema’s rows', async () => {
    const a = postgresStore({ pool: test.pool, schema: 'tenant_a', codec: plaintextCodec() })
    const b = postgresStore({ pool: test.pool, schema: 'tenant_b', codec: plaintextCodec() })
    await a.run(({ tx }) => tx.query("INSERT INTO workspaces (id, slug, name, created_by) VALUES ('wsa', 'alpha', 'Alpha', 'user:a')"))
    expect((await b.run(({ tx }) => tx.query('SELECT count(*)::int AS n FROM workspaces'))).rows[0]).toEqual({ n: 0 })
    expect((await a.run(({ tx }) => tx.query('SELECT count(*)::int AS n FROM workspaces'))).rows[0]).toEqual({ n: 1 })
  })

  it('refuse a migration whose text changed after it was applied, and a schema name that is not an identifier', async () => {
    const changed = CORE_MIGRATIONS.map((migration) => ({ ...migration, sql: `${migration.sql}\n-- edited` }))
    await expect(transaction(test.pool, (tx) => migrateSchema(tx, 'tenant_a', changed))).rejects.toBeInstanceOf(MigrationError)
    await expect(migrate(test.pool, { schema: 'Robert"); DROP TABLE x; --' })).rejects.toThrow(/not a safe SQL identifier/)
  })

  it('roll a store transaction back when it throws, and hand its connection back', async () => {
    const store = postgresStore({ pool: test.pool, schema: 'tenant_b', codec: plaintextCodec() })
    await expect(
      store.run(async ({ tx }) => {
        await tx.query("INSERT INTO workspaces (id, slug, name, created_by) VALUES ('wsb', 'beta', 'Beta', 'user:b')")
        throw new Error('changed my mind')
      })
    ).rejects.toThrow('changed my mind')
    expect((await store.run(({ tx }) => tx.query('SELECT count(*)::int AS n FROM workspaces'))).rows[0]).toEqual({ n: 0 })
    expect(test.pool.totalCount).toBeLessThanOrEqual(6)
  })
})
