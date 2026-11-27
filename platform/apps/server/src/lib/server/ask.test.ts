// SPDX-License-Identifier: AGPL-3.0-only
import type { UiEntity } from '@chrisjowen/docket/open/types'
import { CAP_MESSAGE, QueryError, type AskResponse, type QueryClient } from '@docket/platform-mcp-tools'
import { describe, expect, it, vi } from 'vitest'

import { askAcross, searchAcross, type AskDeps, type CanonicalGraph, type OrgWorkspace } from './ask'

const entity = (id: string, type: string, extra: Partial<UiEntity> = {}) =>
  ({ id, type, title: id, path: `${id}.md`, paths: [], tags: [], attributes: {}, links: [], mentions: [], content: '', evidence: [], frontmatter: {}, ...extra }) as UiEntity

const platform: OrgWorkspace = { id: 'wsplatform', slug: 'platform', name: 'Platform' }
const data: OrgWorkspace = { id: 'wsdata', slug: 'data', name: 'Data' }

const graphs: Record<string, CanonicalGraph> = {
  platform: {
    entities: [entity('service.orders', 'service', { title: 'Orders', tags: ['tier-1'] }), entity('team.core', 'team', { title: 'Core' })],
    edges: [{ source: 'service.orders', rel: 'owned_by', target: 'team.core' }],
    types: [{ name: 'service', icon: 'server' }],
    index: { synced: true, behind: 0 },
  },
  data: {
    entities: [entity('service.orders', 'service', { title: 'Orders (warehouse copy)', tags: ['tier-2'], content: 'nightly orders export' })],
    edges: [],
    index: { synced: true, behind: 2 },
  },
}

const answered = (entityId: string, text: string | null): AskResponse =>
  ({
    answer: {
      requestId: 'r',
      question: 'q',
      results: [{ adapter: 'neo4j', state: 'answered' }],
      synthesis: text ? { text, model: 'm', citedEntities: [entityId], citedEvidence: [] } : null,
      references: [{ kind: 'resource', id: entityId, status: 'resolved', foundBy: [{ adapter: 'neo4j', blockIds: [], evidenceIds: [] }] }],
      diagnostics: [],
    },
    ...(text ? {} : { notice: 'AI is not set up on this server.' }),
  }) as unknown as AskResponse

function deps(query: Partial<QueryClient>, overrides: Partial<AskDeps> = {}): AskDeps {
  return {
    orgId: 'org1',
    actor: 'user:u1',
    userId: 'u1',
    query: { search: vi.fn(), ask: vi.fn(), ...query } as QueryClient,
    assertWithinCap: async () => undefined,
    graphs: async (workspaces) => new Map(workspaces.map((workspace) => [workspace.slug, graphs[workspace.slug] ?? { entities: [], edges: [] }])),
    describe: async (wanted) =>
      new Map(
        wanted.map(({ workspace, ids }) => [
          workspace.slug,
          new Map((graphs[workspace.slug]?.entities ?? []).filter((entity) => ids.includes(entity.id)).map((entity) => [entity.id, { title: entity.title, type: entity.type }])),
        ]),
      ),
    ...overrides,
  }
}

