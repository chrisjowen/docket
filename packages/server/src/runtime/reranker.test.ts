import { describe, expect, it, vi } from 'vitest'

import { RERANKER_MODEL, RERANK_PATH, rerankerClient } from './reranker.js'

const MODEL = RERANKER_MODEL.name

/** A re-ranker process that answers with `body`, and remembers what it was sent. */
function serving(body: unknown, status = 200) {
  const sent: { url: string; body: unknown }[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return new Response(JSON.stringify(body), { status })
  })
  return { fetch: fetch as typeof globalThis.fetch, sent }
}

describe('the re-ranker client', () => {
  it('asks the re-ranker for a score of each text, in order', async () => {
    const { fetch, sent } = serving({ model: MODEL, logits: [2.5, -1] })
    const client = rerankerClient({ url: 'http://reranker.test:8080', model: MODEL, fetch })
    expect(client.model).toBe(MODEL)
    expect(await client.score('who owns orders', ['service: Orders', 'team: Commerce'])).toEqual([2.5, -1])
    expect(sent).toEqual([{ url: `http://reranker.test:8080${RERANK_PATH}`, body: { query: 'who owns orders', texts: ['service: Orders', 'team: Commerce'] } }])
  })

  it('asks nothing for no texts', async () => {
    const { fetch } = serving({})
    expect(await rerankerClient({ url: 'http://reranker.test', model: MODEL, fetch }).score('q', [])).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses another model, an answer without a score for each text, and a failed request', async () => {
    const score = (body: unknown, status?: number) => rerankerClient({ url: 'http://reranker.test', model: MODEL, fetch: serving(body, status).fetch }).score('q', ['a', 'b'])
    await expect(score({ model: 'another-model', logits: [1, 2] })).rejects.toThrow(/runs another-model/)
    await expect(score({ model: MODEL, logits: [1] })).rejects.toThrow(/without a score for each text/)
    await expect(score({ model: MODEL, logits: [1, 'x'] })).rejects.toThrow(/without a score for each text/)
    await expect(score({ error: 'loading' }, 503)).rejects.toThrow('the re-ranker answered 503')
  })

  it('pins the model the fitted cut was fitted for', () => {
    expect(RERANKER_MODEL).toMatchObject({ name: 'cross-encoder/ms-marco-MiniLM-L6-v2@int8-vnni', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
  })
})
