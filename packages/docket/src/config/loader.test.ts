import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_YAML } from './defaults.js'
import { defaultConfig, findConfigFile, loadConfig } from './loader.js'

describe('loadConfig', () => {
  it('finds the config from a nested subdirectory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memory-loader-'))
    await writeFile(join(root, '.docket.yaml'), DEFAULT_CONFIG_YAML)
    const nested = join(root, '.docket', 'resources', 'services')
    await mkdir(nested, { recursive: true })

    expect(findConfigFile(nested)).toBe(join(root, '.docket.yaml'))

    const resolved = await loadConfig(nested)
    expect(resolved.projectRoot).toBe(root)
    expect(resolved.memoryRoot).toBe(join(root, '.docket'))
    expect(resolved.config.watch.debounceMs).toBe(300)
  })

  it('errors clearly when no config exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memory-loader-'))
    await expect(loadConfig(root)).rejects.toThrow(/No \.docket\.yaml found/)
  })

  it('errors on an invalid config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memory-loader-'))
    await writeFile(join(root, '.docket.yaml'), 'version: 3\n')
    await expect(loadConfig(root)).rejects.toThrow(/version must be 1 or 2/)
  })

  it('defaults a fresh project without touching disk', () => {
    const resolved = defaultConfig('/tmp/nowhere')
    expect(resolved.ontologyPath).toBe('/tmp/nowhere/.docket/entities.yaml')
    expect(resolved.config.adapters).toEqual([
      { id: 'local', module: '@docket/adapter-jsonl', roles: ['projection', 'query'], config: { output: '.docket/.index' } }
    ])
  })

  const loadYaml = async (yaml: string) => {
    const root = await mkdtemp(join(tmpdir(), 'memory-loader-'))
    await writeFile(join(root, '.docket.yaml'), `version: 1\n${yaml}`)
    return loadConfig(root)
  }

  it('still accepts the old `file` projection name as jsonl', async () => {
    const resolved = await loadYaml('projections:\n  - type: file\n    output: .docket/.out\n')
    expect(resolved.config.adapters).toEqual([
      { id: 'jsonl', module: '@docket/adapter-jsonl', roles: ['projection', 'query'], config: { output: '.docket/.out' } }
    ])
  })

  it("passes a projection's settings through untouched, for its adapter to validate", async () => {
    const resolved = await loadYaml(
      'projections:\n  - type: mem0\n    mode: oss\n    config:\n      vectorStore:\n        provider: qdrant\n        config: { host: localhost, port: 6333 }\n'
    )
    expect(resolved.config.adapters).toEqual([
      {
        id: 'mem0',
        module: '@docket/adapter-mem0',
        roles: ['projection', 'query'],
        config: { mode: 'oss', config: { vectorStore: { provider: 'qdrant', config: { host: 'localhost', port: 6333 } } } }
      }
    ])
  })

  it('rejects a projection type no adapter serves', async () => {
    await expect(loadYaml('projections:\n  - type: kuzu\n')).rejects.toThrow(/Invalid/)
  })

  it('keeps the manifest in state.dir, apart from any projection', () => {
    expect(defaultConfig('/tmp/nowhere').config.state).toEqual({ dir: '.docket/.index' })
  })
})

describe('runtimes in .docket.yaml', () => {
  const loadYaml = async (yaml: string) => {
    const root = await mkdtemp(join(tmpdir(), 'memory-loader-'))
    await writeFile(join(root, '.docket.yaml'), `version: 1\n${yaml}`)
    return loadConfig(root)
  }

  const GRAPH_DEV = `runtimes:
  graph-dev:
    provider: docker-compose
    composeFile: ./infra/docket-memory.compose.yaml
    projectName: docket-payments
    pullPolicy: missing
    services: [graph]
`

  it('has none unless configured: connecting to a service is the default', () => {
    expect(defaultConfig('/tmp/nowhere').config.runtimes).toEqual({})
  })

  it('reads a docker-compose runtime group and an adapter\'s reference to it', async () => {
    const resolved = await loadYaml(
      `projections:\n  - type: neo4j\n    url: bolt://127.0.0.1:17687\n    runtime: graph-dev\n${GRAPH_DEV}`
    )
    expect(resolved.config.runtimes).toEqual({
      'graph-dev': {
        provider: 'docker-compose',
        composeFile: './infra/docket-memory.compose.yaml',
        projectName: 'docket-payments',
        pullPolicy: 'missing',
        services: ['graph']
      }
    })
    expect(resolved.config.adapters).toEqual([
      {
        id: 'neo4j',
        module: '@docket/adapter-neo4j',
        roles: ['projection', 'query'],
        runtime: 'graph-dev',
        config: { url: 'bolt://127.0.0.1:17687' }
      }
    ])
  })

  it('never pulls unless the pull policy says so', async () => {
    const resolved = await loadYaml(
      'runtimes:\n  graph-dev:\n    provider: docker-compose\n    composeFile: compose.yaml\n    projectName: docket\n'
    )
    expect(resolved.config.runtimes['graph-dev']?.pullPolicy).toBe('never')
  })

  it('rejects a reference to a runtime that is not defined', async () => {
    await expect(loadYaml('projections:\n  - type: jsonl\n    runtime: graph-dev\n')).rejects.toThrow(
      /runtime "graph-dev" is not defined under runtimes/
    )
  })

  it('does not take an inherited object property for a runtime', async () => {
    await expect(loadYaml('projections:\n  - type: jsonl\n    runtime: toString\n')).rejects.toThrow(
      /runtime "toString" is not defined under runtimes/
    )
  })

  it.each([
    ['an unknown pull policy', GRAPH_DEV.replace('pullPolicy: missing', 'pullPolicy: sometimes')],
    ['a misspelt field', GRAPH_DEV.replace('pullPolicy:', 'pullpolicy:')],
    ['an unknown provider', GRAPH_DEV.replace('provider: docker-compose', 'provider: podman')],
    ['a project name Compose refuses', GRAPH_DEV.replace('projectName: docket-payments', 'projectName: Docket Payments')],
    ['no services', GRAPH_DEV.replace('services: [graph]', 'services: []')]
  ])('rejects %s', async (_what, yaml) => {
    await expect(loadYaml(yaml)).rejects.toThrow(/Invalid/)
  })
})

