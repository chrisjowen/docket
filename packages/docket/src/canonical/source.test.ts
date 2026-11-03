import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { loadConfig } from '../config/loader.js'
import { hashContent } from '../source/hashing.js'
import { scanSource } from '../source/scanner.js'
import { filesystemSource, readCanonical, type CanonicalDocument, type CanonicalSource } from './source.js'

const EXAMPLE = fileURLToPath(new URL('../../../../examples/acme-platform', import.meta.url))

const collect = async (source: CanonicalSource): Promise<CanonicalDocument[]> => {
  const documents: CanonicalDocument[] = []
  for await (const document of source.documents()) if ('raw' in document) documents.push(document)
  return documents
}

describe('filesystemSource', () => {
  it("yields every document the scanner finds, with docket's hash", async () => {
    const resolved = await loadConfig(EXAMPLE)
    const scanned = await scanSource(resolved)
    const yielded = await collect(filesystemSource(resolved))

    expect(scanned.documents.length).toBeGreaterThan(0)
    expect(yielded.map(({ path, hash }) => ({ path, hash }))).toEqual(
      scanned.documents.map(({ path, hash }) => ({ path, hash }))
    )
    for (const document of yielded) {
      expect(document.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(document.raw).toBe(await readFile(join(EXAMPLE, document.path), 'utf8'))
    }
  })

  it('gives the ontology file and its revision', async () => {
    const resolved = await loadConfig(EXAMPLE)
    const ontology = await filesystemSource(resolved).ontology()

    expect(ontology.text).toBe(await readFile(resolved.ontologyPath, 'utf8'))
    expect(ontology.revision).toBe(hashContent(ontology.text))
  })
})

describe('readCanonical', () => {
  it('reads what the scanner reads, sorted by path, from any source', async () => {
    const resolved = await loadConfig(EXAMPLE)
    const scanned = await scanSource(resolved)
    const files = await collect(filesystemSource(resolved))
    const shuffled: CanonicalSource = {
      resolved,
      ontology: () => filesystemSource(resolved).ontology(),
      async *documents() {
        yield* [...files].reverse()
      }
    }

    const read = await readCanonical(shuffled)
    expect(read.documents).toEqual(scanned.documents)
    expect(read.diagnostics).toEqual(scanned.diagnostics)
    expect(read.files.get(files[0]!.path)).toBe(files[0]!.raw)
  })

  it('reports a document the source could not read, and a missing ontology, as the scanner and loader do', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'docket-source-'))
    await mkdir(join(projectRoot, '.docket'), { recursive: true })
    await writeFile(join(projectRoot, '.docket.yaml'), 'version: 1\n')
    const resolved = await loadConfig(projectRoot)
    const source: CanonicalSource = {
      resolved,
      ontology: () => filesystemSource(resolved).ontology(),
      async *documents() {
        yield { path: '.docket/gone.md', error: 'EACCES: permission denied' }
      }
    }

    const read = await readCanonical(source)
    expect(read.documents).toEqual([])
    expect(read.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'unreadable-file', path: '.docket/gone.md' })
    ])
    expect(read.ontology.ontology).toBeNull()
    expect(read.ontology.diagnostics).toEqual([expect.objectContaining({ code: 'ontology-missing', path: resolved.ontologyPath })])
  })
})
