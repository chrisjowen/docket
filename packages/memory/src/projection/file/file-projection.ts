import { readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { ProjectionConfig } from '../../config/config.js'
import {
  emptyManifest,
  readManifest,
  writeFileAtomic,
  writeManifest,
  type ManifestEntry
} from '../../manifest/manifest.js'
import type { MemoryDocument } from '../../model/index.js'
import type { MemoryProjection, ProjectionContext } from '../projection.js'

export const DOCUMENTS_FILENAME = 'documents.jsonl'
export const NODES_FILENAME = 'nodes.jsonl'
export const EDGES_FILENAME = 'edges.jsonl'

/** One line of `documents.jsonl` (spec §28). */
export interface DocumentRecord {
  id: string
  type: string
  title: string
  path: string
  content: string
  tags: string[]
}

/** One line of `nodes.jsonl` (spec §29). */
export interface NodeRecord {
  id: string
  type: string
  title: string
  attributes: Record<string, unknown>
}

/** One line of `edges.jsonl` (spec §30). */
export interface EdgeRecord {
  source: string
  rel: string
  target: string
  attributes?: Record<string, unknown>
}

/**
 * Writes the normalized model out as JSONL plus a manifest (spec §27).
 *
 * Holds the full projected state in memory so an incremental `upsert` can
 * rewrite whole files atomically without re-reading the canonical sources.
 */
class FileProjection implements MemoryProjection {
  readonly name = 'file'

  private outputDir: string | null = null
  private readonly documents = new Map<string, DocumentRecord>()
  private readonly nodes = new Map<string, NodeRecord>()
  /** Keyed by source document id, so `remove` drops a document's edges with it. */
  private readonly edges = new Map<string, EdgeRecord[]>()
  private readonly manifest = new Map<string, ManifestEntry>()

  constructor(private readonly config: ProjectionConfig) {}

  async init(context: ProjectionContext): Promise<void> {
    const outputDir = resolve(context.projectRoot, this.config.output)
    this.outputDir = outputDir

    // Reload what was projected before so a partial `sync` does not drop
    // records for documents it never visited. Missing files mean empty state,
    // which is what makes `rm -rf .memory/.index` safe (spec §2.2).
    const [documents, nodes, edges, manifest] = await Promise.all([
      readJsonl<DocumentRecord>(join(outputDir, DOCUMENTS_FILENAME)),
      readJsonl<NodeRecord>(join(outputDir, NODES_FILENAME)),
      readJsonl<EdgeRecord>(join(outputDir, EDGES_FILENAME)),
      readManifest(outputDir)
    ])

    this.clear()
    for (const record of documents) this.documents.set(record.id, record)
    for (const record of nodes) this.nodes.set(record.id, record)
    for (const record of edges) {
      const bucket = this.edges.get(record.source)
      if (bucket) bucket.push(record)
      else this.edges.set(record.source, [record])
    }
    for (const [id, entry] of Object.entries(manifest.documents)) this.manifest.set(id, entry)
  }

  async upsert(document: MemoryDocument): Promise<void> {
    this.documents.set(document.id, {
      id: document.id,
      type: document.type,
      title: document.title,
      path: document.path,
      content: document.content,
      tags: [...document.tags]
    })

    // `index.graph: false` suppresses the graph records only (spec §21). The
    // `fts` and `vector` flags have no counterpart in this projection in v0 -
    // they are hints for the future FTS and vector projections.
    if (document.index.graph) {
      this.nodes.set(document.id, {
        id: document.id,
        type: document.type,
        title: document.title,
        attributes: document.attributes
      })
      this.edges.set(
        document.id,
        document.links.map(link => ({
          source: document.id,
          rel: link.rel,
          target: link.target,
          ...(link.attributes ? { attributes: link.attributes } : {})
        }))
      )
    } else {
      this.nodes.delete(document.id)
      this.edges.delete(document.id)
    }

    this.manifest.set(document.id, { path: document.path, hash: document.hash })
    await this.flush()
  }

  async remove(id: string): Promise<void> {
    this.documents.delete(id)
    this.nodes.delete(id)
    this.edges.delete(id)
    this.manifest.delete(id)
    await this.flush()
  }

  /** Drops the whole output directory; `memory rebuild` recreates it. */
  async reset(): Promise<void> {
    const outputDir = this.requireOutputDir()
    this.clear()
    await rm(outputDir, { recursive: true, force: true })
  }

  private clear(): void {
    this.documents.clear()
    this.nodes.clear()
    this.edges.clear()
    this.manifest.clear()
  }

  private requireOutputDir(): string {
    if (this.outputDir === null) {
      throw new Error('file projection used before init() - call ProjectionManager.init() first')
    }
    return this.outputDir
  }

  /**
   * Rewrites every file from the in-memory state. Records are sorted and object
   * keys serialized in sorted order so the same documents always produce the
   * same bytes (spec §72). Nothing derived from the run - no timestamps,
   * absolute paths or run ids - is ever written.
   */
  private async flush(): Promise<void> {
    const outputDir = this.requireOutputDir()

    const documents = [...this.documents.values()].sort((a, b) => compare(a.id, b.id))
    const nodes = [...this.nodes.values()].sort((a, b) => compare(a.id, b.id))
    const edges = [...this.edges.values()].flat().sort(compareEdges)

    // ponytail: whole-file rewrite per mutation. Fine at v0 scale (spec §73);
    // batch the flush if a sync of thousands of files gets slow.
    await Promise.all([
      writeFileAtomic(join(outputDir, DOCUMENTS_FILENAME), toJsonl(documents)),
      writeFileAtomic(join(outputDir, NODES_FILENAME), toJsonl(nodes)),
      writeFileAtomic(join(outputDir, EDGES_FILENAME), toJsonl(edges)),
      writeManifest(outputDir, {
        ...emptyManifest(),
        documents: Object.fromEntries(this.manifest)
      })
    ])
  }
}

export function createFileProjection(config: ProjectionConfig): MemoryProjection {
  return new FileProjection(config)
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

/** `JSON.stringify` with object keys emitted in codepoint order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => compare(a, b))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function compareEdges(a: EdgeRecord, b: EdgeRecord): number {
  return (
    compare(a.source, b.source) ||
    compare(a.rel, b.rel) ||
    compare(a.target, b.target) ||
    compare(stableStringify(a.attributes ?? null), stableStringify(b.attributes ?? null))
  )
}