describe('version 2 .docket.yaml', () => {
  const loadYaml = async (yaml: string) => {
    const root = await mkdtemp(join(tmpdir(), 'memory-loader-'))
    await writeFile(join(root, '.docket.yaml'), `version: 2\n${yaml}`)
    return loadConfig(root)
  }

  /** docs/adapter-spec.md §5, with §6's runtime group. */
  const SPEC_EXAMPLE = `source:
  root: .docket
  exclude: [".index/**", ".cache/**", "adapters/**"]

adapters:
  - id: local
    module: "@docket/adapter-jsonl"
    roles: [projection, query]
    config:
      output: .docket/.index/local

  - id: enterprise-graph
    module: "@docket/adapter-neo4j"
    roles: [projection, query]
    config:
      uri: "neo4j+s://graph.internal.example"
      database: project-memory
      username: docket
      passwordEnv: DOCKET_GRAPH_PASSWORD
      scope: payments-project

  - id: company-memory
    module: "./tools/docket/company-memory.mjs"
    roles: [projection, query]
    config:
      endpoint: "https://memory.internal.example"
      tokenEnv: COMPANY_MEMORY_TOKEN

  - id: dev-graph
    module: "@docket/adapter-neo4j"
    runtime: graph-dev
    config:
      uri: "bolt://127.0.0.1:17687"
      username: neo4j
      passwordEnv: DOCKET_GRAPH_PASSWORD

query:
  defaultAdapters: [local, enterprise-graph, company-memory]
  timeoutMs: 30000
  maxConcurrentAdapters: 3
  synthesis: true

runtimes:
  graph-dev:
    provider: docker-compose
    composeFile: ./infra/docket-memory.compose.yaml
    projectName: docket-payments
    pullPolicy: never
    services: [graph]
`

  it('reads the specification\'s example: instances, their configs untouched, the query section and runtimes', async () => {
    const { config } = await loadYaml(SPEC_EXAMPLE)
    expect(config.version).toBe(2)
    expect(config.source.exclude).toEqual(['.index/**', '.cache/**', 'adapters/**'])
    expect(config.adapters.map(({ id, module, roles, runtime }) => [id, module, roles, runtime])).toEqual([
      ['local', '@docket/adapter-jsonl', ['projection', 'query'], undefined],
      ['enterprise-graph', '@docket/adapter-neo4j', ['projection', 'query'], undefined],
      ['company-memory', './tools/docket/company-memory.mjs', ['projection', 'query'], undefined],
      ['dev-graph', '@docket/adapter-neo4j', ['projection', 'query'], 'graph-dev']
    ])
    // Core does not read an adapter's config: unfamiliar fields reach the adapter as written.
    expect(config.adapters[2]?.config).toEqual({ endpoint: 'https://memory.internal.example', tokenEnv: 'COMPANY_MEMORY_TOKEN' })
    expect(config.query).toEqual({
      defaultAdapters: ['local', 'enterprise-graph', 'company-memory'],
      timeoutMs: 30000,
      maxConcurrentAdapters: 3,
      synthesis: true
    })
    expect(Object.keys(config.runtimes)).toEqual(['graph-dev'])
  })

  it('defaults the query section and an instance\'s roles and config', async () => {
    const { config } = await loadYaml('adapters:\n  - id: a\n    module: "@docket/adapter-jsonl"\n')
    expect(config.adapters).toEqual([{ id: 'a', module: '@docket/adapter-jsonl', roles: ['projection', 'query'], config: {} }])
    expect(config.query).toEqual({ timeoutMs: 30000, maxConcurrentAdapters: 4, synthesis: true })
  })

  it('keeps the roles an instance lists, including none', async () => {
    const { config } = await loadYaml(
      'adapters:\n  - id: a\n    module: m\n    roles: [query]\n  - id: b\n    module: m\n    roles: []\n'
    )
    expect(config.adapters.map((adapter) => adapter.roles)).toEqual([['query'], []])
  })

  it.each([
    ['a repeated instance id', 'adapters:\n  - id: a\n    module: m\n  - id: a\n    module: n\n', 'adapter "a": adapter id "a" is used more than once'],
    ['an unfamiliar envelope field', 'adapters:\n  - id: graph\n    module: m\n    modul: n\n', 'adapter "graph": Unrecognized key: "modul"'],
    ['a missing module', 'adapters:\n  - id: graph\n', 'adapter "graph": Invalid input'],
    ['an unknown role', 'adapters:\n  - id: graph\n    module: m\n    roles: [projection, ingest]\n', 'adapter "graph": Invalid option'],
    ['a repeated role', 'adapters:\n  - id: graph\n    module: m\n    roles: [query, query]\n', 'adapter "graph": a role is listed more than once'],
    ['an unsafe id', 'adapters:\n  - id: ../escape\n    module: m\n', 'an adapter id starts with a letter or digit'],
    ['an undefined runtime', 'adapters:\n  - id: graph\n    module: m\n    runtime: graph-dev\n', 'adapter "graph": runtime "graph-dev" is not defined under runtimes'],
    ['a default adapter that is not configured', 'query:\n  defaultAdapters: [nowhere]\n', 'adapter "nowhere" is not defined under adapters'],
    [
      'a default adapter without the query role',
      'adapters:\n  - id: graph\n    module: m\n    roles: [projection]\nquery:\n  defaultAdapters: [graph]\n',
      'adapter "graph" does not have the query role'
    ],
    ['an unfamiliar query field', 'query:\n  timeout: 5\n', 'Unrecognized key: "timeout"'],
    ['projections, which version 2 replaced', 'projections:\n  - type: jsonl\n', 'Unrecognized key: "projections"']
  ])('rejects %s', async (_what, yaml, message) => {
    await expect(loadYaml(yaml)).rejects.toThrow(message)
  })
})

