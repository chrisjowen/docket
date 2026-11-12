import type { Chat } from '@docket/adapter-kit'

import { LOW_CONFIDENCE } from '../../src/query/synthesis.js'
import { queryTerms, tokenize, type Embedder, type Engine, type LexicalHit, type Scored, type VectorIndex } from './engine.js'

/*
 * The search strategies compared (README.md). Each answers a query with
 * entity ids, most relevant first; an empty answer says nothing in the docket
 * answers it. Only relevance to the query decides what is returned - except
 * in `current+confidence`, which reproduces filtering on node confidence to
 * show what that does and does not change.
 */

/** What a strategy returns for one query. */
export interface Answer {
  ids: string[]
  /** Model calls made answering it. */
  llmCalls: number
  /** Answered from a cache of an earlier identical query. */
  cached?: boolean
}

export interface Strategy {
  readonly name: string
  readonly description: string
  search(query: string): Promise<Answer>
}

/** The two single-pass sources' raw hits, before any floor. */
export interface Retrieval {
  semantic: Scored[]
  lexical: LexicalHit[]
}

/** The relevance floor: the least cosine similarity a semantic hit needs, and the least share of the query a lexical hit must cover. */
export interface FloorParams {
  semantic: number
  coverage: number
}

/** Hits each source returns before the floor. docket_search asks each projection for 10. */
export const SOURCE_LIMIT = 10
/** The most a fused answer returns. */
export const ANSWER_LIMIT = 10

export const floored = (retrieval: Retrieval, floor: FloorParams): Retrieval => ({
  semantic: retrieval.semantic.filter((hit) => hit.score >= floor.semantic),
  lexical: retrieval.lexical.filter((hit) => hit.coverage >= floor.coverage)
})

/** Semantic hits, then lexical hits not already listed: how docket_search lists matches across sources today. */
export const concatenated = (retrieval: Retrieval): string[] => [...new Set([...retrieval.semantic, ...retrieval.lexical].map((hit) => hit.id))]

/** Reciprocal rank fusion (Cormack et al., 2009): one ranking from several, by rank alone, so scores need not be comparable. */
export const fused = (lists: readonly (readonly { id: string }[])[], limit = ANSWER_LIMIT, k = 60): string[] => {
  const scores = new Map<string, number>()
  for (const list of lists) list.forEach((hit, rank) => scores.set(hit.id, (scores.get(hit.id) ?? 0) + 1 / (k + rank + 1)))
  return [...scores]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([id]) => id)
}

/** The two sources, as docket_search asks them: semantic over mem0's text, with nomic-embed-text's query prefix, and full-text. */
export const retrieve = async (engine: Engine, vectors: VectorIndex, embedder: Embedder, query: string, limit = SOURCE_LIMIT): Promise<Retrieval> => {
  const [vector] = await embedder.embed([`search_query: ${query}`])
  return { semantic: vectors.search(vector as Float32Array, limit), lexical: engine.bm25.search(query, limit) }
}

/** Today's docket_search over mem0 and Neo4j: every hit of both sources, semantic first, no floor. */
export const currentStrategy = (engine: Engine, vectors: VectorIndex, embedder: Embedder): Strategy => ({
  name: 'current',
  description: 'Single pass: mem0-style semantic top 10, then full-text top 10, no floor - docket_search today.',
  search: async (query) => ({ ids: concatenated(await retrieve(engine, vectors, embedder, query)), llmCalls: 0 })
})

/** Today's search with hits below the low-confidence line dropped: confidence, not relevance. */
export const confidenceStrategy = (engine: Engine, vectors: VectorIndex, embedder: Embedder): Strategy => ({
  name: 'current+confidence',
  description: `As current, dropping entities whose node confidence is below ${LOW_CONFIDENCE}: the "drop low-confidence results" change.`,
  search: async (query) => ({
    ids: concatenated(await retrieve(engine, vectors, embedder, query)).filter((id) => (engine.byId.get(id)?.confidence ?? 0) >= LOW_CONFIDENCE),
    llmCalls: 0
  })
})

