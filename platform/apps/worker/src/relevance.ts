// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'

/*
 * How `docket_search` decides what is relevant to a question, and how many
 * results to return (the search evaluation's research: the hybrid pool almost
 * always holds a relevant record, but nothing read the question and the record
 * together, and an absolute score floor or node confidence cannot say how many
 * to keep). In order: a question naming something the workspace has never
 * recorded is answered with nothing; otherwise a cross-encoder reads the
 * question with each candidate the projections found, and a small logistic
 * model over its score and the projections' own scores gives each candidate a
 * probability of being relevant: a question whose best candidate is not
 * relevant enough is answered with nothing, and otherwise the candidates above
 * a lower bar and close enough to the best are kept. Node confidence is no
 * part of it: it says how well a record is supported, not whether it answers
 * the question.
 */

/** As docket's lexical search: words too common to say what a question is about. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from',
  'how', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'this', 'to', 'use', 'what', 'when',
  'where', 'which', 'who', 'why', 'with',
])

/** The words of a text, lower-cased, two letters or more. */
export const tokensOf = (text: string): string[] => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((token) => token.length > 1)

/** The words a question is searched by: no stop words, each once. */
export const queryTerms = (query: string): string[] => [...new Set(tokensOf(query).filter((token) => !STOP_WORDS.has(token)))]

/** What the projections index of a resource: Neo4j's full-text index covers its title, id, tags and body, and its attributes are said in its text. */
export interface Indexed {
  id: string
  type: string
  title: string
  content: string
  tags?: readonly string[]
  attributes?: Readonly<Record<string, unknown>>
}

const scalars = (attributes: Readonly<Record<string, unknown>> = {}) =>
  Object.entries(attributes).flatMap(([key, value]) =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? [[key, String(value)] as const] : [],
  )

const indexedText = (entity: Indexed) =>
  [entity.id, entity.title, ...(entity.tags ?? []), entity.content, ...scalars(entity.attributes).flatMap(([key, value]) => [key, value])].join(' ')

/**
 * Every word a workspace's resources hold, with how many resources hold it:
 * whether a question names something the workspace has recorded, and how rare
 * each of its words is. A term matches every word it begins, as docket's
 * lexical search matches.
 */
export class Vocabulary {
  private readonly words: string[]
  private readonly counts: number[]
  readonly documents: number

  constructor(entities: Iterable<Indexed>) {
    const frequency = new Map<string, number>()
    let documents = 0
    for (const entity of entities) {
      documents += 1
      for (const word of new Set(tokensOf(indexedText(entity)))) frequency.set(word, (frequency.get(word) ?? 0) + 1)
    }
    this.documents = documents
    this.words = [...frequency.keys()].sort()
    this.counts = this.words.map((word) => frequency.get(word) as number)
  }

  private first(term: string): number {
    let [low, high] = [0, this.words.length]
    while (low < high) {
      const mid = (low + high) >>> 1
      if ((this.words[mid] as string) < term) low = mid + 1
      else high = mid
    }
    return low
  }

  /** Whether any resource holds a word beginning with `term`. */
  has(term: string): boolean {
    return (this.words[this.first(term)] ?? '').startsWith(term)
  }

  /** How rare `term` is, as BM25 weighs it: resources holding a word it begins, over all of them. */
  idf(term: string): number {
    let held = 0
    for (let at = this.first(term); at < this.words.length && (this.words[at] as string).startsWith(term); at += 1) held += this.counts[at] as number
    held = Math.min(held, this.documents)
    return Math.log(1 + (this.documents - held + 0.5) / (held + 0.5))
  }
}

const vocabularies = new Map<string, Vocabulary>()
/** Workspaces whose vocabulary is kept between questions. */
const VOCABULARIES_KEPT = 16

/** A workspace's vocabulary, built once for each set of revisions and kept for the questions after. */
export function vocabularyOf(workspace: string, entities: readonly (Indexed & { revision?: string })[]): Vocabulary {
  const hash = createHash('sha256')
  for (const entity of entities) hash.update(`${entity.id}\u0000${entity.revision ?? indexedText(entity)}\u0000`)
  const key = `${workspace}\u0000${hash.digest('hex')}`
  const held = vocabularies.get(key)
  if (held) {
    vocabularies.delete(key)
    vocabularies.set(key, held)
    return held
  }
  const vocabulary = new Vocabulary(entities)
  for (const old of vocabularies.keys()) if (old.startsWith(`${workspace}\u0000`)) vocabularies.delete(old)
  while (vocabularies.size >= VOCABULARIES_KEPT) vocabularies.delete(vocabularies.keys().next().value as string)
  vocabularies.set(key, vocabulary)
  return vocabulary
}

