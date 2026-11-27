// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import {
  byDay,
  docketSheet,
  evidenceTrails,
  exhibitsOf,
  factRows,
  filterFacts,
  filterTrails,
  groupByFact,
  supersessions,
  timelineOf,
  type ActivityEntry,
  type FactFilter,
} from './browse'
import type { UiEntity, UiGraph } from './model'

const assessment = (confidence: number, basis: 'evidence' | 'stated' | 'unevidenced', sources: string[], evidenceCount = sources.length) => ({
  confidence,
  basis,
  evidenceCount,
  sources,
})

const entity = (id: string, type: string, extra: Partial<UiEntity> = {}): UiEntity => ({
  id,
  type,
  title: id.split('.')[1] ?? id,
  path: `.docket/${type}/${id}.md`,
  paths: [`.docket/${type}/${id}.md`],
  tags: [],
  attributes: {},
  links: [],
  mentions: [],
  content: '',
  evidence: [],
  frontmatter: {},
  assessment: assessment(0.5, 'unevidenced', []),
  ...extra,
})

const orders = entity('service.orders', 'service', {
  evidence: [
    { source: 'code', path: 'orders/main.go', observedAt: '2026-10-01T09:00:00.000Z', observedBy: 'alice (web)' },
    { source: 'human', note: 'confirmed in standup', observedAt: '2026-10-03', eventAt: '2026-09-30' },
  ],
  assessment: assessment(0.9, 'evidence', ['code', 'human']),
  links: [
    { rel: 'depends_on', target: 'datasource.orders-db', evidence: [{ source: 'code', path: 'orders/db.go', observedAt: '2026-10-02' }], assessment: assessment(0.7, 'evidence', ['code']) },
    { rel: 'owned_by', target: 'team.core', evidence: [], assessment: assessment(0.5, 'unevidenced', []) },
  ],
})
const decision = entity('decision.orders-on-postgres', 'decision', {
  attributes: { decided: '2026-08-14', status: 'accepted' },
  frontmatter: { id: 'decision.orders-on-postgres', review: '2027-01-01', title: 'x' },
  links: [{ rel: 'supersedes', target: 'decision.orders-on-dynamodb', evidence: [] }],
  assessment: assessment(0.3, 'stated', ['doc']),
})
const old = entity('decision.orders-on-dynamodb', 'decision')

const graph: UiGraph = {
  project: { name: 'p', root: '/' },
  entities: [orders, decision, old],
  edges: [
    { source: 'service.orders', rel: 'depends_on', target: 'datasource.orders-db', dangling: true },
    { source: 'decision.orders-on-postgres', rel: 'supersedes', target: 'decision.orders-on-dynamodb', dangling: false },
  ],
  types: [],
  relationships: [],
  diagnostics: [],
  index: { synced: true, behind: 0 },
}

const change: ActivityEntry = {
  id: 'e1',
  at: '2026-10-01T09:00:01.000Z',
  channel: 'ui',
  action: 'add-evidence',
  actorLabel: '@alice',
  outcome: 'ok',
  resourceId: 'service.orders',
  documents: [{ path: orders.path, change: 'updated', revision: 2 }],
  evidenceCount: 1,
  requestId: 'r1',
}

const ALL: FactFilter = { q: '', kind: 'all', type: '', source: '', confidence: 'any', flag: 'all', single: false, about: '' }