/** Today's search with a relevance floor on each source, listed as today. */
export const floorStrategy = (engine: Engine, vectors: VectorIndex, embedder: Embedder, floor: FloorParams): Strategy => ({
  name: 'floor',
  description: `As current, keeping semantic hits with cosine >= ${floor.semantic} and full-text hits covering >= ${floor.coverage} of the query's idf.`,
  search: async (query) => ({ ids: concatenated(floored(await retrieve(engine, vectors, embedder, query), floor)), llmCalls: 0 })
})

/** The floor, with the two sources fused by rank and cut to 10. */
export const floorRrfStrategy = (engine: Engine, vectors: VectorIndex, embedder: Embedder, floor: FloorParams): Strategy => ({
  name: 'floor+rrf',
  description: `Relevance floor (cosine >= ${floor.semantic}, coverage >= ${floor.coverage}) on top 20 of each source, fused by reciprocal rank, top 10.`,
  search: async (query) => {
    const kept = floored(await retrieve(engine, vectors, embedder, query, 2 * SOURCE_LIMIT), floor)
    return { ids: fused([kept.semantic, kept.lexical]), llmCalls: 0 }
  }
})

/** Words after "who is" that say which one, not who: "who is our contact". */
const DETERMINERS = new Set(['a', 'an', 'the', 'our', 'my', 'your', 'their', 'his', 'her', 'its', 'this', 'that', 'these', 'those'])

/** A code or an acronym (`IL-6`, `DNA`), which an entity may spell differently, rather than a name. */
const codeLike = (word: string): boolean => /\p{N}/u.test(word) || (/\p{L}.*\p{L}/u.test(word) && word === word.toUpperCase())

/**
 * Words in the query that name something - a capitalised word that does not
 * start a sentence, or whatever follows "who is" - which no entity holds:
 * a question about something the docket has never recorded.
 */
