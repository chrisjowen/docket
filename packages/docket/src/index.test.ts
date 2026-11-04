import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  aggregate,
  canonicalState,
  confidenceModel,
  filesystemSource,
  hashContent,
  memoryConfigSchema,
  parseMemoryFile,
  parseOntology,
  readCanonical,
  readGraph,
  sync,
  SyncError,
  validate,
  validateDocuments,
  type AdapterManifest,
  type CanonicalDocument,
  type CanonicalSource,
  type ManifestStore,
  type MemoryAdapter,
  type ProjectionBatch,
  type ResolvedConfig,
  type SyncTarget
} from './index.js'
import { loadConfig } from './config/loader.js'
import { checkpointOf } from './manifest/adapter-manifest.js'

const EXAMPLE = fileURLToPath(new URL('../../../examples/acme-platform', import.meta.url))

/** The example project's ontology and documents, held in memory under another root, as a host would. */
const memorySource = async (): Promise<CanonicalSource> => {
  const files = filesystemSource(await loadConfig(EXAMPLE))
  const ontology = await files.ontology()
  const documents: CanonicalDocument[] = []
  for await (const document of files.documents()) if ('raw' in document) documents.push(document)

  const resolved: ResolvedConfig = {
    config: memoryConfigSchema.parse({ version: 2, adapters: [] }),
    projectRoot: '/workspaces/acme',
    memoryRoot: '/workspaces/acme/.docket',
    ontologyPath: '.docket/entities.yaml'
  }
  return {
    resolved,
    ontology: async () => ontology,
    async *documents() {
      yield* documents.map(({ path, raw }) => ({ path, raw, hash: hashContent(raw) }))
    }
  }
}

describe('the public API', () => {
  it('validates a source that is not a directory as docket validate does the project', async () => {
    const fromFiles = await validate({ cwd: EXAMPLE })
    const fromMemory = await validate({ source: await memorySource() })

    expect(fromFiles.entities.length).toBeGreaterThan(0)
    expect(fromMemory.entities).toEqual(fromFiles.entities)
    expect(fromMemory.documents).toEqual(fromFiles.documents)
  })

  it("exports validation's parts, which compose to the same answer", async () => {
    const source = await memorySource()
    const { ontology } = parseOntology((await source.ontology()).text, source.resolved.ontologyPath)
    const documents: ReturnType<typeof parseMemoryFile>['document'][] = []
    for await (const document of source.documents()) {
      if ('raw' in document) documents.push(parseMemoryFile(document.raw, document.path).document)
    }
    const parsed = documents.flatMap((document) => (document ? [document] : []))

    expect(ontology).not.toBeNull()
    expect(validateDocuments(parsed, ontology!).filter((d) => d.severity === 'error')).toEqual([])
    const merged = aggregate(parsed, confidenceModel(ontology!))
    expect(merged.entities).toEqual((await validate({ source })).entities)
    expect((await readCanonical(source)).files.size).toBe(parsed.length)
  })
})

/** Manifests held in memory, as a host's database would hold them: exactly as written. */
const memoryManifests = (): ManifestStore & { held: Map<string, AdapterManifest> } => {
  const held = new Map<string, AdapterManifest>()
  return {
    held,
    read: async (id) => held.get(id),
    write: async (id, manifest) => {
      held.set(id, structuredClone(manifest))
    },
    list: async () => [...held.keys()].sort(),
    remove: async (id) => {
      held.delete(id)
    }
  }
}

