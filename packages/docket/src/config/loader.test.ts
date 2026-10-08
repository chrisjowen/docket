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
    await writeFile(join(root, '.docket.yaml'), 'version: 2\n')
    await expect(loadConfig(root)).rejects.toThrow(/Invalid/)
  })

  it('defaults a fresh project without touching disk', () => {
    const resolved = defaultConfig('/tmp/nowhere')
    expect(resolved.ontologyPath).toBe('/tmp/nowhere/.docket/entities.yaml')
    expect(resolved.config.projections).toEqual([
      { type: 'jsonl', output: '.docket/.index' }
    ])
  })

  const loadYaml = async (yaml: string) => {
    const root = await mkdtemp(join(tmpdir(), 'memory-loader-'))
    await writeFile(join(root, '.docket.yaml'), `version: 1\n${yaml}`)
    return loadConfig(root)
  }

  it('still accepts the old `file` projection name as jsonl', async () => {
    const resolved = await loadYaml('projections:\n  - type: file\n    output: .docket/.out\n')
    expect(resolved.config.projections).toEqual([{ type: 'jsonl', output: '.docket/.out' }])
  })

  it('accepts a hosted mem0 projection with the key read from the environment', async () => {
    const resolved = await loadYaml(
      'projections:\n  - type: mem0\n    mode: platform\n    scope:\n      userId: platform-team\n'
    )
    expect(resolved.config.projections).toEqual([
      { type: 'mem0', mode: 'platform', apiKeyEnv: 'MEM0_API_KEY', scope: { userId: 'platform-team' } }
    ])
  })

  it('passes a self-hosted mem0 config through untouched', async () => {
    const resolved = await loadYaml(
      'projections:\n  - type: mem0\n    mode: oss\n    config:\n      vectorStore:\n        provider: qdrant\n        config: { host: localhost, port: 6333 }\n'
    )
    expect(resolved.config.projections).toEqual([
      {
        type: 'mem0',
        mode: 'oss',
        config: { vectorStore: { provider: 'qdrant', config: { host: 'localhost', port: 6333 } } }
      }
    ])
  })

  it('rejects a mem0 projection without a mode or with an empty scope', async () => {
    await expect(loadYaml('projections:\n  - type: mem0\n')).rejects.toThrow(/Invalid/)
    await expect(
      loadYaml('projections:\n  - type: mem0\n    mode: oss\n    scope: {}\n')
    ).rejects.toThrow(/Invalid/)
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
    expect(resolved.config.projections).toEqual([
      { type: 'neo4j', url: 'bolt://127.0.0.1:17687', username: 'neo4j', runtime: 'graph-dev' }
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