describe('version 1 .docket.yaml as version 2', () => {
  const load = async (yaml: string) => {
    const root = await mkdtemp(join(tmpdir(), 'memory-loader-'))
    await writeFile(join(root, '.docket.yaml'), yaml)
    return (await loadConfig(root)).config
  }

  it('converts every projection - each mem0 mode, Neo4j setting, scope and runtime - without losing an option', async () => {
    const runtimes =
      'runtimes:\n  graph-dev:\n    provider: docker-compose\n    composeFile: compose.yaml\n    projectName: docket\n'
    const v1 = await load(`version: 1
projections:
  - type: file
    output: .docket/.out
  - type: neo4j
    url: neo4j+s://graph.example
    database: memory
    username: docket
    passwordEnv: GRAPH_PASSWORD
    scope: payments
    cypher: { model: "qwen2.5:7b", url: "http://ollama:11434", timeoutMs: 1000 }
    runtime: graph-dev
  - type: mem0
    mode: platform
    apiKeyEnv: MY_MEM0_KEY
    host: https://mem0.example
    minScore: 0.4
    scope: { userId: me }
  - type: mem0
    mode: server
    url: http://localhost:8888
    scope: { agentId: docket, runId: r1 }
  - type: mem0
    mode: oss
    config: { vectorStore: { provider: qdrant, config: { host: localhost } } }
summarize:
  model: llama
${runtimes}`)
    const v2 = await load(`version: 2
adapters:
  - id: jsonl
    module: "@docket/adapter-jsonl"
    config: { output: .docket/.out }
  - id: neo4j
    module: "@docket/adapter-neo4j"
    runtime: graph-dev
    config:
      url: neo4j+s://graph.example
      database: memory
      username: docket
      passwordEnv: GRAPH_PASSWORD
      scope: payments
      cypher: { model: "qwen2.5:7b", url: "http://ollama:11434", timeoutMs: 1000 }
  - id: mem0
    module: "@docket/adapter-mem0"
    config: { mode: platform, apiKeyEnv: MY_MEM0_KEY, host: https://mem0.example, minScore: 0.4, scope: { userId: me } }
  - id: mem0#2
    module: "@docket/adapter-mem0"
    config: { mode: server, url: http://localhost:8888, scope: { agentId: docket, runId: r1 } }
  - id: mem0#3
    module: "@docket/adapter-mem0"
    config: { mode: oss, config: { vectorStore: { provider: qdrant, config: { host: localhost } } } }
summarize:
  model: llama
${runtimes}`)
    expect(v1).toEqual(v2)
  })

  it('keeps v1\'s defaults: no projections means the jsonl one', async () => {
    expect((await load('version: 1\n')).adapters).toEqual([
      { id: 'jsonl', module: '@docket/adapter-jsonl', roles: ['projection', 'query'], config: { output: '.docket/.index' } }
    ])
  })
})
