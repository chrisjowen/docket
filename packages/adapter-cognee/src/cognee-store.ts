import { canonicalPassage, checkoutScope, type NativeHit, type NativeIdentity, type NativeRecord, type NativeStore } from '@docket/adapter-kit'
import type { CanonicalInput, CanonicalReader, EntityInput, InputKind } from '@docket/contracts'

import { CogneeHttpError, contentHash, type CogneeChunk, type CogneeClient, type CogneeData, type RequestOptions } from './cognee-client.js'
import { isDatasetName } from './config.js'

const KINDS: readonly InputKind[] = ['entity', 'observation', 'document']

/** The dataset a checkout's scope is filed in unless configured: unique to the checkout, as mem0's scope is. */
export const defaultDataset = (projectRoot: string, scope: string): string => {
  const base = checkoutScope(projectRoot)
  const name = (scope === 'default' ? base : `${base}-${scope}`).replace(/[.\s]+/g, '-')
  return isDatasetName(name) ? name : 'docket'
}

/**
 * The identity docket files with each data item, as its external metadata:
 * the dataset and scope it belongs to, and the canonical input and revision
 * it holds. cognee returns it on every chunk a search finds, so a hit maps
 * back to its canonical record without a lookup.
 */
export const identityMetadata = (dataset: string, scope: string, identity: NativeIdentity): Record<string, string> => ({
  docket_dataset: dataset,
  docket_scope: scope,
  docket_kind: identity.kind,
  docket_id: identity.id,
  docket_revision: identity.revision
})

/**
 * The identity a data item's or chunk's metadata holds, or undefined for one
 * docket did not file in this dataset and scope. A search can return chunks
 * of other datasets when cognee runs without access control, so every hit is
 * checked here.
 */
export const parseIdentity = (dataset: string, scope: string, value: unknown): NativeIdentity | undefined => {
  let metadata = value
  if (typeof value === 'string') {
    try {
      metadata = JSON.parse(value) as unknown
    } catch {
      return undefined
    }
  }
  if (metadata === null || typeof metadata !== 'object') return undefined
  const { docket_dataset, docket_scope, docket_kind, docket_id, docket_revision } = metadata as Record<string, unknown>
  if (docket_dataset !== dataset || docket_scope !== scope) return undefined
  if (typeof docket_kind !== 'string' || !(KINDS as readonly string[]).includes(docket_kind)) return undefined
  if (typeof docket_id !== 'string' || docket_id === '' || typeof docket_revision !== 'string' || docket_revision === '') return undefined
  return { kind: docket_kind as InputKind, id: docket_id, revision: docket_revision }
}

/**
 * What a linked entity is called, for the text cognify reads: its title when
 * the canonical files hold it, otherwise its id.
 */
const titleOf = async (canonical: CanonicalReader, id: string): Promise<string> => {
  const record = await canonical.get('entity', id).catch(() => undefined)
  return record?.kind === 'entity' && record.title.trim() !== '' ? record.title : id
}

/**
 * An entity as cognify reads it: its title, type, body, what it links to and
 * its tags. Links name their target by title - "owned_by: Payments team" - so
 * the graph cognify extracts joins the entities they name, and a question
 * about a neighbour can find the entity that links to it. Ids, confidence and
 * evidence stay out: they say nothing about what the entity is about, and the
 * metadata carries the id.
 */
export const renderEntity = async (entity: EntityInput, canonical: CanonicalReader): Promise<string> => {
  const lines = [`# ${entity.title}`, entity.type.replace(/_/g, ' ')]
  const body = entity.content.trim()
  if (body) lines.push('', body)
  if (entity.links.length > 0) {
    lines.push('', 'Links:')
    for (const link of entity.links) lines.push(`- ${link.rel.replace(/_/g, ' ')}: ${await titleOf(canonical, link.target)}`)
  }
  if (entity.tags.length > 0) lines.push('', `Tags: ${entity.tags.join(', ')}`)
  return `${lines.join('\n')}\n`
}

/**
 * Appended to an input's text only when another input already holds the very
 * same text: cognee keeps one data item per content hash, so the second would
 * otherwise be filed under the first one's identity.
 */
export const disambiguation = (identity: NativeIdentity): string => `\n(docket ${identity.kind} ${identity.id})\n`

/** A chunk's text without the disambiguation line, which only the last chunk of an item carries. */
export const stripDisambiguation = (text: string, identity: NativeIdentity): string => {
  const line = disambiguation(identity)
  return text.endsWith(line) ? text.slice(0, -line.length) : text
}

/** A file name cognee shows for the item: readable, with nothing a multipart header needs escaped. */
const fileName = (identity: NativeIdentity): string => `docket-${identity.kind}-${identity.id}`.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 200) + '.md'

const sameIdentity = (a: NativeIdentity, b: NativeIdentity): boolean => a.kind === b.kind && a.id === b.id && a.revision === b.revision

/**
 * The results of a search, however cognee 1.6.8 wraps them: a bare list with
 * access control off, one `{ dataset_id, search_result }` per dataset with it on.
 */
export const searchResults = (answer: unknown): unknown[] =>
  (Array.isArray(answer) ? answer : []).flatMap((item) => {
    const wrapped = (item as { search_result?: unknown } | null)?.search_result
    return wrapped === undefined ? [item] : Array.isArray(wrapped) ? wrapped : [wrapped]
  })

export interface CogneeSearch {
  hits: NativeHit[]
  /** Whether cognee may hold more matches than it returned. */
  more: boolean
  /** Chunks left out because another dataset or scope filed them. */
  foreign: number
}

