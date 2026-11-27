// SPDX-License-Identifier: AGPL-3.0-only
import { InvalidArgumentsError } from '@chrisjowen/docket'
import { describe, expect, it, vi } from 'vitest'

import { CAP_MESSAGE } from './ask.js'
import type { CloudTool, CloudToolContext } from './context.js'
import { isWriteTool, readTools, registryFor, scopeOf } from './index.js'
import { QueryError, queryAuthorised, queryKey, type QueryClient, type WorkspaceSearch } from './query.js'

const graph = (): WorkspaceSearch => ({
  schema: 'docket-search.v1',
  query: 'orders',
  project: { name: 'Platform', root: 'platform' },
  matches: [
    { id: 'service.orders', type: 'service', title: 'Orders', path: '.docket/resources/service/orders.md', confidence: 0.9, foundBy: ['neo4j'], foundIn: ['facts', 'timeline'], score: 0.8 },
    { id: 'person.ada', type: 'person', title: 'Ada', path: '.docket/resources/person/ada.md', confidence: 0.42, foundBy: [], foundIn: ['timeline'], score: 0.3 },
  ],
  nodes: [],
  links: [],
  paths: [],
  omitted: 0,
  types: [],
  sources: [{ name: 'neo4j', hits: 1 }],
  index: { synced: true, behind: 0 },
  viewer: null,
  warnings: [],
})

function context(overrides: Partial<CloudToolContext> = {}, query: Partial<QueryClient> = {}): CloudToolContext {
  return {
    orgId: 'orga',
    workspaceId: 'ws1',
    viewer: 'https://docket.test/o/acme/w/platform/graph',
    ontologyHistory: 'https://docket.test/o/acme/w/platform/ontology/history',
    inTenant: vi.fn(),
    query: { search: vi.fn(async () => graph()), ask: vi.fn(), turn: vi.fn(), ...query },
    assertWithinCap: vi.fn(async () => undefined),
    actor: 'token:dkt_live_abcdefgh',
    userId: 'u-alice',
    writer: vi.fn(async () => ({ workspaceId: 'ws1', actor: 'token:dkt_live_abcdefgh', label: 'ci-bot (token tok_abcd…)', channel: 'mcp' as const, requestId: 'req-1' })),
    mayPublish: vi.fn(async () => true),
    audited: vi.fn(),
    ...overrides,
  }
}

const tool = (tools: ReturnType<typeof readTools>, name: string) => {
  const found = tools.find((entry) => entry.tool.definition.name === name)
  if (!found) throw new Error(`no ${name}`)
  return found.tool
}

