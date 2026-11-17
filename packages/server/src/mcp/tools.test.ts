import { InvalidArgumentsError } from '@chrisjowen/docket'
import { describe, expect, it, vi } from 'vitest'

import type { ServerTool, ToolContext } from './context.js'
import { ModelCallRefused } from './context.js'
import { QueryError, queryAuthorised, queryClient, queryKey, type QueryClient, type WorkspaceSearch } from './query.js'
import { CAP_MESSAGE, isWriteTool, readTools, registryFor, scopeOf, serverTools, writeTools } from './tools/index.js'

const graph = (): WorkspaceSearch => ({
  schema: 'docket-search.v1',
  query: 'orders',
  project: { name: 'Platform', root: 'platform' },
  matches: [
    { id: 'service.orders', type: 'service', title: 'Orders', path: '.docket/resources/service/orders.md', confidence: 0.9, foundBy: ['neo4j'], foundIn: ['facts', 'timeline'], score: 0.8 },
    { id: 'person.ada', type: 'person', title: 'Ada', path: '.docket/resources/person/ada.md', confidence: 0.42, foundBy: [], foundIn: ['timeline'], score: 0.3 }
  ],
  nodes: [],
  links: [],
  paths: [],
  omitted: 0,
  types: [],
  sources: [{ name: 'neo4j', hits: 1 }],
  index: { synced: true, behind: 0 },
  viewer: null,
  warnings: []
})

function context(overrides: Partial<ToolContext> = {}, query: Partial<QueryClient> = {}): ToolContext {
  return {
    workspaceId: 'ws1',
    viewer: 'https://docket.test/o/acme/w/platform/graph',
    ontologyHistory: 'https://docket.test/o/acme/w/platform/ontology/history',
    store: { run: vi.fn() },
    query: { search: vi.fn(async () => graph()), ask: vi.fn(), ...query },
    beforeModelCall: vi.fn(async () => undefined),
    actor: 'token:dkt_live_abcdefgh',
    userId: 'u-alice',
    writer: vi.fn(async () => ({ workspaceId: 'ws1', actor: 'token:dkt_live_abcdefgh', label: 'ci-bot (token tok_abcd…)', channel: 'mcp' as const, requestId: 'req-1' })),
    role: vi.fn(async () => 'editor' as const),
    audited: vi.fn(),
    ...overrides
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
      ['docket_ontology', 'ontology:read']
    ])
    expect(Object.keys(registryFor(tools, ['ontology:read']))).toEqual(['docket_ontology'])
    expect(Object.keys(registryFor(tools, ['docket:read', 'ontology:read']))).toHaveLength(4)
    expect(scopeOf(tools, 'docket_remember')).toBeNull()
  })

  it('are all read-only: none counts against the write limit, and a tool not annotated read-only does', () => {
    const tools = readTools(context())
    expect(tools.filter((entry) => isWriteTool(tools, entry.tool.definition.name))).toEqual([])
    expect(isWriteTool(tools, 'docket_remember')).toBe(false)
    const search = tools[0] as ServerTool
    const write: ServerTool = {
      scope: 'docket:write',
      tool: { ...search.tool, definition: { ...search.tool.definition, name: 'docket_remember', annotations: { readOnlyHint: false } } }
    }
    expect(isWriteTool([...tools, write], 'docket_remember')).toBe(true)
  })

  it('search the workspace the credential names, whatever the arguments say, with the workspace graph as viewer', async () => {
    const ctx = context()
    const result = await tool(readTools(ctx), 'docket_search').call({ query: ' orders ', project: 'someone-else' }, { source: vi.fn(), viewer: null })
    expect(ctx.query.search).toHaveBeenCalledWith({ workspaceId: 'ws1', query: 'orders', limit: 10, actor: 'token:dkt_live_abcdefgh', userId: 'u-alice' })
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
    const ctx = context({ beforeModelCall: vi.fn(async () => Promise.reject(capped)) })
    const result = await tool(readTools(ctx), 'docket_ask').call({ question: 'who owns orders?' }, { source: vi.fn(), viewer: null })
    expect(result).toMatchObject({ isError: true, content: [{ text: CAP_MESSAGE }] })
    expect(ctx.query.ask).not.toHaveBeenCalled()
    // A deployment's own refusal reads as its message.
    const refused = context({ beforeModelCall: vi.fn(async () => Promise.reject(new ModelCallRefused('No model is set up on this server.'))) })
    expect(await tool(readTools(refused), 'docket_ask').call({ question: 'who owns orders?' }, { source: vi.fn(), viewer: null })).toMatchObject({
      isError: true,
      content: [{ text: 'No model is set up on this server.' }]
    })
  })

  it('docket_ask asks the projections for the credential’s workspace, and cites what they found', async () => {
    const answer = { query: 'who owns orders?', results: [], references: [{ id: 'service.orders', kind: 'entity', status: 'resolved', foundBy: [{ adapter: 'neo4j' }] }], synthesis: { text: 'Commerce owns orders.', model: 'test-model' } }
    const ctx = context({}, { ask: vi.fn(async () => ({ answer }) as never) })
    const result = await tool(readTools(ctx), 'docket_ask').call({ question: ' who owns orders? ', maxResults: 5 }, { source: vi.fn(), viewer: null })
    expect(ctx.query.ask).toHaveBeenCalledWith({ workspaceId: 'ws1', question: 'who owns orders?', actor: 'token:dkt_live_abcdefgh', userId: 'u-alice', maxResults: 5 })
    const text = result.content[0]?.text ?? ''
    expect(text).toContain('Commerce owns orders.')
    expect(text).toContain('(Written by test-model.)')
    expect(text).toContain('- service.orders (entity) - neo4j')
    expect(result.structuredContent).toMatchObject({ schema: 'docket-ask.v1' })
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

const VIEWER = 'https://docket.test/o/acme/w/platform/graph'
const HISTORY = 'https://docket.test/o/acme/w/platform/ontology/history'

function stubContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceId: 'ws1',
    viewer: VIEWER,
    ontologyHistory: HISTORY,
    store: { run: vi.fn() },
    query: { search: vi.fn(), ask: vi.fn() },
    beforeModelCall: vi.fn(async () => undefined),
    actor: 'token:dkt_live_abcdefgh',
    userId: 'u-alice',
    writer: vi.fn(async () => ({ workspaceId: 'ws1', actor: 'token:dkt_live_abcdefgh', label: 'ci-bot (token tok_abcd…)', channel: 'mcp' as const, requestId: 'req-1' })),
    role: vi.fn(async () => 'editor' as const),
    audited: vi.fn(),
    ...overrides
  }
}