/**
 * One cognee dataset, through its REST API (pinned: cognee 1.6.8). Each
 * canonical input is one data item - a Markdown file - with its identity in
 * the item's external metadata, so the mapping is read back from cognee
 * itself. Adding does not make an item searchable: `cognify` does, once per
 * batch.
 */
export class CogneeStore implements NativeStore {
  /** The dataset's id, once known; cognee creates the dataset on the first add. */
  private datasetId: string | undefined

  constructor(
    private readonly client: CogneeClient,
    readonly dataset: string,
    private readonly scope: string,
    private readonly canonical: CanonicalReader
  ) {}

  /** The dataset's id, or undefined while nothing has been added to it. */
  async resolveDataset(options: RequestOptions = {}): Promise<string | undefined> {
    this.datasetId ??= await this.client.findDataset(this.dataset, options)
    return this.datasetId
  }

  async list(signal?: AbortSignal): Promise<NativeRecord[]> {
    const datasetId = await this.resolveDataset({ signal })
    if (datasetId === undefined) return []
    return this.records(await this.client.listData(datasetId, { signal }))
  }

  async write(record: CanonicalInput, signal?: AbortSignal): Promise<NativeRecord> {
    const identity = { kind: record.kind, id: record.id, revision: record.revision }
    const text = record.kind === 'entity' ? await renderEntity(record, this.canonical) : canonicalPassage(record).text
    // The plain text first; with the disambiguation line if another input already holds that text.
    for (const candidate of [text, `${text}${disambiguation(identity)}`]) {
      const datasetId = await this.resolveDataset({ signal })
      const existing = datasetId === undefined ? [] : await this.client.listData(datasetId, { signal, hash: contentHash(candidate) })
      const holders = existing.map((item) => ({ item, held: parseIdentity(this.dataset, this.scope, item.externalMetadata) }))
      const current = holders.find(({ held }) => held !== undefined && sameIdentity(held, identity))
      if (current !== undefined) return { nativeId: current.item.id, identity }
      // An earlier revision of this input with the same text: cognee would keep its metadata, so it goes first.
      const earlier = holders.filter(({ held }) => held !== undefined && held.kind === identity.kind && held.id === identity.id)
      if (earlier.length < holders.length) continue
      for (const { item } of earlier) await this.client.deleteData(datasetId as string, item.id, { signal })
      const added = await this.client.add(
        { name: this.dataset, id: datasetId },
        { name: fileName(identity), text: candidate, metadata: identityMetadata(this.dataset, this.scope, identity) },
        { signal }
      )
      this.datasetId = added.datasetId
      return { nativeId: added.dataId, identity }
    }
    throw new CogneeHttpError(`cognee already holds the text of ${record.kind} ${record.id} under another identity`, 409, false)
  }

  async delete(record: NativeRecord, signal?: AbortSignal): Promise<void> {
    const datasetId = await this.resolveDataset({ signal })
    if (datasetId !== undefined) await this.client.deleteData(datasetId, record.nativeId, { signal })
  }

  /** Cognifies whatever was added and not yet cognified. Nothing to do while the dataset does not exist. */
  async cognify(options: RequestOptions = {}): Promise<void> {
    const datasetId = await this.resolveDataset(options)
    if (datasetId !== undefined) await this.client.cognify(datasetId, options)
  }

  /** How many data items the dataset holds, docket's or not; undefined while it does not exist. */
  async count(options: RequestOptions = {}): Promise<number | undefined> {
    const datasetId = await this.resolveDataset(options)
    return datasetId === undefined ? undefined : this.client.countData(datasetId, options)
  }

  /**
   * cognee's `CHUNKS` search of the dataset: the chunks closest to the
   * question, each mapped back to the input it was cut from. Chunks of
   * other datasets, and those further than `maxDistance`, are left out.
   */
  async search(question: string, limit: number, options: RequestOptions & { maxDistance?: number | undefined } = {}): Promise<CogneeSearch> {
    const datasetId = await this.resolveDataset(options)
    if (datasetId === undefined) return { hits: [], more: false, foreign: 0 }
    const asked = Math.max(1, Math.min(limit, 100))
    const answer = await this.client.search({ search_type: 'CHUNKS', dataset_ids: [datasetId], query: question, top_k: asked }, options)
    const chunks = searchResults(answer).filter((chunk): chunk is CogneeChunk => typeof (chunk as { id?: unknown })?.id === 'string' && typeof (chunk as { text?: unknown }).text === 'string')
    const hits: NativeHit[] = []
    let foreign = 0
    for (const chunk of chunks) {
      const identity = parseIdentity(this.dataset, this.scope, chunk.external_metadata)
      const score = typeof chunk.score === 'number' && Number.isFinite(chunk.score) ? chunk.score : undefined
      if (identity === undefined || (options.maxDistance !== undefined && score !== undefined && score > options.maxDistance)) {
        foreign += identity === undefined ? 1 : 0
        continue
      }
      hits.push({ nativeId: chunk.id, identity, text: stripDisambiguation(chunk.text, identity), ...(score !== undefined ? { score } : {}) })
    }
    return { hits, more: chunks.length >= asked || limit > asked, foreign }
  }

  /** Each item's identity, where it carries one of this dataset and scope. */
  private records(items: readonly CogneeData[]): NativeRecord[] {
    const records: NativeRecord[] = []
    for (const item of items) {
      const identity = parseIdentity(this.dataset, this.scope, item.externalMetadata)
      if (identity !== undefined) records.push({ nativeId: item.id, identity })
    }
    return records
  }
}

/** Whether a failed request is worth retrying: a server that is down or busy comes back; a refused request does not. */
export const retryableCogneeError = (error: unknown): boolean => (error instanceof CogneeHttpError ? error.retryable : true)
