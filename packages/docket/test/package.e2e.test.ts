import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The built package as npm ships it: every entry point its `exports` names
 * exists, and a host reaches what it needs through them alone, never through
 * the package's built modules.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))

interface Target {
  types: string
  import: string
}

const exportsMap = async (): Promise<Record<string, Target | string>> =>
  JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).exports

/** The module an import of `@chrisjowen/docket` + `subpath` loads. */
const load = async (subpath: string): Promise<Record<string, unknown>> => {
  const target = (await exportsMap())[subpath] as Target
  return import(pathToFileURL(`${ROOT}/${target.import}`).href)
}

describe('the published package', () => {
  it('ships every entry point it exports', async () => {
    for (const [subpath, target] of Object.entries(await exportsMap())) {
      const files = typeof target === 'string' ? [target] : [target.types, target.import]
      for (const file of files) expect(existsSync(`${ROOT}/${file}`), `${subpath}: ${file}`).toBe(true)
    }
  })

  it('exports sync and its parts, the graph browser and asking from its root', async () => {
    const docket = await load('.')
    for (const name of [
      'sync',
      'SyncError',
      'canonicalState',
      'planAdapter',
      'Checkpoint',
      'emptyRecords',
      'INPUT_KINDS',
      'resetPendingFingerprint',
      'unacknowledged',
      'entityProjectionAdapter',
      'readGraph',
      'iconFor',
      'MATTER_OPTIONS',
      'MAX_SEARCH_LIMIT',
      'SEARCH_SCHEMA',
      'searchText',
      'askWith',
      'snapshotOf',
      'toSearchResult',
      'citationsIn',
      'synthesisPrompt'
    ]) {
      expect(docket[name], name).toBeDefined()
    }
  })

  it('exports the contracts, the adapter kit and the parts of sync, query, search and the graph browser at their own entry points', async () => {
    const entries: Record<string, string[]> = {
      './contracts': ['unacknowledged', 'ADAPTER_API_VERSION'],
      './adapter-kit': ['entityProjectionAdapter'],
      './manifest/adapter-manifest': ['Checkpoint', 'emptyRecords', 'INPUT_KINDS', 'resetPendingFingerprint'],
      './manifest/plan': ['planAdapter'],
      './mcp/search': ['MAX_SEARCH_LIMIT', 'searchText'],
      './mcp/types': ['SEARCH_SCHEMA'],
      './ontology/icons': ['iconFor', 'ICON_NAMES'],
      './open/graph': ['readGraph'],
      './open/types': [],
      './query/ask': ['askWith'],
      './query/legacy': ['toSearchResult'],
      './query/snapshot': ['snapshotOf'],
      './query/synthesis': ['citationsIn', 'synthesisPrompt'],
      './source/hashing': ['hashContent'],
      './source/parser': ['MATTER_OPTIONS'],
      './sync/inputs': ['canonicalState']
    }
    for (const [subpath, names] of Object.entries(entries)) {
      const module = await load(subpath)
      for (const name of names) expect(module[name], `${subpath}: ${name}`).toBeDefined()
    }
    // The same modules as the root's, so a host mixing the two shares one copy of each.
    expect((await load('./contracts')).unacknowledged).toBe((await load('.')).unacknowledged)
    expect((await load('./adapter-kit')).entityProjectionAdapter).toBe((await load('.')).entityProjectionAdapter)
  })

  it('exports the bundled Neo4j, mem0 and cognee adapters at their own entry points', async () => {
    const neo4j = await load('./adapters/neo4j')
    expect(neo4j.createNeo4jProjection).toBeTypeOf('function')
    expect(neo4j.neo4jConfigSchema).toBeDefined()

    const mem0 = await load('./adapters/mem0')
    expect(mem0.createMem0Projection).toBeTypeOf('function')
    expect(mem0.mem0ConfigSchema).toBeDefined()

    const cognee = await load('./adapters/cognee')
    expect(cognee.createCogneeAdapter).toBeTypeOf('function')
    expect((cognee.default as { name?: unknown }).name).toBe('cognee')
  })
})