describe('asking several workspaces', () => {
  it('asks each one as the member, and names the workspace of every source', async () => {
    const ask = vi.fn(async ({ workspaceId }: { workspaceId: string }) =>
      workspaceId === 'wsplatform' ? answered('team.core', 'Owned by [team.core].') : answered('service.orders', null),
    )
    const graphsRead = vi.fn()
    const describe = vi.fn(deps({}).describe)
    const answers = await askAcross(deps({ ask }, { graphs: graphsRead, describe }), [platform, data], 'who owns orders?')
    // Only the cited resources are looked up, never a workspace's whole graph.
    expect(graphsRead).not.toHaveBeenCalled()
    expect(describe.mock.calls[0]?.[0].map(({ workspace, ids }) => [workspace.slug, ids])).toEqual([
      ['platform', ['team.core']],
      ['data', ['service.orders']],
    ])
    expect(ask.mock.calls.map(([call]) => call)).toEqual([
      { orgId: 'org1', workspaceId: 'wsplatform', question: 'who owns orders?', actor: 'user:u1', userId: 'u1' },
      { orgId: 'org1', workspaceId: 'wsdata', question: 'who owns orders?', actor: 'user:u1', userId: 'u1' },
    ])
    expect(answers.map((answer) => [answer.workspace.slug, answer.text, answer.notice])).toEqual([
      ['platform', 'Owned by [team.core].', null],
      ['data', null, 'AI is not set up on this server.'],
    ])
    expect(answers.flatMap((answer) => answer.sources.map((source) => [source.workspace, source.id, source.title]))).toEqual([
      ['platform', 'team.core', 'Core'],
      ['data', 'service.orders', 'Orders (warehouse copy)'],
    ])
  })

  it('lets one workspace fail while the others answer', async () => {
    const ask = vi.fn(async ({ workspaceId }: { workspaceId: string }) => {
      if (workspaceId === 'wsdata') throw new QueryError(503, 'The search index is not running on this server.')
      return answered('team.core', 'Owned by [team.core].')
    })
    const answers = await askAcross(deps({ ask }), [platform, data], 'q')
    expect(answers[0]?.text).toBe('Owned by [team.core].')
    expect(answers[1]?.error).toBe('The docket could not answer: The search index is not running on this server.')
  })

  it('asks nothing once the AI budget is spent', async () => {
    const ask = vi.fn()
    const spent = Object.assign(new Error('spent'), { name: 'AiCapReached' })
    const answers = await askAcross(deps({ ask }, { assertWithinCap: async () => Promise.reject(spent) }), [platform, data], 'q')
    expect(ask).not.toHaveBeenCalled()
    expect(answers.map((answer) => answer.error)).toEqual([CAP_MESSAGE, CAP_MESSAGE])
  })

  it("still asks a docket whose own budget holds when another docket's is spent", async () => {
    const ask = vi.fn(async () => Promise.reject(new QueryError(503, 'asked')))
    const spent = Object.assign(new Error('spent'), { name: 'AiCapReached' })
    const sliced = Object.assign(new Error("This space's AI budget for this month is spent"), { name: 'AiCapReached', spaceId: 'research' })
    const capped = (workspaceId: string) => Promise.reject(workspaceId === platform.id ? spent : sliced)
    const answers = await askAcross(deps({ ask }, { assertWithinCap: async (workspaceId) => (workspaceId === data.id ? undefined : capped(workspaceId)) }), [platform, data], 'q')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: data.id }))
    expect(answers[0]?.error).toBe(CAP_MESSAGE)
    expect(answers[1]?.error).toBe('The docket could not answer: asked')

    const bySlice = await askAcross(deps({ ask }, { assertWithinCap: async () => Promise.reject(sliced) }), [platform], 'q')
    expect(bySlice[0]?.error).toBe("This space's AI budget for this month is spent")
  })
})

