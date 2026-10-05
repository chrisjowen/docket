import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import type { MemoryDocument } from '../../model/index.js'
import type { MemoryProjection, ProjectionContext } from '../projection.js'
import {
  DOCUMENTS_FILENAME,
  EDGES_FILENAME,
  NODES_FILENAME,
  createJsonlProjection
} from './jsonl-projection.js'

const OUTPUT = '.docket/.index'

function makeDocument(overrides: Partial<MemoryDocument> & { id: string }): MemoryDocument {
  return {
    type: 'agent',
    title: 'Research Assistant',
    path: `.docket/resources/${overrides.id}.md`,
    hash: `sha256:${overrides.id}`,
    tags: [],
    attributes: {},
    links: [],
    content: '',
    mentions: [],
    index: { graph: true, fts: true, vector: true },
    ...overrides
  }
}

async function newProjection(): Promise<{ projection: MemoryProjection; outputDir: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'memory-file-projection-'))
  const context: ProjectionContext = {
    projectRoot,
    memoryRoot: join(projectRoot, '.docket'),
    stateRoot: join(projectRoot, OUTPUT)
  }
  const projection = createJsonlProjection({ type: 'jsonl', output: OUTPUT })
  await projection.init?.(context)
  return { projection, outputDir: join(projectRoot, OUTPUT) }
}

async function lines(outputDir: string, file: string): Promise<unknown[]> {
  const raw = await readFile(join(outputDir, file), 'utf8')
  return raw.split('\n').filter(line => line.length > 0).map(line => JSON.parse(line) as unknown)
}

const agent = makeDocument({
  id: 'agent.research-assistant',
  tags: ['research', 'agents'],
  content: 'The Research Assistant performs research...',
  attributes: { runtime: 'in-process', package: 'RA.agent', modes: ['fast', 'slow'] },
  links: [
    { rel: 'uses', target: 'datasource.public-market-1' },
    { rel: 'owned_by', target: 'team.research-platform', attributes: { criticality: 'high' } }
  ]
})
const team = makeDocument({ id: 'team.research-platform', type: 'team', title: 'Research Platform' })

