import { describe, expect, it } from 'vitest'

import {
  EMPTY_FILTER,
  exhibitRows,
  filterExhibits,
  filterObservations,
  historyOf,
  observationRows,
  supersessions,
  type TableFilter
} from './browse.js'
import type { UiEntity, UiGraph } from './types.js'

const entity = (id: string, overrides: Partial<UiEntity> = {}): UiEntity => ({
  id,
  type: id.split('.')[0] ?? 'thing',
  title: id,
  path: `.docket/${id}.md`,
  paths: [`.docket/${id}.md`],
  tags: [],
  attributes: {},
  links: [],
  mentions: [],
  content: '',
  evidence: [],
  frontmatter: {},
  ...overrides
})

const GRAPH: UiGraph = {
  project: { name: 'acme', root: '/acme' },
  entities: [
    entity('service.orders', {
      evidence: [
        { source: 'code', path: 'src/orders.ts', lines: '1-20', observedAt: '2026-09-14T00:00:00.000Z' },
        { source: 'conversation', observedAt: '2026-10-01', eventAt: '2026-09-30T15:00:00Z', note: 'Deployed after the freeze' }
      ],
      assessment: { confidence: 0.9, basis: 'evidence', evidenceCount: 2, sources: ['code', 'conversation'] },
      links: [{ rel: 'stored_in', target: 'datasource.orders-db', evidence: [{ source: 'manifest', key: 'db.url' }] }]
    }),
    entity('datasource.orders-db', { assessment: { confidence: 0.3, basis: 'unevidenced', evidenceCount: 0, sources: [] } }),
    entity('decision.c'),
    entity('decision.b'),
    entity('decision.a')
  ],
  edges: [
    { source: 'decision.c', rel: 'supersedes', target: 'decision.b', dangling: false },
    { source: 'decision.b', rel: 'supersedes', target: 'decision.a', dangling: false },
    { source: 'service.orders', rel: 'stored_in', target: 'datasource.orders-db', dangling: false }
  ],
  types: [],
  relationships: [],
  diagnostics: [],
  index: { synced: true, behind: 0 }
}

const filter = (overrides: Partial<TableFilter>): TableFilter => ({ ...EMPTY_FILTER, ...overrides })
const ids = (rows: { entity: UiEntity }[]): string[] => rows.map((row) => row.entity.id)

describe('exhibit rows', () => {
  const rows = exhibitRows(GRAPH)

  it('carry the assessment and the latest day observed', () => {
    expect(rows[0]).toMatchObject({ sources: ['code', 'conversation'], confidence: 0.9, evidenceCount: 2, lastObserved: '2026-10-01' })
  })

  it('filter by type, source, assessment, date and text', () => {
    expect(ids(filterExhibits(rows, filter({ types: new Set(['datasource']) })))).toEqual(['datasource.orders-db'])
    expect(ids(filterExhibits(rows, filter({ sources: new Set(['code']) })))).toEqual(['service.orders'])
    expect(ids(filterExhibits(rows, filter({ assessment: 'high' })))).toEqual(['service.orders'])
    expect(ids(filterExhibits(rows, filter({ assessment: 'unevidenced' })))).toEqual(['datasource.orders-db'])
    expect(ids(filterExhibits(rows, filter({ from: '2026-09-01', to: '2026-09-20' })))).toEqual(['service.orders'])
    expect(ids(filterExhibits(rows, filter({ from: '2026-10-02' })))).toEqual([])
    expect(ids(filterExhibits(rows, filter({ text: 'orders db' })))).toEqual(['datasource.orders-db'])
  })
})

describe('observation rows', () => {
  const rows = observationRows(GRAPH)

  it('list exhibit and relationship evidence alike', () => {
    expect(rows.map((row) => [row.entity.id, row.link?.rel ?? null, row.location])).toEqual([
      ['service.orders', null, 'src/orders.ts:1-20'],
      ['service.orders', null, ''],
      ['service.orders', 'stored_in', 'db.url']
    ])
  })

  it('filter by the day observed, leaving out undated ones when a range is set', () => {
    expect(filterObservations(rows, filter({ from: '2026-09-01' })).map((row) => row.key)).toEqual([
      'service.orders#0',
      'service.orders#1'
    ])
    expect(filterObservations(rows, filter({ sources: new Set(['manifest']) }))).toHaveLength(1)
  })
})

describe('history', () => {
  it('files each dated observation under when it was observed, and separately under when it happened', () => {
    expect(historyOf(GRAPH).map((entry) => [entry.day, entry.semantics, entry.row.key])).toEqual([
      ['2026-10-01', 'observed', 'service.orders#1'],
      ['2026-09-30', 'event', 'service.orders#1'],
      ['2026-09-14', 'observed', 'service.orders#0']
    ])
  })

  it('chains supersessions from the current record back to the oldest', () => {
    expect(supersessions(GRAPH.edges)).toEqual([['decision.c', 'decision.b', 'decision.a']])
  })
})
