// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Real stores for the projection tests, from the environment: a Neo4j and a
 * Qdrant with JWT RBAC on. CI runs both as services; locally, see README.
 */
export const TEST_STORES = {
  neo4jUrl: process.env.DOCKET_TEST_NEO4J_URL,
  neo4jPassword: process.env.DOCKET_TEST_NEO4J_PASSWORD ?? '',
  qdrantUrl: process.env.DOCKET_TEST_QDRANT_URL,
  qdrantApiKey: process.env.DOCKET_TEST_QDRANT_API_KEY ?? '',
}

export const HAVE_TEST_STORES = Boolean(TEST_STORES.neo4jUrl && TEST_STORES.qdrantUrl)

if (!HAVE_TEST_STORES && process.env.CI) {
  throw new Error('DOCKET_TEST_NEO4J_URL and DOCKET_TEST_QDRANT_URL must be set in CI: the projection tests would otherwise be skipped')
}

/** Small vectors keep the test collections cheap. */
export const TEST_DIMENSION = 32

/**
 * A stand-in for the in-cluster Ollama embedder: the two endpoints mem0 calls,
 * answering with a deterministic bag-of-words vector, so similar text lands
 * near similar text and nothing is downloaded.
 */
export async function startFakeEmbedder(dimension = TEST_DIMENSION): Promise<{ url: string; model: string; dimension: number; close(): Promise<void> }> {
  const model = 'nomic-embed-text'
  const embed = (text: string): number[] => {
    const vector = new Array<number>(dimension).fill(0)
    for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      const digest = createHash('sha256').update(word).digest()
      vector[(digest[0] ?? 0) % dimension] = (vector[(digest[0] ?? 0) % dimension] ?? 0) + 1
    }
    const norm = Math.hypot(...vector) || 1
    return vector.map((value) => value / norm)
  }
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: `${model}:latest` }] }))
        return
      }
      if (req.url === '/api/embed') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { input?: string | string[] }
        const inputs = Array.isArray(body.input) ? body.input : [body.input ?? '']
        res.end(JSON.stringify({ model, embeddings: inputs.map(embed) }))
        return
      }
      res.statusCode = 404
      res.end(JSON.stringify({ error: `no ${req.url}` }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    model,
    dimension,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

export { serveFakeCognee, startFakeCognee } from './fake-cognee.js'
export type { FakeCognee, FakeDataset, FakeItem } from './fake-cognee.js'