export const unknownNames = (engine: Engine, query: string): string[] => {
  const named = new Set<string>()
  for (const match of query.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const before = query.slice(0, match.index).trimEnd()
    if (before !== '' && !/[.?!:]$/.test(before) && /^\p{Lu}/u.test(match[0])) named.add(match[0])
  }
  const whoIs = /\bwho(?:'s|’s| is| was)\s+([\p{L}\p{N}'’-]+(?:\s+\p{Lu}[\p{L}\p{N}'’-]*)*)/iu.exec(query)
  const whoWords = whoIs?.[1]?.split(/\s+/) ?? []
  // "who is our contact at X" describes someone rather than naming them; X is caught as a capitalised word.
  if (!DETERMINERS.has(whoWords[0]?.toLowerCase() ?? '')) for (const word of whoWords) named.add(word)
  return [...named]
    .filter((word) => !codeLike(word))
    .flatMap((word) => tokenize(word))
    .filter((token) => queryTerms(token).length > 0 && !engine.bm25.has(token))
}

/** The query-time half of the precached strategy: the name gate, then floored fusion over the contextual index. */
export const precachedAnswer = (engine: Engine, retrieval: Retrieval, query: string, floor: FloorParams): string[] => {
  if (unknownNames(engine, query).length > 0) return []
  const kept = floored(retrieval, floor)
  return fused([kept.semantic, kept.lexical])
}

/**
 * Everything that does not depend on the question computed at sync time:
 * embeddings of each entity with its links' titles (`contextualText`), the
 * full-text index and its vocabulary, and a cache of answers already given.
 * A query is then one embedding, a vocabulary check and one fusion.
 */
export const precachedStrategy = (engine: Engine, contextual: VectorIndex, embedder: Embedder, floor: FloorParams, name = 'precached'): Strategy => {
  const cache = new Map<string, string[]>()
  return {
    name,
    description:
      `Sync-time link-aware embeddings and vocabulary; a query naming a word no entity holds returns nothing; ` +
      `otherwise floor (cosine >= ${floor.semantic}, coverage >= ${floor.coverage}) and RRF, top 10. Repeated queries come from a cache.`,
    search: async (query) => {
      const key = queryTerms(query).join(' ')
      const hit = cache.get(key)
      if (hit) return { ids: hit, llmCalls: 0, cached: true }
      const ids = unknownNames(engine, query).length > 0 ? [] : precachedAnswer(engine, await retrievePrecached(engine, contextual, embedder, query), query, floor)
      cache.set(key, ids)
      return { ids, llmCalls: 0 }
    }
  }
}

export const retrievePrecached = async (engine: Engine, contextual: VectorIndex, embedder: Embedder, query: string): Promise<Retrieval> => {
  const [vector] = await embedder.embed([`search_query: ${query}`])
  return { semantic: contextual.search(vector as Float32Array, 2 * SOURCE_LIMIT), lexical: engine.bm25.search(query, 2 * SOURCE_LIMIT) }
}

/** The JSON object in a model's reply, or null. */
const jsonIn = (text: string): Record<string, unknown> | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

/** A record's body for the judge, without its heading, which the listing already shows as the title. */
const excerpt = (text: string, max = 600): string => {
  const flat = text.trimStart().replace(/^#.*\n/, '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const PLAN_SYSTEM = (types: readonly string[]) =>
  [
    'You plan searches over a knowledge base of typed records.',
    `Record types: ${types.join(', ')}.`,
    'Reply with JSON only, in this shape:',
    '{"searches": ["1 to 3 short keyword searches that would find the records answering the question"],',
    ' "types": ["the record types likely to hold the answer, from the list"],',
    ' "followLinks": true if answering needs a second record linked to the first (who owns X, who works at Y), else false}'
  ].join('\n')

const JUDGE_SYSTEM = [
  'You decide which records answer a question about a knowledge base.',
  'A record is relevant only if it is about exactly what the question asks: the same person, organisation, product or thing - not one with a similar name, and not merely the same topic.',
  'If no record is relevant, the answer is an empty list: the knowledge base does not hold it.',
  'Reply with JSON only: {"relevant": ["record id", ...]}, most relevant first.'
].join('\n')

/**
 * A model plans searches, the single-pass sources run each one (and follow
 * links when the plan says to), and the model judges which of the candidates
 * are about what was asked. Two model calls per query.
 */
export const agenticStrategy = (engine: Engine, vectors: VectorIndex, embedder: Embedder, chat: Chat, model: string): Strategy => ({
  name: 'agentic',
  description: `${model} plans 1-3 searches and whether to follow links, the single-pass sources run them (RRF), and ${model} judges which candidates answer the question.`,
  search: async (question) => {
    const planReply = await chat({ system: PLAN_SYSTEM(engine.types), user: `Question: ${question}` })
    const plan = jsonIn(planReply) ?? {}
    const searches = [question, ...strings(plan.searches).slice(0, 3)]
    const types = new Set(strings(plan.types))
    const lists = await Promise.all(
      searches.map(async (search) => {
        const retrieval = await retrieve(engine, vectors, embedder, search)
        return fused([retrieval.semantic, retrieval.lexical], SOURCE_LIMIT).map((id) => ({ id }))
      })
    )
    let candidates = fused(lists, 20)
    // The planned types first, so the judge sees them before the cut.
    candidates = [...candidates.filter((id) => types.has(engine.byId.get(id)?.type ?? '')), ...candidates.filter((id) => !types.has(engine.byId.get(id)?.type ?? ''))]
    if (plan.followLinks === true) {
      for (const id of candidates.slice(0, 5)) {
        for (const neighbour of (engine.neighbours.get(id) ?? []).slice(0, 3)) if (!candidates.includes(neighbour.id)) candidates.push(neighbour.id)
      }
    }
    candidates = candidates.slice(0, 24)
    const listing = candidates
      .map((id) => {
        const entity = engine.byId.get(id)
        return entity ? `[${id}] (${entity.type}) ${entity.title} - ${excerpt(entity.content)}` : null
      })
      .filter(Boolean)
      .join('\n')
    const judged = jsonIn(await chat({ system: JUDGE_SYSTEM, user: `Question: ${question}\n\nRecords:\n${listing}` })) ?? {}
    const allowed = new Set(candidates)
    return { ids: [...new Set(strings(judged.relevant).filter((id) => allowed.has(id)))].slice(0, ANSWER_LIMIT), llmCalls: 2 }
  }
})