/** An instance taking entities, recording every batch and reset; `fail` makes every batch throw. */
const fakeTarget = (id: string, options: { fail?: boolean } = {}) => {
  const seen = { batches: [] as ProjectionBatch[], resets: [] as string[], entities: new Set<string>() }
  const adapter = (): MemoryAdapter => ({
    describe: () => ({ name: 'fake', version: '1.0.0', inputs: ['entity'], resultKinds: [], rebuild: 'deterministic' }),
    status: async () => ({ state: 'ready', message: 'fake' }),
    projection: {
      apply: async (batch) => {
        if (options.fail) throw new Error('unreachable')
        seen.batches.push(batch)
        const applied: string[] = []
        for (const change of batch.changes) {
          if (change.operation === 'upsert') {
            seen.entities.add(change.record.id)
            applied.push(change.record.id)
          } else {
            seen.entities.delete(change.id)
            applied.push(change.id)
          }
        }
        return { batchId: batch.batchId, applied, failed: [] }
      },
      reset: async (scope) => {
        seen.resets.push(scope)
        seen.entities.clear()
      }
    },
    close: async () => undefined
  })
  const target: SyncTarget = { id, fingerprint: `fingerprint-${id}`, create: async () => adapter() }
  return { target, seen }
}

describe('the public sync', () => {
  it('syncs a source that is not a directory into instances whose manifests a host keeps', async () => {
    const source = await memorySource()
    const manifests = memoryManifests()
    const graph = fakeTarget('graph')
    const scope = 'workspace:acme'

    const first = await sync(source, manifests, [graph.target], { scope })
    const { entities, documents } = await validate({ source })
    const ids = canonicalState(entities, documents, scope)
      .inputs.filter(({ input }) => input.kind === 'entity')
      .map(({ input }) => input.id)

    expect(first.upserted).toEqual(ids)
    expect([...graph.seen.entities].sort()).toEqual([...ids].sort())
    expect(graph.seen.batches.every((batch) => batch.scope === scope)).toBe(true)
    expect(first.adapters).toMatchObject([{ id: 'graph', origin: 'created', reset: true }])
    expect(graph.seen.resets).toEqual([scope])

    const manifest = manifests.held.get('graph')!
    expect(manifest).toMatchObject({ adapter: 'graph', fingerprint: 'fingerprint-graph', scope, inputs: ['entity'] })
    expect(Object.keys(manifest.records.entity).sort()).toEqual([...ids].sort())
    // A store that keeps the manifest as given still holds a checkpoint of exactly its records.
    expect(manifest.checkpoint).toBe(checkpointOf(manifest.records))
    expect(first.adapters[0]?.checkpoint).toBe(manifest.checkpoint)

    const second = await sync(source, manifests, [graph.target], { scope })
    expect(second.upserted).toEqual([])
    expect(second.unchanged).toBe(ids.length)
    expect(second.adapters).toMatchObject([{ origin: 'current', reset: false }])

    const rebuilt = await sync(source, manifests, [graph.target], { scope, fresh: new Set(['graph']) })
    expect(rebuilt.upserted).toEqual(ids)
    expect(rebuilt.adapters).toMatchObject([{ origin: 'rebuilt', reset: true }])
  })

  it('syncs every other instance when one fails, and says which failed', async () => {
    const source = await memorySource()
    const manifests = memoryManifests()
    const graph = fakeTarget('graph')
    const broken = fakeTarget('broken', { fail: true })

    const failure = await sync(source, manifests, [graph.target, broken.target]).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(SyncError)
    const { result } = failure as SyncError
    expect(result.adapters.find((report) => report.id === 'broken')?.error).toBe('unreachable')
    expect(result.adapters.find((report) => report.id === 'graph')?.error).toBeUndefined()
    expect(manifests.held.get('graph')?.records.entity).not.toEqual({})
  })

  it('refuses an instance id given twice', async () => {
    const graph = fakeTarget('graph')
    await expect(sync(await memorySource(), memoryManifests(), [graph.target, graph.target])).rejects.toThrow(
      'Adapter id "graph" is used more than once'
    )
  })
})

describe('the graph browser', () => {
  it('reads the graph of a source that is not a directory as of the project', async () => {
    const fromFiles = await readGraph(filesystemSource(await loadConfig(EXAMPLE)))
    const fromMemory = await readGraph(await memorySource())

    expect(fromMemory.entities.length).toBeGreaterThan(0)
    expect(fromMemory.entities.map((entity) => entity.id)).toEqual(fromFiles.entities.map((entity) => entity.id))
  })
})
