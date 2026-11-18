import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createMcpServer, localTools, type McpServer, type ToolDefinition } from '@chrisjowen/docket'
import { TOOL_DEFINITIONS, TOOL_NAMES, surfaceOf } from '@chrisjowen/docket/mcp/surface'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { SCOPES } from '../auth/scopes.js'
import type { ToolContext } from './context.js'
import { registryFor, serverTools } from './tools/index.js'

/**
 * Docket's MCP surface is the same wherever an agent connects: docket's own
 * local MCP server (`docket open`'s `/mcp`), this server core - a
 * self-hosted server's and, once it runs on this package, Docket Cloud's.
 * These fail when the two drift: a tool added, dropped or reordered, or a
 * name, input schema, annotation or argument check that differs. Only a
 * tool's description may differ, worded for where it runs.
 */

const context = (): ToolContext => ({
  workspaceId: 'ws1',
  viewer: 'https://docket.test/w/platform/graph',
  ontologyHistory: 'https://docket.test/w/platform/ontology/history',
  store: { run: vi.fn() },
  query: { search: vi.fn(), ask: vi.fn() },
  beforeModelCall: vi.fn(async () => undefined),
  actor: 'user:ada',
  userId: 'u-ada',
  writer: vi.fn(),
  role: vi.fn(async () => 'owner' as const),
  audited: vi.fn()
})

let dir: string
let local: McpServer
let server: McpServer

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'docket-parity-'))
  local = createMcpServer({ cwd: dir })
  // Every scope: the tools a caller may run narrow by scope, never by what a tool is.
  server = createMcpServer({ cwd: dir, tools: registryFor(serverTools(context()), SCOPES) })
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

const listed = async (mcp: McpServer): Promise<ToolDefinition[]> =>
  ((await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as unknown as { result: { tools: ToolDefinition[] } }).result.tools

describe("Docket's MCP surface", () => {
  it('is what the server offers: every tool, in order, with its names, input schemas and annotations', async () => {
    expect((await listed(server)).map(surfaceOf)).toEqual(TOOL_DEFINITIONS.map(surfaceOf))
  })

  it("is what docket's local MCP server offers, tool for tool", async () => {
    const [mine, theirs] = [await listed(server), await listed(local)]
    expect(theirs.map((tool) => tool.name)).toEqual(TOOL_NAMES)
    expect(theirs.map(surfaceOf)).toEqual(mine.map(surfaceOf))
    expect(Object.keys(localTools({ cwd: dir }))).toEqual(TOOL_NAMES)
  })

  it('refuses the same arguments with the same errors on both', async () => {
    const calls: [string, unknown][] = [
      ...TOOL_NAMES.map((name): [string, unknown] => [name, { bogus: 1 }]),
      ...TOOL_NAMES.filter((name) => name !== 'docket_ontology').map((name): [string, unknown] => [name, {}]),
      ['docket_search', { query: 'x', limit: 0 }],
      ['docket_search', { query: 'x', include: ['everything'] }],
      ['docket_ask', { question: 'x', maxResults: 51 }],
      ['docket_remember', { id: 'a', type: 't', title: 'T', evidence: [{ where: 'x' }] }],
      ['docket_remember', { id: 'a', type: 't', title: 'T', evidence: [], links: [{ rel: 'r' }] }],
      ['docket_add_evidence', { id: 'a', evidence: [], link: { rel: 'r' } }],
      ['docket_supersede', { id: 'a', by: 'b', reason: 'r', evidence: 'x' }],
      ['docket_propose_ontology_change', { patch: 'a', yaml: 'b' }],
      ['docket_publish_ontology_change', { patch: 'a', expectedHead: -1 }],
      ['docket_publish_ontology_change', { patch: 'a', migration: [{ op: 'explode', from: 'a' }] }],
      ['docket_publish_ontology_change', { patch: 'a', dispositions: { 'a.b': 'shrug' } }]
    ]
    for (const [name, args] of calls) {
      const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
      const [mine, theirs] = [await server.handle(request), await local.handle(request)]
      expect(mine, `${name} ${JSON.stringify(args)}`).toMatchObject({ error: { code: -32602 } })
      expect(theirs, `${name} ${JSON.stringify(args)}`).toEqual(mine)
    }
  })
})
