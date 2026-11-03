import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { filesystemSource, type CanonicalSource } from '../canonical/source.js'
import { init } from '../commands/init.js'
import { sync } from '../commands/sync.js'
import { loadConfig } from '../config/loader.js'
import { createMcpServer, InvalidArgumentsError, SEARCH_TOOL, searchTool, type ToolRegistry } from './server.js'
import type { SearchGraph } from './types.js'

const ORDERS = `---
id: service.orders
type: service
title: Orders API
---

Handles orders for checkout.
`

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-mcp-tools-'))
  await init({ cwd: root })
  await mkdir(join(root, '.docket/resources/services'), { recursive: true })
  await writeFile(join(root, '.docket/resources/services/orders.md'), ORDERS, 'utf8')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const call = (server: ReturnType<typeof createMcpServer>, name: string, args: unknown) =>
  server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })

describe('createMcpServer tools', () => {
  it('offers docket_search alone by default', async () => {
    const server = createMcpServer({ cwd: root })
    const listed = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(listed).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: [searchTool.definition] } })
  })

  it('searches the canonical source it is given, not a directory', async () => {
    await sync({ cwd: root })
    const files = filesystemSource(await loadConfig(root))
    const documents: Awaited<ReturnType<typeof collect>> = await collect(files)
    // Only the source holds the documents: the directory has none left.
    await rm(join(root, '.docket/resources'), { recursive: true, force: true })
    const source: CanonicalSource = {
      resolved: files.resolved,
      ontology: () => files.ontology(),
      async *documents() {
        yield* documents
      }
    }

    const answer = await call(createMcpServer({ source }), SEARCH_TOOL, { query: 'orders' })
    const result = (answer as unknown as { result: { structuredContent: SearchGraph; isError?: boolean } }).result
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['service.orders']))
  })

  it('lists and calls the tools of the registry it is given, with the source and viewer', async () => {
    const source = filesystemSource(await loadConfig(root))
    const seen: unknown[] = []
    const tools: ToolRegistry = {
      [SEARCH_TOOL]: searchTool,
      docket_echo: {
        definition: { name: 'docket_echo', description: 'Echoes.', inputSchema: { type: 'object' } },
        call: async (args, context) => {
          seen.push(args, await context.source(), context.viewer)
          if (args === undefined) throw new InvalidArgumentsError('docket_echo takes arguments.')
          return { content: [{ type: 'text', text: 'echo' }] }
        }
      }
    }
    const server = createMcpServer({ source, tools, viewer: 'http://127.0.0.1:1/' })

    const listed = (await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as unknown as { result: { tools: { name: string }[] } }
    expect(listed.result.tools.map((tool) => tool.name)).toEqual([SEARCH_TOOL, 'docket_echo'])
    expect(await call(server, 'docket_echo', { a: 1 })).toEqual({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'echo' }] } })
    expect(seen).toEqual([{ a: 1 }, source, 'http://127.0.0.1:1/'])
    expect(await call(server, 'docket_echo', undefined)).toMatchObject({ error: { code: -32602, message: 'docket_echo takes arguments.' } })
  })

  it('refuses a tool the registry does not hold, even one an object inherits', async () => {
    const server = createMcpServer({ cwd: root })
    for (const name of ['docket_write', 'constructor', '__proto__', 'toString']) {
      expect(await call(server, name, {})).toMatchObject({ error: { code: -32602, message: expect.stringMatching(/There is no tool/) } })
    }
  })

  it('refuses a registry whose key is not its tool name', () => {
    expect(() => createMcpServer({ cwd: root, tools: { docket_find: searchTool } })).toThrow(/docket_find/)
  })
})

const collect = async (source: CanonicalSource) => {
  const documents = []
  for await (const document of source.documents()) documents.push(document)
  return documents
}
