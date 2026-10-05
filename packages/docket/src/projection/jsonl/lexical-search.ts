import type { SearchHit } from '../projection.js'
import type { DocumentRecord } from './jsonl-projection.js'

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from',
  'how', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'this', 'to', 'use', 'what', 'when',
  'where', 'which', 'who', 'why', 'with'
])

/** A title match says more about a document than an id or tag match, and both more than body text. */
const WEIGHTS = { title: 3, label: 2, content: 1 } as const

/** Standard BM25 constants: how fast repeats stop counting, and how much length is normalised. */
const K1 = 1.2
const B = 0.75

const tokenize = (text: string): string[] =>
  text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1)

/** How many of `words` start with `term`, so `upload` finds `uploads`. */
const occurrences = (words: readonly string[], term: string): number =>
  words.reduce((count, word) => count + (word.startsWith(term) ? 1 : 0), 0)

interface Indexed {
  id: string
  /** Field-weighted length, the `dl` in BM25. */
  length: number
  /** Field-weighted term frequency per query term. */
  frequency: Map<string, number>
}

/**
 * Keyword search over the documents the jsonl projection already holds. Needs
 * no service, so a search always has at least one answer, and it finds exact
 * names - ids, tags, product terms - that embeddings can blur.
 *
 * Scored with BM25 over the weighted fields, so a term most documents share
 * counts for little and a long document does not win by mentioning everything.
 */
export const lexicalSearch = (
  documents: Iterable<DocumentRecord>,
  query: string,
  limit: number
): SearchHit[] => {
  const terms = [...new Set(tokenize(query).filter((term) => !STOP_WORDS.has(term)))]
  if (terms.length === 0) return []

  const indexed: Indexed[] = []
  for (const document of documents) {
    const fields = [
      { words: tokenize(document.title), weight: WEIGHTS.title },
      { words: tokenize(`${document.id} ${document.tags.join(' ')}`), weight: WEIGHTS.label },
      { words: tokenize(document.content), weight: WEIGHTS.content }
    ]
    indexed.push({
      id: document.id,
      length: fields.reduce((sum, field) => sum + field.weight * field.words.length, 0),
      frequency: new Map(
        terms.map((term) => [
          term,
          fields.reduce((sum, field) => sum + field.weight * occurrences(field.words, term), 0)
        ])
      )
    })
  }
  if (indexed.length === 0) return []

  const averageLength = indexed.reduce((sum, document) => sum + document.length, 0) / indexed.length
  const idf = new Map(
    terms.map((term) => {
      const containing = indexed.filter((document) => (document.frequency.get(term) ?? 0) > 0).length
      return [term, Math.log(1 + (indexed.length - containing + 0.5) / (containing + 0.5))]
    })
  )

  const hits: SearchHit[] = []
  for (const document of indexed) {
    const norm = K1 * (1 - B + (B * document.length) / (averageLength || 1))
    let score = 0
    for (const term of terms) {
      const tf = document.frequency.get(term) ?? 0
      if (tf > 0) score += (idf.get(term) ?? 0) * ((tf * (K1 + 1)) / (tf + norm))
    }
    if (score > 0) hits.push({ id: document.id, score })
  }

  return hits
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.id < b.id ? -1 : 1))
    .slice(0, limit)
}
