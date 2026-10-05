import { describe, expect, it } from 'vitest'

import { connectingPaths } from './paths.js'

const EDGES = [
  { source: 'service.orders', rel: 'owned_by', target: 'team.payments' },
  { source: 'service.orders', rel: 'depends_on', target: 'datasource.ledger' },
  { source: 'service.checkout', rel: 'depends_on', target: 'service.orders' },
  { source: 'team.payments', rel: 'member_of', target: 'org.acme' },
  { source: 'org.acme', rel: 'operates', target: 'system.far' }
]

describe('connectingPaths', () => {
  it('joins two entities through the shortest chain, walking links either way', () => {
    expect(connectingPaths(EDGES, ['service.checkout', 'team.payments'])).toEqual([
      {
        nodes: ['service.checkout', 'service.orders', 'team.payments'],
        steps: [
          { rel: 'depends_on', forward: true },
          { rel: 'owned_by', forward: true }
        ]
      }
    ])
    expect(connectingPaths(EDGES, ['datasource.ledger', 'team.payments'])).toEqual([
      {
        nodes: ['datasource.ledger', 'service.orders', 'team.payments'],
        steps: [
          { rel: 'depends_on', forward: false },
          { rel: 'owned_by', forward: true }
        ]
      }
    ])
  })

  it('gives one path per connected pair, shortest first', () => {
    const paths = connectingPaths(EDGES, ['service.orders', 'team.payments', 'service.checkout'])
    expect(paths.map((path) => path.nodes)).toEqual([
      ['service.orders', 'service.checkout'],
      ['service.orders', 'team.payments'],
      ['team.payments', 'service.orders', 'service.checkout']
    ])
  })

  it('leaves out pairs further apart than the longest useful chain', () => {
    expect(connectingPaths(EDGES, ['service.checkout', 'system.far'])).toEqual([])
    expect(connectingPaths(EDGES, ['service.checkout', 'system.far'], 5)).toHaveLength(1)
  })

  it('finds nothing for unconnected or unknown entities', () => {
    expect(connectingPaths(EDGES, ['service.orders'])).toEqual([])
    expect(connectingPaths(EDGES, ['service.orders', 'nothing.here'])).toEqual([])
  })
})
