import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { openDocket } from '../adapters/docket.js'
import type { AdapterDistribution } from '../adapters/resolve-module.js'
import { loadConfig } from '../config/loader.js'
import type { Choice, Prompter } from '../install/answers.js'
import type { CommandInvocation, CommandRunner } from '../runtime/runner.js'
import { adapterAdd, adaptersList, type AdapterAddOptions } from './adapter.js'
import { init } from './init.js'

let root: string
let calls: CommandInvocation[]

const runner: CommandRunner = async (invocation) => {
  calls.push(invocation)
  return { exitCode: 0, stdout: '', stderr: '' }
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'docket-adapter-add-')))
  calls = []
  await init({ cwd: root })
})

const configText = (): Promise<string> => readFile(join(root, '.docket.yaml'), 'utf8')

/** Applied without a terminal, as a script would: the given options, the defaults, and --yes. */
const add = (provider: string, values: Record<string, string> = {}, options: AdapterAddOptions = {}) =>
  adapterAdd(provider, { cwd: root, interactive: false, yes: true, runner, values, ...options })

/** The configured instance `id`, as `.docket.yaml` now loads. */
const instance = async (id: string) => {
  const resolved = await loadConfig(root)
  return { resolved, entry: resolved.config.adapters.find((adapter) => adapter.id === id) }
}

/** Every file under the project, read: what a secret must never appear in. */
const everything = async (dir = root): Promise<string> => {
  let text = ''
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    text += entry.isDirectory() ? await everything(path) : await readFile(path, 'utf8')
  }
  return text
}

/** Installs a package under `dir`'s node_modules: the project's own copy of it. */
const installPackage = async (dir: string, name: string): Promise<string> => {
  const packageDir = join(dir, 'node_modules', name)
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name, type: 'module', exports: { '.': './index.js' } }))
  await writeFile(join(packageDir, 'index.js'), 'export default {}\n')
  return packageDir
}

/** The project's own copy of the provider adapters with drivers, so the driver is looked up from the project. */
const ownAdapters = async (): Promise<void> => {
  await installPackage(root, '@docket/adapter-neo4j')
  await installPackage(root, '@docket/adapter-mem0')
}

/** Answers questions from a script, by a fragment of each question's text, and records what was asked. */
const scripted = (script: [fragment: string, answer: string | boolean][]): Prompter & { asked: string[] } => {
  const asked: string[] = []
  const next = (question: string): string | boolean => {
    asked.push(question)
    const at = script.findIndex(([fragment]) => question.includes(fragment))
    if (at < 0) throw new Error(`Unexpected question: ${question}`)
    return script.splice(at, 1)[0]![1]
  }
  return {
    asked,
    text: async (question, fallback) => {
      const answer = next(question) as string
      return answer === '' ? (fallback ?? '') : answer
    },
    choose: async (question: string, _choices: readonly Choice[], fallback: string) => {
      const answer = next(question) as string
      return answer === '' ? fallback : answer
    },
    confirm: async (question) => next(question) as boolean,
    note: () => {}
  }
}

