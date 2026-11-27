// SPDX-License-Identifier: AGPL-3.0-only
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** The 12-document platform workspace at `tests/fixtures/workspace`. */
export const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'workspace')

export interface Fixture {
  ontology: string
  /** Paths relative to the fixture root, posix-separated, sorted. */
  documents: { path: string; raw: string }[]
}

/** Reads a docket checkout: `.docket/entities.yaml` and every Markdown file under `.docket/`. */
export async function readFixture(root: string = FIXTURE_ROOT): Promise<Fixture> {
  const ontology = await readFile(join(root, '.docket', 'entities.yaml'), 'utf8')
  const entries = await readdir(join(root, '.docket'), { recursive: true, withFileTypes: true })
  const documents = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map(async (entry) => {
        const absolute = join(entry.parentPath, entry.name)
        return { path: relative(root, absolute).split(sep).join('/'), raw: await readFile(absolute, 'utf8') }
      }),
  )
  documents.sort((a, b) => (a.path < b.path ? -1 : 1))
  return { ontology, documents }
}
