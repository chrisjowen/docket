import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { readIndex, type IndexedEdge, type IndexedEntity } from './corpus.js'

/*
 * What every strategy searches with, built once from a synced docket's JSONL
 * index: a BM25 index scored exactly as the JSONL adapter's lexicalSearch
 * scores (its stand-in for Neo4j's full-text index), entity embeddings for
 * semantic search (the stand-in for mem0), and the links between entities.
 */

/** As adapter-jsonl's lexical-search.ts: the same stop words, field weights and BM25 constants. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from',
  'how', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'this', 'to', 'use', 'what', 'when',
  'where', 'which', 'who', 'why', 'with'
])
const WEIGHTS = { title: 3, label: 2, content: 1 } as const
const K1 = 1.2
const B = 0.75

export const tokenize = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1)

/** The query terms BM25 scores: tokens that are not stop words, once each. */
export const queryTerms = (query: string): string[] => [...new Set(tokenize(query).filter((term) => !STOP_WORDS.has(term)))]

export interface Scored {
  id: string
  score: number
}

/** A lexical hit, with how much of the query it covers: matched terms' idf over all terms' idf. */
export interface LexicalHit extends Scored {
  coverage: number
}

/**
 * BM25 over title, id and tags, and body, with prefix matching - a term
 * matches every word it begins - exactly as lexicalSearch scores, but with the
 * documents tokenised once rather than on every query.
 */
export class Bm25Index {
  private readonly ids: string[] = []
  private readonly lengths: number[] = []
  private readonly averageLength: number
  /** Sorted vocabulary, so the words a term prefixes are one contiguous range. */
  private readonly words: string[]
  private readonly postings = new Map<string, Map<number, number>>()

  constructor(entities: readonly { id: string; title: string; content: string; tags: string[] }[]) {
    entities.forEach((entity, doc) => {
      this.ids.push(entity.id)
      let length = 0
      const fields = [
        { words: tokenize(entity.title), weight: WEIGHTS.title },
        { words: tokenize(`${entity.id} ${entity.tags.join(' ')}`), weight: WEIGHTS.label },
        { words: tokenize(entity.content), weight: WEIGHTS.content }
      ]
      for (const field of fields) {
        length += field.weight * field.words.length
        for (const word of field.words) {
          const posting = this.postings.get(word) ?? new Map<number, number>()
          posting.set(doc, (posting.get(doc) ?? 0) + field.weight)
          this.postings.set(word, posting)
        }
      }
      this.lengths.push(length)
    })
    this.words = [...this.postings.keys()].sort()
    this.averageLength = this.lengths.reduce((sum, length) => sum + length, 0) / Math.max(1, this.lengths.length)
  }

  /** Whether any document holds a word beginning with `term`. */
  has(term: string): boolean {
    const at = this.lowerBound(term)
    return (this.words[at] ?? '').startsWith(term)
  }

  private lowerBound(term: string): number {
    let low = 0
    let high = this.words.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if ((this.words[mid] as string) < term) low = mid + 1
      else high = mid
    }
    return low
  }

  /** Field-weighted frequency of `term` in each document that has it. */
  private frequencies(term: string): Map<number, number> {
    const frequency = new Map<number, number>()
    for (let at = this.lowerBound(term); at < this.words.length && (this.words[at] as string).startsWith(term); at += 1) {
      for (const [doc, count] of this.postings.get(this.words[at] as string) ?? []) frequency.set(doc, (frequency.get(doc) ?? 0) + count)
    }
    return frequency
  }

  search(query: string, limit: number): LexicalHit[] {
    const terms = queryTerms(query)
    if (terms.length === 0 || this.ids.length === 0) return []
    const n = this.ids.length
    const scores = new Map<number, { score: number; covered: number }>()
    const idfs = terms.map((term) => {
      const frequency = this.frequencies(term)
      const idf = Math.log(1 + (n - frequency.size + 0.5) / (frequency.size + 0.5))
      for (const [doc, tf] of frequency) {
        const norm = K1 * (1 - B + (B * (this.lengths[doc] as number)) / (this.averageLength || 1))
        const entry = scores.get(doc) ?? { score: 0, covered: 0 }
        entry.score += idf * ((tf * (K1 + 1)) / (tf + norm))
        entry.covered += idf
        scores.set(doc, entry)
      }
      return idf
    })
    const total = idfs.reduce((sum, idf) => sum + idf, 0) || 1
    return [...scores]
      .map(([doc, { score, covered }]) => ({ id: this.ids[doc] as string, score, coverage: covered / total }))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, limit)
  }
}

/** An embedding model behind Ollama's /api/embed. */
export interface Embedder {
  readonly name: string
  embed(texts: readonly string[]): Promise<Float32Array[]>
}

/** The most of a text the embedder is given: nomic-embed-text reads 2,048 tokens by default. */
const EMBED_CHARS = 2000

