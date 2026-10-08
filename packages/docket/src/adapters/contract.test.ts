import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertAdapterContract, fakeServices } from '@docket/contracts/testing'
import { describe, expect, it } from 'vitest'

import { init } from '../commands/init.js'
import { compatDefinitions } from './compat.js'
import { loadAdapterDefinition } from './loader.js'

const FIXTURES = dirname(fileURLToPath(new URL('../../test/fixtures/adapters/fake-local.mjs', import.meta.url)))

describe('adapter contract', () => {
  it('holds for a small fake local adapter loaded as a module', async () => {
    const definition = await loadAdapterDefinition('./fake-local.mjs', { id: 'fake', projectRoot: FIXTURES })
    const report = await assertAdapterContract(definition, { config: { label: 'fake' }, invalidConfig: {} })
    expect(report.checks.every((check) => check.ok)).toBe(true)
    expect(report.checks.map((check) => check.name)).toContain('query.ask returns a valid answer')
  })

  it('holds for the v1 jsonl projection through its compatibility definition', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'docket-compat-')))
    await init({ cwd: root })
    const { jsonl } = compatDefinitions({ projectRoot: root, memoryRoot: join(root, '.docket'), stateRoot: join(root, '.docket', '.index') })

    const report = await assertAdapterContract(jsonl, {
      config: { type: 'jsonl', output: '.docket/.index' },
      invalidConfig: { type: 'neo4j' },
      services: fakeServices({ projectRoot: root })
    })
    expect(report.checks.map((check) => check.name)).toEqual([
      'definition envelope',
      'validateConfig accepts the config',
      'validateConfig rejects the invalid config',
      'create resolves to an adapter',
      'describe',
      'status',
      'projection.apply acknowledges every change',
      'projection.apply replays the same batch',
      'projection.flush',
      'projection.reset',
      'query.ask returns a valid answer',
      'close'
    ])
  })

  it('accepts the v1 `file` alias for jsonl, and every v1 mem0 and neo4j config', () => {
    const definitions = compatDefinitions({ projectRoot: '/repo', memoryRoot: '/repo/.docket', stateRoot: '/repo/.docket/.index' })
    expect(definitions.jsonl.validateConfig({ type: 'file' })).toEqual({ type: 'jsonl', output: '.docket/.index' })
    expect(definitions.mem0.validateConfig({ type: 'mem0', mode: 'server', url: 'http://localhost:8888' })).toMatchObject({
      mode: 'server',
      apiKeyEnv: 'MEM0_API_KEY'
    })
    expect(definitions.neo4j.validateConfig({ type: 'neo4j', url: 'neo4j+s://graph.example', scope: 'payments' })).toMatchObject({
      url: 'neo4j+s://graph.example',
      scope: 'payments'
    })
    expect(() => definitions.neo4j.validateConfig({ type: 'jsonl' })).toThrow('expected a neo4j projection, got jsonl')
  })
})
