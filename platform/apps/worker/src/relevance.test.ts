// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { fitLogistic, macroScores, ndcgAt, type EvalQuestion } from './relevance-fit.js'
import { CUT_MODEL, RETRIEVAL_CUT_MODEL } from './relevance-model.js'
import { coverage, cut, featuresOf, queryTerms, rerankText, unknownNames, Vocabulary, vocabularyOf, type CutModel } from './relevance.js'
import { RERANKER_MODEL } from './reranker.js'

const record = (id: string, title: string, content = '', extra: { tags?: string[]; attributes?: Record<string, unknown> } = {}) => ({
  id,
  type: id.split('.')[0] ?? '',
  title,
  content,
  ...extra,
})

const workspace = new Vocabulary([
  record('person.alice-hong', 'Alice Hong', 'Alice runs the Harbour Bank account.'),
  record('account.harbour-bank', 'Harbour Bank', 'A retail bank.', { tags: ['finance'] }),
  record('species.passer', 'Passeriformes', 'Perching birds.'),
  record('service.orders', 'Orders', 'Takes orders.', { attributes: { engine: 'postgres', tier: 1 } }),
])

describe('the name gate', () => {
  it('finds names no resource holds: after "who is", and capitalised words that do not start a sentence', () => {
    expect(unknownNames(workspace, 'who is sophia')).toEqual(['sophia'])
    expect(unknownNames(workspace, "Who's Sophia Patel?")).toEqual(['sophia', 'patel'])
    expect(unknownNames(workspace, 'What did Ingrid say to Alice?')).toEqual(['ingrid'])
    expect(unknownNames(workspace, 'who is alice')).toEqual([])
    expect(unknownNames(workspace, 'What does Harbour Bank use?')).toEqual([])
  })

  it('matches a name by the words it begins, as the full-text index does', () => {
    expect(unknownNames(workspace, 'who is Ali')).toEqual([])
    expect(unknownNames(workspace, 'Does it run on Postgres?')).toEqual([])
  })

  it('skips sentence-initial words, determiners after "who is", words with digits and words in capitals', () => {
    expect(unknownNames(workspace, 'Answer yes or no. Does Harbour Bank bank with us?')).toEqual([])
    expect(unknownNames(workspace, 'who is our contact at Harbour Bank?')).toEqual([])
    expect(unknownNames(workspace, 'Do Passeriformes carry Ptdlns3 or HSV?')).toEqual([])
    expect(unknownNames(workspace, 'Which tier is the Orders API?')).toEqual([])
  })

  it('reads names in any script', () => {
    expect(unknownNames(workspace, 'who is José')).toEqual(['josé'])
  })
})

describe('the vocabulary', () => {
  it('weighs rare words above common ones, and knows a term by the words it begins', () => {
    const words = new Vocabulary([record('a.one', 'Bank', 'bank teller'), record('a.two', 'Bank', 'river bank'), record('a.three', 'Teller', 'counts money')])
    expect(words.has('tell')).toBe(true)
    expect(words.has('zebra')).toBe(false)
    expect(words.idf('river')).toBeGreaterThan(words.idf('bank'))
    expect(words.idf('zebra')).toBeGreaterThan(words.idf('river'))
  })

  it("keeps a workspace's vocabulary until its resources change", () => {
    const one = [record('a.one', 'Bank', 'bank teller')]
    expect(vocabularyOf('org/ws', one)).toBe(vocabularyOf('org/ws', one))
    expect(vocabularyOf('org/ws', [...one, record('a.two', 'River', '')])).not.toBe(vocabularyOf('org/ws', one))
  })

  it("measures how much of a question's rarer terms a resource holds", () => {
    expect(queryTerms('Who owns the Orders service?')).toEqual(['owns', 'orders', 'service'])
    expect(coverage(workspace, 'orders on postgres', record('service.orders', 'Orders', 'Takes orders.', { attributes: { engine: 'postgres' } }))).toBe(1)
    expect(coverage(workspace, 'orders on postgres', record('service.orders', 'Orders', 'Takes orders.'))).toBeLessThan(1)
    expect(coverage(workspace, 'the', record('service.orders', 'Orders'))).toBe(0)
  })
})

describe('what the re-ranker reads', () => {
  it('reads type and title, attributes, links by name, then the body, flattened', () => {
    const text = rerankText(
      { ...record('service.orders', 'Orders', '# Orders\n\nTakes  orders.\n\nFrom the shop.', { attributes: { owner_team: 'commerce', notes: { nested: true } } }), links: [{ rel: 'depends_on', target: 'datasource.gone' }] },
      () => undefined,
    )
    expect(text).toBe('service: Orders\nowner team: commerce\nLinked: depends on datasource.gone\nTakes orders. From the shop.')
  })
})