describe('facts', () => {
  const rows = factRows(graph)

  it('lists every exhibit and every relationship it states, with what stands behind each', () => {
    expect(rows.map((row) => [row.key, row.kind, row.link?.rel ?? null])).toEqual([
      ['service.orders', 'exhibit', null],
      ['service.orders>0', 'link', 'depends_on'],
      ['service.orders>1', 'link', 'owned_by'],
      ['decision.orders-on-postgres', 'exhibit', null],
      ['decision.orders-on-postgres>0', 'link', 'supersedes'],
      ['decision.orders-on-dynamodb', 'exhibit', null],
    ])
    const [first] = rows
    expect(first).toMatchObject({ sources: ['code', 'human'], confidence: 0.9, evidenceCount: 2, lastObserved: '2026-10-03', weak: false, strong: true, single: false })
  })

  it('marks strong facts, weak facts - low confidence or only the default - and facts on a single source', () => {
    const flags = Object.fromEntries(rows.map((row) => [row.key, [row.strong, row.weak, row.single]]))
    expect(flags).toEqual({
      'service.orders': [true, false, false],
      'service.orders>0': [false, false, true],
      'service.orders>1': [false, true, false],
      'decision.orders-on-postgres': [false, true, true],
      // No assessment: weak when nothing is behind it.
      'decision.orders-on-postgres>0': [false, true, false],
      'decision.orders-on-dynamodb': [false, true, false],
    })
  })

  it('does not count the ontology default as strong, however high it is', () => {
    const [row] = factRows({ ...graph, entities: [entity('x.y', 'x', { assessment: assessment(0.95, 'unevidenced', []) })] })
    expect(row).toMatchObject({ strong: false, weak: true })
  })

  it('filters by flag, kind, type, source, confidence and words', () => {
    const keys = (filter: Partial<FactFilter>) => filterFacts(rows, { ...ALL, ...filter }).map((row) => row.key)
    expect(keys({ flag: 'strong' })).toEqual(['service.orders'])
    expect(keys({ single: true })).toEqual(['service.orders>0', 'decision.orders-on-postgres'])
    expect(keys({ flag: 'weak', kind: 'exhibit' })).toEqual(['decision.orders-on-postgres', 'decision.orders-on-dynamodb'])
    expect(keys({ flag: 'weak', single: true })).toEqual(['decision.orders-on-postgres'])
    expect(keys({ about: 'decision.orders-on-dynamodb' })).toEqual(['decision.orders-on-postgres>0', 'decision.orders-on-dynamodb'])
    expect(keys({ type: 'service', kind: 'link' })).toEqual(['service.orders>0', 'service.orders>1'])
    expect(keys({ source: 'human' })).toEqual(['service.orders'])
    expect(keys({ confidence: 'high' })).toEqual(['service.orders'])
    expect(keys({ confidence: 'unevidenced' })).toEqual(['service.orders>1', 'decision.orders-on-dynamodb'])
    expect(keys({ q: 'orders-db DEPENDS' })).toEqual(['service.orders>0'])
  })
})

describe('the timeline', () => {
  const entries = timelineOf(graph, [change])

  it('dates what documents record, when evidence says things happened and were seen, and the activity log, newest first', () => {
    expect(entries.map((entry) => [entry.kind, entry.at, entry.field, entry.entity?.id ?? null])).toEqual([
      ['decision', '2027-01-01', 'review', 'decision.orders-on-postgres'],
      ['observed', '2026-10-03', 'observedAt', 'service.orders'],
      ['observed', '2026-10-02', 'observedAt', 'service.orders'],
      ['change', '2026-10-01T09:00:01.000Z', 'add-evidence', 'service.orders'],
      ['observed', '2026-10-01T09:00:00.000Z', 'observedAt', 'service.orders'],
      ['event', '2026-09-30', 'eventAt', 'service.orders'],
      ['decision', '2026-08-14', 'decided', 'decision.orders-on-postgres'],
    ])
    expect(entries.find((entry) => entry.at === '2026-10-02')?.link).toEqual({ rel: 'depends_on', target: 'datasource.orders-db' })
  })

  it('leaves out values that are not dates and docket’s own fields', () => {
    const odd = entity('event.launch', 'event', { attributes: { status: 'done', count: 3, when: '2026-13' }, frontmatter: { id: '2026-01-01' } })
    expect(timelineOf({ ...graph, entities: [odd] }, [])).toEqual([])
  })

  it('groups by day, keeping the order', () => {
    expect(byDay(entries).map(([day, items]) => [day, items.length])).toEqual([
      ['2027-01-01', 1],
      ['2026-10-03', 1],
      ['2026-10-02', 1],
      ['2026-10-01', 2],
      ['2026-09-30', 1],
      ['2026-08-14', 1],
    ])
  })

  it('follows supersedes chains from the record in force', () => {
    expect(
      supersessions([
        { source: 'c', rel: 'supersedes', target: 'b' },
        { source: 'b', rel: 'supersedes', target: 'a' },
        { source: 'x', rel: 'depends_on', target: 'c' },
      ]),
    ).toEqual([['c', 'b', 'a']])
  })
})

