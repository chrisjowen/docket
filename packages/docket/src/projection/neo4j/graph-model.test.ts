import { describe, expect, it } from 'vitest'

import { entitiesOf, makeDocument } from '../../../test/entities.js'
import {
  NODE_PROPERTIES,
  describeNeighbours,
  fulltextQuery,
  labelFor,
  nodeProperties,
  relationshipRows,
  relationshipTypeFor
} from './graph-model.js'

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

  describe('merged entities', () => {
    const inManifest = { source: 'manifest', path: 'package.json', key: 'dependencies.pg' }
    const inCode = { source: 'code', path: 'src/db.ts', lines: '12' }
    const [orders] = entitiesOf([
      makeDocument({
        id: 'service.orders',
        path: '.docket/a.md',
        tags: ['core', 'orders'],
        evidence: [inCode],
        links: [
          {
            rel: 'depends_on',
            target: 'datasource.db',
            attributes: { criticality: 'high', confidence: 'spoofed', rel: 'spoofed', ports: { http: 80 } },
            evidence: [inManifest]
          },
          { rel: 'depends_on', target: 'datasource.db', evidence: [inCode] }
        ]
      }),
      makeDocument({
        id: 'service.orders',
        path: '.docket/b.md',
        links: [{ rel: 'depends_on', target: 'datasource.db', evidence: [inManifest] }]
      })
    ])
    if (!orders) throw new Error('fixture')

    it('writes one node per entity, with its evidence count and confidence', () => {
      const properties = nodeProperties(orders)
      expect(properties).toMatchObject({
        type: 'service',
        path: '.docket/a.md',
        paths: ['.docket/a.md', '.docket/b.md'],
        tags: 'core orders',
        confidence: 0.6,
        confidenceBasis: 'evidence',
        evidenceCount: 1,
        sources: ['code']
      })
      expect(JSON.parse(properties.evidence as string)).toEqual([inCode])
      // Everything written is cleared again when the node turns into a stub.
      expect(Object.keys(properties).sort()).toEqual([...NODE_PROPERTIES].sort())
    })

    it('writes one relationship per (source, rel, target), however often it was declared', () => {
      const rows = relationshipRows(orders)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        type: 'DEPENDS_ON',
        rel: 'depends_on',
        target: 'datasource.db',
        properties: {
          criticality: 'high',
          // A link attribute never shadows what queries rely on.
          rel: 'depends_on',
          // manifest 0.9 and code 0.6, independent: 1 - 0.1 * 0.4.
          confidence: 0.96,
          confidenceBasis: 'evidence',
          evidenceCount: 2,
          sources: ['code', 'manifest'],
          // Neo4j holds no maps, so a nested value is kept as JSON.
          ports: '{"http":80}'
        }
      })
      expect(JSON.parse(rows[0]?.properties.evidence as string)).toEqual([inManifest, inCode])
    })
  })
})
