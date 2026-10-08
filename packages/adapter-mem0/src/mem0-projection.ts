import type { EntityInput } from '@docket/contracts'
import {
  checkoutScope,
  stableStringify,
  type EntityProjection,
  type ProjectionContext,
  type SearchAnswer,
  type SearchHit
} from '@docket/adapter-kit'

import type { Mem0Config } from './config.js'
import { describeAssessment, describeEvidence } from './describe.js'
import { connectMem0, type Mem0Backend, type Mem0Scope } from './backend.js'

/** Metadata key tying a mem0 memory back to the canonical document id. */
export const DOCUMENT_ID_KEY = 'memory_id'

export type Mem0Connector = (
  config: Mem0Config,
  scope: Mem0Scope
) => Promise<Mem0Backend>

/**
 * One scope per checkout by default, so `reset` - which deletes the whole
 * scope - can never touch memories another checkout or tool put in mem0.
 */
export const defaultScope = (projectRoot: string): Mem0Scope => ({
  agentId: checkoutScope(projectRoot)
})

/**
 * The text mem0 embeds and returns on search: what an agent should read. One
 * memory per entity, carrying how far to trust it and exactly where it was
 * seen, so a hit can be checked without opening the file.
 */
export const renderDocument = (entity: EntityInput): string => {
  const lines = [
    `# ${entity.title}`,
    `${entity.type} ${entity.id}`,
    `Confidence: ${describeAssessment(entity)}`
  ]
  const body = entity.content.trim()
  if (body) lines.push('', body)

  const listed = new Set(entity.evidence.map(stableStringify))
  if (entity.links.length > 0) {
    lines.push('', 'Links:')
    for (const link of entity.links) {
      lines.push(`- ${link.rel} ${link.target} (confidence ${link.confidence})`)
      // Evidence the link shares with the resource is listed once, below.
      for (const evidence of link.evidence) {
        if (!listed.has(stableStringify(evidence))) lines.push(`  - ${describeEvidence(evidence)}`)
      }
    }
  }

  if (entity.evidence.length > 0) {
    lines.push('', 'Evidence:')
    for (const evidence of entity.evidence) lines.push(`- ${describeEvidence(evidence)}`)
  }

  if (entity.tags.length > 0) lines.push('', `Tags: ${entity.tags.join(', ')}`)
  return `${lines.join('\n')}\n`
}

/** Scalar metadata only, so it filters the same way on the hosted and self-hosted stores. */
export const documentMetadata = (entity: EntityInput): Record<string, unknown> => ({
  [DOCUMENT_ID_KEY]: entity.id,
  memory_type: entity.type,
  memory_path: entity.path,
  ...(entity.paths.length > 1 ? { memory_paths: entity.paths.join(',') } : {}),
  memory_hash: entity.revision,
  ...(entity.tags.length > 0 ? { memory_tags: entity.tags.join(',') } : {}),
  confidence: entity.confidence,
  confidence_basis: entity.basis,
  evidence_count: entity.evidenceCount,
  ...(entity.sources.length > 0 ? { evidence_sources: entity.sources.join(',') } : {}),
  ...(entity.provenance?.authority !== undefined
    ? { authority: entity.provenance.authority }
    : {}),
  ...(entity.provenance?.capturedBy !== undefined
    ? { captured_by: entity.provenance.capturedBy }
    : {})
})

/**
 * Projects each entity into mem0 as one verbatim memory (`infer: false`), so
 * a rebuild reproduces exactly what the Markdown says and costs no LLM calls.
 * Files that declare the same id arrive already merged, so they are one memory.
 * Documents with `index.vector: false` are kept out (spec §21).
 *
 * mem0 assigns memory ids, and the hosted API may accept a write before it can
 * report them. So nothing is persisted locally: which memories belong to which
 * document is read back from mem0 via the `memory_id` metadata, and re-read
 * whenever an add did not report its ids.
 */
class Mem0Projection implements EntityProjection {
  readonly name = 'mem0'

  private backend: Mem0Backend | null = null
  /** Document id to its memory ids. `null` until first read from mem0. */
  private owned: Map<string, string[]> | null = null
  /** Documents whose last add did not report ids; their entry above cannot be trusted. */
  private readonly unconfirmed = new Set<string>()

  constructor(
    private readonly config: Mem0Config,
    private readonly connect: Mem0Connector
  ) {}

  async init(context: ProjectionContext): Promise<void> {
    this.backend = await this.connect(
      this.config,
      this.config.scope ?? defaultScope(context.projectRoot)
    )
    this.owned = null
    this.unconfirmed.clear()
  }

  async upsert(entity: EntityInput): Promise<void> {
    await this.remove(entity.id)
    if (!entity.index.vector) return

    const ids = await this.requireBackend().add(
      renderDocument(entity),
      documentMetadata(entity)
    )
    const owned = await this.ownership()
    owned.set(entity.id, ids)
    if (ids.length === 0) this.unconfirmed.add(entity.id)
  }

  async remove(id: string): Promise<void> {
    if (this.unconfirmed.has(id)) this.owned = null
    const owned = await this.ownership()
    const backend = this.requireBackend()
    for (const memoryId of owned.get(id) ?? []) await backend.delete(memoryId)
    owned.delete(id)
    this.unconfirmed.delete(id)
  }

  /** Deletes the whole scope - which is why the default scope is per checkout. */
  async reset(): Promise<void> {
    await this.requireBackend().deleteAll()
    this.owned = new Map()
    this.unconfirmed.clear()
  }

  /**
   * mem0's own ranking, mapped back to document ids. Memories without our id
   * metadata were not projected from `.docket/` and are left out.
   */
  async search(query: string, limit: number): Promise<SearchAnswer> {
    const hits: SearchHit[] = []
    const seen = new Set<string>()
    for (const memory of await this.requireBackend().search(query, limit)) {
      const id = memory.metadata?.[DOCUMENT_ID_KEY]
      if (typeof id !== 'string' || seen.has(id)) continue
      seen.add(id)
      hits.push({ id, ...(memory.score !== undefined ? { score: memory.score } : {}) })
    }
    return { hits }
  }

  private async ownership(): Promise<Map<string, string[]>> {
    if (this.owned) return this.owned
    const owned = new Map<string, string[]>()
    for (const memory of await this.requireBackend().list()) {
      const id = memory.metadata?.[DOCUMENT_ID_KEY]
      if (typeof id !== 'string') continue
      owned.set(id, [...(owned.get(id) ?? []), memory.id])
    }
    this.owned = owned
    this.unconfirmed.clear()
    return owned
  }

  private requireBackend(): Mem0Backend {
    if (!this.backend) {
      throw new Error('mem0 projection used before init() - call ProjectionManager.init() first')
    }
    return this.backend
  }
}

export function createMem0Projection(
  config: Mem0Config,
  connect: Mem0Connector = connectMem0
): EntityProjection {
  return new Mem0Projection(config, connect)
}
