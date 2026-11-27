// SPDX-License-Identifier: AGPL-3.0-only
// A stand-in for the in-cluster Ollama embedder, for local previews and the
// e2e suite: the two endpoints mem0 calls, answering with a deterministic
// bag-of-words vector, so similar text lands near similar text and nothing is
// downloaded. packages/projections/src/testing.ts is the same for vitest.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

export const FAKE_EMBEDDER_MODEL = 'nomic-embed-text'

export function embed(text, dimension) {
  const vector = new Array(dimension).fill(0)
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const slot = createHash('sha256').update(word).digest()[0] % dimension
    vector[slot] += 1
  }
  const norm = Math.hypot(...vector) || 1
  return vector.map((value) => value / norm)
}

export function startFakeEmbedder({ port = 0, dimension = 32 } = {}) {
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: `${FAKE_EMBEDDER_MODEL}:latest` }] }))
      if (req.url === '/api/embed') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        const inputs = Array.isArray(body.input) ? body.input : [body.input ?? '']
        return res.end(JSON.stringify({ model: FAKE_EMBEDDER_MODEL, embeddings: inputs.map((input) => embed(input, dimension)) }))
      }
      res.statusCode = 404
      res.end(JSON.stringify({ error: `no ${req.url}` }))
    })
  })
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, dimension })),
  )
}
