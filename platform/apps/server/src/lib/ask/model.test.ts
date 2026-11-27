// SPDX-License-Identifier: AGPL-3.0-only
import type { UiEntity } from '@chrisjowen/docket/open/types'
import { describe, expect, it } from 'vitest'

import { chosenWorkspaces, citationSegments, facets, highlightBoard, passes, survivingAnswers, textMatches, workspaceAnswer, type AskedAnswer } from './model'

const entity = (id: string, type: string, extra: Partial<UiEntity> = {}) =>
  ({ id, type, title: id, path: `${id}.md`, paths: [], tags: [], attributes: {}, links: [], mentions: [], content: '', evidence: [], frontmatter: {}, ...extra }) as UiEntity

const platform = { slug: 'platform', name: 'Platform' }

describe('an answer from one workspace', () => {
  const answer: AskedAnswer = {
    synthesis: { text: 'Orders is owned by [team.core].', model: 'anthropic/claude', citedEntities: ['team.core'] },
    references: [
      { kind: 'resource', id: 'service.orders', status: 'resolved', foundBy: [{ adapter: 'mem0' }] },
      { kind: 'observation', id: 'obs-1', entity: 'team.core', status: 'stale', foundBy: [{ adapter: 'neo4j' }] },
      { kind: 'resource', id: 'team.core', status: 'resolved', foundBy: [{ adapter: 'mem0' }] },
      { kind: 'resource', id: 'service.gone', status: 'unresolved', foundBy: [{ adapter: 'neo4j' }] },
    ],
    results: [
      { adapter: 'neo4j', state: 'answered' },
      { adapter: 'mem0', state: 'failed', error: { message: 'timed out' } },
    ],
  }
  const entities = new Map([
    ['service.orders', entity('service.orders', 'service', { title: 'Orders' })],
    ['team.core', entity('team.core', 'team', { title: 'Core' })],
  ])

  it('keeps the model’s text and lists each source once, cited first, named by its workspace', () => {
    const part = workspaceAnswer(platform, { answer }, entities)
    expect(part.text).toBe('Orders is owned by [team.core].')
    expect(part.model).toBe('anthropic/claude')
    expect(part.notice).toBeNull()
    expect(part.sources).toEqual([
      { workspace: 'platform', id: 'team.core', title: 'Core', type: 'team', cited: true, stale: true, foundBy: ['neo4j', 'mem0'] },
      { workspace: 'platform', id: 'service.orders', title: 'Orders', type: 'service', cited: false, stale: false, foundBy: ['mem0'] },
    ])
    expect(part.unavailable).toEqual(['mem0: timed out'])
  })

  it('says why there is no text when no model wrote one', () => {
    const part = workspaceAnswer(platform, { answer: { ...answer, synthesis: null }, notice: 'AI is not set up on this server.' }, entities)
    expect(part.text).toBeNull()
    expect(part.notice).toBe('AI is not set up on this server.')
    expect(part.sources.every((source) => !source.cited)).toBe(true)
  })
})

describe('citations in an answer', () => {
  it('links the ids the sources hold and leaves other brackets as prose', () => {
    expect(citationSegments('See [team.core] and [neo4j:ev-1], not [x y].', new Set(['team.core']))).toEqual([
      { text: 'See ' },
      { cite: 'team.core' },
      { text: ' and [neo4j:ev-1], not [x y].' },
    ])
    expect(citationSegments('[a][b]', new Set(['a', 'b']))).toEqual([{ cite: 'a' }, { cite: 'b' }])
  })
})

describe('direct search', () => {
  const entities = [
    entity('service.orders', 'service', { title: 'Orders', tags: ['tier-1', 'transactional'], content: 'Takes payment.' }),
    entity('service.search', 'service', { title: 'Search', tags: ['tier-2'], content: 'Finds orders for support.' }),
    entity('team.core', 'team', { title: 'Core', tags: ['tier-1'] }),
  ]

  it('filters by any chosen type and every chosen tag', () => {
    expect(entities.filter((one) => passes(one, { types: ['service'], tags: [] })).map((one) => one.id)).toEqual(['service.orders', 'service.search'])
    expect(entities.filter((one) => passes(one, { types: [], tags: ['tier-1'] })).map((one) => one.id)).toEqual(['service.orders', 'team.core'])
    expect(entities.filter((one) => passes(one, { types: ['service'], tags: ['tier-1', 'transactional'] })).map((one) => one.id)).toEqual(['service.orders'])
  })

  it('matches the documents’ text when the index does not answer, titles before bodies', () => {
    expect(textMatches(entities, 'orders').map((one) => one.id)).toEqual(['service.orders', 'service.search'])
    expect(textMatches(entities, 'orders payment').map((one) => one.id)).toEqual(['service.orders'])
    expect(textMatches(entities, '  ')).toEqual([])
  })

  it('counts types and tags for the filters', () => {
    expect(facets(entities)).toEqual({
      types: [
        { name: 'service', count: 2 },
        { name: 'team', count: 1 },
      ],
      tags: [
        { name: 'tier-1', count: 2 },
        { name: 'tier-2', count: 1 },
        { name: 'transactional', count: 1 },
      ],
    })
  })

  it('draws the matches with what they link to, keyed by workspace', () => {
    const graph = {
      entities: [entity('a', 'service'), entity('b', 'team'), entity('c', 'system'), entity('d', 'system')],
      edges: [
        { source: 'a', rel: 'owned_by', target: 'b' },
        { source: 'c', rel: 'uses', target: 'd' },
        { source: 'a', rel: 'uses', target: 'ghost' },
      ],
    }
    const board = highlightBoard('platform', graph, ['a', 'missing'])
    expect(board.nodes.map((node) => node.key)).toEqual(['platform/a', 'platform/b'])
    expect(board.matched).toEqual(['platform/a'])
    expect(board.links).toEqual([{ key: 'platform/a\u0000owned_by\u0000platform/b', source: 'platform/a', target: 'platform/b', rel: 'owned_by' }])
    expect(highlightBoard('platform', graph, ['a', 'c'], 2).nodes.map((node) => node.id)).toEqual(['a', 'c'])
  })

  it('keeps only the workspaces the org has, in its order', () => {
    const all = [platform, { slug: 'data', name: 'Data' }]
    expect(chosenWorkspaces(all, ['data', 'nope', 'platform']).map((one) => one.slug)).toEqual(['platform', 'data'])
  })

  it('drops the parts of an answer whose workspace was deleted while answering', () => {
    const asked = [{ id: 'w1', ...platform }, { id: 'w2', slug: 'data', name: 'Data' }]
    const part = (workspace: { slug: string; name: string }) => ({ workspace, text: 'x', model: null, notice: null, error: null, sources: [], unavailable: [] })
    const answers = [part(platform), part({ slug: 'data', name: 'Data' })]
    const kept = survivingAnswers(asked, answers, new Set(['w2']))
    expect(kept.workspaces.map((one) => one.id)).toEqual(['w2'])
    expect(kept.answers.map((one) => one.workspace.slug)).toEqual(['data'])
    expect(survivingAnswers(asked, answers, new Set()).answers).toEqual([])
  })
})
