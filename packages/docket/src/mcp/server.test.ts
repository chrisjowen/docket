import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { init } from '../commands/init.js'
import { sync } from '../commands/sync.js'
import { startUiServer, type UiServer } from '../open/server.js'
import type { UiHealth } from '../open/types.js'
import { APP_MIME, APP_URI, PROTOCOL_VERSIONS, SEARCH_TOOL } from './server.js'
import { MAX_NODES, MAX_SEARCH_LIMIT } from './search.js'
import { SEARCH_SCHEMA, type SearchGraph } from './types.js'

const ORDERS = `---
id: service.orders
type: service
title: Orders API
links:
  - rel: owned_by
    target: team.payments
  - rel: depends_on
    target: service.ledger
---

Handles orders for checkout.
`

const PAYMENTS = `---
id: team.payments
type: team
title: Payments
---

The payments team owns checkout money movement.
`

const APP = '<!doctype html><title>docket search</title><p>app</p>'

let root: string
let server: UiServer | undefined

const write = async (path: string, contents: string): Promise<void> => {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

const post = (body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(new URL('/mcp', server?.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })

let next = 1
const rpc = async (method: string, params?: unknown): Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string } }> => {
  const id = next++
  const response = await post({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toMatch(/^application\/json/)
  const body = (await response.json()) as { id: number; result?: Record<string, unknown>; error?: { code: number; message: string } }
  expect(body.id).toBe(id)
  return body
}

const searchFor = async (args: Record<string, unknown>): Promise<{ text: string; graph: SearchGraph; isError?: boolean }> => {
  const { result } = await rpc('tools/call', { name: SEARCH_TOOL, arguments: args })
  const content = result?.content as { type: string; text: string }[]
  return { text: content[0]?.text ?? '', graph: result?.structuredContent as SearchGraph, isError: result?.isError as boolean | undefined }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-mcp-'))
  await init({ cwd: root })
  await write(join(root, '.docket/resources/services/orders.md'), ORDERS)
  await write(join(root, '.docket/resources/teams/payments.md'), PAYMENTS)
  await write(join(root, 'app', 'search.html'), APP)
  await sync({ cwd: root })
  server = await startUiServer({ cwd: root, uiDir: join(root, 'ui'), port: 0, mcpAppFile: join(root, 'app', 'search.html') })
})

afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(root, { recursive: true, force: true })
})

