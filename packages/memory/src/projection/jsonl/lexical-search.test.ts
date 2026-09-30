import { describe, expect, it } from 'vitest'

import type { DocumentRecord } from './jsonl-projection.js'
import { lexicalSearch } from './lexical-search.js'

const doc = (id: string, title: string, content = '', tags: string[] = []): DocumentRecord => ({
  id,
  type: id.split('.')[0] ?? 'note',
  title,
  path: `.memory/${id}.md`,
  content,
  tags
})

const DOCUMENTS = [
  doc('system.object-storage', 'Object storage', 'Stores uploads in MinIO buckets.'),
  doc('decision.minio', 'Use MinIO in development', 'Uploads go to MinIO through S3.'),
  doc('service.api', 'API', 'Phoenix service.', ['elixir'])
]

describe('lexicalSearch', () => {
  it('ranks title matches above body-only matches', () => {
    const ids = lexicalSearch(DOCUMENTS, 'minio', 10).map((hit) => hit.id)

    expect(ids).toEqual(['decision.minio', 'system.object-storage'])
  })

  it('matches a query term as a prefix of a word', () => {
    expect(lexicalSearch(DOCUMENTS, 'upload', 10).map((hit) => hit.id).sort()).toEqual([
      'decision.minio',
      'system.object-storage'
    ])
  })

  it('matches ids and tags, ignoring case and punctuation', () => {
    expect(lexicalSearch(DOCUMENTS, 'Elixir?', 10).map((hit) => hit.id)).toEqual(['service.api'])
    expect(lexicalSearch(DOCUMENTS, 'object-storage', 1).map((hit) => hit.id)).toEqual([
      'system.object-storage'
    ])
  })

  it('returns nothing for a query of only stop words or no matches', () => {
    expect(lexicalSearch(DOCUMENTS, 'the of and', 10)).toEqual([])
    expect(lexicalSearch(DOCUMENTS, 'kubernetes', 10)).toEqual([])
  })

  it('ranks a short document about a term above a long one that mentions it in passing', () => {
    const filler = Array.from({ length: 200 }, (_, index) => `word${index}`).join(' ')
    const documents = [
      doc('decision.long', 'Everything', `${filler} postgres postgres ${filler}`),
      doc('datasource.db', 'Database', 'Postgres on port 5433.')
    ]

    expect(lexicalSearch(documents, 'postgres', 10).map((hit) => hit.id)).toEqual([
      'datasource.db',
      'decision.long'
    ])
  })

  it('weighs a rare term above one most documents share', () => {
    const documents = [
      doc('a.one', 'One', 'service service service'),
      doc('a.two', 'Two', 'service mailpit'),
      doc('a.three', 'Three', 'service'),
      doc('a.four', 'Four', 'service')
    ]

    expect(lexicalSearch(documents, 'service mailpit', 1).map((hit) => hit.id)).toEqual(['a.two'])
  })

  it('returns at most the limit', () => {
    expect(lexicalSearch(DOCUMENTS, 'minio uploads', 1)).toHaveLength(1)
  })
})