describe('docket adapter add jsonl', () => {
  it('adds an instance the docket loads, and creates nothing else', async () => {
    const result = await add('jsonl')
    expect(result.status).toBe('applied')
    const { resolved, entry } = await instance('local-2')
    expect(entry).toEqual({
      id: 'local-2',
      module: '@docket/adapter-jsonl',
      roles: ['projection', 'query'],
      config: { output: '.docket/.index/local-2' }
    })
    const docket = await openDocket(resolved)
    expect(docket.adapters.map((slot) => slot.id)).toEqual(['local', 'local-2'])
    expect(result.status === 'applied' && result.created).toEqual([])
    expect(result.plan.driver).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('keeps every existing entry and comment', async () => {
    const before = await configText()
    await add('jsonl', { '--id': 'mirror', '--roles': 'query' })
    const after = await configText()
    for (const line of before.split('\n').filter((line) => line.trim().startsWith('#'))) {
      expect(after).toContain(line.trim())
    }
    expect(after).toContain('- id: mirror')
    expect(after).toContain('roles: [query]')
  })

  it('writes out the default local adapter before adding to a file that had none listed', async () => {
    await writeFile(join(root, '.docket.yaml'), 'version: 2\n')
    await add('jsonl', { '--id': 'second' })
    const { resolved } = await instance('second')
    expect(resolved.config.adapters.map((adapter) => adapter.id)).toEqual(['local', 'second'])
  })
})

describe('docket adapter add neo4j', () => {
  it('connects to an existing endpoint with no runtime, naming only the password variable', async () => {
    const result = await add('neo4j', {
      '--url': 'neo4j+s://graph.example.com',
      '--username': 'docket',
      '--password-env': 'GRAPH_PASSWORD',
      '--database': 'memory',
      '--scope': 'payments'
    })
    const { resolved, entry } = await instance('graph')
    expect(entry).toEqual({
      id: 'graph',
      module: '@docket/adapter-neo4j',
      roles: ['projection', 'query'],
      config: {
        uri: 'neo4j+s://graph.example.com',
        username: 'docket',
        passwordEnv: 'GRAPH_PASSWORD',
        database: 'memory',
        scope: 'payments'
      }
    })
    expect(resolved.config.runtimes).toEqual({})
    expect(result.plan.files).toEqual([])
    expect(result.plan.env).toEqual([expect.objectContaining({ name: 'GRAPH_PASSWORD', secret: true })])
    // The adapter itself accepts what was written.
    await expect(openDocket(resolved)).resolves.toBeDefined()
  })

  it('requires the endpoint without a terminal, and says how to choose a local container instead', async () => {
    await expect(add('neo4j')).rejects.toThrow(/--url is required: .*--mode local/)
  })

  it('writes a user-owned Compose template from the image given, and a runtime group the adapter references', async () => {
    const result = await add('neo4j', { '--mode': 'local', '--image': 'registry.internal/neo4j:5.26@sha256:abc', '--port': '27687' })
    const { resolved, entry } = await instance('graph')
    expect(entry).toMatchObject({
      runtime: 'graph-dev',
      config: { uri: 'bolt://127.0.0.1:27687', username: 'neo4j', passwordEnv: 'DOCKET_NEO4J_PASSWORD' }
    })
    expect(resolved.config.runtimes['graph-dev']).toEqual({
      provider: 'docker-compose',
      composeFile: './infra/docket-graph-dev.compose.yaml',
      projectName: expect.stringMatching(/^docket-.*-graph-dev$/),
      pullPolicy: 'never',
      services: ['neo4j']
    })
    expect(result.status === 'applied' && result.created).toEqual(['./infra/docket-graph-dev.compose.yaml'])

    const compose = parse(await readFile(join(root, 'infra', 'docket-graph-dev.compose.yaml'), 'utf8'))
    expect(compose).toEqual({
      services: {
        neo4j: {
          image: 'registry.internal/neo4j:5.26@sha256:abc',
          ports: ['127.0.0.1:27687:7687'],
          environment: {
            NEO4J_AUTH: 'neo4j/${DOCKET_NEO4J_PASSWORD:?Set DOCKET_NEO4J_PASSWORD to the local Neo4j password}'
          },
          volumes: ['graph-data:/data']
        }
      },
      volumes: { 'graph-data': {} }
    })
    await expect(openDocket(resolved)).resolves.toBeDefined()
  })

  it('never picks an image: without one the template requires the image variable', async () => {
    const result = await add('neo4j', { '--mode': 'local', '--image-env': 'APPROVED_GRAPH_IMAGE' })
    const compose = parse(await readFile(join(root, 'infra', 'docket-graph-dev.compose.yaml'), 'utf8'))
    expect(compose.services.neo4j.image).toBe('${APPROVED_GRAPH_IMAGE:?Set APPROVED_GRAPH_IMAGE to the approved Neo4j image reference}')
    expect(result.plan.env.map((variable) => variable.name)).toEqual(['APPROVED_GRAPH_IMAGE', 'DOCKET_NEO4J_PASSWORD'])
  })

  it('never pulls or starts anything, and says what to run instead', async () => {
    const result = await add('neo4j', { '--mode': 'local', '--image': 'neo4j:5' })
    expect(calls).toEqual([])
    expect(result.plan.next).toEqual(
      expect.arrayContaining(['docket runtime plan graph-dev', 'docket runtime up graph-dev', 'docket runtime status graph-dev', 'docket sync'])
    )
  })

  it('runs docket runtime plan - and only that - when asked', async () => {
    const result = await add('neo4j', { '--mode': 'local', '--image': 'neo4j:5' }, { planRuntime: true })
    expect(calls.map((call) => call.args.slice(0, 1).concat(call.args.slice(5, 6)))).toEqual([['compose', 'config']])
    expect(result.status === 'applied' && result.runtimePlan?.ok).toBe(true)
  })

  it('refuses options that do not apply to what was chosen', async () => {
    await expect(add('neo4j', { '--mode': 'local', '--url': 'bolt://elsewhere:7687' })).rejects.toThrow(
      /--url does not apply to a neo4j adapter set up this way/
    )
    expect(existsSync(join(root, 'infra'))).toBe(false)
  })
})

describe('docket adapter add mem0', () => {
  it('sets up hosted mem0 with the API key variable', async () => {
    const result = await add('mem0', { '--scope': 'payments-agent' })
    const { resolved, entry } = await instance('memories')
    expect(entry).toEqual({
      id: 'memories',
      module: '@docket/adapter-mem0',
      roles: ['projection', 'query'],
      config: { mode: 'platform', apiKeyEnv: 'MEM0_API_KEY', scope: { agentId: 'payments-agent' } }
    })
    expect(result.plan.driver).toMatchObject({ name: 'mem0ai', spec: expect.stringMatching(/^mem0ai@/) })
    expect(result.plan.next).toContain('export MEM0_API_KEY=...   # your mem0 platform API key')
    await expect(openDocket(resolved)).resolves.toBeDefined()
  })

  it('connects to a self-hosted server by URL', async () => {
    await add('mem0', { '--mode': 'server', '--url': 'http://localhost:8888', '--api-key-env': 'TEAM_MEM0_KEY' })
    const { resolved, entry } = await instance('memories')
    expect(entry?.config).toEqual({ mode: 'server', url: 'http://localhost:8888', apiKeyEnv: 'TEAM_MEM0_KEY' })
    await expect(openDocket(resolved)).resolves.toBeDefined()
  })
})

describe('never overwriting', () => {
  it('keeps an existing Compose file byte for byte, and says so', async () => {
    const mine = '# my own compose file\nservices:\n  neo4j:\n    image: corp/neo4j:pinned\n'
    await mkdir(join(root, 'infra'))
    await writeFile(join(root, 'infra', 'docket-graph-dev.compose.yaml'), mine)
    const result = await add('neo4j', { '--mode': 'local', '--image': 'neo4j:5' })
    expect(await readFile(join(root, 'infra', 'docket-graph-dev.compose.yaml'), 'utf8')).toBe(mine)
    expect(result.status === 'applied' && result.kept).toEqual(['./infra/docket-graph-dev.compose.yaml'])
    expect(result.plan.notes.join('\n')).toMatch(/already exists and is kept as it is/)
  })

  it('refuses an id or runtime id that is already configured', async () => {
    await add('jsonl', { '--id': 'mirror' })
    await expect(add('jsonl', { '--id': 'mirror' })).rejects.toThrow(/adapter "mirror" is already in \.docket\.yaml/)
    await add('neo4j', { '--mode': 'local', '--image': 'neo4j:5' })
    await expect(add('neo4j', { '--id': 'graph2', '--mode': 'local', '--runtime-id': 'graph-dev' })).rejects.toThrow(
      /runtime "graph-dev" is already defined/
    )
  })

  it('without a terminal, defaults to a runtime id that is not taken', async () => {
    await add('neo4j', { '--id': 'old-graph', '--mode': 'local', '--image': 'neo4j:5', '--runtime-id': 'graph-dev' })
    const result = await add('neo4j', { '--mode': 'local', '--image': 'neo4j:5' })
    expect(result.plan.addition.runtime?.id).toBe('graph-dev-2')
    expect((await instance('graph')).entry?.runtime).toBe('graph-dev-2')
  })

  it('without a terminal, checks a default the way it checks a given answer', async () => {
    const before = await configText()
    await expect(add('neo4j', { '--id': 'graph#1', '--mode': 'local', '--image': 'neo4j:5' })).rejects.toThrow(
      /--runtime-id is required: its default "graph#1-dev" will not do/
    )
    expect(await configText()).toBe(before)
  })

  it('changes nothing on a dry run', async () => {
    const before = await configText()
    const result = await add('neo4j', { '--mode': 'local', '--image': 'neo4j:5' }, { dryRun: true, yes: false })
    expect(result.status).toBe('preview')
    expect(result.plan.files[0]).toMatchObject({ exists: false, contents: expect.stringContaining('image: neo4j:5') })
    expect(await configText()).toBe(before)
    expect(existsSync(join(root, 'infra'))).toBe(false)
  })

  it('changes nothing without --yes or a terminal to confirm on', async () => {
    const before = await configText()
    await expect(add('mem0', {}, { yes: false })).rejects.toThrow(/without confirmation\. Pass --yes/)
    expect(await configText()).toBe(before)
  })
})

describe('secrets', () => {
  const SECRETS = { MEM0_API_KEY: 'm0-secret-value-1', DOCKET_NEO4J_PASSWORD: 'neo4j-secret-value-2', GRAPH_PASSWORD: 'graph-secret-3' }
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const [name, value] of Object.entries(SECRETS)) {
      saved[name] = process.env[name]
      process.env[name] = value
    }
  })
  afterEach(() => {
    for (const name of Object.keys(SECRETS)) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
  })

  it('writes only the names of secret variables, never their values, anywhere', async () => {
    const results = [
      await add('mem0'),
      await add('neo4j', { '--mode': 'local', '--image': 'neo4j:5' }),
      await add('neo4j', { '--id': 'remote', '--url': 'bolt://graph:7687', '--password-env': 'GRAPH_PASSWORD' })
    ]
    const written = await everything()
    const shown = JSON.stringify(results)
    for (const value of Object.values(SECRETS)) {
      expect(written).not.toContain(value)
      expect(shown).not.toContain(value)
    }
    expect(written).toContain('DOCKET_NEO4J_PASSWORD')
  })

  it('refuses a value where a variable name belongs', async () => {
    await expect(add('mem0', { '--api-key-env': 'm0-abc123!' })).rejects.toThrow(/name of an environment variable.*never its value/)
    await expect(add('neo4j', { '--url': 'bolt://neo4j:hunter2@graph:7687' })).rejects.toThrow(/leave credentials out of the URL/)
    expect(await everything()).not.toContain('hunter2')
  })
})

