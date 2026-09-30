import type { Mem0ProjectionConfig } from '../../config/config.js'
import type { Mem0Backend, Mem0Scope } from './backend.js'
import { resultsOf, scopeFilters } from './wire-format.js'

type ServerConfig = Extract<Mem0ProjectionConfig, { mode: 'server' }>

/**
 * The server's `GET /memories` returns a default page unless `top_k` is given,
 * and rejects a `top_k` above this.
 */
export const SERVER_LIST_LIMIT = 1000

/**
 * mem0's self-hosted REST server. Plain HTTP, so it needs no mem0 package: the
 * server does the embedding with whatever providers it was configured with.
 */
export const connectServer = async (
  config: ServerConfig,
  scope: Mem0Scope,
  fetchImpl: typeof fetch = fetch
): Promise<Mem0Backend> => {
  const base = config.url.replace(/\/+$/, '')
  const apiKey = process.env[config.apiKeyEnv]
  const ids = scopeFilters(scope)
  const scopeQuery = new URLSearchParams(ids).toString()

  const request = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(apiKey ? { 'X-API-Key': apiKey } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`mem0 server ${method} ${path} failed: ${response.status} ${text}`)
    }
    return text ? JSON.parse(text) : null
  }

  return {
    async add(text, metadata) {
      const response = await request('POST', '/memories', {
        messages: [{ role: 'user', content: text }],
        ...ids,
        metadata,
        infer: false
      })
      return resultsOf(response).map((memory) => memory.id)
    },
    async list() {
      const memories = resultsOf(
        await request('GET', `/memories?${scopeQuery}&top_k=${SERVER_LIST_LIMIT}`)
      )
      // A full page may be a truncated one, and a partial ownership map would
      // leave stale memories behind on the next update.
      if (memories.length >= SERVER_LIST_LIMIT) {
        throw new Error(
          `mem0 server returned ${memories.length} memories, its list limit; ` +
            'cannot tell whether the scope holds more'
        )
      }
      return memories
    },
    async delete(memoryId) {
      await request('DELETE', `/memories/${encodeURIComponent(memoryId)}`)
    },
    async deleteAll() {
      await request('DELETE', `/memories?${scopeQuery}`)
    },
    async search(query, limit) {
      return resultsOf(
        await request('POST', '/search', {
          query,
          filters: ids,
          top_k: limit,
          ...(config.minScore === undefined ? {} : { threshold: config.minScore })
        })
      )
    }
  }
}