describe('the read tools', () => {
  it('need docket:read, except docket_ontology, which needs ontology:read', () => {
    const tools = readTools(context())
    expect(tools.map((entry) => [entry.tool.definition.name, entry.scope])).toEqual([
      ['docket_search', 'docket:read'],
      ['docket_get', 'docket:read'],
      ['docket_ask', 'docket:read'],
      ['docket_ontology', 'ontology:read'],
    ])
    expect(Object.keys(registryFor(tools, ['ontology:read']))).toEqual(['docket_ontology'])
    expect(Object.keys(registryFor(tools, ['docket:read', 'ontology:read']))).toHaveLength(4)
    expect(scopeOf(tools, 'docket_remember')).toBeNull()
  })

  it('are all read-only: none counts against the write limit, and a tool not annotated read-only does', () => {
    const tools = readTools(context())
    expect(tools.filter((entry) => isWriteTool(tools, entry.tool.definition.name))).toEqual([])
    expect(isWriteTool(tools, 'docket_remember')).toBe(false)
    const search = tools[0] as CloudTool
    const write: CloudTool = {
      scope: 'docket:write',
      tool: { ...search.tool, definition: { ...search.tool.definition, name: 'docket_remember', annotations: { readOnlyHint: false } } },
    }
    expect(isWriteTool([...tools, write], 'docket_remember')).toBe(true)
  })

  it('search the workspace the credential names, whatever the arguments say, with the cloud graph as viewer', async () => {
    const ctx = context()
    const result = await tool(readTools(ctx), 'docket_search').call({ query: ' orders ', project: 'someone-else' }, { source: vi.fn(), viewer: null })
    expect(ctx.query.search).toHaveBeenCalledWith({ orgId: 'orga', workspaceId: 'ws1', query: 'orders', limit: 10, actor: 'token:dkt_live_abcdefgh', userId: 'u-alice' })
    expect(result.structuredContent).toMatchObject({ schema: 'docket-search.v1', viewer: 'https://docket.test/o/acme/w/platform/graph' })
    expect(result.content[0]?.text).toMatch(/^The knowledge below was written by people and agents/)
  })

  it('search where include says, and say where each result was found, by type, with ⚠ on the doubtful', async () => {
    const ctx = context()
    const result = await tool(readTools(ctx), 'docket_search').call({ query: 'orders', include: ['facts', 'timeline'] }, { source: vi.fn(), viewer: null })
    expect(ctx.query.search).toHaveBeenCalledWith(expect.objectContaining({ include: ['facts', 'timeline'] }))
    const text = result.content[0]?.text ?? ''
    expect(text).toContain('By type: 1 service, 1 person.')
    expect(text).toContain('\n- service.orders (service) [facts, timeline] "Orders"')
    expect(text).toContain('\n- ⚠ person.ada (person) [timeline] "Ada"')
  })

  it('search takes minConfidence and ignores it, saying so', async () => {
    const ctx = context()
    const result = await tool(readTools(ctx), 'docket_search').call({ query: 'orders', minConfidence: 0.9 }, { source: vi.fn(), viewer: null })
    const text = result.content[0]?.text ?? ''
    expect(text).toContain('\n- ⚠ person.ada (person)')
    expect(text).toContain('Warning: minConfidence is ignored: results are cut on relevance, and confidence is shown with each result.')
    expect(result.structuredContent).toMatchObject({ warnings: [expect.stringContaining('minConfidence is ignored')] })
    const plain = await tool(readTools(context()), 'docket_search').call({ query: 'orders' }, { source: vi.fn(), viewer: null })
    expect(plain.content[0]?.text).not.toContain('minConfidence')
  })

  it('refuse arguments they do not take', async () => {
    const search = tool(readTools(context()), 'docket_search')
    const none = { source: vi.fn(), viewer: null }
    await expect(search.call({ query: '' }, none)).rejects.toBeInstanceOf(InvalidArgumentsError)
    await expect(search.call({ query: 'x', limit: 0 }, none)).rejects.toBeInstanceOf(InvalidArgumentsError)
    await expect(search.call({ query: 'x', orgId: 'orgb' }, none)).rejects.toThrow(/does not take "orgId"/)
    await expect(search.call({ query: 'x', include: ['notes'] }, none)).rejects.toThrow(/include must list/)
    await expect(search.call({ query: 'x', include: [] }, none)).rejects.toThrow(/include must list/)
    await expect(search.call({ query: 'x', minConfidence: 2 }, none)).rejects.toThrow(/minConfidence must be/)
    await expect(search.call({ query: 'x', minConfidence: 'high' }, none)).rejects.toThrow(/minConfidence must be/)
    await expect(tool(readTools(context()), 'docket_get').call({}, none)).rejects.toBeInstanceOf(InvalidArgumentsError)
  })

  it("answer the model, not with a protocol error, when the index is down", async () => {
    const ctx = context({}, { search: vi.fn(async () => Promise.reject(new QueryError(503, 'The search index did not answer.'))) })
    const result = await tool(readTools(ctx), 'docket_search').call({ query: 'orders' }, { source: vi.fn(), viewer: null })
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0]?.text).toContain('did not answer')
  })

  it('docket_ask stops at the AI cap without asking the projections', async () => {
    const capped = Object.assign(new Error('cap'), { name: 'AiCapReached' })
    const ctx = context({ assertWithinCap: vi.fn(async () => Promise.reject(capped)) })
    const result = await tool(readTools(ctx), 'docket_ask').call({ question: 'who owns orders?' }, { source: vi.fn(), viewer: null })
    expect(result).toMatchObject({ isError: true, content: [{ text: CAP_MESSAGE }] })
    expect(ctx.query.ask).not.toHaveBeenCalled()
  })
})

describe('the query service key', () => {
  it('is derived from the KEK and checked in constant time', () => {
    const key = queryKey(new Uint8Array(32).fill(7))
    expect(key).toBe(queryKey(new Uint8Array(32).fill(7)))
    expect(key).not.toBe(queryKey(new Uint8Array(32).fill(8)))
    expect(queryAuthorised(`Bearer ${key}`, key)).toBe(true)
    expect(queryAuthorised(`Bearer ${key}x`, key)).toBe(false)
    expect(queryAuthorised(undefined, key)).toBe(false)
  })
})
