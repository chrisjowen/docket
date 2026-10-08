import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { loadConfig } from '../config/loader.js'
import { configMigrate } from './config.js'

const V1 = 'version: 1\nprojections:\n  - type: neo4j\n    url: bolt://localhost:7687\n    passwordEnv: NEO4J_PASSWORD\n'

const project = async (contents = V1): Promise<{ root: string; file: string; nested: string }> => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'docket-config-')))
  const file = join(root, '.docket.yaml')
  await writeFile(file, contents, 'utf8')
  const nested = join(root, 'src', 'deep')
  await mkdir(nested, { recursive: true })
  return { root, file, nested }
}

describe('docket config migrate', () => {
  it('shows the version 2 file on a dry run, and writes nothing', async () => {
    const { file, nested } = await project()
    const result = await configMigrate({ cwd: nested, dryRun: true })
    expect(result.status).toBe('preview')
    expect(result.status === 'preview' && result.text).toContain('module: "@docket/adapter-neo4j"')
    expect(await readFile(file, 'utf8')).toBe(V1)
  })

  it('never rewrites the file without --write or a confirmation', async () => {
    const { file, root } = await project()
    await expect(configMigrate({ cwd: root })).rejects.toThrow(/without confirmation\. Pass --write/)
    expect(await readFile(file, 'utf8')).toBe(V1)
  })

  it('shows the file and asks before writing, and leaves it alone when told no', async () => {
    const { file, root } = await project()
    const confirm = vi.fn(async () => false)
    expect((await configMigrate({ cwd: root, confirm })).status).toBe('declined')
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('keeping the original as a backup'), expect.stringContaining('version: 2'))
    expect(await readFile(file, 'utf8')).toBe(V1)
  })

  it('writes the version 2 file once confirmed, keeping the original as a backup', async () => {
    const { file, root } = await project()
    const before = (await loadConfig(root)).config
    const result = await configMigrate({ cwd: root, confirm: async () => true })
    expect(result).toMatchObject({ status: 'written', backup: `${file}.v1.bak` })
    expect(await readFile(`${file}.v1.bak`, 'utf8')).toBe(V1)
    expect(await readFile(file, 'utf8')).toMatch(/^version: 2\n/)
    expect((await loadConfig(root)).config).toEqual(before)
  })

  it('never overwrites an earlier backup', async () => {
    const { file, root } = await project()
    await writeFile(`${file}.v1.bak`, 'an earlier backup', 'utf8')
    const result = await configMigrate({ cwd: root, write: true })
    expect(result).toMatchObject({ status: 'written', backup: `${file}.v1.bak.2` })
    expect(await readFile(`${file}.v1.bak`, 'utf8')).toBe('an earlier backup')
    expect(await readFile(`${file}.v1.bak.2`, 'utf8')).toBe(V1)
  })

  it('has nothing to do for a version 2 file', async () => {
    const { file, root } = await project()
    await configMigrate({ cwd: root, write: true })
    const v2 = await readFile(file, 'utf8')
    expect((await configMigrate({ cwd: root, write: true })).status).toBe('current')
    expect(await readFile(file, 'utf8')).toBe(v2)
  })

  it('refuses --dry-run with --write', async () => {
    const { root } = await project()
    await expect(configMigrate({ cwd: root, dryRun: true, write: true })).rejects.toThrow(/contradict/)
  })
})
