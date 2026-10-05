import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { memoryConfigSchema, type ResolvedConfig } from '../config/config.js'
import { scanSource } from './scanner.js'

let projectRoot: string

const doc = (id: string, title = id) =>
  `---\nid: ${id}\ntype: service\ntitle: ${title}\n---\n\nBody.\n`

const write = async (relative: string, contents: string) => {
  const absolute = join(projectRoot, relative)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, contents)
}

const resolved = (): ResolvedConfig => ({
  config: memoryConfigSchema.parse({ version: 1 }),
  projectRoot,
  memoryRoot: join(projectRoot, '.docket'),
  ontologyPath: join(projectRoot, '.docket/entities.yaml')
})

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'docket-scan-'))
})

describe('scanSource', () => {
  it('returns repo-relative documents sorted by path', async () => {
    await write('.docket/services/b.md', doc('service.b'))
    await write('.docket/a.md', doc('service.a'))

    const { documents, diagnostics } = await scanSource(resolved())
    expect(diagnostics).toEqual([])
    expect(documents.map((d) => d.path)).toEqual([
      '.docket/a.md',
      '.docket/services/b.md'
    ])
  })

  it('honours include and exclude patterns', async () => {
    await write('.docket/keep.md', doc('service.keep'))
    await write('.docket/drafts/skip.md', doc('service.skip'))
    await write('.docket/notes.txt', 'not markdown')

    const base = resolved()
    const config = {
      ...base.config,
      source: { ...base.config.source, exclude: ['drafts/**'] }
    }

    const { documents } = await scanSource({ ...base, config })
    expect(documents.map((d) => d.id)).toEqual(['service.keep'])
  })

  it('emits an error diagnostic for each duplicate id (spec §66)', async () => {
    await write('.docket/services/foo.md', doc('service.foo'))
    await write('.docket/old/foo.md', doc('service.foo'))
    await write('.docket/older/foo.md', doc('service.foo'))

    const { documents, diagnostics } = await scanSource(resolved())
    expect(documents).toHaveLength(3)
    expect(diagnostics).toEqual([
      {
        severity: 'error',
        code: 'duplicate-id',
        id: 'service.foo',
        path: '.docket/older/foo.md',
        message: expect.stringContaining('.docket/old/foo.md')
      },
      {
        severity: 'error',
        code: 'duplicate-id',
        id: 'service.foo',
        path: '.docket/services/foo.md',
        message: expect.stringContaining('.docket/old/foo.md')
      }
    ])
  })

  it('collects parse diagnostics without dropping the healthy files', async () => {
    await write('.docket/good.md', doc('service.good'))
    await write('.docket/bad.md', '---\nid: service.bad\ntype: service\n---\n')

    const { documents, diagnostics } = await scanSource(resolved())
    expect(documents.map((d) => d.id)).toEqual(['service.good'])
    expect(diagnostics[0]).toMatchObject({
      code: 'invalid-frontmatter',
      path: '.docket/bad.md'
    })
  })

  it('is empty rather than failing when the source root is absent', async () => {
    const { documents, diagnostics } = await scanSource(resolved())
    expect(documents).toEqual([])
    expect(diagnostics).toEqual([])
  })
})
