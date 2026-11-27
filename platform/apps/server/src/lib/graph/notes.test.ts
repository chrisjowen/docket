// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import type { FactFilter } from './browse'
import type { UiEntity, UiGraph } from './model'
import { factNotes, filterNotes, LEDE_LENGTH, ledeOf, noteText, proseParts, railOf, relWords, sortNotes } from './notes'

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
  title: 'Orders',
  content: '# Orders\n\nOwns the order lifecycle,\nfrom cart to `datasource.orders-db` and [[team.core|the core team]].\n\n## Runtime\n\nRuns on Kubernetes.',
  evidence: [
    { source: 'code', path: 'orders/main.go', observedAt: '2026-10-01', observedBy: 'alice' },
    { source: 'human', note: 'Confirmed in standup', observedAt: '2026-10-03', observedBy: 'bob' },
  ],
  assessment: assessment(0.9, 'evidence', ['code', 'human']),
  provenance: { capturedBy: 'claude' },
  links: [
    {
      rel: 'depends_on',
      target: 'datasource.orders-db',
      attributes: { criticality: 'high', runtime: true, nested: { no: 1 } },
      evidence: [{ source: 'code', path: 'orders/db.go', note: 'Opens a pool to the orders database.', observedAt: '2026-10-02' }],
      assessment: assessment(0.7, 'evidence', ['code']),
    },
    { rel: 'owned_by', target: 'team.ghost', evidence: [], assessment: assessment(0.5, 'unevidenced', []) },
  ],
})
const db = entity('datasource.orders-db', 'datasource', { title: 'Orders DB', frontmatter: { summary: 'The orders Postgres.' } })
const core = entity('team.core', 'team', { title: 'Core' })
const graph = { entities: [orders, db, core], edges: [] } as unknown as UiGraph

const ALL: FactFilter = { q: '', kind: 'all', type: '', source: '', confidence: 'any', flag: 'all', single: false, about: '' }

describe('ledeOf', () => {
  it('is the summary, else the first paragraph of prose, joined onto one line', () => {
    expect(ledeOf(db)).toBe('The orders Postgres.')
    expect(ledeOf(orders)).toBe('Owns the order lifecycle, from cart to `datasource.orders-db` and [[team.core|the core team]].')
    expect(ledeOf(entity('x.y', 'x', { content: '- a list\n\n```\ncode\n```\n\n| a | b |\n\nAt last, prose.' }))).toBe('At last, prose.')
    expect(ledeOf(entity('x.y', 'x'))).toBe('')
  })

  it('cuts a long paragraph at the last sentence that fits', () => {
    const long = `${'A sentence that goes on. '.repeat(30)}`
    const lede = ledeOf(entity('x.y', 'x', { content: long }))
    expect(lede.length).toBeLessThanOrEqual(LEDE_LENGTH)
    expect(lede.endsWith('goes on.')).toBe(true)
  })
})

describe('proseParts', () => {
  it('links the records it names and leaves other code as words', () => {
    const titles = new Map([
      ['team.core', 'Core'],
      ['datasource.orders-db', 'Orders DB'],
    ])
    expect(proseParts('Uses `datasource.orders-db`, **not** `redis`, for [[team.core]] and [[team.core|them]]; [[team.none]].', titles)).toEqual([
      { text: 'Uses ' },
      { record: 'datasource.orders-db', text: 'Orders DB' },
      { text: ', not ' },
      { text: 'redis' },
      { text: ', for ' },
      { record: 'team.core', text: 'Core' },
      { text: ' and ' },
      { record: 'team.core', text: 'them' },
      { text: '; ' },
      { text: 'team.none' },
      { text: '.' },
    ])
  })

  it('takes out paired emphasis and leaves identifiers and arithmetic as written', () => {
    expect(proseParts('**Joins** on user_id via _order_items_ and ~~old~~ *new* rows, 2 * 3 of them.', new Map())).toEqual([
      { text: 'Joins on user_id via order_items and old new rows, 2 * 3 of them.' },
    ])
  })
})

