import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertAdapterContract, fakeServices } from '@docket/contracts/testing'
import { describe, expect, it } from 'vitest'

import { init } from '../commands/init.js'
import { V1_PROJECTION_MODULES } from '../config/config.js'
import { POSTGRES_ADAPTER_MODULE, SQLITE_ADAPTER_MODULE, standardDistribution } from './distribution.js'
import { loadAdapterDefinition } from './loader.js'

const FIXTURES = dirname(fileURLToPath(new URL('../../test/fixtures/adapters/fake-local.mjs', import.meta.url)))

describe('adapter contract', () => {
  it('holds for a small fake local adapter loaded as a module', async () => {
    const definition = await loadAdapterDefinition('./fake-local.mjs', { id: 'fake', projectRoot: FIXTURES })
    const report = await assertAdapterContract(definition, { config: { label: 'fake' }, invalidConfig: {} })
    expect(report.checks.every((check) => check.ok)).toBe(true)
    expect(report.checks.map((check) => check.name)).toContain('query.ask returns a valid answer')
  })

  it('holds for the jsonl adapter docket serves v1 jsonl projections with', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'docket-jsonl-')))
    await init({ cwd: root })
    const jsonl = await loadAdapterDefinition(V1_PROJECTION_MODULES.jsonl, {
      id: 'jsonl',
      projectRoot: root,
      distribution: standardDistribution
    })

    const report = await assertAdapterContract(jsonl, {
      config: { type: 'jsonl', output: '.docket/.index' },
      invalidConfig: { type: 'neo4j' },
      services: fakeServices({ projectRoot: root })
    })
    expect(report.checks.every((check) => check.ok)).toBe(true)
    expect(report.checks.map((check) => check.name)).toContain('query.ask returns a valid answer')
  })

  it('holds for the sqlite adapter, in a file of its own', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'docket-sqlite-')))
    const sqlite = await loadAdapterDefinition(SQLITE_ADAPTER_MODULE, { id: 'sqlite', projectRoot: root, distribution: standardDistribution })

    const report = await assertAdapterContract(sqlite, {
      config: {},
      invalidConfig: { search: 'semantic' },
      services: fakeServices({ projectRoot: root, stateRoot: join(root, '.docket/.index/adapters/sqlite') })
    })
    expect(report.checks.map((check) => check.name)).toContain('query.ask returns a valid answer')
  })

  // Against a real Postgres, as the adapter's own suites run: DOCKET_TEST_PG_URL (packages/adapter-postgres/test/postgres.ts).
  it.skipIf(!process.env.DOCKET_TEST_PG_URL)('holds for the postgres adapter, in a scope of its own', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'docket-postgres-')))
    const postgres = await loadAdapterDefinition(POSTGRES_ADAPTER_MODULE, { id: 'postgres', projectRoot: root, distribution: standardDistribution })

    const report = await assertAdapterContract(postgres, {
      config: { url: process.env.DOCKET_TEST_PG_URL, schema: 'docket_contract', scope: `contract-${Date.now()}` },
      invalidConfig: { url: 'postgres://localhost/db', urlEnv: 'DATABASE_URL' },
      services: fakeServices({ projectRoot: root })
    })
    expect(report.checks.map((check) => check.name)).toContain('query.ask returns a valid answer')
  })
})
