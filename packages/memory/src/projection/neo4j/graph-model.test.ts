import { describe, expect, it } from 'vitest'

import { describeNeighbours, fulltextQuery, labelFor, relationshipTypeFor } from './graph-model.js'

describe('graph model', () => {
  it('turns a resource type into a label Cypher can take without quoting risk', () => {
    expect(labelFor('service')).toBe('Service')
    expect(labelFor('data-source')).toBe('DataSource')
    expect(labelFor('a`b; DROP')).toBe('ABDrop')
  })

  it('turns a relationship name into an upper-case relationship type', () => {
    expect(relationshipTypeFor('depends_on')).toBe('DEPENDS_ON')
    expect(relationshipTypeFor('owned-by')).toBe('OWNED_BY')
    expect(relationshipTypeFor('`x`')).toBe('X')
  })

  it('refuses a name with nothing usable in it', () => {
    expect(() => labelFor('***')).toThrow(/label/)
    expect(() => relationshipTypeFor('')).toThrow(/relationship/)
  })

  it('builds a full-text query that matches any word, with Lucene syntax escaped', () => {
    expect(fulltextQuery('where do uploads go?')).toBe('where OR do OR uploads OR go')
    expect(fulltextQuery('a:b (c) "d"')).toBe('a\\:b OR c OR d')
    expect(fulltextQuery('  ')).toBe('')
  })

  it('describes a node by its links in both directions', () => {
    expect(
      describeNeighbours([
        { direction: 'out', rel: 'depends_on', id: 'datasource.postgres' },
        { direction: 'in', rel: 'uses', id: 'service.web' }
      ])
    ).toBe('depends_on → datasource.postgres; ← uses service.web')
    expect(describeNeighbours([])).toBe('')
  })
})
