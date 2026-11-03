import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  aggregate,
  confidenceModel,
  filesystemSource,
  hashContent,
  memoryConfigSchema,
  parseMemoryFile,
  parseOntology,
  readCanonical,
  validate,
  validateDocuments,
  type CanonicalDocument,
  type CanonicalSource,
  type ResolvedConfig
} from './index.js'
import { loadConfig } from './config/loader.js'

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