const writeTool = (context: ToolContext, name: string) => {
  const found = writeTools(context).find((entry) => entry.tool.definition.name === name)
  if (!found) throw new Error(`no ${name}`)
  return found.tool
}
const call = (context: ToolContext, name: string, args: unknown) => writeTool(context, name).call(args, { source: vi.fn(), viewer: null })

describe('the write tools', () => {
  it('need docket:write, except the ontology tools, which need ontology:propose and ontology:write', () => {
    const tools = writeTools(stubContext())
    expect(tools.map((entry) => [entry.tool.definition.name, entry.scope])).toEqual([
      ['docket_remember', 'docket:write'],
      ['docket_update_notes', 'docket:write'],
      ['docket_add_evidence', 'docket:write'],
      ['docket_retire', 'docket:write'],
      ['docket_supersede', 'docket:write'],
      ['docket_propose_ontology_change', 'ontology:propose'],
      ['docket_publish_ontology_change', 'ontology:write']
    ])
    // An editor's credential without ontology:write lists the proposal tool and not the publish one.
    const editor = Object.keys(registryFor(serverTools(stubContext()), ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose']))
    expect(editor).toContain('docket_propose_ontology_change')
    expect(editor).not.toContain('docket_publish_ontology_change')
    // A viewer's read-only credential lists none of them.
    expect(Object.keys(registryFor(serverTools(stubContext()), ['docket:read', 'ontology:read']))).toEqual(['docket_search', 'docket_get', 'docket_ask', 'docket_ontology'])
    const all = serverTools(stubContext())
    expect(tools.every((entry) => isWriteTool(all, entry.tool.definition.name))).toBe(true)
    expect(isWriteTool(all, 'docket_search')).toBe(false)
  })

  it('say what they do: remember is idempotent, retire destructive, supersede neither destructive nor read-only', () => {
    const byName = Object.fromEntries(writeTools(stubContext()).map((entry) => [entry.tool.definition.name, entry.tool.definition.annotations]))
    expect(byName.docket_remember).toMatchObject({ readOnlyHint: false, idempotentHint: true, destructiveHint: false })
    expect(byName.docket_update_notes).toMatchObject({ readOnlyHint: false, idempotentHint: false, destructiveHint: false })
    expect(byName.docket_retire).toMatchObject({ readOnlyHint: false, destructiveHint: true })
    expect(byName.docket_supersede).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true })
    expect(byName.docket_propose_ontology_change).toMatchObject({ readOnlyHint: false })
    expect(byName.docket_publish_ontology_change).toMatchObject({ readOnlyHint: false, destructiveHint: true })
  })

  it('refuse malformed arguments as invalid params, before touching the workspace', async () => {
    const context = stubContext()
    await expect(call(context, 'docket_remember', { id: 'service.x', type: 'service', title: 'X', evidence: 'code' })).rejects.toBeInstanceOf(InvalidArgumentsError)
    await expect(call(context, 'docket_remember', { id: 'service.x', type: 'service', title: 'X', evidence: [{ source: 'code', session: 'mine' }] })).rejects.toThrow(
      /does not take "session"/
    )
    await expect(call(context, 'docket_remember', { id: 'service.x', type: 'service', title: 'X', evidence: [], workspace: 'other' })).rejects.toThrow(/does not take "workspace"/)
    for (const additional_notes of [undefined, '', '   ', 123, 'x'.repeat(60001)]) {
      await expect(call(context, 'docket_update_notes', { id: 'service.x', additional_notes, evidence: [{ source: 'human' }] })).rejects.toBeInstanceOf(InvalidArgumentsError)
    }
    await expect(call(context, 'docket_update_notes', { id: 'service.x', additional_notes: 'New notes', evidence: 'human' })).rejects.toBeInstanceOf(InvalidArgumentsError)
    await expect(call(context, 'docket_update_notes', { id: 'service.x', additional_notes: 'New notes', evidence: [], workspace: 'other' })).rejects.toThrow(/does not take "workspace"/)
    await expect(call(context, 'docket_update_notes', { id: 'service.x', additional_notes: 'New notes', evidence: [], dryRun: 'true' })).rejects.toThrow(/dryRun/)
    await expect(call(context, 'docket_retire', { id: 'service.x' })).rejects.toThrow(/reason must be a non-empty string/)
    await expect(call(context, 'docket_supersede', { id: 'agent.sophia', reason: 'Renamed.', evidence: [{ source: 'human' }] })).rejects.toThrow(/by must be a non-empty string/)
    await expect(call(context, 'docket_supersede', { id: 'agent.sophia', by: 'agent.captin', reason: 'Renamed.', evidence: 'human' })).rejects.toBeInstanceOf(InvalidArgumentsError)
    await expect(call(context, 'docket_supersede', { id: 'agent.sophia', by: 'agent.captin', reason: 'Renamed.', evidence: [], since: '2026' })).rejects.toThrow(/does not take "since"/)
    await expect(call(context, 'docket_propose_ontology_change', { patch: 'a: 1', yaml: 'version: 1' })).rejects.toThrow(/either patch or yaml/)
    await expect(call(context, 'docket_publish_ontology_change', {})).rejects.toThrow(/either patch or yaml/)
    await expect(call(context, 'docket_publish_ontology_change', { patch: 'a: 1', migration: [{ op: 'dropType', from: 'pod' }] })).rejects.toThrow(/migration\[0\]\.op/)
    await expect(call(context, 'docket_publish_ontology_change', { patch: 'a: 1', dispositions: { 'pod.x': 'ignore' } })).rejects.toThrow(/dispositions\["pod.x"\]/)
    await expect(call(context, 'docket_publish_ontology_change', { patch: 'a: 1', expectedHead: 1.5 })).rejects.toThrow(/expectedHead/)
    await expect(call(context, 'docket_publish_ontology_change', { patch: 'a: 1', workspace: 'other' })).rejects.toThrow(/does not take "workspace"/)
    expect(context.audited).not.toHaveBeenCalled()
  })
})

describe('the query service client', () => {
  it('posts JSON with the shared key, and reads an error the service gives', async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://worker.test/query/search')
      expect(init?.headers).toMatchObject({ authorization: 'Bearer k' })
      return new Response(JSON.stringify({ graph: { matches: [] } }), { status: 200 })
    })
    const client = queryClient({ url: 'https://worker.test', key: 'k', fetch: fetch as typeof globalThis.fetch })
    expect(await client.search({ workspaceId: 'ws1', query: 'orders', limit: 5, userId: 'u1' })).toEqual({ matches: [] })
    const failing = queryClient({ url: 'https://worker.test', key: 'k', fetch: (async () => new Response(JSON.stringify({ error: 'busy' }), { status: 503 })) as typeof globalThis.fetch })
    await expect(failing.ask({ workspaceId: 'ws1', question: 'q', actor: 'a', userId: 'u1' })).rejects.toMatchObject({ status: 503, message: 'busy' })
    await expect(queryClient({ url: null, key: 'k' }).search({ workspaceId: 'ws1', query: 'q', limit: 1, userId: 'u1' })).rejects.toBeInstanceOf(QueryError)
  })
})