export const ollamaEmbedder = (url: string, model: string): Embedder => ({
  name: `ollama:${model}`,
  async embed(texts) {
    const response = await fetch(`${url.replace(/\/+$/, '')}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts.map((text) => text.slice(0, EMBED_CHARS)), truncate: true })
    })
    if (!response.ok) throw new Error(`Ollama ${model} embed failed: ${response.status} ${await response.text()}`)
    const { embeddings } = (await response.json()) as { embeddings: number[][] }
    return embeddings.map(normalise)
  }
})

const normalise = (vector: readonly number[] | Float32Array): Float32Array => {
  let norm = 0
  for (const value of vector) norm += value * value
  norm = Math.sqrt(norm) || 1
  return Float32Array.from(vector, (value) => value / norm)
}

/** Unit vectors, searched by brute-force cosine: exact, and fast enough at these sizes. */
export class VectorIndex {
  constructor(
    readonly ids: readonly string[],
    private readonly vectors: readonly Float32Array[]
  ) {}

  search(query: Float32Array, limit: number): Scored[] {
    const scored: Scored[] = this.vectors.map((vector, index) => {
      let dot = 0
      for (let i = 0; i < vector.length; i += 1) dot += (vector[i] as number) * (query[i] as number)
      return { id: this.ids[index] as string, score: dot }
    })
    return scored.sort((a, b) => b.score - a.score).slice(0, limit)
  }
}

/**
 * Embeds `texts` by id, reusing what an earlier run cached under `cacheDir`
 * for the same model and text: entity embeddings are computed once, as a
 * vector store would hold them.
 */
export const embedAll = async (
  embedder: Embedder,
  texts: ReadonlyMap<string, string>,
  cacheDir: string,
  onProgress?: (done: number, total: number) => void
): Promise<VectorIndex> => {
  await mkdir(cacheDir, { recursive: true })
  const keyOf = (text: string): string => createHash('sha256').update(`${embedder.name}\n${text}`).digest('hex').slice(0, 32)
  const cacheFile = join(cacheDir, `${embedder.name.replace(/[^a-z0-9.-]+/gi, '_')}.cache`)
  const cache = new Map<string, Float32Array>()
  if (existsSync(cacheFile)) {
    const buffer = await readFile(cacheFile)
    const dims = buffer.readUInt32LE(0)
    for (let at = 4; at < buffer.length; at += 32 + dims * 4) {
      const key = buffer.subarray(at, at + 32).toString('latin1')
      cache.set(key, new Float32Array(buffer.buffer.slice(buffer.byteOffset + at + 32, buffer.byteOffset + at + 32 + dims * 4)))
    }
  }
  const missing = [...new Set([...texts.values()].filter((text) => !cache.has(keyOf(text))))]
  for (let start = 0; start < missing.length; start += 64) {
    const batch = missing.slice(start, start + 64)
    const vectors = await embedder.embed(batch)
    batch.forEach((text, index) => cache.set(keyOf(text), vectors[index] as Float32Array))
    onProgress?.(Math.min(start + 64, missing.length), missing.length)
  }
  if (missing.length > 0) {
    const dims = (cache.values().next().value as Float32Array).length
    const parts: Buffer[] = [Buffer.alloc(4)]
    parts[0]?.writeUInt32LE(dims, 0)
    for (const [key, vector] of cache) parts.push(Buffer.from(key, 'latin1'), Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength))
    await writeFile(cacheFile, Buffer.concat(parts))
  }
  const ids = [...texts.keys()]
  return new VectorIndex(ids, ids.map((id) => cache.get(keyOf(texts.get(id) as string)) as Float32Array))
}

/** A neighbour one link away, either direction. */
export interface Neighbour {
  id: string
  rel: string
  direction: 'out' | 'in'
}

/** A synced docket, loaded for searching. */
export class Engine {
  readonly byId: Map<string, IndexedEntity>
  readonly neighbours = new Map<string, Neighbour[]>()
  readonly bm25: Bm25Index

  private constructor(
    readonly dir: string,
    readonly entities: IndexedEntity[],
    readonly edges: IndexedEdge[],
    readonly types: string[]
  ) {
    this.byId = new Map(entities.map((entity) => [entity.id, entity]))
    for (const edge of edges) {
      if (!this.byId.has(edge.source) || !this.byId.has(edge.target)) continue
      this.neighbours.set(edge.source, [...(this.neighbours.get(edge.source) ?? []), { id: edge.target, rel: edge.rel, direction: 'out' }])
      this.neighbours.set(edge.target, [...(this.neighbours.get(edge.target) ?? []), { id: edge.source, rel: edge.rel, direction: 'in' }])
    }
    this.bm25 = new Bm25Index(entities)
  }

  /** `types`: the ontology's resource types, which a docket_search reply lists today whether or not anything has them. */
  static async open(dir: string, types: string[]): Promise<Engine> {
    const { entities, edges } = await readIndex(dir)
    return new Engine(dir, entities, edges, types)
  }
}

/**
 * The text mem0 embeds for an entity, as adapter-mem0's renderDocument writes
 * it - title, type, body and tags - after nomic-embed-text's document
 * prefix, as its `prefixes` config adds it.
 */
export const mem0Text = (entity: IndexedEntity): string => {
  const lines = [`search_document: # ${entity.title}`, entity.type]
  if (entity.content.trim()) lines.push('', entity.content.trim())
  if (entity.tags.length > 0) lines.push('', `Tags: ${entity.tags.join(', ')}`)
  return lines.join('\n')
}

/**
 * The text the precached index embeds: what the entity is and what it is
 * linked to, by title rather than id - so "who manages Northwind" can match
 * the account that names its rep - without confidence or evidence, which say
 * nothing about what the entity is about. nomic-embed-text's document prefix.
 */
export const contextualText = (engine: Engine, entity: IndexedEntity): string => {
  const links = (engine.neighbours.get(entity.id) ?? [])
    .slice(0, 12)
    .map((link) => {
      const other = engine.byId.get(link.id)
      const name = other ? `${other.title} (${other.type})` : link.id
      return link.direction === 'out' ? `${link.rel.replace(/_/g, ' ')} ${name}` : `${name} ${link.rel.replace(/_/g, ' ')} this`
    })
  return [
    `search_document: ${entity.type.replace(/_/g, ' ')}: ${entity.title}`,
    entity.content.replace(/^#.*\n/, '').trim().slice(0, 1500),
    ...(links.length > 0 ? [`Linked: ${links.join('; ')}`] : [])
  ].join('\n')
}
