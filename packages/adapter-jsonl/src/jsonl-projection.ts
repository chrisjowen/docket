import { readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { Assessment, EntityInput, EvidenceRecord } from '@docket/contracts'
import {
  stableStringify,
  writeFileAtomic,
  type EntityProjection,
  type ProjectionContext,
  type SearchAnswer
} from '@docket/adapter-kit'
import { z } from 'zod'

import { lexicalSearch } from './lexical-search.js'

/** Writes the normalized model as JSONL - a readable debug view of what projections receive. */
export const jsonlConfigSchema = z.object({
  type: z.literal('jsonl').default('jsonl'),
  output: z.string().default('.docket/.index')
})

export type JsonlConfig = z.infer<typeof jsonlConfigSchema>

export const DOCUMENTS_FILENAME = 'documents.jsonl'
export const NODES_FILENAME = 'nodes.jsonl'
export const EDGES_FILENAME = 'edges.jsonl'

/** One line of `documents.jsonl` (spec §28): one per entity, however many files declare it. */
export interface DocumentRecord {
  id: string
  type: string
  title: string
  /** The first source file. */
  path: string
  /** Every source file, in path order. */
  paths: string[]
  content: string
  tags: string[]
}

/** One line of `nodes.jsonl` (spec §29), with the evidence behind it and the confidence it earns. */
export interface NodeRecord extends Assessment {
  id: string
  type: string
  title: string
  attributes: Record<string, unknown>
  evidence: EvidenceRecord[]
}

/** One line of `edges.jsonl` (spec §30): one per (source, rel, target). */
export interface EdgeRecord extends Assessment {
  source: string
  rel: string
  target: string
  attributes?: Record<string, unknown>
  evidence: EvidenceRecord[]
}

const assessmentOf = (assessed: Assessment): Assessment => ({
  confidence: assessed.confidence,
  basis: assessed.basis,
  evidenceCount: assessed.evidenceCount,
  sources: [...assessed.sources]
})

/**
 * Writes the normalized model out as JSONL (spec §27) - a readable view of
 * exactly what every projection is handed. Useful for debugging and tests; the
 * canonical source is always the Markdown, never these files.
 *
 * Holds the full projected state in memory so an incremental `upsert` can
 * rewrite whole files atomically without re-reading the canonical sources.
 * Mutations only mark that state dirty; `flush` (or `close`) writes it out
 * once, so a sync of n documents rewrites each file once rather than n times.
 */
class JsonlProjection implements EntityProjection {
  readonly name = 'jsonl'

  private outputDir: string | null = null
  private readonly documents = new Map<string, DocumentRecord>()
  private readonly nodes = new Map<string, NodeRecord>()
  /** Keyed by source document id, so `remove` drops a document's edges with it. */
  private readonly edges = new Map<string, EdgeRecord[]>()
  /** Set by every mutation, cleared once the files match the in-memory state. */
  private dirty = false

  constructor(private readonly config: JsonlConfig) {}

  async init(context: ProjectionContext): Promise<void> {
    const outputDir = resolve(context.projectRoot, this.config.output)
    this.outputDir = outputDir

    // Reload what was projected before so a partial `sync` does not drop
    // records for documents it never visited. Missing files mean empty state,
    // which is what makes `rm -rf .docket/.index` safe (spec §2.2).
    const [documents, nodes, edges] = await Promise.all([
      readJsonl<DocumentRecord>(join(outputDir, DOCUMENTS_FILENAME)),
      readJsonl<NodeRecord>(join(outputDir, NODES_FILENAME)),
      readJsonl<EdgeRecord>(join(outputDir, EDGES_FILENAME))
    ])

    this.clear()
    for (const record of documents) this.documents.set(record.id, record)
    for (const record of nodes) this.nodes.set(record.id, record)
    for (const record of edges) {
      const bucket = this.edges.get(record.source)
      if (bucket) bucket.push(record)
      else this.edges.set(record.source, [record])
    }
  }

  async upsert(entity: EntityInput): Promise<void> {
    this.documents.set(entity.id, {
      id: entity.id,
      type: entity.type,
      title: entity.title,
      path: entity.path,
      paths: [...entity.paths],
      content: entity.content,
      tags: [...entity.tags]
    })

    // `index.graph: false` suppresses the graph records only (spec §21). The
    // `fts` and `vector` flags have no counterpart in this projection in v0 -
    // they are hints for the future FTS and vector projections.
    if (entity.index.graph) {
      this.nodes.set(entity.id, {
        id: entity.id,
        type: entity.type,
        title: entity.title,
        attributes: entity.attributes,
        evidence: entity.evidence,
        ...assessmentOf(entity)
      })
      this.edges.set(
        entity.id,
        entity.links.map(link => ({
          source: entity.id,
          rel: link.rel,
          target: link.target,
          ...(link.attributes ? { attributes: link.attributes } : {}),
          evidence: link.evidence,
          ...assessmentOf(link)
        }))
      )
    } else {
      this.nodes.delete(entity.id)
      this.edges.delete(entity.id)
    }

    this.dirty = true
  }

  async remove(id: string): Promise<void> {
    this.documents.delete(id)
    this.nodes.delete(id)
    this.edges.delete(id)
    this.dirty = true
  }

  /**
   * Drops this projection's files only. The output directory is shared with
   * the manifest by default, and that belongs to sync.
   */
  async reset(): Promise<void> {
    const outputDir = this.requireOutputDir()
    this.clear()
    this.dirty = false
    await Promise.all(
      [DOCUMENTS_FILENAME, NODES_FILENAME, EDGES_FILENAME].map((name) =>
        rm(join(outputDir, name), { force: true })
      )
    )
  }

  async search(query: string, limit: number): Promise<SearchAnswer> {
    return { hits: lexicalSearch(this.documents.values(), query, limit) }
  }

  async close(): Promise<void> {
    await this.flush()
  }

  private clear(): void {
    this.documents.clear()
    this.nodes.clear()
    this.edges.clear()
  }

  private requireOutputDir(): string {
    if (this.outputDir === null) {
      throw new Error('jsonl projection used before init()')
    }
    return this.outputDir
  }

  /**
   * Rewrites every file from the in-memory state. Records are sorted and object
   * keys serialized in sorted order so the same documents always produce the
   * same bytes (spec §72). Nothing derived from the run - no timestamps,
   * absolute paths or run ids - is ever written.
   */
  async flush(): Promise<void> {
    if (!this.dirty) return
    const outputDir = this.requireOutputDir()

    const documents = [...this.documents.values()].sort((a, b) => compare(a.id, b.id))
    const nodes = [...this.nodes.values()].sort((a, b) => compare(a.id, b.id))
    const edges = [...this.edges.values()].flat().sort(compareEdges)

    // Cleared before writing, from the snapshot above, so a mutation that lands
    // while the files are written marks the state dirty again.
    this.dirty = false
    try {
      await Promise.all([
        writeFileAtomic(join(outputDir, DOCUMENTS_FILENAME), toJsonl(documents)),
        writeFileAtomic(join(outputDir, NODES_FILENAME), toJsonl(nodes)),
        writeFileAtomic(join(outputDir, EDGES_FILENAME), toJsonl(edges))
      ])
    } catch (cause) {
      this.dirty = true
      throw cause
    }
  }
}

export function createJsonlProjection(config: JsonlConfig): EntityProjection {
  return new JsonlProjection(config)
}

function toJsonl(records: readonly unknown[]): string {
  return records.length === 0 ? '' : `${records.map(stableStringify).join('\n')}\n`
}

/** Invalid or absent derived files are treated as empty - the index is disposable. */
async function readJsonl<T>(filePath: string): Promise<T[]> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return []
  }

  try {
    return raw
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as T)
  } catch {
    return []
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Entities carry one link per (source, rel, target), so that triple orders edges totally. */
function compareEdges(a: EdgeRecord, b: EdgeRecord): number {
  return compare(a.source, b.source) || compare(a.rel, b.rel) || compare(a.target, b.target)
}
