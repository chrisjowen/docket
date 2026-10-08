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
      '.docket/',
      '.docket/resources/repositories/',
      '.docket/resources/services/',
      '.docket/resources/libraries/',
      '.docket/resources/agents/',
      '.docket/resources/systems/',
      '.docket/resources/environments/',
      '.docket/resources/datasources/',
      '.docket/resources/teams/',
      '.docket/decisions/',
      '.docket/constraints/',
      '.docket/notes/',
      '.docket/.index/',
      '.docket.yaml',
      '.docket/entities.yaml'
    ])
    expect(result.skipped).toEqual([])
  })

  it('round-trips the generated config through the schema', async () => {
    const root = await freshRoot()
    await init({ cwd: root })

    const raw = parse(await readFile(join(root, '.docket.yaml'), 'utf8'))
    expect(memoryConfigSchema.parse(raw)).toEqual(
      memoryConfigSchema.parse({ version: 2 })
    )

    const resolved = await loadConfig(root)
    expect(resolved.memoryRoot).toBe(join(root, '.docket'))
    expect(resolved.ontologyPath).toBe(join(root, '.docket', 'entities.yaml'))
  })

  it('is idempotent and never overwrites without force', async () => {
    const root = await freshRoot()
    await init({ cwd: root })
    await writeFile(join(root, '.docket', 'entities.yaml'), 'version: 1\n')

    const second = await init({ cwd: root })
    expect(second.created).toEqual([])
    expect(second.skipped).toEqual(['.docket.yaml', '.docket/entities.yaml'])
    expect(
      await readFile(join(root, '.docket', 'entities.yaml'), 'utf8')
    ).toBe('version: 1\n')

    const forced = await init({ cwd: root, force: true })
    expect(forced.created).toEqual(['.docket.yaml', '.docket/entities.yaml'])
    expect(
      await readFile(join(root, '.docket', 'entities.yaml'), 'utf8')
    ).toContain('resourceTypes:')
  })

  it('appends to an existing .gitignore exactly once', async () => {
    const root = await freshRoot()
    await writeFile(join(root, '.gitignore'), 'node_modules')

    expect((await init({ cwd: root })).updated).toEqual(['.gitignore'])
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules\n.docket/.index/\n.docket/.cache/\n'
    )
    expect((await init({ cwd: root })).skipped).toContain('.gitignore')
  })

  it('adds only the entries an existing .gitignore lacks', async () => {
    const root = await freshRoot()
    await writeFile(join(root, '.gitignore'), '.docket/.index/\n')

    expect((await init({ cwd: root })).updated).toEqual(['.gitignore'])
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe('.docket/.index/\n.docket/.cache/\n')
  })
})