describe('jsonl projection', () => {
  let projection: MemoryProjection
  let outputDir: string

  beforeEach(async () => {
    ;({ projection, outputDir } = await newProjection())
  })

  it('projects documents, nodes and edges into the expected records', async () => {
    await projection.upsert(agent)
    await projection.flush?.()

    expect(await lines(outputDir, DOCUMENTS_FILENAME)).toEqual([
      {
        id: 'agent.research-assistant',
        type: 'agent',
        title: 'Research Assistant',
        path: '.docket/resources/agent.research-assistant.md',
        content: 'The Research Assistant performs research...',
        tags: ['research', 'agents']
      }
    ])
    expect(await lines(outputDir, NODES_FILENAME)).toEqual([
      {
        id: 'agent.research-assistant',
        type: 'agent',
        title: 'Research Assistant',
        attributes: { package: 'RA.agent', runtime: 'in-process', modes: ['fast', 'slow'] }
      }
    ])
    expect(await lines(outputDir, EDGES_FILENAME)).toEqual([
      {
        source: 'agent.research-assistant',
        rel: 'owned_by',
        target: 'team.research-platform',
        attributes: { criticality: 'high' }
      },
      { source: 'agent.research-assistant', rel: 'uses', target: 'datasource.public-market-1' }
    ])
    // The manifest belongs to sync, not to any projection.
    expect(existsSync(join(outputDir, 'manifest.json'))).toBe(false)
  })

  it('produces byte-identical output regardless of upsert order', async () => {
    await projection.upsert(agent)
    await projection.upsert(team)
    await projection.flush?.()
    const first = await Promise.all(
      [DOCUMENTS_FILENAME, NODES_FILENAME, EDGES_FILENAME].map(file =>
        readFile(join(outputDir, file), 'utf8')
      )
    )

    const second = await newProjection()
    await second.projection.upsert(team)
    await second.projection.upsert(agent)
    await second.projection.flush?.()
    const rebuilt = await Promise.all(
      [DOCUMENTS_FILENAME, NODES_FILENAME, EDGES_FILENAME].map(file =>
        readFile(join(second.outputDir, file), 'utf8')
      )
    )

    expect(rebuilt).toEqual(first)
  })

  it('replaces rather than duplicates records when a document changes', async () => {
    await projection.upsert(agent)
    await projection.upsert(
      makeDocument({
        id: agent.id,
        title: 'Renamed',
        hash: 'sha256:changed',
        links: [{ rel: 'uses', target: 'datasource.other' }]
      })
    )
    await projection.flush?.()

    const documents = (await lines(outputDir, DOCUMENTS_FILENAME)) as { title: string }[]
    expect(documents).toHaveLength(1)
    expect(documents[0]?.title).toBe('Renamed')
    expect(await lines(outputDir, NODES_FILENAME)).toHaveLength(1)
    expect(await lines(outputDir, EDGES_FILENAME)).toEqual([
      { source: agent.id, rel: 'uses', target: 'datasource.other' }
    ])
  })

  it('drops a document and all of its edges on remove', async () => {
    await projection.upsert(agent)
    await projection.upsert(team)
    await projection.remove(agent.id)
    await projection.flush?.()

    expect(await lines(outputDir, DOCUMENTS_FILENAME)).toHaveLength(1)
    expect(await lines(outputDir, NODES_FILENAME)).toHaveLength(1)
    expect(await lines(outputDir, EDGES_FILENAME)).toEqual([])
  })

  it('suppresses graph records when index.graph is false', async () => {
    await projection.upsert(
      makeDocument({ ...agent, index: { graph: false, fts: true, vector: true } })
    )
    await projection.flush?.()

    expect(await lines(outputDir, DOCUMENTS_FILENAME)).toHaveLength(1)
    expect(await lines(outputDir, NODES_FILENAME)).toEqual([])
    expect(await lines(outputDir, EDGES_FILENAME)).toEqual([])
  })

  it('reset removes only its own files and reprojects cleanly', async () => {
    await projection.upsert(agent)
    await projection.flush?.()
    // The default output directory also holds sync's manifest.
    await writeFile(join(outputDir, 'manifest.json'), '{}', 'utf8')
    await projection.reset?.()

    expect(await readdir(outputDir)).toEqual(['manifest.json'])

    await projection.upsert(team)
    await projection.flush?.()
    expect(await lines(outputDir, DOCUMENTS_FILENAME)).toHaveLength(1)
  })

  it('reloads existing state on init so a partial sync keeps untouched records', async () => {
    await projection.upsert(agent)
    await projection.upsert(team)
    await projection.close?.()

    const reopened = createJsonlProjection({ type: 'jsonl', output: OUTPUT })
    await reopened.init?.({
      projectRoot: join(outputDir, '..', '..'),
      memoryRoot: join(outputDir, '..'),
      stateRoot: outputDir
    })
    await reopened.upsert(makeDocument({ id: team.id, type: 'team', title: 'Renamed Team' }))
    await reopened.flush?.()

    expect(await lines(outputDir, DOCUMENTS_FILENAME)).toHaveLength(2)
    expect(((await lines(outputDir, DOCUMENTS_FILENAME)) as { id: string }[]).map((d) => d.id)).toEqual([
      agent.id,
      team.id
    ])
  })

  it('buffers mutations and writes them once, on flush or close', async () => {
    await projection.upsert(agent)
    await projection.upsert(team)
    await projection.remove(team.id)
    expect(existsSync(join(outputDir, DOCUMENTS_FILENAME))).toBe(false)

    await projection.flush?.()
    expect(await lines(outputDir, DOCUMENTS_FILENAME)).toHaveLength(1)

    // Nothing changed since, so a second flush leaves the files alone.
    await writeFile(join(outputDir, DOCUMENTS_FILENAME), 'sentinel\n', 'utf8')
    await projection.flush?.()
    expect(await readFile(join(outputDir, DOCUMENTS_FILENAME), 'utf8')).toBe('sentinel\n')

    await projection.upsert(team)
    await projection.close?.()
    expect(await lines(outputDir, DOCUMENTS_FILENAME)).toHaveLength(2)
  })
})