/** Words that may follow "who is" without naming anyone. */
const DETERMINERS = new Set(['a', 'an', 'the', 'our', 'my', 'your', 'their', 'his', 'her', 'its', 'this', 'that', 'these', 'those'])

/**
 * The words in a question that name something - a capitalised word that does
 * not start a sentence, or whoever follows "who is" - which no resource holds:
 * a question about someone or something the workspace has never recorded,
 * which nothing in it can answer. Words with digits and words in capitals
 * (codes and acronyms) are not taken for names.
 */
export function unknownNames(vocabulary: Vocabulary, query: string): string[] {
  const named = new Set<string>()
  const name = (word: string) => !/\p{N}/u.test(word) && !(word.length > 1 && word === word.toUpperCase())
  for (const match of query.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const before = query.slice(0, match.index).trimEnd()
    const startsSentence = before === '' || /[.?!:;]$/.test(before)
    if (!startsSentence && /^\p{Lu}/u.test(match[0]) && name(match[0])) named.add(match[0])
  }
  const whoIs = /\bwho(?:'s|’s|\s+is|\s+was|\s+are)\s+((?:[\p{L}\p{N}'’-]+\s*)+)/iu.exec(query)
  const following = (whoIs?.[1] ?? '').split(/\s+/).filter(Boolean)
  // "who is our contact": after a determiner comes a role, which is a name only when capitalised.
  let determined = false
  while (following.length > 0 && DETERMINERS.has((following[0] as string).toLowerCase())) {
    following.shift()
    determined = true
  }
  const [first, ...rest] = following
  if (first && name(first) && (!determined || /^\p{Lu}/u.test(first))) {
    named.add(first)
    for (const word of rest) {
      if (!/^\p{Lu}/u.test(word)) break
      if (name(word)) named.add(word)
    }
  }
  return [...new Set([...named].flatMap((word) => tokensOf(word)))].filter((token) => queryTerms(token).length > 0 && !vocabulary.has(token))
}

/** The share of a question's terms, weighted by how rare each is, that a resource holds. */
export function coverage(vocabulary: Vocabulary, query: string, entity: Indexed): number {
  const terms = queryTerms(query)
  if (terms.length === 0) return 0
  const words = tokensOf(indexedText(entity)).sort()
  const holds = (term: string) => {
    let [low, high] = [0, words.length]
    while (low < high) {
      const mid = (low + high) >>> 1
      if ((words[mid] as string) < term) low = mid + 1
      else high = mid
    }
    return (words[low] ?? '').startsWith(term)
  }
  const weights = terms.map((term) => [vocabulary.idf(term), holds(term)] as const)
  const total = weights.reduce((sum, [idf]) => sum + idf, 0)
  return total === 0 ? 0 : weights.reduce((sum, [idf, held]) => sum + (held ? idf : 0), 0) / total
}

/** The most of a resource's body the re-ranker reads; it reads 256 tokens of question and record together. */
const RERANK_BODY_CHARS = 1200
const RERANK_LINKS = 8

/**
 * What the re-ranker reads of a resource: its type and title, its attributes,
 * what it links to by name, and its body, so "who manages Northwind" can match
 * the account that names its rep, and a date kept in an attribute is read.
 */
