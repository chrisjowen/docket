// SPDX-License-Identifier: AGPL-3.0-only
import { InvalidArgumentsError } from '@chrisjowen/docket'
import { QueryError, readTools, type CloudTool, type CloudToolContext, type TurnQuery, type TurnResponse } from '@docket/platform-mcp-tools'
import { describe, expect, it, vi } from 'vitest'

import type { OrgWorkspace } from './ask'
import { AGENT_LIMITS, agentTools, answerProgram, runAgent, type AgentDeps, type AgentEvent } from './ask-agent'

const acme: OrgWorkspace = { id: 'wsacme', slug: 'acme', name: 'Acme' }
const mirror: OrgWorkspace = { id: 'wsmirror', slug: 'mirror', name: 'Mirror' }

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] })
const definition = (name: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  name,
  description: `${name}'s own description.`,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
})

/** A docket's read tools, answering from canned results, and every call they get. */
function fakeTools() {
  const calls: { workspace: string; tool: string; args: unknown }[] = []
  const tool = (workspace: OrgWorkspace, name: string, answer: (args: Record<string, unknown>) => unknown, properties?: Record<string, unknown>): CloudTool => ({
    scope: 'docket:read',
    tool: {
      definition: definition(name, properties),
      call: vi.fn(async (args: unknown) => {
        calls.push({ workspace: workspace.slug, tool: name, args })
        return answer(args as Record<string, unknown>) as never
      }),
    },
  })
  const tools = (workspace: OrgWorkspace): CloudTool[] => [
    tool(
      workspace,
      'docket_search',
      (args) => ({
        ...text(`Found service.orders for ${String(args.query)}`),
        structuredContent: { matches: [{ id: 'service.orders', title: `Orders (${workspace.name})`, type: 'service', foundIn: ['facts', 'graph'] }] },
      }),
      { query: { type: 'string' }, project: { type: 'string' }, minConfidence: { type: 'number', deprecated: true } },
    ),
    tool(workspace, 'docket_get', (args) => {
      if (args.id === 'bad id') throw new InvalidArgumentsError('Give the id of a resource.')
      if (args.id === 'service.ghost') return { ...text('There is no resource service.ghost in this workspace.'), isError: true }
      return { ...text(`${String(args.id)} (team) "Payments"`), structuredContent: { id: args.id, resource: { title: 'Payments', type: 'team' } } }
    }),
    tool(workspace, 'docket_ask', () => ({
      ...text('What the projections found: service.ledger'),
      structuredContent: { answer: { references: [{ kind: 'entity', id: 'service.ledger', status: 'stale', foundBy: [{ adapter: 'neo4j' }] }, { kind: 'entity', id: 'x', status: 'unresolved', foundBy: [] }] } },
    })),
    tool(workspace, 'docket_ontology', () => ({ ...text('ontology'), structuredContent: { version: 3, ontology: { types: { service: {}, team: {} } } } })),
    tool(workspace, 'docket_remember', () => text('never offered')),
  ]
  return { calls, tools }
}

type Reply = Exclude<TurnResponse, { unavailable: unknown }>
const answer = (content: string, costUsd = 0.01): Reply => ({ content, toolCalls: [], model: 'anthropic/claude-sonnet-5.5', costUsd })
const lookUp = (...calls: [string, Record<string, unknown>][]): Reply => ({
  content: '',
  toolCalls: calls.map(([name, args], index) => ({ id: `call_${name}_${index}`, name, arguments: JSON.stringify(args) })),
  model: 'anthropic/claude-sonnet-5.5',
  costUsd: 0.01,
})

