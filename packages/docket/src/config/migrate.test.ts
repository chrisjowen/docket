import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { fromV1Config, memoryConfigSchema, v1ConfigSchema } from './config.js'
import { DEFAULT_CONFIG_YAML } from './defaults.js'
import { migrateConfigText } from './migrate.js'

const V1_STARTER = new URL('../../test/fixtures/config/v1-starter.docket.yaml', import.meta.url)

const migrated = (text: string): string => {
  const migration = migrateConfigText(text)
  if (migration.version !== 1) throw new Error('expected a v1 file')
  return migration.text
}

/** What the file loads as. */
const loaded = (text: string) => memoryConfigSchema.parse(parse(text))

describe('migrateConfigText', () => {
  it('rewrites the v1 starter as version 2 that loads as the same configuration, comments kept', async () => {
    const v1 = await readFile(V1_STARTER, 'utf8')
    const v2 = migrated(v1)

    expect(parse(v2)).toMatchObject({
      version: 2,
      adapters: [
        { id: 'jsonl', module: '@docket/adapter-jsonl', roles: ['projection', 'query'], config: { output: '.docket/.index' } }
      ]
    })
    expect(parse(v2)).not.toHaveProperty('projections')
    expect(loaded(v2)).toEqual(loaded(v1))
    expect(loaded(v2)).toEqual(fromV1Config(v1ConfigSchema.parse(parse(v1))))
    // Everything else is as it was written.
    expect(v2).toContain('# Optional: a Neo4j graph with full-text search.')
    // Trailing comments stay, though the yaml library indents them with the list they follow.
    expect(v2).toContain('#   model: "qwen2.5:7b"     # Ollama at http://localhost:11434')
    expect(v2.slice(0, v2.indexOf('adapters:'))).toBe(v1.slice(0, v1.indexOf('projections:')).replace('version: 1', 'version: 2'))
  })

  it('keeps each projection\'s fields and comments under config, moving type into the module and runtime up', () => {
    const v1 = `version: 1 # keep me
# the engines
projections:
  - type: file
    output: .docket/.out # where
  # the graph
  - { type: neo4j, url: "neo4j+s://graph.example", passwordEnv: GRAPH_PASSWORD, runtime: graph-dev }
  - type: mem0
    mode: oss
    config:
      vectorStore: { provider: qdrant }
  - type: mem0
    mode: platform
runtimes:
  graph-dev: { provider: docker-compose, composeFile: c.yaml, projectName: p }
`
    const v2 = migrated(v1)
    expect(v2).toBe(`version: 2 # keep me
# the engines
adapters:
  - id: jsonl
    module: "@docket/adapter-jsonl"
    roles: [ projection, query ]
    config:
      output: .docket/.out # where
  # the graph
  - id: neo4j
    module: "@docket/adapter-neo4j"
    roles: [ projection, query ]
    runtime: graph-dev
    config: { url: "neo4j+s://graph.example", passwordEnv: GRAPH_PASSWORD }
  - id: mem0
    module: "@docket/adapter-mem0"
    roles: [ projection, query ]
    config:
      mode: oss
      config:
        vectorStore: { provider: qdrant }
  - id: mem0#2
    module: "@docket/adapter-mem0"
    roles: [ projection, query ]
    config:
      mode: platform
runtimes:
  graph-dev: { provider: docker-compose, composeFile: c.yaml, projectName: p }
`)
    expect(loaded(v2)).toEqual(loaded(v1))
  })

  it('writes out v1\'s default projection when the file has none', () => {
    const v1 = 'version: 1\nwatch:\n  debounceMs: 10\n'
    const v2 = migrated(v1)
    expect(parse(v2).adapters).toEqual([
      { id: 'jsonl', module: '@docket/adapter-jsonl', roles: ['projection', 'query'], config: { output: '.docket/.index' } }
    ])
    expect(loaded(v2)).toEqual(loaded(v1))
  })

  it('keeps an empty list of projections empty', () => {
    const v2 = migrated('version: 1\nprojections: []\n')
    expect(v2).toBe('version: 2\nadapters: []\n')
    expect(loaded(v2).adapters).toEqual([])
  })

  it('leaves a version 2 file alone', () => {
    expect(migrateConfigText(DEFAULT_CONFIG_YAML)).toEqual({ version: 2 })
  })

  it('refuses a v1 file that does not load, saying why', () => {
    expect(() => migrateConfigText('version: 1\nprojections:\n  - type: kuzu\n')).toThrow(/fix it before migrating/)
    expect(() => migrateConfigText('version: 3\n')).toThrow(/version must be 1 or 2/)
  })
})
