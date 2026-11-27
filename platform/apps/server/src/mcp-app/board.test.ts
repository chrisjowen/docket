// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { applyHostContext } from './bridge'
import { boardOf, searchOf, typeColours, type SearchGraph } from './board'

const graph = (overrides: Partial<SearchGraph> = {}): SearchGraph => ({
  schema: 'docket-search.v1',
  query: 'orders',
  project: { name: 'acme', root: '/workspace' },
  matches: [{ id: 'service.orders', type: 'service', title: 'Orders', path: '.docket/resources/service/orders.md', confidence: 0.4, foundBy: ['local'] }],
  nodes: [
    { id: 'service.orders', type: 'service', title: 'Orders', path: '.docket/resources/service/orders.md', match: true, ghost: false, via: 'adapter' },
    { id: 'datastore.orders-db', type: 'datastore', title: 'Orders DB', path: '.docket/resources/datastore/orders-db.md', match: false, ghost: false, via: 'canonical' },
    { id: 'team.payments', type: '', title: 'team.payments', match: false, ghost: true, via: 'canonical' },
  ],
  links: [
    { source: 'service.orders', rel: 'reads', target: 'datastore.orders-db', via: 'canonical' },
    { source: 'service.orders', rel: 'owned_by', target: 'team.payments', via: 'canonical' },
  ],
  paths: [],
  omitted: 0,
  types: [
    { name: 'datastore', icon: 'database', count: 2 },
    { name: 'service', icon: 'server', count: 9 },
  ],
  sources: [{ name: 'local', hits: 1 }],
  index: { synced: true, behind: 0 },
  viewer: 'https://docket.example/o/acme/w/shop/graph',
  warnings: [],
  ...overrides,
})

describe('searchOf', () => {
  it('reads a docket-search.v1 result, and nothing else', () => {
    expect(searchOf(graph())?.query).toBe('orders')
    expect(searchOf({ schema: 'docket-search.v2' })).toBeNull()
    expect(searchOf(undefined)).toBeNull()
  })
})

describe('typeColours', () => {
  it('slots types by how many entities the docket has of each, most first, as the graph browser does', () => {
    const colourOf = typeColours(graph())
    expect(colourOf('service')).toBe('var(--series-1)')
    expect(colourOf('datastore')).toBe('var(--series-2)')
    expect(colourOf('unknown')).toBe('var(--graph-other)')
  })
})

describe('boardOf', () => {
  it('draws every node as a case card, with its code, colour and weight', () => {
    const board = boardOf(graph())
    expect(board.nodes.map(({ id, code, colour, weight, weak, flag, exhibits }) => ({ id, code, colour, weight, weak, flag, exhibits }))).toEqual([
      { id: 'service.orders', code: 'SVC', colour: 'var(--series-1)', weight: 0.4, weak: true, flag: null, exhibits: null },
      { id: 'datastore.orders-db', code: 'DS', colour: 'var(--series-2)', weight: null, weak: false, flag: null, exhibits: null },
      { id: 'team.payments', code: 'REF', colour: 'var(--mute)', weight: null, weak: false, flag: 'Not on record', exhibits: null },
    ])
    expect(board.links.map((link) => link.rel)).toEqual(['reads', 'owned_by'])
    expect([...board.placed.keys()].sort()).toEqual(['datastore.orders-db', 'service.orders', 'team.payments'])
  })

  it('fades nothing when no projection returned a subgraph', () => {
    expect(boardOf(graph()).emphasis).toBeNull()
  })

  it("keeps a projection's subgraph at full strength and fades the canonical context", () => {
    const returned = graph({
      links: [
        { source: 'service.orders', rel: 'reads', target: 'datastore.orders-db', via: 'adapter', foundBy: ['neo4j'], confidence: 0.3 },
        { source: 'service.orders', rel: 'owned_by', target: 'team.payments', via: 'canonical' },
      ],
    })
    const board = boardOf(returned)
    expect(board.emphasis).toEqual(new Set(['service.orders']))
    expect(board.links.map((link) => link.weak)).toEqual([true, false])
  })
})

describe('applyHostContext', () => {
  it("follows the host's theme and nothing else", () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement
    applyHostContext({ theme: 'dark', styles: { variables: { '--color-background-primary': '#000' } } }, root)
    expect(root.dataset.theme).toBe('dark')
    applyHostContext({}, root)
    expect(root.dataset.theme).toBe('dark')
  })
})