/** The agent's deps, the model answering each turn with the next of `replies`. */
function deps(replies: (TurnResponse | Error)[]) {
  const { calls, tools } = fakeTools()
  const turns: TurnQuery[] = []
  const turn = vi.fn(async (query: TurnQuery) => {
    // The conversation as it stood when the turn was asked: the loop goes on adding to it.
    turns.push({ ...query, messages: [...query.messages] })
    const next = replies.shift() ?? answer('root = Answer([])')
    if (next instanceof Error) throw next
    return next
  })
  const describe = vi.fn(async (wanted: { workspace: OrgWorkspace; ids: string[] }[]) => new Map(wanted.map(({ workspace, ids }) => [workspace.slug, new Map(ids.map((id) => [id, { title: `${id} title`, type: 'service' }]))])))
  const agent: AgentDeps = { orgId: 'orga', actor: 'user:u1', userId: 'u1', query: { turn }, tools, describe }
  return { agent, calls, turns, turn, describe }
}

describe("the Ask page's agent", () => {
  it('looks things up in several steps through the dockets’ own tools, then answers citing what it found', async () => {
    const { agent, calls, turns, describe } = deps([
      lookUp(['docket_search', { workspace: 'acme', query: 'orders' }], ['docket_ask', { workspace: 'mirror', question: 'who owns orders?' }]),
      lookUp(['docket_get', { workspace: 'acme', id: 'team.payments' }]),
      answer(
        [
          'root = Answer([lead, card])',
          'lead = Prose("Orders is run by Payments [acme/team.payments] and writes to the ledger [mirror/service.ledger].")',
          'card = RecordCard("acme/service.orders", "The service asked about.")',
        ].join('\n'),
      ),
    ])
    const events: AgentEvent[] = []
    const outcome = await runAgent(agent, [acme, mirror], 'Who owns orders?', [{ role: 'user', content: 'earlier' }], (event) => events.push(event))

    // Each tool got its own arguments, in the docket named, without the docket.
    expect(calls).toEqual([
      { workspace: 'acme', tool: 'docket_search', args: { query: 'orders' } },
      { workspace: 'mirror', tool: 'docket_ask', args: { question: 'who owns orders?' } },
      { workspace: 'acme', tool: 'docket_get', args: { id: 'team.payments' } },
    ])
    // Three turns on the org's model, the conversation growing with each call and what it answered.
    expect(turns).toHaveLength(3)
    expect(turns[0]).toMatchObject({ orgId: 'orga', actor: 'user:u1', userId: 'u1', toolChoice: 'auto', maxTokens: AGENT_LIMITS.lookupTokens })
    expect(turns[0]?.messages.map((message) => message.role)).toEqual(['system', 'user', 'user'])
    expect(turns[0]?.messages[0]?.content).toContain('RecordCard(id: string, note?: string)')
    expect(turns[0]?.messages[0]?.content).toContain('acme (Acme), mirror (Mirror)')
    expect(turns[0]?.messages[0]?.content).toContain('write every id as docket/id')
    expect(turns[1]?.messages.slice(3).map((message) => message.role)).toEqual(['assistant', 'tool', 'tool'])
    expect(turns[1]?.messages[4]).toMatchObject({ role: 'tool', toolCallId: 'call_docket_search_0', content: expect.stringMatching(/^Docket acme:\nFound service.orders for orders/) })
    expect(turns[2]?.messages.slice(6).map((message) => message.role)).toEqual(['assistant', 'tool'])

    if (!('answered' in outcome)) throw new Error('expected an answer')
    const answered = outcome.answered
    expect(answered.ui).toContain('root = Answer([lead, card])')
    expect(answered.model).toBe('anthropic/claude-sonnet-5.5')
    expect(answered.costUsd).toBe(0.03)
    expect(answered.notice).toBeNull()
    expect(answered.workspaces).toEqual([
      { slug: 'acme', name: 'Acme' },
      { slug: 'mirror', name: 'Mirror' },
    ])
    expect(answered.steps).toEqual([
      expect.objectContaining({ tool: 'docket_search', workspace: 'acme', input: 'orders', result: '1 record', state: 'done' }),
      expect.objectContaining({ tool: 'docket_ask', workspace: 'mirror', input: 'who owns orders?', result: '1 record found', state: 'done' }),
      expect.objectContaining({ tool: 'docket_get', workspace: 'acme', input: 'team.payments', result: 'Payments', state: 'done' }),
    ])
    // Cited records first, in the order first cited, each naming its docket; an ask's records are titled from the documents.
    expect(answered.sources.map((source) => [source.workspace, source.id, source.cited])).toEqual([
      ['acme', 'team.payments', true],
      ['mirror', 'service.ledger', true],
      ['acme', 'service.orders', true],
    ])
    expect(answered.sources[1]).toMatchObject({ title: 'service.ledger title', type: 'service', stale: true, foundBy: ['neo4j'] })
    expect(describe).toHaveBeenCalledWith([{ workspace: mirror, ids: ['service.ledger'] }])

    // The page heard each turn, and each step as it started and ended.
    expect(events.filter((event) => event.type === 'turn')).toHaveLength(3)
    const heard = events.flatMap((event) => (event.type === 'step' ? [`${event.index}:${event.step.state}`] : []))
    expect(heard.filter((one) => one.startsWith('0:'))).toEqual(['0:running', '0:done'])
    expect(heard).toHaveLength(6)
  })

  it("offers the model the dockets' read tools, each taking the docket, as the MCP endpoint defines them", () => {
    const context = { orgId: 'o', workspaceId: 'w', viewer: 'v', ontologyHistory: 'h' } as unknown as CloudToolContext
    const tools = agentTools(readTools(context), ['acme', 'mirror'])
    expect(tools.map((tool) => tool.name)).toEqual(['docket_search', 'docket_get', 'docket_ask', 'docket_ontology'])
    for (const tool of tools) {
      expect(tool.parameters.required).toContain('workspace')
      expect((tool.parameters.properties as Record<string, unknown>).workspace).toEqual({ type: 'string', enum: ['acme', 'mirror'], description: expect.any(String) })
    }
    const search = tools[0]?.parameters.properties as Record<string, unknown>
    expect(Object.keys(search)).not.toContain('minConfidence')
    expect(Object.keys(search)).not.toContain('project')
    expect(tools[2]?.description).toMatch(/No summary is written: you write the answer/)
  })

  it('says why when no model can be asked, so the page answers another way', async () => {
    expect(await runAgent(deps([{ unavailable: 'not-configured', notice: 'AI is not set up.' }]).agent, [acme], 'q', [])).toEqual({ unavailable: 'AI is not set up.' })
    expect(await runAgent(deps([new QueryError(503, 'The search index is not running on this server.')]).agent, [acme], 'q', [])).toEqual({
      unavailable: 'The search index is not running on this server.',
    })
  })

  it('keeps what it found when the budget runs out part way', async () => {
    const { agent } = deps([lookUp(['docket_search', { workspace: 'acme', query: 'orders' }]), { unavailable: 'cap-reached', notice: 'AI budget for this month reached.' }])
    const outcome = await runAgent(agent, [acme], 'q', [])
    if (!('answered' in outcome)) throw new Error('expected an answer')
    expect(outcome.answered).toMatchObject({ ui: null, notice: 'AI budget for this month reached.', steps: [expect.objectContaining({ state: 'done' })] })
    expect(outcome.answered.sources).toHaveLength(1)
  })

  it('stops looking things up at its limits and must answer on the last turn', async () => {
    const forever = Array.from({ length: AGENT_LIMITS.turns + 2 }, () => lookUp(['docket_search', { workspace: 'acme', query: 'again' }]))
    const { agent, turns, calls } = deps(forever)
    const outcome = await runAgent(agent, [acme], 'q', [])
    expect(turns).toHaveLength(AGENT_LIMITS.turns)
    expect(turns.at(-1)).toMatchObject({ toolChoice: 'none', maxTokens: AGENT_LIMITS.answerTokens })
    expect(calls).toHaveLength(AGENT_LIMITS.turns - 1)
    if (!('answered' in outcome)) throw new Error('expected an answer')
    // The last turn asked for more look-ups anyway: no answer, and it says so.
    expect(outcome.answered).toMatchObject({ ui: null, notice: 'No answer was written; what it looked up is below.' })
  })

  it('answers every call the model asks for, running only as many as a turn allows', async () => {
    const many = Array.from({ length: AGENT_LIMITS.perTurn + 2 }, (_, index) => ['docket_search', { workspace: 'acme', query: `q${index}` }] as [string, Record<string, unknown>])
    const { agent, turns, calls } = deps([lookUp(...many), answer('root = Answer([p])\np = Prose("Done [service.orders].")')])
    await runAgent(agent, [acme], 'q', [])
    expect(calls).toHaveLength(AGENT_LIMITS.perTurn)
    const results = turns[1]?.messages.filter((message) => message.role === 'tool') ?? []
    expect(results).toHaveLength(AGENT_LIMITS.perTurn + 2)
    expect(results.at(-1)?.content).toMatch(/^Not run/)
  })

  it('stops before a turn that would pass its cost limit', async () => {
    const dear = { ...lookUp(['docket_search', { workspace: 'acme', query: 'orders' }]), costUsd: AGENT_LIMITS.costUsd }
    const { agent, turns } = deps([dear])
    const outcome = await runAgent(agent, [acme], 'q', [])
    expect(turns).toHaveLength(1)
    if (!('answered' in outcome)) throw new Error('expected an answer')
    expect(outcome.answered).toMatchObject({ ui: null, costUsd: AGENT_LIMITS.costUsd, notice: expect.stringMatching(/limit of \$0\.50/) })
  })

  it('tells the model about a docket, tool or argument it got wrong, and carries on', async () => {
    const { agent, turns, calls } = deps([
      lookUp(['docket_get', { workspace: 'elsewhere', id: 'x' }], ['docket_remember', { workspace: 'acme' }], ['docket_get', { workspace: 'acme', id: 'bad id' }], ['docket_get', { workspace: 'acme', id: 'service.ghost' }], ['docket_get', { workspace: 'acme' }]),
      answer('root = Answer([p])\np = Prose("Nothing on file.")'),
    ])
    const outcome = await runAgent(agent, [acme], 'q', [])
    // docket_remember is never run: the agent reads only.
    expect(calls.map((call) => call.args)).toEqual([{ id: 'bad id' }, { id: 'service.ghost' }, {}])
    const results = (turns[1]?.messages.filter((message) => message.role === 'tool') ?? []).map((message) => message.content)
    expect(results[0]).toMatch(/Name a docket to look in: one of acme/)
    expect(results[1]).toMatch(/There is no tool docket_remember/)
    expect(results[2]).toMatch(/Invalid arguments: Give the id/)
    expect(results[3]).toMatch(/no resource service.ghost/)
    if (!('answered' in outcome)) throw new Error('expected an answer')
    expect(outcome.answered.steps.map((step) => step.state)).toEqual(['failed', 'failed', 'failed', 'failed', 'done'])
  })

  it('names the references to records no look-up returned, and an answer that cites none', async () => {
    const { agent } = deps([lookUp(['docket_search', { workspace: 'acme', query: 'orders' }]), answer('root = Answer([p, c])\np = Prose("Orders [service.orders].")\nc = RecordCard("team.invented")')])
    const outcome = await runAgent(agent, [acme], 'q', [])
    if (!('answered' in outcome)) throw new Error('expected an answer')
    expect(outcome.answered.notice).toBe('It named 1 record no look-up returned, shown unlinked: team.invented.')
  })
})

describe("the agent's answer as OpenUI Lang", () => {
  it('drops a fence, keeps a program, and wraps plain words in one Prose', () => {
    expect(answerProgram('```openui\nroot = Answer([])\n```')).toBe('root = Answer([])')
    expect(answerProgram('root = Answer([p])\np = Prose("x")')).toBe('root = Answer([p])\np = Prose("x")')
    expect(answerProgram('Payments owns it [team.payments], "they say".')).toBe('root = Answer([p])\np = Prose("Payments owns it [team.payments], \\"they say\\".")')
    expect(answerProgram('  ')).toBeNull()
  })
})