describe('docket open /mcp', () => {
  it('initializes without a session, in the version the client asks for when it speaks it', async () => {
    const response = await post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } })
    expect(response.status).toBe(200)
    expect(response.headers.get('mcp-session-id')).toBeNull()
    const { result } = (await response.json()) as { result: Record<string, unknown> }
    expect(result.protocolVersion).toBe('2025-06-18')
    expect(result.capabilities).toEqual({ tools: {}, resources: {} })
    expect(result.serverInfo).toMatchObject({ name: 'docket' })
    expect(result.instructions).toMatch(/docket_search/)

    const { result: newest } = await rpc('initialize', { protocolVersion: '1999-01-01', capabilities: {} })
    expect(newest?.protocolVersion).toBe(PROTOCOL_VERSIONS[0])
  })

  it('accepts notifications with 202 and nothing else', async () => {
    const response = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('offers docket_search as a read-only tool with its app', async () => {
    const { result } = await rpc('tools/list')
    const tools = result?.tools as Record<string, unknown>[]
    expect(tools.map((tool) => tool.name)).toEqual([SEARCH_TOOL])
    expect(tools[0]).toMatchObject({
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: APP_URI } },
      inputSchema: { required: ['query'] }
    })
  })

  it('serves the app as an MCP Apps resource that needs no network', async () => {
    const { result: listed } = await rpc('resources/list')
    expect(listed?.resources).toEqual([expect.objectContaining({ uri: APP_URI, mimeType: APP_MIME })])
    const { result } = await rpc('resources/read', { uri: APP_URI })
    expect(result?.contents).toEqual([{ uri: APP_URI, mimeType: APP_MIME, text: APP, _meta: { ui: { prefersBorder: true } } }])
    const { error } = await rpc('resources/read', { uri: 'ui://docket/other.html' })
    expect(error?.code).toBe(-32002)
  })

  it('finds the matching resources, their neighbours and the links between them', async () => {
    const { text, graph, isError } = await searchFor({ query: 'orders' })
    expect(isError).toBeUndefined()
    expect(graph.schema).toBe(SEARCH_SCHEMA)
    expect(graph.query).toBe('orders')
    expect(graph.project.root).toBe(root)
    expect(graph.viewer).toBe(server?.url)
    expect(graph.matches.map((match) => match.id)).toEqual(['service.orders'])
    expect(graph.matches[0]).toMatchObject({ type: 'service', title: 'Orders API', path: '.docket/resources/services/orders.md', foundBy: ['local'] })

    const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
    expect(nodes.get('service.orders')).toMatchObject({ match: true, ghost: false })
    expect(nodes.get('team.payments')).toMatchObject({ match: false, ghost: false, title: 'Payments', path: '.docket/resources/teams/payments.md' })
    // No file defines the ledger yet: it is drawn as a ghost.
    expect(nodes.get('service.ledger')).toMatchObject({ match: false, ghost: true })
    expect(graph.links).toEqual(
      expect.arrayContaining([
        { source: 'service.orders', rel: 'owned_by', target: 'team.payments' },
        { source: 'service.orders', rel: 'depends_on', target: 'service.ledger' }
      ])
    )
    expect(graph.omitted).toBe(0)
    expect(graph.types).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'service', count: 1 }), expect.objectContaining({ name: 'team', count: 1 })]))
    expect(graph.sources).toEqual([expect.objectContaining({ name: 'local', hits: 1 })])

    expect(text).toContain('service.orders (service) "Orders API": .docket/resources/services/orders.md')
    expect(text).toContain('links: owned_by -> team.payments; depends_on -> service.ledger')
    expect(text).toContain('local: 1 hit')
  })

  it('says when nothing matches', async () => {
    const { text, graph } = await searchFor({ query: 'zebra' })
    expect(graph.matches).toEqual([])
    expect(graph.nodes).toEqual([])
    expect(text).toMatch(/nothing found/)
  })

  it('keeps the board to MAX_NODES, matches first', async () => {
    const links = Array.from({ length: MAX_NODES + 5 }, (_, index) => `  - rel: uses\n    target: lib.l${index}`).join('\n')
    await write(join(root, '.docket/resources/services/hub.md'), `---\nid: service.hub\ntype: service\ntitle: Hub\nlinks:\n${links}\n---\n\nThe hub.\n`)
    await sync({ cwd: root })
    const { graph } = await searchFor({ query: 'hub' })
    expect(graph.nodes).toHaveLength(MAX_NODES)
    expect(graph.nodes[0]).toMatchObject({ id: 'service.hub', match: true })
    expect(graph.omitted).toBe(6)
  })

  it('refuses arguments it does not take, an unknown tool and an unknown method as JSON-RPC errors', async () => {
    for (const args of [{}, { query: '  ' }, { query: 'x', limit: 0 }, { query: 'x', limit: MAX_SEARCH_LIMIT + 1 }, { query: 'x', root: '/' }]) {
      const { error } = await rpc('tools/call', { name: SEARCH_TOOL, arguments: args })
      expect(error?.code).toBe(-32602)
    }
    expect((await rpc('tools/call', { name: 'docket_write', arguments: {} })).error?.code).toBe(-32602)
    expect((await rpc('sampling/createMessage', {})).error?.code).toBe(-32601)
  })

  it('answers a docket it cannot read as a tool error the model can read', async () => {
    await rm(join(root, '.docket.yaml'))
    const { text, isError } = await searchFor({ query: 'orders' })
    expect(isError).toBe(true)
    expect(text).toMatch(/could not be searched/)
  })

  it('answers only POSTed JSON, one message at a time', async () => {
    const get = await fetch(new URL('/mcp', server?.url))
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'content-type': 'text/plain' })).status).toBe(415)
    const parse = await post('{not json')
    expect(parse.status).toBe(400)
    expect(((await parse.json()) as { error: { code: number } }).error.code).toBe(-32700)
    const batch = await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }])
    expect(batch.status).toBe(400)
    const invalid = await post({ id: 3, method: 'ping' })
    expect(((await invalid.json()) as { error: { code: number } }).error.code).toBe(-32600)
  })

  it('refuses a page on another site, and a name other than its loopback one', async () => {
    const page = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })
    expect(page.status).toBe(403)
    // fetch keeps its own Host header, so a DNS name rebound to 127.0.0.1 is sent by hand.
    const rebound = await new Promise<number>((done, fail) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
      const sent = request(
        { host: '127.0.0.1', port: server?.port, path: '/mcp', method: 'POST', headers: { host: `evil.example:${server?.port}`, 'content-type': 'application/json' } },
        (response) => {
          response.resume()
          done(response.statusCode ?? 0)
        }
      )
      sent.on('error', fail)
      sent.end(body)
    })
    expect(rebound).toBe(403)
  })

  it('names its MCP endpoint in its health', async () => {
    const health = (await (await fetch(new URL('/api/health', server?.url))).json()) as UiHealth
    expect(health.mcp).toBe('/mcp')
  })
})

describe('docket open /mcp without a built app', () => {
  it('says the app is not built', async () => {
    await server?.close()
    server = await startUiServer({ cwd: root, uiDir: join(root, 'ui'), port: 0, mcpAppFile: join(root, 'missing.html') })
    const { error } = await rpc('resources/read', { uri: APP_URI })
    expect(error?.message).toMatch(/not built/)
  })
})
