import { describe, expect, it } from 'vitest'

import { questionTerms, relevantExcerpt, termsIn } from './excerpt.js'

describe('questionTerms', () => {
  it('keeps the words a question is about, once each', () => {
    expect(questionTerms('Why did we choose Postgres for the orders? Postgres!')).toEqual(['choose', 'postgres', 'orders'])
  })
})

describe('termsIn', () => {
  it('counts the terms a text holds, matching word prefixes', () => {
    expect(termsIn('Uploads go to MinIO in development.', ['upload', 'minio', 'zebra'])).toBe(2)
  })
})

describe('relevantExcerpt', () => {
  const body = [
    'Orders is the checkout service.',
    'It runs three replicas behind the gateway and scales on queue depth during sales.',
    'Order state lives in Postgres, chosen for transactions across order lines.',
    'Owned by the payments team.'
  ].join('\n\n')

  it('returns short text whole', () => {
    expect(relevantExcerpt('  Short.  ', ['short'], 100)).toEqual({ text: 'Short.', truncated: false })
  })

  it('keeps the paragraphs that match, in order, marking what it left out', () => {
    const excerpt = relevantExcerpt(body, questionTerms('Why Postgres for order state?'), 90)
    expect(excerpt.truncated).toBe(true)
    expect(excerpt.text).toContain('Order state lives in Postgres')
    expect(excerpt.text).not.toContain('three replicas')
    expect(excerpt.text.startsWith('…')).toBe(true)
  })

  it('finds a relevant paragraph however far into the text it is', () => {
    const long = `${'Background. '.repeat(200)}\n\nThe ledger settles nightly.`
    expect(relevantExcerpt(long, ['ledger'], 60).text).toContain('The ledger settles nightly.')
  })

  it('gives the beginning when nothing matches, cut at a word', () => {
    const excerpt = relevantExcerpt(body, ['zebra'], 40)
    expect(excerpt).toEqual({ text: expect.stringMatching(/^Orders is the checkout service\.(.*)…$/s), truncated: true })
    expect(excerpt.text.length).toBeLessThanOrEqual(41)
  })

  it('cuts one long matching paragraph around its first match', () => {
    const paragraph = `${'filler '.repeat(50)}the ledger is here ${'filler '.repeat(50)}`
    const excerpt = relevantExcerpt(paragraph, ['ledger'], 60)
    expect(excerpt.text).toContain('ledger')
    expect(excerpt.text.length).toBeLessThanOrEqual(62)
  })
})