describe('the cut', () => {
  const model = (weights: Partial<Record<string, number>>, threshold: number, ratio: number, answer = threshold): CutModel => {
    const features = Object.keys(weights)
    return { name: 't', reranker: null, features, mean: features.map(() => 0), scale: features.map(() => 1), weights: features.map((name) => weights[name] as number), bias: 0, answer, threshold, ratio }
  }

  it('describes each candidate against the best of its question', () => {
    const [first, second] = featuresOf([
      { id: 'a', coverage: 1, logit: 2, semantic: { rank: 0, score: 0.8 } },
      { id: 'b', coverage: 0.5, logit: -1, lexical: { rank: 3, score: 2 } },
    ])
    expect(first).toMatchObject({ logit: 2, logitGap: 0, rerankRank: 0, cosine: 0.8, cosineGap: 0, both: 0, semanticOnly: 1, lexicalShare: 0, lexicalRank: 3 })
    expect(second).toMatchObject({ logitGap: -3, rerankRank: 0.1, cosine: 0, cosineGap: -0.5, lexicalShare: 1, lexicalRank: 0.3, lexicalOnly: 1 })
  })

  it('keeps candidates above the threshold and near enough to the best, most relevant first, at most the limit', () => {
    const candidates = [
      { id: 'low', coverage: 0, logit: -3 },
      { id: 'top', coverage: 0, logit: 3 },
      { id: 'near', coverage: 0, logit: 1.5 },
    ]
    expect(cut(model({ logit: 1 }, 0.5, 0), candidates, 10).map((kept) => kept.id)).toEqual(['top', 'near'])
    expect(cut(model({ logit: 1 }, 0.5, 0.95), candidates, 10).map((kept) => kept.id)).toEqual(['top'])
    expect(cut(model({ logit: 1 }, 0.01, 0), candidates, 2).map((kept) => kept.id)).toEqual(['top', 'near'])
    expect(cut(model({ logit: 1 }, 0.99, 0), candidates, 10)).toEqual([])
  })

  it('answers at all only when the best candidate reaches the answer bar, then keeps others above the lower keep bar', () => {
    const candidates = [
      { id: 'top', coverage: 0, logit: 1 },
      { id: 'weak', coverage: 0, logit: -1 },
    ]
    // sigmoid(1) = 0.73, sigmoid(-1) = 0.27.
    expect(cut(model({ logit: 1 }, 0.2, 0, 0.8), candidates, 10)).toEqual([])
    expect(cut(model({ logit: 1 }, 0.2, 0, 0.7), candidates, 10).map((kept) => kept.id)).toEqual(['top', 'weak'])
  })

  it('ships fitted models that read only features the search computes', () => {
    const known = Object.keys(featuresOf([{ id: 'a', coverage: 0 }])[0] as object)
    for (const shipped of [CUT_MODEL, RETRIEVAL_CUT_MODEL]) {
      expect(shipped.features.every((name) => known.includes(name))).toBe(true)
      expect([shipped.mean, shipped.scale, shipped.weights].map((values) => values.length)).toEqual([shipped.features.length, shipped.features.length, shipped.features.length])
    }
    expect(RETRIEVAL_CUT_MODEL.features).not.toContain('logit')
    // The cut reads the logits of the model it was fitted on, and no other.
    expect(CUT_MODEL.reranker).toBe(RERANKER_MODEL.name)
  })
})

describe('fitting the cut', () => {
  it('learns which way a feature points, and how far', () => {
    const rows = Array.from({ length: 400 }, (_, i) => {
      const x = (i % 40) / 10 - 2
      return { x: [x, (i * 7919) % 13], y: (x + ((i * 31) % 7) / 7 - 0.5 > 0 ? 1 : 0) as 0 | 1, weight: 1 }
    })
    const fitted = fitLogistic(rows)
    expect(fitted.weights[0]).toBeGreaterThan(2)
    expect(Math.abs(fitted.weights[1] as number)).toBeLessThan(0.5)
  })

  it('scores answers as docket\'s search evaluation does', () => {
    expect(ndcgAt(['a', 'b'], { a: 2 })).toBe(1)
    expect(ndcgAt(['b', 'a'], { a: 2 })).toBeCloseTo(1 / Math.log2(3))
    const question = (corpus: string, kind: EvalQuestion['kind'], relevant: Record<string, number>): EvalQuestion => ({
      corpus, id: 'q', text: 'q', kind, category: 'c', split: 'test', relevant, gated: false, candidates: [],
    })
    const scores = macroScores([
      { question: question('one', 'answerable', { a: 1 }), ids: ['a', 'b'] },
      { question: question('one', 'no-answer', {}), ids: [] },
      { question: question('two', 'answerable', { a: 2 }), ids: ['a'] },
      { question: question('two', 'no-answer', {}), ids: ['x'] },
    ])
    expect(scores).toMatchObject({ fpr: 0.5, replyPrecision: 0.75, returned: 1.5 })
    expect(scores.byCorpus.one).toMatchObject({ fpr: 0, replyPrecision: 0.5 })
  })
})
