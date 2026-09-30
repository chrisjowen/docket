import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { memoryConfigSchema } from '../config/config.js'
import { loadConfig } from '../config/loader.js'
import { init } from './init.js'

const freshRoot = (): Promise<string> => mkdtemp(join(tmpdir(), 'memory-init-'))

describe('init', () => {
  it('creates the spec section 4 tree', async () => {
    const root = await freshRoot()
    const result = await init({ cwd: root })

    expect(result.created).toEqual([
      '.memory/',
      '.memory/resources/repositories/',
      '.memory/resources/services/',
      '.memory/resources/libraries/',
      '.memory/resources/agents/',
      '.memory/resources/systems/',
      '.memory/resources/environments/',
      '.memory/resources/datasources/',
      '.memory/resources/teams/',
      '.memory/decisions/',
      '.memory/constraints/',
      '.memory/notes/',
      '.memory/.index/',
      '.memory.yaml',
      '.memory/entities.yaml'
    ])
    expect(result.skipped).toEqual([])
  })

  it('round-trips the generated config through the schema', async () => {
    const root = await freshRoot()
    await init({ cwd: root })

    const raw = parse(await readFile(join(root, '.memory.yaml'), 'utf8'))
    expect(memoryConfigSchema.parse(raw)).toEqual(
      memoryConfigSchema.parse({ version: 1 })
    )

    const resolved = await loadConfig(root)
    expect(resolved.memoryRoot).toBe(join(root, '.memory'))
    expect(resolved.ontologyPath).toBe(join(root, '.memory', 'entities.yaml'))
  })

  it('is idempotent and never overwrites without force', async () => {
    const root = await freshRoot()
    await init({ cwd: root })
    await writeFile(join(root, '.memory', 'entities.yaml'), 'version: 1\n')

    const second = await init({ cwd: root })
    expect(second.created).toEqual([])
    expect(second.skipped).toEqual(['.memory.yaml', '.memory/entities.yaml'])
    expect(
      await readFile(join(root, '.memory', 'entities.yaml'), 'utf8')
    ).toBe('version: 1\n')

    const forced = await init({ cwd: root, force: true })
    expect(forced.created).toEqual(['.memory.yaml', '.memory/entities.yaml'])
    expect(
      await readFile(join(root, '.memory', 'entities.yaml'), 'utf8')
    ).toContain('resourceTypes:')
  })

  it('appends to an existing .gitignore exactly once', async () => {
    const root = await freshRoot()
    await writeFile(join(root, '.gitignore'), 'node_modules')

    expect((await init({ cwd: root })).updated).toEqual(['.gitignore'])
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules\n.memory/.index/\n'
    )
    expect((await init({ cwd: root })).skipped).toContain('.gitignore')
  })
})
