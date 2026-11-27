// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import type { UiGraph } from './model'
import { cappedScope, resultScope } from './scope'

const entity = (id: string) =>
  ({ id, type: id.split('.')[0], title: id, path: '', paths: [], tags: [], attributes: {}, links: [], mentions: [], content: '', evidence: [], frontmatter: {} }) as UiGraph['entities'][number]
const edge = (source: string, rel: string, target: string, dangling = false) => ({ source, rel, target, dangling })

/** A hub with three spokes, a chain off one spoke, a loner, and a link to a record no document files. */
const graph = {
  entities: ['service.hub', 'service.a', 'service.b', 'service.c', 'team.d', 'team.loner'].map(entity),
  edges: [
    edge('service.hub', 'uses', 'service.a'),
    edge('service.hub', 'uses', 'service.b'),
    edge('service.hub', 'uses', 'service.c'),
    edge('service.a', 'owned_by', 'team.d'),
    edge('service.c', 'uses', 'system.gone', true),
  ],
}

const ids = (scope: { graph: { entities: { id: string }[] } }) => scope.graph.entities.map((each) => each.id).sort()
const links = (scope: { graph: { edges: { source: string; target: string }[] } }) => scope.graph.edges.map((each) => `${each.source}>${each.target}`)

describe('the board at first', () => {
  it('draws every record when the docket is within the limit', () => {
    const scope = cappedScope(graph, 10)
    expect(scope).toMatchObject({ shown: 6, total: 6, matched: null })
    expect(scope.graph.edges).toHaveLength(5)
  })

  it('draws the most connected records first, and only the links between what it draws', () => {
    const scope = cappedScope(graph, 2)
    expect(scope).toMatchObject({ shown: 2, total: 6 })
    expect(ids(scope)).toEqual(['service.a', 'service.hub'])
    expect(links(scope)).toEqual(['service.hub>service.a'])
  })

  it('keeps a link to a record no document files, for its ghost', () => {
    expect(links(cappedScope(graph, 4))).toContain('service.c>system.gone')
  })

  it('always draws the selected record', () => {
    const scope = cappedScope(graph, 2, 'team.loner')
    expect(ids(scope)).toContain('team.loner')
    expect(scope.shown).toBe(3)
    // A selection the docket does not hold adds nothing.
    expect(cappedScope(graph, 2, 'nope').shown).toBe(2)
  })
})

describe('a query on the board', () => {
  it('draws the matches and the records one link away, with only the matches’ links', () => {
    const scope = resultScope(graph, ['service.a'], 10)
    expect(scope.matched).toEqual(['service.a'])
    expect(ids(scope)).toEqual(['service.a', 'service.hub', 'team.d'])
    expect(links(scope)).toEqual(['service.hub>service.a', 'service.a>team.d'])
    expect(scope).toMatchObject({ shown: 3, total: 3 })
  })

  it('leaves out links between two neighbours of a match', () => {
    const scope = resultScope(graph, ['service.b', 'team.d'], 10)
    expect(ids(scope)).toEqual(['service.a', 'service.b', 'service.hub', 'team.d'])
    expect(links(scope)).toEqual(['service.hub>service.b', 'service.a>team.d'])
  })

  it('keeps the matches first when the limit cuts, and drops what the docket no longer holds', () => {
    const scope = resultScope(graph, ['gone.record', 'service.hub', 'team.loner'], 2)
    expect(scope.matched).toEqual(['service.hub', 'team.loner'])
    expect(ids(scope)).toEqual(['service.hub', 'team.loner'])
    expect(scope).toMatchObject({ shown: 2, total: 5 })
  })

  it('draws a match’s link to a record no document files', () => {
    expect(links(resultScope(graph, ['service.c'], 10))).toEqual(['service.hub>service.c', 'service.c>system.gone'])
  })

  it('finds nothing to draw for no matches', () => {
    expect(resultScope(graph, [], 10)).toMatchObject({ shown: 0, total: 0, matched: [] })
  })
})
