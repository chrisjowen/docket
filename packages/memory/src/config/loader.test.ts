import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_YAML } from './defaults.js'
import { defaultConfig, findConfigFile, loadConfig } from './loader.js'

describe('loadConfig', () => {
  it('finds the config from a nested subdirectory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memory-loader-'))
    await writeFile(join(root, '.memory.yaml'), DEFAULT_CONFIG_YAML)
    const nested = join(root, '.memory', 'resources', 'services')
    await mkdir(nested, { recursive: true })

    expect(findConfigFile(nested)).toBe(join(root, '.memory.yaml'))

    const resolved = await loadConfig(nested)
    expect(resolved.projectRoot).toBe(root)
    expect(resolved.memoryRoot).toBe(join(root, '.memory'))
    expect(resolved.config.watch.debounceMs).toBe(300)
  })

  it('errors clearly when no config exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memory-loader-'))
    await expect(loadConfig(root)).rejects.toThrow(/No \.memory\.yaml found/)
  })

  it('errors on an invalid config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memory-loader-'))
    await writeFile(join(root, '.memory.yaml'), 'version: 2\n')
    await expect(loadConfig(root)).rejects.toThrow(/Invalid/)
  })

  it('defaults a fresh project without touching disk', () => {
    const resolved = defaultConfig('/tmp/nowhere')
    expect(resolved.ontologyPath).toBe('/tmp/nowhere/.memory/entities.yaml')
    expect(resolved.config.projections).toEqual([
      { type: 'file', output: '.memory/.index' }
    ])
  })
})