describe('evidence trails', () => {
  const documents = [
    { path: orders.path, origin: 'cloud', originRef: null, revision: 2, createdBy: '@alice', createdAt: '2026-09-01T00:00:00.000Z' },
    { path: '.docket/team/team.core.md', origin: 'repo', originRef: 'alice/platform', revision: 1, createdBy: 'github', createdAt: '2026-09-01T00:00:00.000Z' },
  ]
  const trails = evidenceTrails(graph, documents, [change])

  it('lists every document with the evidence its exhibits hold and the changes that touched it', () => {
    expect(trails.map((trail) => [trail.path, trail.entities.map((e) => e.id), trail.items.length, trail.sources, trail.changes.length])).toEqual([
      ['.docket/decision/decision.orders-on-dynamodb.md', ['decision.orders-on-dynamodb'], 0, [], 0],
      ['.docket/decision/decision.orders-on-postgres.md', ['decision.orders-on-postgres'], 0, [], 0],
      [orders.path, ['service.orders'], 3, ['code', 'human'], 1],
      ['.docket/team/team.core.md', [], 0, [], 0],
    ])
    const ordersTrail = trails.find((trail) => trail.path === orders.path)
    expect(ordersTrail?.document?.origin).toBe('cloud')
    expect(ordersTrail?.items.map((item) => [item.source, item.location, item.link?.rel ?? null])).toEqual([
      ['code', 'orders/main.go', null],
      ['human', '', null],
      ['code', 'orders/db.go', 'depends_on'],
    ])
  })

  it('groups a document\u2019s evidence by the exhibit or link it is about', () => {
    const items = trails.find((trail) => trail.path === orders.path)?.items ?? []
    expect(groupByFact(items).map((group) => [group[0]?.link?.rel ?? 'itself', group.length])).toEqual([
      ['itself', 2],
      ['depends_on', 1],
    ])
  })

  it('filters by source, words, and documents with no evidence', () => {
    const paths = (filter: Partial<Parameters<typeof filterTrails>[1]>) =>
      filterTrails(trails, { q: '', source: '', bare: false, ...filter }).map((trail) => trail.path)
    expect(paths({ source: 'human' })).toEqual([orders.path])
    expect(paths({ q: 'db.go' })).toEqual([orders.path])
    expect(paths({ bare: true })).toHaveLength(3)
  })
})

describe('exhibits', () => {
  const exhibits = exhibitsOf(graph)

  it('numbers every piece of evidence in the docket in the order it was filed', () => {
    expect(exhibits.map((exhibit) => [exhibit.no, exhibit.key, exhibit.at ?? null])).toEqual([
      [1, 'service.orders#0', '2026-10-01T09:00:00.000Z'],
      [2, 'service.orders>0#0', '2026-10-02'],
      [3, 'service.orders#1', '2026-10-03'],
    ])
    expect(exhibits[1]?.link).toEqual({ rel: 'depends_on', target: 'datasource.orders-db' })
    expect(exhibits[0]?.location).toBe('orders/main.go')
  })

  it('files undated evidence last', () => {
    const undated = entity('service.billing', 'service', { evidence: [{ source: 'human', note: 'said so' }] })
    const numbered = exhibitsOf({ ...graph, entities: [undated, ...graph.entities] })
    expect(numbered.at(-1)).toMatchObject({ no: 4, key: 'service.billing#0' })
  })
})

describe('the docket sheet', () => {
  it('numbers every entry, oldest first, and lists them newest first', () => {
    const sheet = docketSheet(timelineOf(graph, [change]))
    expect(sheet.map((entry) => entry.no)).toEqual([7, 6, 5, 4, 3, 2, 1])
    expect(sheet.at(-1)).toMatchObject({ no: 1, field: 'decided' })
  })
})
