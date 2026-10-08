import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertAdapterContract, fakeServices } from '@docket/contracts/testing'
import { describe, expect, it } from 'vitest'

import { init } from '../commands/init.js'
import { V1_PROJECTION_MODULES } from '../config/config.js'
import { standardDistribution } from './distribution.js'
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
})