describe('the driver package', () => {
  beforeEach(async () => {
    await writeFile(join(root, 'package.json'), '{"name":"project","private":true}\n')
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    await ownAdapters()
  })

  it('is installed with the project\'s package manager only with consent', async () => {
    const result = await add('neo4j', { '--url': 'bolt://graph:7687' }, { install: true })
    expect(calls).toEqual([
      { command: 'pnpm', args: ['add', '--save-dev', expect.stringMatching(/^neo4j-driver@/)], cwd: root, stream: true }
    ])
    expect(result.status === 'applied' && result.install).toEqual({ ok: true, value: expect.stringContaining('pnpm add') })
  })

  it('is not installed without consent; the plan says how', async () => {
    const result = await add('mem0')
    expect(calls).toEqual([])
    expect(result.plan.next[0]).toMatch(/^pnpm add --save-dev 'mem0ai@/)
  })

  it('is not offered when the project already has it', async () => {
    await mkdir(join(root, 'node_modules', 'mem0ai'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'mem0ai', 'package.json'), '{"name":"mem0ai","version":"3.3.1"}')
    const result = await add('mem0', {}, { install: true })
    expect(result.plan.driver?.installed).toBe(true)
    expect(calls).toEqual([])
  })

  it('is looked for where the adapter loads from, as adapters list does', async () => {
    await installPackage(join(root, 'node_modules', '@docket', 'adapter-mem0'), 'mem0ai')
    const result = await add('mem0', {}, { install: true })
    expect(result.plan.driver?.installed).toBe(true)
    expect(calls).toEqual([])
    expect((await adaptersList({ cwd: root })).adapters.find((adapter) => adapter.id === 'memories')?.problem).toBeUndefined()
  })

  it('uses npm when the project has no other lockfile', async () => {
    await rm(join(root, 'pnpm-lock.yaml'))
    const result = await add('mem0', {}, { dryRun: true, yes: false })
    expect(result.plan.driver?.command?.slice(0, 3)).toEqual(['npm', 'install', '--save-dev'])
  })
})

describe('interactively', () => {
  it('asks what it needs, shows the plan, and applies it once confirmed', async () => {
    const prompter = scripted([
      ['instance id', ''],
      ['What should it do', 'query'],
      ['Where does the Neo4j server run', 'external'],
      ['Scope', ''],
      ['Database', ''],
      ['Connection URI', 'not a url'],
      ['Connection URI', 'neo4j+s://graph.example.com'],
      ['Username', ''],
      ['password', 'NEO4J_PASSWORD'],
      ['Apply this plan', true],
      ['Check the connection', false]
    ])
    let shown = false
    const result = await adapterAdd('neo4j', {
      cwd: root,
      interactive: true,
      prompter,
      runner,
      show: () => {
        shown = true
      }
    })
    expect(shown).toBe(true)
    expect(result.status).toBe('applied')
    const { entry } = await instance('graph')
    expect(entry).toMatchObject({ roles: ['query'], config: { uri: 'neo4j+s://graph.example.com', username: 'neo4j' } })
    expect(prompter.asked.filter((question) => question.includes('Connection URI'))).toHaveLength(2)
  })

  it('changes nothing when the plan is declined', async () => {
    const before = await configText()
    const prompter = scripted([
      ['instance id', ''],
      ['What should it do', ''],
      ['Which mem0', ''],
      ['API key', ''],
      ['Agent id', ''],
      ['Apply this plan', false]
    ])
    const result = await adapterAdd('mem0', { cwd: root, interactive: true, prompter, runner })
    expect(result.status).toBe('declined')
    expect(await configText()).toBe(before)
  })

  it('asks before installing the driver, and installs nothing when told no', async () => {
    await writeFile(join(root, 'package.json'), '{"name":"project","private":true}\n')
    await ownAdapters()
    const prompter = scripted([
      ['instance id', ''],
      ['What should it do', ''],
      ['Which mem0', ''],
      ['API key', ''],
      ['Agent id', ''],
      ['Apply this plan', true],
      ['Install mem0ai', false],
      ['Check the connection', false]
    ])
    await adapterAdd('mem0', { cwd: root, interactive: true, prompter, runner })
    expect(calls).toEqual([])
  })
})

describe('a version 1 .docket.yaml', () => {
  const V1 = 'version: 1\nprojections:\n  - type: jsonl\n    output: .docket/.index\n'

  beforeEach(async () => {
    await writeFile(join(root, '.docket.yaml'), V1)
  })

  it('is never migrated silently: without a terminal, adding explains how to migrate', async () => {
    await expect(add('mem0')).rejects.toThrow(/version 1.*docket config migrate/s)
    expect(await configText()).toBe(V1)
  })

  it('is migrated first when the developer agrees, keeping the original', async () => {
    const prompter = scripted([
      ['Migrate', true],
      ['instance id', ''],
      ['What should it do', ''],
      ['Directory', ''],
      ['Apply this plan', true],
      ['Check the connection', false]
    ])
    await adapterAdd('jsonl', { cwd: root, interactive: true, prompter, runner })
    expect(await readFile(join(root, '.docket.yaml.v1.bak'), 'utf8')).toBe(V1)
    const { resolved } = await instance('local')
    expect(resolved.config.adapters.map((adapter) => adapter.id)).toEqual(['jsonl', 'local'])
  })
})

/** docket's workspace copies of the adapter packages it does not bundle, as a project would install them. */
const workspacePackages: AdapterDistribution = {
  packages: ['@docket/adapter-memvid', '@docket/adapter-mempalace'],
  find: (name) => fileURLToPath(new URL(`../../../${name.replace('@docket/', '')}`, import.meta.url))
}

describe('docket adapter add memvid', () => {
  it('adds an embedded instance the adapter accepts, and says what the project must install itself', async () => {
    const result = await add('memvid', { '--namespace': 'payments' })
    const { resolved, entry } = await instance('memvid')
    expect(entry).toEqual({
      id: 'memvid',
      module: '@docket/adapter-memvid',
      roles: ['projection', 'query'],
      config: { namespace: 'payments' }
    })
    expect(resolved.config.runtimes).toEqual({})
    expect(result.plan.module).toEqual({ name: '@docket/adapter-memvid', installed: false })
    expect(result.plan.driver).toBeUndefined()
    expect(result.plan.next[0]).toMatch(/^Add @docket\/adapter-memvid to the project: it is not published/)
    expect(result.plan.next).toContain(result.plan.prerequisites[0])
    expect(result.plan.prerequisites[0]).toMatch(/^npm install -g memvid-cli@2\.0\.160/)
    expect(calls).toEqual([])
    await expect(openDocket(resolved, { distribution: workspacePackages })).resolves.toBeDefined()
  })

  it('refuses a file that is not a .mv2, and a namespace that is not one segment', async () => {
    await expect(add('memvid', { '--file': 'memory.db' })).rejects.toThrow(/a \.mv2 file/)
    await expect(add('memvid', { '--namespace': 'a/b' })).rejects.toThrow(/one URI segment/)
  })
})

describe('docket adapter add mempalace', () => {
  it('adds an instance the adapter accepts, keeping only what differs from its defaults', async () => {
    const result = await add('mempalace', { '--wing': 'payments wing', '--embedding-model': 'embeddinggemma', '--palace': 'palace' })
    const { resolved, entry } = await instance('palace')
    expect(entry?.config).toEqual({ palace: 'palace', wing: 'payments wing', embeddingModel: 'embeddinggemma' })
    expect(result.plan.prerequisites[0]).toMatch(/^pip install mempalace==3\.10\.0/)
    expect(result.plan.module?.installed).toBe(false)
    await expect(openDocket(resolved, { distribution: workspacePackages })).resolves.toBeDefined()
  })

  it('offers to fetch nothing, and says how to download the default model', async () => {
    const result = await add('mempalace')
    expect((await instance('palace')).entry?.config).toEqual({})
    expect(result.plan.prerequisites[1]).toContain('ONNXMiniLM_L6_V2')
    expect(calls).toEqual([])
  })

  it('refuses a wing MemPalace would', async () => {
    await expect(add('mempalace', { '--wing': '../escape' })).rejects.toThrow(/starting and ending with a letter or digit/)
  })
})

describe('docket adapter add, other providers', () => {
  it('lists what it can set up when given one it cannot', async () => {
    await expect(add('nonesuch')).rejects.toThrow(/No provider "nonesuch"\. .* jsonl, neo4j, mem0, memvid, mempalace/)
  })
})

describe('docket adapters list', () => {
  it('lists each instance with where its module loads from, and the providers', async () => {
    await add('neo4j', { '--mode': 'local', '--image': 'neo4j:5' })
    await add('memvid')
    await writeFile(join(root, 'custom.mjs'), 'export default {}\n')
    const text = await configText()
    await writeFile(
      join(root, '.docket.yaml'),
      text.replace(
        'adapters:\n',
        'adapters:\n  - id: custom\n    module: ./custom.mjs\n  - id: missing\n    module: "@acme/not-installed"\n'
      )
    )
    const result = await adaptersList({ cwd: root })
    expect(result.adapters.map(({ id, source, runtime }) => ({ id, source, runtime }))).toEqual([
      { id: 'custom', source: 'project file', runtime: undefined },
      { id: 'missing', source: undefined, runtime: undefined },
      { id: 'local', source: expect.any(String), runtime: undefined },
      { id: 'graph', source: expect.any(String), runtime: 'graph-dev' },
      { id: 'memvid', source: undefined, runtime: undefined }
    ])
    expect(result.adapters.find((adapter) => adapter.id === 'missing')?.problem).toMatch(/is not installed/)
    expect(result.adapters.find((adapter) => adapter.id === 'memvid')?.problem).toMatch(/not published to npm/)
    expect(result.providers.map((provider) => provider.name)).toEqual(['jsonl', 'neo4j', 'mem0', 'memvid', 'mempalace'])
  })
})
