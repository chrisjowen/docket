import { describe, expect, it } from 'vitest'

import { embeddingText, ollamaEmbedder, prefixesOf, semanticConfigSchema } from './embedder.js'

const respond = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch

describe('ollamaEmbedder', () => {
  const config = semanticConfigSchema.parse({ dimensions: 2 })

  it('asks Ollama for every text at once and returns its vectors in order', async () => {
    const requests: unknown[] = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify({ embeddings: [[1, 0], [0, 1]] }))
    }) as unknown as typeof fetch
    expect(await ollamaEmbedder(config, fetchImpl).embed(['a', 'b'])).toEqual([[1, 0], [0, 1]])
    expect(requests).toEqual([{ url: 'http://localhost:11434/api/embed', body: { model: 'nomic-embed-text', input: ['a', 'b'] } }])
  })

  it('refuses vectors of another size than configured, and says why Ollama failed', async () => {
    await expect(ollamaEmbedder(config, respond({ embeddings: [[1, 0, 0]] })).embed(['a'])).rejects.toThrow(/3 dimensions; semantic.dimensions says 2/)
    await expect(ollamaEmbedder(config, respond({ error: 'model not found' }, 404)).embed(['a'])).rejects.toThrow(/404 .*model not found/)
  })
})

describe('prefixesOf', () => {
  it('gives nomic-embed-text its prefixes, other models none unless configured', () => {
    expect(prefixesOf(semanticConfigSchema.parse({}))).toEqual({ document: 'search_document: ', query: 'search_query: ' })
    expect(prefixesOf(semanticConfigSchema.parse({ model: 'nomic-embed-text:v1.5' })).query).toBe('search_query: ')
    expect(prefixesOf(semanticConfigSchema.parse({ model: 'mxbai-embed-large' }))).toEqual({ document: '', query: '' })
    expect(prefixesOf(semanticConfigSchema.parse({ model: 'e5', prefixes: { document: 'passage: ', query: 'query: ' } })).query).toBe('query: ')
  })
})

describe('embeddingText', () => {
  it('is the title, type, body and tags, as adapter-mem0 renders an entity', () => {
    expect(embeddingText({ title: 'Orders', type: 'service', content: 'Takes orders.\n', tags: ['core'] })).toBe(
      '# Orders\nservice\n\nTakes orders.\n\nTags: core\n'
    )
  })
})
