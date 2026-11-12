import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { lexicalSearch, type DocumentRecord } from '@docket/adapter-jsonl'
import { describe, expect, it } from 'vitest'

import { validate } from '../../src/commands/validate.js'
import { readIndex, writeDocket, type Corpus, type EvalQuery } from './corpus.js'
import { loadCrm } from './datasets/crm.js'
import { loadPeople } from './datasets/people.js'
import { Bm25Index, Engine } from './engine.js'
import { ndcgAt, precisionAt, recallAt, reciprocalRank, summarise, type QueryOutcome } from './metrics.js'
import { concatenated, floored, fused, unknownNames } from './strategies.js'

/*
 * The parts of the search evaluation that need no model (README.md): the
 * metrics, the full-text index against the JSONL adapter it stands in for,
 * the strategies' floors and fusion, and the committed and generated corpora.
 * The evaluation itself is `pnpm eval:search`.
 */

const query = (relevant: Record<string, number>, kind: EvalQuery['kind'] = 'answerable'): EvalQuery => ({ id: 'q', text: 'q', kind, category: 'x', relevant })
const outcome = (ids: string[], q: EvalQuery): QueryOutcome => ({ corpus: 'c', strategy: 's', query: q, ids, ms: 1, llmCalls: 0, confidences: ids.map(() => 0.9) })

describe('metrics', () => {
  const relevant = new Set(['a', 'b'])

  it('scores precision, recall and reciprocal rank at the cut-off', () => {
    expect(precisionAt(['x', 'a', 'b'], relevant, 2)).toBe(0.5)
    expect(recallAt(['x', 'a', 'b'], relevant, 2)).toBe(0.5)
    expect(reciprocalRank(['x', 'y', 'b'], relevant)).toBeCloseTo(1 / 3)
    expect(reciprocalRank(['x'], relevant)).toBe(0)
  })

  it('scores graded nDCG against the ideal ordering', () => {
    expect(ndcgAt(['a', 'b'], { a: 2, b: 1 })).toBe(1)
    expect(ndcgAt(['b', 'a'], { a: 2, b: 1 })).toBeLessThan(1)
    expect(ndcgAt(['x'], { a: 2 })).toBe(0)
  })

  it('counts any answer to a no-answer query as a false positive, and leaves confidence out of relevance', () => {
    const summary = summarise([outcome(['a'], query({ a: 2 })), outcome(['z'], query({}, 'no-answer')), outcome([], query({}, 'no-answer'))])
    expect(summary.falsePositiveRate).toBe(0.5)
    expect(summary.noAnswerReturned).toBe(0.5)
    expect(summary.ndcg).toBe(1)
    expect(summary.confidence).toBe(0.9)
  })
})

describe('the full-text index', () => {
  it('ranks and scores exactly as the JSONL adapter\'s lexicalSearch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'docket-search-eval-'))
    await writeDocket(await loadPeople(), dir)
    const { entities } = await readIndex(dir)
    const index = new Bm25Index(entities)
    const documents = entities.map((entity) => ({ ...entity, path: '', paths: [] }) as DocumentRecord)
    for (const text of ['who is hannah okoro', 'kubernetes training', 'Harbour Bank pilot', 'fraud model risk', 'who is sophia']) {
      const expected = lexicalSearch(documents, text, 10)
      const actual = index.search(text, 10)
      expect(actual.map((hit) => hit.id)).toEqual(expected.map((hit) => hit.id))
      actual.forEach((hit, at) => expect(hit.score).toBeCloseTo(expected[at]?.score ?? 0, 9))
    }
  })
})

describe('strategies', () => {
  const retrieval = {
    semantic: [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.6 }
    ],
    lexical: [
      { id: 'c', score: 5, coverage: 1 },
      { id: 'a', score: 3, coverage: 0.3 }
    ]
  }

  it('floors each source by its own relevance measure, never by confidence', () => {
    expect(concatenated(retrieval)).toEqual(['a', 'b', 'c'])
    expect(concatenated(floored(retrieval, { semantic: 0.7, coverage: 0.5 }))).toEqual(['a', 'c'])
  })

  it('fuses by rank, so an entity both sources found comes first', () => {
    expect(fused([retrieval.semantic, retrieval.lexical])[0]).toBe('a')
  })

  it('names the words of a question no entity holds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'docket-search-eval-'))
    await writeDocket(await loadPeople(), dir)
    const engine = await Engine.open(dir, [])
    expect(unknownNames(engine, 'who is sophia')).toEqual(['sophia'])
    expect(unknownNames(engine, 'Who is Priya Okoro?')).toEqual(['priya'])
    expect(unknownNames(engine, 'Who is Hannah Okoro?')).toEqual([])
    expect(unknownNames(engine, 'Who knows Kubernetes?')).toEqual([])
  })
})

const checkCorpus = async (corpus: Corpus): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'docket-search-eval-'))
  await writeDocket(corpus, dir)
  const { diagnostics } = await validate({ cwd: dir })
  expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
  const { entities } = await readIndex(dir)
  const ids = new Set(entities.map((entity) => entity.id))
  expect(new Set(corpus.queries.map((item) => item.id)).size).toBe(corpus.queries.length)
  for (const item of corpus.queries) {
    if (item.kind === 'no-answer') expect(item.relevant, item.id).toEqual({})
    else expect(Object.keys(item.relevant).length, item.id).toBeGreaterThan(0)
    for (const id of Object.keys(item.relevant)) expect(ids.has(id), `${item.id}: ${id}`).toBe(true)
  }
  expect(corpus.queries.some((item) => item.text === 'who is sophia')).toBe(true)
}

describe('corpora', () => {
  it('the people fixture validates under its template and every relevant entity exists', async () => {
    await checkCorpus(await loadPeople())
  })

  it('the generated CRM is the same every time, validates under its template and every relevant entity exists', async () => {
    const budget = { answerable: 24, noAnswer: 8 }
    const corpus = await loadCrm(budget)
    expect(await loadCrm(budget)).toEqual(corpus)
    expect(corpus.queries.filter((item) => item.kind === 'no-answer')).toHaveLength(8)
    await checkCorpus(corpus)
  })
})
