import { basename } from 'node:path'

import type { Mem0ProjectionConfig } from '../../config/config.js'
import type { MemoryDocument } from '../../model/index.js'
import type { MemoryProjection, ProjectionContext } from '../projection.js'
import { connectMem0, type Mem0Backend, type Mem0Scope } from './backend.js'

/** Metadata key tying a mem0 memory back to the canonical document id. */
export const DOCUMENT_ID_KEY = 'memory_id'

export type Mem0Connector = (
  config: Mem0ProjectionConfig,
  scope: Mem0Scope
) => Promise<Mem0Backend>

/**
 * One scope per repository by default, so `reset` - which deletes the whole
 * scope - can never touch memories another repository or tool put in mem0.
 */
export const defaultScope = (projectRoot: string): Mem0Scope => ({
  agentId: `team-memory-${basename(projectRoot).replace(/\s+/g, '-')}`
})

/** The text mem0 embeds and returns on search: what an agent should read. */
export const renderDocument = (document: MemoryDocument): string => {
  const lines = [`# ${document.title}`, `${document.type} ${document.id}`]
  const body = document.content.trim()
  if (body) lines.push('', body)
  if (document.links.length > 0) {
    lines.push('', 'Links:')
    for (const link of document.links) lines.push(`- ${link.rel} ${link.target}`)
  }
  if (document.tags.length > 0) lines.push('', `Tags: ${document.tags.join(', ')}`)
  return `${lines.join('\n')}\n`
}

/** Scalar metadata only, so it filters the same way on the hosted and self-hosted stores. */
export const documentMetadata = (document: MemoryDocument): Record<string, unknown> => ({
  [DOCUMENT_ID_KEY]: document.id,
  memory_type: document.type,
  memory_path: document.path,
  memory_hash: document.hash,
  ...(document.tags.length > 0 ? { memory_tags: document.tags.join(',') } : {}),
  ...(document.provenance?.authority !== undefined
    ? { authority: document.provenance.authority }
    : {}),
  ...(document.provenance?.confidence !== undefined
    ? { confidence: document.provenance.confidence }
    : {}),
  ...(document.provenance?.capturedBy !== undefined
    ? { captured_by: document.provenance.capturedBy }
    : {})
})

/**
 * Projects each document into mem0 as one verbatim memory (`infer: false`), so
 * a rebuild reproduces exactly what the Markdown says and costs no LLM calls.
 * Documents with `index.vector: false` are kept out (spec §21).
 *
 * mem0 assigns memory ids, and the hosted API may accept a write before it can
 * report them. So nothing is persisted locally: which memories belong to which
 * document is read back from mem0 via the `memory_id` metadata, and re-read
 * whenever an add did not report its ids.
 */
class Mem0Projection implements MemoryProjection {
  readonly name = 'mem0'

  private backend: Mem0Backend | null = null
  /** Document id to its memory ids. `null` until first read from mem0. */
  private owned: Map<string, string[]> | null = null
  /** Documents whose last add did not report ids; their entry above cannot be trusted. */
  private readonly unconfirmed = new Set<string>()

  constructor(
    private readonly config: Mem0ProjectionConfig,
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

  async upsert(document: MemoryDocument): Promise<void> {
    await this.remove(document.id)
    if (!document.index.vector) return

    const ids = await this.requireBackend().add(
      renderDocument(document),
      documentMetadata(document)
    )
    const owned = await this.ownership()
    owned.set(document.id, ids)
    if (ids.length === 0) this.unconfirmed.add(document.id)
  }

  async remove(id: string): Promise<void> {
    if (this.unconfirmed.has(id)) this.owned = null
    const owned = await this.ownership()
    const backend = this.requireBackend()
    for (const memoryId of owned.get(id) ?? []) await backend.delete(memoryId)
    owned.delete(id)
    this.unconfirmed.delete(id)
  }

  /** Deletes the whole scope - which is why the default scope is per repository. */
  async reset(): Promise<void> {
    await this.requireBackend().deleteAll()
    this.owned = new Map()
    this.unconfirmed.clear()
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
  config: Mem0ProjectionConfig,
  connect: Mem0Connector = connectMem0
): MemoryProjection {
  return new Mem0Projection(config, connect)
}