describe('searching several workspaces', () => {
  type Board = Awaited<ReturnType<QueryClient['search']>>
  const board = (ids: string[]): Board => ({ matches: ids.map((id) => ({ id, foundBy: ['neo4j'] })), sources: [{ name: 'mem0', hits: 0, error: 'down' }] }) as unknown as Board

  it('keeps the index’s hits the documents hold and the filters allow, each with its workspace', async () => {
    const search = vi.fn(async ({ workspaceId }: { workspaceId: string }) => board(workspaceId === 'wsplatform' ? ['service.orders', 'service.retired'] : ['service.orders']))
    const outcome = await searchAcross(deps({ search }), [platform, data], 'orders', { types: ['service'], tags: ['tier-1'] })
    // A filter asks the index 50 deep for each projection, and for up to 50 relevant results.
    expect(search).toHaveBeenCalledWith({ orgId: 'org1', workspaceId: 'wsplatform', query: 'orders', limit: 50, pool: 50, actor: 'user:u1', userId: 'u1' })
    expect(outcome.hits.map((hit) => [hit.workspace.slug, hit.id, hit.foundBy])).toEqual([['platform', 'service.orders', ['neo4j']]])
    expect(outcome.notes.map((note) => [note.workspace.slug, note.message])).toEqual([
      ['platform', 'mem0: down'],
      ['data', 'The index is 2 changes behind the documents, so search may miss the latest.'],
      ['data', 'mem0: down'],
    ])
    expect(outcome.boards[0]?.matched).toEqual(['platform/service.orders'])
    expect(outcome.boards[0]?.nodes.map((node) => node.key)).toEqual(['platform/service.orders', 'platform/team.core'])
    expect(outcome.icons).toEqual({ service: 'server' })
  })

  it('with a filter, asks for more and fills from the documents what the index ranked too low', async () => {
    // The index's top results are other types; the filtered set still holds a match for the text.
    const search = vi.fn(async () => board(['team.core']))
    const outcome = await searchAcross(deps({ search }), [platform], 'orders', { types: ['service'], tags: [] })
    expect(search).toHaveBeenCalledWith({ orgId: 'org1', workspaceId: 'wsplatform', query: 'orders', limit: 50, pool: 50, actor: 'user:u1', userId: 'u1' })
    expect(outcome.hits.map((hit) => [hit.id, hit.foundBy])).toEqual([['service.orders', ['documents']]])
  })

  it('without a filter, asks for fewer at the search\'s own depth', async () => {
    const search = vi.fn(async () => board(['service.orders']))
    await searchAcross(deps({ search }), [platform], 'orders', { types: [], tags: [] })
    expect(search).toHaveBeenCalledWith({ orgId: 'org1', workspaceId: 'wsplatform', query: 'orders', limit: 30, actor: 'user:u1', userId: 'u1' })
  })

  it('lists by filter alone without asking the index', async () => {
    const search = vi.fn()
    const outcome = await searchAcross(deps({ search }), [platform, data], '', { types: ['service'], tags: [] })
    expect(search).not.toHaveBeenCalled()
    expect(outcome.hits.map((hit) => `${hit.workspace.slug}/${hit.id}`)).toEqual(['platform/service.orders', 'data/service.orders'])
  })

  it('answers with the record current now and notes the change, never matching an out-of-date record by its text', async () => {
    const muse: OrgWorkspace = { id: 'wsmuse', slug: 'muse', name: 'Chris Muse' }
    const sophia = entity('agent.sophia', 'agent', { title: 'Sophia', content: 'Sophia is the Muse bot.', frontmatter: { superseded_by: 'agent.captin' } })
    const captin = entity('agent.captin', 'agent', { title: 'Captin', content: 'Captin is the Muse bot, renamed from Sophia.' })
    const note = 'Out of date: "Sophia" (agent.sophia) is superseded by "Captin" (agent.captin) since 2026-11-01. The Muse bot was renamed.'
    const search = vi.fn(async () => ({ ...board(['agent.captin']), sources: [], changes: [{ id: 'agent.sophia', note }] }) as unknown as Board)
    const muses = deps({ search }, { graphs: async () => new Map([['muse', { entities: [sophia, captin], edges: [] }]]) })
    const outcome = await searchAcross(muses, [muse], 'sophia', { types: ['agent'], tags: [] })
    expect(outcome.hits.map((hit) => hit.id)).toEqual(['agent.captin'])
    expect(outcome.notes.map((entry) => entry.message)).toEqual([note])

    const down = vi.fn(async () => Promise.reject(new QueryError(503, 'The search index is not running on this server.')))
    const fallback = await searchAcross({ ...muses, query: { ...muses.query, search: down } }, [muse], 'muse bot', { types: [], tags: [] })
    expect(fallback.hits.map((hit) => hit.id)).toEqual(['agent.captin'])
  })

  it('finds notes, memory matches, exhibits and docket entries beside the records, and ranks each docket\'s types', async () => {
    const search = vi.fn(async () => ({ ...board([]), matches: [{ id: 'service.orders', foundBy: ['neo4j', 'mem0'], score: 0.8 }] }) as unknown as Board)
    const billing = entity('service.billing', 'service', {
      title: 'Billing',
      content: 'Bills the day’s orders nightly.',
      evidence: [{ source: 'code', note: 'Reads the orders export.', observedAt: '2026-10-02' }],
    })
    const activity = vi.fn(async () => new Map([['platform', []]]))
    const graphsWith = async () => new Map([['platform', { ...graphs.platform!, entities: [...graphs.platform!.entities, billing] }]])
    const outcome = await searchAcross(deps({ search }, { graphs: graphsWith, activity }), [platform], 'orders', { types: [], tags: [] })
    expect(activity).toHaveBeenCalledOnce()
    expect(outcome.groups.memory.map((memory) => [memory.id, memory.score])).toEqual([['service.orders', 0.8]])
    expect(outcome.groups.notes.map((note) => note.entity)).toEqual(['service.billing'])
    expect(outcome.groups.exhibits.map((exhibit) => [exhibit.no, exhibit.text])).toEqual([[1, 'Reads the orders export.']])
    expect(outcome.groups.entries.map((entry) => [entry.no, entry.kind, entry.entity])).toEqual([[1, 'observed', 'service.billing']])
    expect(outcome.slots).toEqual({ platform: { service: 1, team: 2 } })
    expect(outcome.tookMs).toBeGreaterThanOrEqual(0)

    // A type filter keeps to its records, and the exhibits keep their numbers.
    const teams = await searchAcross(deps({ search }, { graphs: graphsWith, activity }), [platform], 'orders', { types: ['team'], tags: [] })
    expect(teams.groups).toEqual({ notes: [], memory: [], exhibits: [], entries: [] })
    // Listing by filter alone reads no activity and finds nothing besides the records.
    activity.mockClear()
    const listed = await searchAcross(deps({ search }, { graphs: graphsWith, activity }), [platform], '', { types: ['service'], tags: [] })
    expect(activity).not.toHaveBeenCalled()
    expect(listed.groups).toEqual({ notes: [], memory: [], exhibits: [], entries: [] })
  })

  it('takes each docket’s best in turn, so the first docket listed never crowds out another’s', async () => {
    const services = (slug: string) => ['a', 'b', 'c'].map((name) => entity(`service.${name}`, 'service', { title: `${slug} ${name} orders`, content: 'orders' }))
    const many = async () => new Map([['platform', { entities: services('platform'), edges: [] }], ['data', { entities: services('data'), edges: [] }]])
    const search = vi.fn(async ({ workspaceId }: { workspaceId: string }) => ({
      ...board([]),
      matches: ['service.a', 'service.b', 'service.c'].map((id, rank) => ({ id, foundBy: ['mem0'], score: workspaceId === 'wsdata' ? 0.9 - rank / 10 : 0.5 - rank / 10 })),
    }) as unknown as Board)
    const outcome = await searchAcross(deps({ search }, { graphs: many }), [platform, data], 'orders', { types: [], tags: [] })
    const firstTwo = (items: readonly { workspace: { slug: string } }[]) => items.slice(0, 2).map((item) => item.workspace.slug)
    expect(firstTwo(outcome.hits)).toEqual(['platform', 'data'])
    expect(firstTwo(outcome.groups.memory)).toEqual(['platform', 'data'])
    expect(firstTwo(outcome.groups.notes)).toEqual(['platform', 'data'])
    expect(outcome.hits.map((hit) => `${hit.workspace.slug}/${hit.id}`)).toEqual([
      'platform/service.a',
      'data/service.a',
      'platform/service.b',
      'data/service.b',
      'platform/service.c',
      'data/service.c',
    ])
  })

  it('matches the documents’ text when the index does not answer', async () => {
    const search = vi.fn(async () => Promise.reject(new QueryError(503, 'The search index is not running on this server.')))
    const outcome = await searchAcross(deps({ search }), [data], 'nightly export', { types: [], tags: [] })
    expect(outcome.hits.map((hit) => [hit.id, hit.foundBy])).toEqual([['service.orders', ['documents']]])
    expect(outcome.notes.at(-1)?.message).toContain('matches the documents')
  })
})
