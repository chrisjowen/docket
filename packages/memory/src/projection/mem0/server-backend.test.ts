import { afterEach, describe, expect, it } from 'vitest'

import type { Mem0ProjectionConfig } from '../../config/config.js'
import { connectServer, SERVER_LIST_LIMIT } from './server-backend.js'

type ServerConfig = Extract<Mem0ProjectionConfig, { mode: 'server' }>

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body?: unknown
}

/** Records every request and answers from a queue, like the mem0 server would. */
const fakeFetch = (...responses: Array<{ status?: number; json?: unknown }>) => {
  const calls: Call[] = []
  const impl: typeof fetch = async (input, init) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {})
    })
    const next = responses.shift() ?? {}
    return new Response(JSON.stringify(next.json ?? {}), { status: next.status ?? 200 })
  }
  return { impl, calls }
}

const CONFIG: ServerConfig = {
  type: 'mem0',
  mode: 'server',
  url: 'http://localhost:8888/',
  apiKeyEnv: 'TEST_MEM0_SERVER_KEY'
}

const SCOPE = { agentId: 'team-memory-acme' }

afterEach(() => {
  delete process.env.TEST_MEM0_SERVER_KEY
})

describe('mem0 server backend', () => {
  it('adds a verbatim memory in the scope and returns its ids', async () => {
    process.env.TEST_MEM0_SERVER_KEY = 'secret'
    const { impl, calls } = fakeFetch({ json: { results: [{ id: 'm1', event: 'ADD' }] } })
    const backend = await connectServer(CONFIG, SCOPE, impl)

    const ids = await backend.add('# Orders\n', { memory_id: 'service.orders' })

    expect(ids).toEqual(['m1'])
    expect(calls[0]).toEqual({
      method: 'POST',
      url: 'http://localhost:8888/memories',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: {
        messages: [{ role: 'user', content: '# Orders\n' }],
        agent_id: 'team-memory-acme',
        metadata: { memory_id: 'service.orders' },
        infer: false
      }
    })
  })

  it('lists the scope with an explicit limit, since the server pages by default', async () => {
    const { impl, calls } = fakeFetch({
      json: { results: [{ id: 'm1', metadata: { memory_id: 'service.orders' } }] }
    })
    const backend = await connectServer(CONFIG, SCOPE, impl)

    expect(await backend.list()).toEqual([
      { id: 'm1', metadata: { memory_id: 'service.orders' } }
    ])
    expect(calls[0]?.url).toBe(
      `http://localhost:8888/memories?agent_id=team-memory-acme&top_k=${SERVER_LIST_LIMIT}`
    )
  })

  it('refuses a list that may have been truncated at the server limit', async () => {
    const full = Array.from({ length: SERVER_LIST_LIMIT }, (_, index) => ({ id: `m${index}` }))
    const { impl } = fakeFetch({ json: { results: full } })
    const backend = await connectServer(CONFIG, SCOPE, impl)

    await expect(backend.list()).rejects.toThrow(/limit/)
  })

  it('deletes one memory, and the whole scope', async () => {
    const { impl, calls } = fakeFetch({}, {})
    const backend = await connectServer(CONFIG, SCOPE, impl)

    await backend.delete('m 1')
    await backend.deleteAll()

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'DELETE http://localhost:8888/memories/m%201',
      'DELETE http://localhost:8888/memories?agent_id=team-memory-acme'
    ])
  })

  it('searches within the scope, returning scores', async () => {
    const { impl, calls } = fakeFetch({
      json: { results: [{ id: 'm1', score: 0.7, metadata: { memory_id: 'service.orders' } }] }
    })
    const backend = await connectServer(CONFIG, SCOPE, impl)

    expect(await backend.search('orders', 5)).toEqual([
      { id: 'm1', score: 0.7, metadata: { memory_id: 'service.orders' } }
    ])
    expect(calls[0]).toEqual(
      expect.objectContaining({
        method: 'POST',
        url: 'http://localhost:8888/search',
        body: { query: 'orders', filters: { agent_id: 'team-memory-acme' }, top_k: 5 }
      })
    )
  })

  it('passes minScore as the semantic threshold mem0 applies before its keyword boost', async () => {
    const { impl, calls } = fakeFetch({ json: { results: [] } })
    const backend = await connectServer({ ...CONFIG, minScore: 0.5 }, SCOPE, impl)

    await backend.search('orders', 5)

    expect(calls[0]?.body).toMatchObject({ threshold: 0.5 })
  })

  it('sends no key header when the key variable is unset', async () => {
    const { impl, calls } = fakeFetch({ json: { results: [] } })
    const backend = await connectServer(CONFIG, SCOPE, impl)

    await backend.list()

    expect(calls[0]?.headers).not.toHaveProperty('x-api-key')
  })

  it('reports the status and body of a failed request', async () => {
    const { impl } = fakeFetch({ status: 401, json: { detail: 'Invalid API key' } })
    const backend = await connectServer(CONFIG, SCOPE, impl)

    await expect(backend.add('text', {})).rejects.toThrow(/401.*Invalid API key/)
  })
})
