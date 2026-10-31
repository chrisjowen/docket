import { describe, expect, it } from 'vitest'

import { edgeKey } from '$lib/model.js'
import { SEARCH_SCHEMA, type SearchGraph } from '../../../docket/src/mcp/types.js'
import { boardOf, hasSubgraph, searchOf, typeColours } from './board.js'

const graph = (): SearchGraph => ({
  schema: SEARCH_SCHEMA,
  query: 'orders',
  project: { name: 'shop', root: '/work/shop' },
  matches: [{ id: 'service.orders', type: 'service', title: 'Orders API', path: '.docket/resources/orders.md', foundBy: ['local'] }],
  nodes: [
    { id: 'service.orders', type: 'service', title: 'Orders API', path: '.docket/resources/orders.md', match: true, ghost: false, via: 'adapter' },
    { id: 'team.payments', type: 'team', title: 'Payments', path: '.docket/resources/payments.md', match: false, ghost: false, via: 'canonical' },
    { id: 'service.ledger', type: '', title: 'service.ledger', match: false, ghost: true, via: 'canonical' }
  ],
  links: [
    { source: 'service.orders', rel: 'owned_by', target: 'team.payments', via: 'canonical' },
    { source: 'service.orders', rel: 'depends_on', target: 'service.ledger', via: 'canonical' },
    { source: 'team.payments', rel: 'uses', target: 'service.ledger', via: 'canonical' }
  ],
  paths: [],
  omitted: 0,
  types: [
    { name: 'team', icon: 'users', count: 2 },
    { name: 'service', icon: 'server', count: 7 }
  ],
  sources: [{ name: 'local', hits: 1 }],
  index: { synced: true, behind: 0 },
  viewer: 'http://127.0.0.1:4400/',
  warnings: []
})

/** The scout report's case: a projection returned orders -> ledger -> ledger-db; payments is only a neighbour in the files. */
const subgraph = (): SearchGraph => ({
  ...graph(),
  nodes: [
    { id: 'service.orders', type: 'service', title: 'Orders API', path: '.docket/resources/orders.md', match: true, ghost: false, via: 'adapter' },
    { id: 'service.ledger', type: 'service', title: 'Ledger', path: '.docket/resources/ledger.md', match: false, ghost: false, via: 'adapter' },
    { id: 'datasource.ledger-db', type: 'datasource', title: 'Ledger DB', path: '.docket/resources/ledger-db.md', match: false, ghost: false, via: 'adapter' },
    { id: 'team.payments', type: 'team', title: 'Payments', path: '.docket/resources/payments.md', match: false, ghost: false, via: 'canonical' }
  ],
  links: [
    { source: 'service.orders', rel: 'depends_on', target: 'service.ledger', via: 'adapter', foundBy: ['graphy'], confidence: 0.9, why: ['calls it'] },
    { source: 'service.ledger', rel: 'depends_on', target: 'datasource.ledger-db', via: 'adapter', foundBy: ['graphy'] },
    { source: 'service.orders', rel: 'owned_by', target: 'team.payments', via: 'canonical' }
  ],
  paths: [{ nodes: ['service.orders', 'service.ledger', 'datasource.ledger-db'], foundBy: ['graphy'] }]
})

describe('hasSubgraph', () => {
  it('tells a returned subgraph from matches with canonical context only', () => {
    expect(hasSubgraph(graph())).toBe(false)
    expect(hasSubgraph(subgraph())).toBe(true)
  })
})

describe('boardOf', () => {
  it("draws a returned subgraph at full strength, and the files' context faded", () => {
    const board = boardOf(subgraph(), null)
    expect(board.nodes.map((node) => node.id)).toEqual(['service.orders', 'service.ledger', 'datasource.ledger-db', 'team.payments'])
    expect([...(board.emphasis?.nodes ?? [])]).toEqual(['service.orders', 'service.ledger', 'datasource.ledger-db'])
    expect(board.emphasis?.links).toEqual(
      new Set([
        edgeKey({ source: 'service.orders', rel: 'depends_on', target: 'service.ledger' }),
        edgeKey({ source: 'service.ledger', rel: 'depends_on', target: 'datasource.ledger-db' })
      ])
    )
    // The graph view is handed only what it draws.
    expect(board.links[0]).toEqual({
      key: edgeKey({ source: 'service.orders', rel: 'depends_on', target: 'service.ledger' }),
      source: 'service.orders',
      rel: 'depends_on',
      target: 'service.ledger'
    })
  })

  it('still brings a picked resource forward over a returned subgraph, canonical context included', () => {
    const board = boardOf(subgraph(), 'team.payments')
    expect([...(board.emphasis?.nodes ?? [])].sort()).toEqual(['service.orders', 'team.payments'])
  })

  it('draws every node and link, nothing faded until a resource is picked, when no subgraph was returned', () => {
    const board = boardOf(graph(), null)
    expect(board.nodes.map((node) => node.id)).toEqual(['service.orders', 'team.payments', 'service.ledger'])
    expect(board.nodes[2]?.ghost).toBe(true)
    expect(board.links.map((link) => link.key)).toEqual(graph().links.map(edgeKey))
    expect(board.emphasis).toBeNull()
  })

  it('brings a picked resource and its neighbourhood forward', () => {
    const board = boardOf(graph(), 'team.payments')
    expect([...(board.emphasis?.nodes ?? [])].sort()).toEqual(['service.ledger', 'service.orders', 'team.payments'])
    expect(board.emphasis?.links).toEqual(
      new Set([
        edgeKey({ source: 'service.orders', rel: 'owned_by', target: 'team.payments' }),
        edgeKey({ source: 'team.payments', rel: 'uses', target: 'service.ledger' })
      ])
    )
  })

  it('ignores a pick that is not on the board', () => {
    expect(boardOf(graph(), 'gone').emphasis).toBeNull()
  })
})

describe('typeColours', () => {
  it('slots types by how many the whole docket has, as the casebook does', () => {
    const colour = typeColours(graph())
    expect(colour('service')).toBe('var(--series-1)')
    expect(colour('team')).toBe('var(--series-2)')
    expect(colour('unknown')).toBe('var(--graph-other)')
  })
})

describe('searchOf', () => {
  it('reads a docket_search result and nothing else', () => {
    expect(searchOf(graph())?.query).toBe('orders')
    expect(searchOf({ schema: 'other' })).toBeNull()
    expect(searchOf(null)).toBeNull()
  })
})
