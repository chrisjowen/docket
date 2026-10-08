import { copyFile, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { AdapterDefinition } from '@docket/contracts'
import { sampleAskRequest, sampleBatch } from '@docket/contracts/testing'
import { describe, expect, it, vi } from 'vitest'

import { init } from '../commands/init.js'
import { createDocket } from './docket.js'
import { standardDistribution } from './distribution.js'
import { loadAdapterDefinition } from './loader.js'

const FAKE_LOCAL = fileURLToPath(new URL('../../test/fixtures/adapters/fake-local.mjs', import.meta.url))

/** A fresh project with `.docket.yaml`, the fake adapter under tools/docket, and a nested directory. */
const project = async (): Promise<{ root: string; nested: string }> => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'docket-adapters-')))
  await init({ cwd: root })
  await mkdir(join(root, 'tools', 'docket'), { recursive: true })
  await copyFile(FAKE_LOCAL, join(root, 'tools', 'docket', 'fake-local.mjs'))
  const nested = join(root, 'services', 'orders', 'src')
  await mkdir(nested, { recursive: true })
  return { root, nested }
}

const write = async (path: string, contents: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

const inDirectory = async <T>(dir: string, run: () => Promise<T>): Promise<T> => {
  const previous = process.cwd()
  process.chdir(dir)
  try {
    return await run()
  } finally {
    process.chdir(previous)
  }
}

const reference = { id: 'company-memory', module: './tools/docket/fake-local.mjs', config: { label: 'company' } }

describe('project-local adapter modules', () => {
  it('load from any working directory, resolved against .docket.yaml', async () => {
    const { root, nested } = await project()
    const elsewhere = await realpath(await mkdtemp(join(tmpdir(), 'docket-elsewhere-')))

    for (const [cwd, projectRoot] of [
      [nested, undefined],
      [elsewhere, nested],
      [root, root]
    ] as const) {
      const docket = await inDirectory(cwd, () => createDocket({ projectRoot, adapters: [reference] }))
      expect(docket.resolved.projectRoot).toBe(root)
      const slot = docket.adapters.find((candidate) => candidate.id === 'company-memory')
      expect(slot).toMatchObject({ name: 'fake-local', source: './tools/docket/fake-local.mjs', roles: ['projection', 'query'] })

      const adapter = await slot!.create()
      const batch = sampleBatch({ scope: 'default' })
      expect(await adapter.projection!.apply(batch)).toEqual({
        batchId: batch.batchId,
        applied: ['service.orders', 'service.retired'],
        failed: []
      })
      const answer = await adapter.query!.ask({ ...sampleAskRequest(), context: { ...sampleAskRequest().context, scope: 'default' } })
      expect(answer.blocks.map((block) => block.kind)).toEqual(['entities', 'passages'])
      expect(answer.evidence[0]?.canonicalRefs).toEqual([{ kind: 'entity', id: 'service.orders', revision: 'sha256:0001' }])
      await adapter.close()
    }
  })

  it('report a missing file against the directory holding .docket.yaml', async () => {
    const { root, nested } = await project()
    await expect(
      createDocket({ projectRoot: nested, adapters: [{ ...reference, module: './tools/docket/missing.mjs' }] })
    ).rejects.toThrow(
      `Adapter "company-memory" module "./tools/docket/missing.mjs" was not found at ${join(root, 'tools/docket/missing.mjs')}. ` +
        `Relative paths resolve against ${root}, the directory holding .docket.yaml.`
    )
  })

  it('refuse TypeScript without an explicitly configured runner', async () => {
    const { root } = await project()
    await write(join(root, 'tools', 'docket', 'typed.ts'), 'export default {}\n')
    const typed = { ...reference, module: './tools/docket/typed.ts' }

    await expect(createDocket({ projectRoot: root, adapters: [typed] })).rejects.toThrow(
      /module ".\/tools\/docket\/typed.ts" is TypeScript, and docket does not run TypeScript itself/
    )

    const fake = (await import(FAKE_LOCAL)) as { default: AdapterDefinition }
    const typescript = vi.fn(async () => fake)
    const docket = await createDocket({ projectRoot: root, adapters: [typed], typescript })
    expect(typescript).toHaveBeenCalledWith(join(root, 'tools', 'docket', 'typed.ts'))
    expect(docket.adapters.map((slot) => slot.id)).toEqual(['jsonl', 'company-memory'])
  })

  it('must be compiled JavaScript', async () => {
    const { root } = await project()
    await expect(createDocket({ projectRoot: root, adapters: [{ ...reference, module: './tools/docket/adapter.json' }] })).rejects.toThrow(
      /must be a compiled .js or .mjs file/
    )
  })
})

describe('adapter packages', () => {
  it('resolve from the project root, through the package exports', async () => {
    const { root, nested } = await project()
    const packageDir = join(root, 'node_modules', '@acme', 'docket-adapter-memory')
    await write(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: '@acme/docket-adapter-memory',
        type: 'module',
        exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs' }, './extra/*': './dist/extra/*.mjs' }
      })
    )
    await mkdir(join(packageDir, 'dist', 'extra'), { recursive: true })
    await copyFile(FAKE_LOCAL, join(packageDir, 'dist', 'index.mjs'))
    await copyFile(FAKE_LOCAL, join(packageDir, 'dist', 'extra', 'other.mjs'))

    const docket = await createDocket({
      projectRoot: nested,
      adapters: [
        { id: 'packaged', module: '@acme/docket-adapter-memory', config: { label: 'p' } },
        { id: 'subpath', module: '@acme/docket-adapter-memory/extra/other', config: { label: 's' } }
      ]
    })
    expect(docket.adapters.map((slot) => [slot.id, slot.name])).toEqual([
      ['jsonl', 'jsonl'],
      ['packaged', 'fake-local'],
      ['subpath', 'fake-local']
    ])
  })

  it('are never taken from docket\'s own dependencies, nor installed', async () => {
    const { root } = await project()
    // docket itself depends on zod; the project does not.
    await expect(createDocket({ projectRoot: root, adapters: [{ id: 'z', module: 'zod' }] })).rejects.toThrow(
      `Adapter "z" module "zod" is not installed in ${root}. Install it in the project (e.g. \`npm install zod\`); docket never installs packages itself.`
    )
  })
})

describe('adapter definitions', () => {
  it('are checked for a supported contract major before any of their code runs', async () => {
    const { root } = await project()
    await write(
      join(root, 'tools', 'docket', 'future.mjs'),
      `export default { apiVersion: 2, name: 'future', validateConfig() { throw new Error('ran') }, async create() { throw new Error('ran') } }\n`
    )
    await expect(
      loadAdapterDefinition('./tools/docket/future.mjs', { id: 'future', projectRoot: root })
    ).rejects.toThrow('Adapter "future" module "./tools/docket/future.mjs" declares apiVersion 2; this docket supports adapter apiVersion 1')
  })

  it('report a module that fails to import, and one without a default export', async () => {
    const { root } = await project()
    await write(join(root, 'tools', 'docket', 'broken.mjs'), `throw new Error('kaboom')\n`)
    await write(join(root, 'tools', 'docket', 'named.mjs'), `export const adapter = {}\n`)
    await expect(loadAdapterDefinition('./tools/docket/broken.mjs', { id: 'b', projectRoot: root })).rejects.toThrow(
      'Adapter "b" module "./tools/docket/broken.mjs" failed to load: kaboom'
    )
    await expect(loadAdapterDefinition('./tools/docket/named.mjs', { id: 'n', projectRoot: root })).rejects.toThrow(
      /module ".\/tools\/docket\/named.mjs" does not export an adapter definition/
    )
  })

  it('reject their configuration with an instance-specific error', async () => {
    const { root } = await project()
    await expect(createDocket({ projectRoot: root, adapters: [{ ...reference, config: {} }] })).rejects.toThrow(
      'Adapter "company-memory" (fake-local) rejected its configuration: label is required'
    )
  })
})

describe('createDocket', () => {
  const fake = async (): Promise<AdapterDefinition> => ((await import(FAKE_LOCAL)) as { default: AdapterDefinition }).default

  it('serves the v1 projections with their adapter packages', async () => {
    const { root } = await project()
    await writeFile(
      join(root, '.docket.yaml'),
      'version: 1\nprojections:\n  - type: file\n    output: .docket/.index\n  - type: jsonl\n    output: .docket/.index/second\n',
      'utf8'
    )
    const docket = await createDocket({ projectRoot: root })
    expect(docket.adapters.map((slot) => [slot.id, slot.name, slot.source])).toEqual([
      ['jsonl', 'jsonl', '@docket/adapter-jsonl'],
      ['jsonl#2', 'jsonl', '@docket/adapter-jsonl']
    ])
    const adapter = await docket.adapters[0]!.create()
    expect(adapter.describe()).toMatchObject({ name: 'jsonl', inputs: ['entity'], resultKinds: ['entities'] })
    expect(await adapter.status()).toMatchObject({ state: 'ready' })
    await adapter.close()
  })

  it('takes definitions registered directly, honouring their roles', async () => {
    const { root } = await project()
    const docket = await createDocket({
      projectRoot: root,
      registrations: [{ id: 'ask-only', definition: await fake(), config: { label: 'a' }, roles: ['query'] }]
    })
    const adapter = await docket.adapters[1]!.create()
    expect(adapter.query).toBeDefined()
    expect(adapter.projection).toBeUndefined()
  })

  it('rejects duplicate and unsafe instance ids', async () => {
    const { root } = await project()
    const definition = await fake()
    await expect(
      createDocket({ projectRoot: root, registrations: [{ id: 'jsonl', definition, config: { label: 'a' } }] })
    ).rejects.toThrow('Adapter id "jsonl" is used more than once; instance ids must be unique.')
    await expect(
      createDocket({ projectRoot: root, registrations: [{ id: '../escape', definition, config: { label: 'a' } }] })
    ).rejects.toThrow(/Adapter id "..\/escape" must start with a letter or digit/)
  })

  it('validates what an adapter returns at runtime', async () => {
    const { root } = await project()
    const definition = await fake()
    const lying: AdapterDefinition = {
      ...definition,
      async create(config, services) {
        const adapter = await definition.create(config, services)
        return {
          ...adapter,
          status: async () => ({ state: 'fine' }) as never,
          query: { ask: async (request) => ({ ...(await adapter.query!.ask(request)), evidence: [{ id: 'e', kind: 'rumour' }] }) as never }
        }
      }
    }
    const docket = await createDocket({ projectRoot: root, registrations: [{ id: 'lying', definition: lying, config: { label: 'l' } }] })
    const adapter = await docket.adapters[1]!.create()
    await expect(adapter.status()).rejects.toThrow(/Adapter "lying" broke its contract - invalid adapter status/)
    const sample = sampleAskRequest()
    await expect(adapter.query!.ask({ ...sample, context: { ...sample.context, scope: 'default' } })).rejects.toThrow(
      /Adapter "lying" broke its contract - invalid adapter answer:\n {2}- evidence.0.kind/
    )
  })

  it('gives each instance its own state directory and the project canonical records', async () => {
    const { root } = await project()
    await write(join(root, '.docket', 'resources', 'services', 'orders.md'), '---\nid: service.orders\ntype: service\ntitle: Orders\n---\n\nTakes orders.\n')
    const definition = await fake()
    const seen = vi.fn()
    const docket = await createDocket({
      projectRoot: root,
      registrations: [
        {
          id: 'probe',
          definition: {
            ...definition,
            async create(config, services) {
              seen(services.stateRoot, services.scope, await services.canonical.get('entity', 'service.orders'))
              return definition.create(config, services)
            }
          },
          config: { label: 'probe' }
        }
      ]
    })
    await (await docket.adapters[1]!.create()).close()
    expect(seen).toHaveBeenCalledWith(
      join(root, '.docket', '.index', 'adapters', 'probe'),
      'default',
      expect.objectContaining({ kind: 'entity', id: 'service.orders', title: 'Orders', scope: 'default' })
    )
  })
})

describe('v1 projections', () => {
  const v1Config = (projections: string): string => `version: 1\nprojections:\n${projections}`

  it('load the neo4j and mem0 adapters without their drivers until an instance is created', async () => {
    const { root } = await project()
    await writeFile(
      join(root, '.docket.yaml'),
      v1Config('  - type: neo4j\n    passwordEnv: NEO4J_PASSWORD\n  - type: mem0\n    mode: server\n    url: http://localhost:8888\n'),
      'utf8'
    )
    const docket = await createDocket({ projectRoot: root })
    expect(docket.adapters.map((slot) => [slot.id, slot.name, slot.source])).toEqual([
      ['neo4j', 'neo4j', '@docket/adapter-neo4j'],
      ['mem0', 'mem0', '@docket/adapter-mem0']
    ])
  })

  it('reject an adapter configuration with an instance-specific error', async () => {
    const { root } = await project()
    await writeFile(join(root, '.docket.yaml'), v1Config('  - type: mem0\n    mode: server\n'), 'utf8')
    await expect(createDocket({ projectRoot: root })).rejects.toThrow(/^Adapter "mem0" \(mem0\) rejected its configuration: /)
  })

  it("prefer the project's own install of an adapter package to docket's copy", async () => {
    const { root } = await project()
    const packageDir = join(root, 'node_modules', '@docket', 'adapter-jsonl')
    await write(join(packageDir, 'package.json'), JSON.stringify({ name: '@docket/adapter-jsonl', type: 'module', exports: './index.mjs' }))
    await write(
      join(packageDir, 'index.mjs'),
      "export default { apiVersion: 1, name: 'project-jsonl', validateConfig: (config) => config, async create() { throw new Error('unused') } }\n"
    )
    const docket = await createDocket({ projectRoot: root })
    expect(docket.adapters.map((slot) => [slot.id, slot.name])).toEqual([['jsonl', 'project-jsonl']])
  })

  it('say how to get an adapter package a minimal docket was built without', async () => {
    const { root } = await project()
    await writeFile(join(root, '.docket.yaml'), v1Config('  - type: neo4j\n'), 'utf8')
    const minimal = { packages: standardDistribution.packages, find: () => undefined }
    await expect(createDocket({ projectRoot: root, distribution: minimal })).rejects.toThrow(
      `Adapter "neo4j" module "@docket/adapter-neo4j" is not installed in ${root}. ` +
        'The standard @chrisjowen/docket distribution includes it; this installation of docket was built without it. ' +
        'Install it in the project (e.g. `npm install @docket/adapter-neo4j`); docket never installs packages itself.'
    )
  })

  it('keep the manifest fingerprint they had before moving into adapter packages', async () => {
    const { root } = await project()
    // Recorded with docket 0.3.1, whose core parsed every projection itself:
    // the same configuration must not force a rebuild after upgrading.
    expect((await createDocket({ projectRoot: root })).projectionsFingerprint).toBe(
      'sha256:5d74288ec45676e8b952515b25e67fdd81f0277c48ab79f297b261d60a32cf68'
    )
    await writeFile(
      join(root, '.docket.yaml'),
      v1Config(
        [
          '  - type: file',
          '  - type: neo4j',
          '    passwordEnv: NEO4J_PASSWORD',
          '    cypher: { model: "qwen2.5:7b" }',
          '  - type: mem0',
          '    mode: platform',
          '  - type: mem0',
          '    mode: server',
          '    url: http://localhost:8888',
          '    minScore: 0.3',
          '    scope: { agentId: docket }',
          '  - type: mem0',
          '    mode: oss',
          '    config: { vectorStore: { provider: qdrant } }',
          ''
        ].join('\n')
      ),
      'utf8'
    )
    expect((await createDocket({ projectRoot: root })).projectionsFingerprint).toBe(
      'sha256:95b63ed86b9899d353e6acb5c79eabc2d31302a9464006795b1aaa303f0e7ac7'
    )
  })

  it('leave the manifest fingerprint unchanged when a projection names a runtime', async () => {
    const { root } = await project()
    const projection = '  - type: mem0\n    mode: server\n    url: http://localhost:8888\n'
    await writeFile(join(root, '.docket.yaml'), v1Config(projection), 'utf8')
    const before = (await createDocket({ projectRoot: root })).projectionsFingerprint

    await writeFile(
      join(root, '.docket.yaml'),
      v1Config(`${projection}    runtime: local\n`) +
        'runtimes:\n  local:\n    provider: docker-compose\n    composeFile: compose.yaml\n    projectName: docket-local\n',
      'utf8'
    )
    const docket = await createDocket({ projectRoot: root })
    expect(docket.resolved.config.projections[0]?.runtime).toBe('local')
    expect(docket.projectionsFingerprint).toBe(before)
  })
})
