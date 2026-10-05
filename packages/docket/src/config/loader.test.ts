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

  it("defaults the plugin's review model to a small one, and accepts another", async () => {
    expect(defaultConfig('/tmp/nowhere').config.review).toEqual({ model: 'haiku' })
    expect((await loadYaml('review:\n  model: sonnet\n')).config.review).toEqual({ model: 'sonnet' })
    await expect(loadYaml('review:\n  model: ""\n')).rejects.toThrow(/Invalid/)
  })
})