export function rerankText(entity: Indexed & { links?: readonly { rel: string; target: string }[] }, titleOf: (id: string) => string | undefined): string {
  const attributes = scalars(entity.attributes).map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`)
  const links = (entity.links ?? []).slice(0, RERANK_LINKS).map((link) => `${link.rel.replace(/_/g, ' ')} ${titleOf(link.target) ?? link.target}`)
  const body = entity.content.replace(/^\s*#[^\n]*\n/, '').replace(/\s+/g, ' ').trim().slice(0, RERANK_BODY_CHARS)
  return [
    `${entity.type.replace(/_/g, ' ')}: ${entity.title}`,
    ...(attributes.length > 0 ? [attributes.join('; ')] : []),
    ...(links.length > 0 ? [`Linked: ${links.join('; ')}`] : []),
    ...(body ? [body] : []),
  ].join('\n')
}

/** Where a projection ranked a candidate, and its own score there. */
export interface Placed {
  rank: number
  score: number
}

/** One candidate, as the projections and the re-ranker see it. */
export interface Candidate {
  id: string
  /** mem0's semantic search: its cosine similarity. */
  semantic?: Placed | undefined
  /** Neo4j's full-text search: its Lucene score. */
  lexical?: Placed | undefined
  /** The share of the question's terms, by rarity, the resource holds. */
  coverage: number
  /** The cross-encoder's logit for question and record together; absent when the re-ranker did not answer. */
  logit?: number | undefined
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
/** The rank a candidate a projection did not return is given. */
const UNRANKED = 30

/** Every feature a cut model may use, by name, for each candidate of one question. */
export function featuresOf(candidates: readonly Candidate[]): Record<string, number>[] {
  const best = (values: (number | undefined)[]) => {
    const known = values.filter((value): value is number => value !== undefined)
    return known.length > 0 ? Math.max(...known) : undefined
  }
  const topLogit = best(candidates.map((candidate) => candidate.logit))
  const topSemantic = best(candidates.map((candidate) => candidate.semantic?.score))
  const topLexical = best(candidates.map((candidate) => candidate.lexical?.score))
  const order = candidates
    .map((candidate, index) => ({ index, logit: candidate.logit ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => b.logit - a.logit)
  const rerankRank = new Map(order.map((entry, rank) => [entry.index, rank]))
  return candidates.map((candidate, index) => {
    const logit = candidate.logit ?? 0
    return {
      logit,
      probability: candidate.logit === undefined ? 0 : sigmoid(logit),
      logitGap: candidate.logit === undefined || topLogit === undefined ? 0 : logit - topLogit,
      topProbability: topLogit === undefined ? 0 : sigmoid(topLogit),
      rerankRank: Math.min(rerankRank.get(index) ?? UNRANKED, UNRANKED) / 10,
      cosine: candidate.semantic?.score ?? 0,
      cosineGap: candidate.semantic && topSemantic !== undefined ? candidate.semantic.score - topSemantic : -0.5,
      topCosine: topSemantic ?? 0,
      semanticRank: Math.min(candidate.semantic?.rank ?? UNRANKED, UNRANKED) / 10,
      coverage: candidate.coverage,
      lexicalShare: candidate.lexical && topLexical ? candidate.lexical.score / topLexical : 0,
      lexicalRank: Math.min(candidate.lexical?.rank ?? UNRANKED, UNRANKED) / 10,
      both: candidate.semantic && candidate.lexical ? 1 : 0,
      semanticOnly: candidate.semantic && !candidate.lexical ? 1 : 0,
      lexicalOnly: candidate.lexical && !candidate.semantic ? 1 : 0,
    }
  })
}

/**
 * A logistic keep-or-drop model over a candidate's features, fitted on the
 * search evaluation's dev queries (`search-relevance.int.test.ts`), and where
 * it cuts, in two steps: a question is answered at all only when its best
 * candidate's probability of being relevant reaches `answer`; then a
 * candidate is kept when its probability is at least `threshold` and at least
 * `ratio` times the best candidate's.
 */
export interface CutModel {
  /** What it was fitted for: the re-ranker whose logits it reads (none for the fallback) and the projections it was fitted over. */
  name: string
  reranker: string | null
  features: readonly string[]
  /** Each feature is standardised, (x - mean) / scale, before it is weighed. */
  mean: readonly number[]
  scale: readonly number[]
  weights: readonly number[]
  bias: number
  answer: number
  threshold: number
  ratio: number
}

/** Each candidate's probability of being relevant, by `model`. */
export function relevanceOf(model: CutModel, candidates: readonly Candidate[]): number[] {
  return featuresOf(candidates).map((features) => {
    let z = model.bias
    model.features.forEach((name, index) => {
      z += (model.weights[index] as number) * (((features[name] ?? 0) - (model.mean[index] as number)) / (model.scale[index] as number))
    })
    return sigmoid(z)
  })
}

/** The candidates `model` keeps, most probably relevant first, at most `limit`: their ids with each one's probability; none when the best is not relevant enough to answer with. */
export function cut(model: CutModel, candidates: readonly Candidate[], limit: number): { id: string; relevance: number }[] {
  const scored = relevanceOf(model, candidates)
    .map((relevance, index) => ({ id: (candidates[index] as Candidate).id, relevance }))
    .sort((a, b) => b.relevance - a.relevance)
  const top = scored[0]?.relevance ?? 0
  if (top < model.answer) return []
  return scored.filter((candidate) => candidate.relevance >= model.threshold && candidate.relevance >= model.ratio * top).slice(0, limit)
}
