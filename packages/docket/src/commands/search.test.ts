import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import { init } from './init.js'
import { search } from './search.js'
import { sync } from './sync.js'

let root: string

const writeDecision = (name: string, title: string, body: string): Promise<void> =>
  writeFile(
    join(root, '.docket', 'decisions', `${name}.md`),
    `---\nid: decision.${name}\ntype: decision\ntitle: ${title}\n---\n\n${body}\n`,
    'utf8'
  )

const configure = (projections: string): Promise<void> =>
  writeFile(join(root, '.docket.yaml'), `version: 1\nprojections:\n${projections}`, 'utf8')

const JSONL = '  - type: jsonl\n    output: .docket/.index\n'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memory-search-'))
  await init({ cwd: root })
  await configure(JSONL)
  await writeDecision('minio', 'Use MinIO in development', 'Uploads go to MinIO.')
  await writeDecision('ollama', 'Synthesise with Ollama', 'A local model in development.')
  await sync({ cwd: root })
})

describe('search', () => {
  it('answers from each searchable projection, and says which found what', async () => {
    const result = await search('minio uploads', { cwd: root })

    expect(result.sources).toEqual([
      { name: 'jsonl', hits: [{ id: 'decision.minio', score: expect.any(Number) }], note: expect.stringContaining('BM25') }
    ])
    expect(result.documents).toEqual([
      {
        id: 'decision.minio',
        type: 'decision',
        title: 'Use MinIO in development',
        path: '.docket/decisions/minio.md',
        // No evidence and no stated confidence: the ontology's default.
        confidence: 0.5,
        foundBy: ['jsonl']
      }
    ])
    expect(result.diagnostics).toEqual([])
  })

  it('reports a projection that cannot answer and keeps the others', async () => {
    await configure(`${JSONL}  - type: mem0\n    mode: server\n    url: http://127.0.0.1:1\n`)

    const result = await search('ollama', { cwd: root })

    expect(result.sources.map((source) => source.name)).toEqual(['jsonl', 'mem0'])
    expect(result.sources[0]?.hits.map((hit) => hit.id)).toEqual(['decision.ollama'])
    expect(result.sources[1]).toMatchObject({ name: 'mem0', hits: [], error: expect.any(String) })
    expect(result.documents.map((document) => document.id)).toEqual(['decision.ollama'])
  })

  it('drops hits for documents no longer in the files, with a warning', async () => {
    await rm(join(root, '.docket', 'decisions', 'minio.md'))

    const result = await search('minio', { cwd: root })

    expect(result.sources[0]?.hits).toEqual([])
    expect(result.documents).toEqual([])
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'stale-search-hit', id: 'decision.minio' })
    ])
  })

  it('asks only the instances query.defaultAdapters names, and none whose query role is off', async () => {
    const adapter = (id: string, roles: string) =>
      `  - id: ${id}\n    module: "@docket/adapter-jsonl"\n    roles: ${roles}\n    config: { output: .docket/.index }\n`
    const v2 = (query: string) =>
      writeFile(
        join(root, '.docket.yaml'),
        `version: 2\nadapters:\n${adapter('a', '[projection, query]')}${adapter('b', '[query]')}${adapter('c', '[projection]')}${query}`,
        'utf8'
      )

    await v2('')
    expect((await search('minio', { cwd: root })).sources.map((source) => source.name)).toEqual(['a', 'b'])

    await v2('query:\n  defaultAdapters: [b]\n')
    expect((await search('minio', { cwd: root })).sources.map((source) => source.name)).toEqual(['b'])
  })

  it('passes the limit to every projection', async () => {
    const result = await search('development', { cwd: root, limit: 1 })

    expect(result.sources[0]?.hits).toHaveLength(1)
  })
})