describe('factNotes', () => {
  const notes = factNotes(graph)

  it('numbers every record and relation as the facts list does', () => {
    expect(notes.map((note) => note.no)).toEqual(['F-001', 'F-002', 'F-003', 'F-004', 'F-005'])
    expect(notes.map((note) => note.headline)).toEqual(['Orders', 'Orders depends on Orders DB', 'Orders owned by team.ghost', 'Orders DB', 'Core'])
  })

  it("writes a record's note from its lede and what its exhibits say, each cited inline", () => {
    const [note] = notes
    expect(note?.paragraphs[0]).toContainEqual({ record: 'team.core', text: 'the core team' })
    expect(note?.paragraphs[1]).toEqual([
      { text: 'Confirmed in standup ' },
      { exhibit: 'service.orders#1' },
      { text: '.' },
      { text: ' Also on file: ' },
      { exhibit: 'service.orders#0' },
      { text: '.' },
    ])
    expect(note?.exhibits).toEqual(['service.orders#0', 'service.orders#1'])
    expect(note?.standing.key).toBe('corroborated')
    // The latest exhibit's filer.
    expect(note?.filedBy).toBe('bob')
  })

  it("writes a relation's note from its scalar attributes, then its exhibits", () => {
    const link = notes[1]
    expect(link?.paragraphs[0]).toEqual([{ text: 'Recorded with criticality high, runtime yes.' }])
    expect(link?.paragraphs[1]).toEqual([{ text: 'Opens a pool to the orders database ' }, { exhibit: 'service.orders>0#0' }, { text: '.' }])
    expect(link?.standing.key).toBe('sole')
    expect(link?.filedBy).toBe('claude')
  })

  it('says when nothing is on file, or the target is not on record', () => {
    const ghost = notes[2]
    expect(noteText(ghost ?? { paragraphs: [] })).toBe("No document files team.ghost yet. No exhibit on file: it rests on Orders's document alone.")
    expect(ghost?.standing.key).toBe('unfiled')
    expect(noteText(notes[4] ?? { paragraphs: [] })).toBe('No exhibit on file: it rests on the document alone.')
    expect(notes[4]?.standing.key).toBe('uncorroborated')
  })
})

describe('filterNotes', () => {
  const notes = factNotes(graph)

  it('keeps what the facts filters keep, and the words also find what a note says', () => {
    expect(filterNotes(notes, { ...ALL, kind: 'link' }).map((note) => note.no)).toEqual(['F-002', 'F-003'])
    expect(filterNotes(notes, { ...ALL, q: 'standup' }).map((note) => note.no)).toEqual(['F-001'])
    expect(filterNotes(notes, { ...ALL, q: 'F-004' }).map((note) => note.no)).toEqual(['F-004'])
    expect(filterNotes(notes, { ...ALL, flag: 'weak', q: 'ghost' }).map((note) => note.no)).toEqual(['F-003'])
  })

  it('keeps exactly the notes about a record, not those of a record whose id extends it', () => {
    const replica = entity('datasource.orders-db-replica', 'datasource', { title: 'Replica' })
    const more = factNotes({ ...graph, entities: [orders, db, core, replica] })
    expect(filterNotes(more, { ...ALL, q: 'datasource.orders-db' }).map((note) => note.no)).toContain('F-006')
    expect(filterNotes(more, { ...ALL, about: 'datasource.orders-db' }).map((note) => note.no)).toEqual(['F-002', 'F-004'])
  })
})

describe('sortNotes and railOf', () => {
  const notes = factNotes(graph)

  it('orders by weight, exhibits or the latest filing, docket order otherwise', () => {
    expect(sortNotes(notes, 'docket').map((note) => note.no)).toEqual(['F-001', 'F-002', 'F-003', 'F-004', 'F-005'])
    expect(sortNotes(notes, 'strong')[0]?.no).toBe('F-001')
    expect(sortNotes(notes, 'weak').at(-1)?.no).toBe('F-001')
    expect(sortNotes(notes, 'latest')[0]?.no).toBe('F-001')
    expect(sortNotes(notes, 'exhibits')[0]?.no).toBe('F-001')
  })

  it('colours the rail by the fact\u2019s band, and the default alone as low', () => {
    expect(railOf({ band: 'high', basis: 'evidence' })).toBe('high')
    expect(railOf({ band: 'medium', basis: 'evidence' })).toBe('mid')
    expect(railOf({ band: 'high', basis: 'unevidenced' })).toBe('low')
    expect(railOf({})).toBe('none')
  })

  it('words a relation', () => {
    expect(relWords('depends_on')).toBe('depends on')
    expect(relWords('deployedTo')).toBe('deployed to')
  })
})
