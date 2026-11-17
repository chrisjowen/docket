import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The core is shared by every deployment, so it imports nothing of any one
 * of them: a module of the package imports its own files, Node's built-ins
 * and the packages listed here, and never Docket Cloud's.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const ALLOWED_PACKAGES: readonly string[] = []
const TEST_PACKAGES: readonly string[] = ['vitest']

const sources = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      return Promise.resolve(entry.name.endsWith('.ts') ? [path] : [])
    })
  )
  return files.flat()
}

const SPECIFIER = /(?:^|\s)(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm

const specifiers = (source: string): string[] =>
  [...source.matchAll(SPECIFIER)].map((match) => (match[1] ?? match[2] ?? match[3]) as string)

const packageOf = (specifier: string): string =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : (specifier.split('/')[0] as string)

describe('the import boundary', () => {
  it('imports only its own modules, Node built-ins and its listed packages', async () => {
    const outside: string[] = []
    for (const file of await sources(SRC)) {
      const allowed = file.endsWith('.test.ts') ? [...ALLOWED_PACKAGES, ...TEST_PACKAGES] : ALLOWED_PACKAGES
      for (const specifier of specifiers(await readFile(file, 'utf8'))) {
        if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
        if (!allowed.includes(packageOf(specifier))) outside.push(`${relative(SRC, file)}: ${specifier}`)
      }
    }
    expect(outside).toEqual([])
  })

  it('never names Docket Cloud', async () => {
    const named: string[] = []
    for (const file of await sources(SRC)) {
      if (/@docket-cloud\/|docket-cloud/.test(await readFile(file, 'utf8'))) named.push(relative(SRC, file))
    }
    expect(named).toEqual([])
  })

  it('finds the imports it checks', () => {
    expect(
      specifiers(
        [
          "import { a } from './a.js'",
          "import type { B } from '@docket-cloud/tenancy'",
          "export { c } from 'pg'",
          "import 'side-effect'",
          "const d = await import('node:fs')"
        ].join('\n')
      )
    ).toEqual(['./a.js', '@docket-cloud/tenancy', 'pg', 'side-effect', 'node:fs'])
  })
})
