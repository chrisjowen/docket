// SPDX-License-Identifier: AGPL-3.0-only
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { RERANK_PATH, rerankerClient, startRerankerServer, type Reranker } from './reranker.js'

const quiet = { info: () => undefined, error: () => undefined }
const MODEL = 'cross-encoder/ms-marco-MiniLM-L6-v2@int8-vnni'
/** Scores a text by how many of the query's words it holds. */
const overlap: Reranker = {
  model: MODEL,
  score: async (query, texts) => texts.map((text) => query.split(' ').filter((word) => text.includes(word)).length),
}

describe('the re-ranker pod', () => {
  const servers: { close(): void }[] = []
  afterEach(() => servers.splice(0).forEach((server) => server.close()))

  async function serve(reranker: Promise<Reranker>) {
    const server = startRerankerServer({ reranker, port: 0, host: '127.0.0.1', tls: null, production: false, log: quiet })
    servers.push(server)
    await new Promise((resolve) => server.once('listening', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  it('scores each text for the worker, in order', async () => {
    const url = await serve(Promise.resolve(overlap))
    const client = rerankerClient({ url, model: MODEL })
    expect(await client.score('orders service', ['the orders service', 'a team', 'orders'])).toEqual([2, 0, 1])
    expect(await client.score('anything', [])).toEqual([])
    expect((await fetch(`${url}/readyz`)).status).toBe(200)
  })

  it('is not ready until its model has loaded, and unhealthy when it cannot load', async () => {
    let load: (reranker: Reranker) => void = () => undefined
    const loading = await serve(new Promise<Reranker>((resolve) => (load = resolve)))
    expect((await fetch(`${loading}/readyz`)).status).toBe(503)
    expect((await fetch(`${loading}${RERANK_PATH}`, { method: 'POST', body: '{"query":"q","texts":["t"]}' })).status).toBe(503)
    load(overlap)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await fetch(`${loading}/readyz`)).status).toBe(200)

    const broken = await serve(Promise.reject(new Error('sha256 mismatch')))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await fetch(`${broken}/healthz`)).status).toBe(500)
  })

  it('refuses a malformed request, and the client refuses a model or an answer it did not ask for', async () => {
    const url = await serve(Promise.resolve(overlap))
    expect((await fetch(`${url}${RERANK_PATH}`, { method: 'POST', body: '{"query":1}' })).status).toBe(400)
    expect((await fetch(`${url}${RERANK_PATH}`, { method: 'POST', body: JSON.stringify({ query: 'q', texts: new Array(65).fill('t') }) })).status).toBe(400)
    await expect(rerankerClient({ url, model: 'another-model' }).score('q', ['t'])).rejects.toThrow(/runs cross-encoder/)
    const short = rerankerClient({ url, model: MODEL, fetch: async () => Response.json({ model: MODEL, logits: [1] }) })
    await expect(short.score('q', ['a', 'b'])).rejects.toThrow(/without a score for each text/)
  })

  it('serves plain HTTP on loopback only, and never in production', () => {
    expect(() => startRerankerServer({ reranker: Promise.resolve(overlap), port: 0, host: '0.0.0.0', tls: null, production: false, log: quiet })).toThrow(/TLS/)
    expect(() => startRerankerServer({ reranker: Promise.resolve(overlap), port: 0, host: '127.0.0.1', tls: null, production: true, log: quiet })).toThrow(/TLS/)
  })
})
