// SPDX-License-Identifier: AGPL-3.0-only
import type { UiEntity } from '@chrisjowen/docket/open/types'
import { describe, expect, it } from 'vitest'

import type { ActivityEntry } from '$lib/graph/browse'

import { countsOf, entryHits, exhibitHits, interleave, marked, memoryHits, noteHits, plainText, proseOf, ranked, snippet, termsOf } from './groups'

const entity = (id: string, type: string, extra: Partial<UiEntity> = {}) =>
  ({ id, type, title: id, path: `${id}.md`, paths: [], tags: [], attributes: {}, links: [], mentions: [], content: '', evidence: [], frontmatter: {}, ...extra }) as UiEntity

const platform = { slug: 'platform', name: 'Platform' }

const orders = entity('service.orders', 'service', {
  title: 'Orders',
  content: '# Orders\n\nOwns the order **lifecycle**, from cart to [[team.core|Core]] fulfilment.',
  evidence: [{ source: 'code', path: 'src/charge.ts', note: 'Calls Stripe before an order is accepted.', observedAt: '2026-09-02' }],
  links: [{ rel: 'depends_on', target: 'system.stripe', evidence: [{ source: 'code', note: 'Charges cards through Stripe.' }] }],
})
const stripe = entity('system.stripe', 'system', { title: 'Stripe', frontmatter: { summary: 'The payment processor behind Orders.' } })
const core = entity('team.core', 'team', { title: 'Core', evidence: [{ source: 'user', path: 'teams/core.md', observedAt: '2026-01-05' }] })
const graph = { entities: [orders, stripe, core] }

describe('the words a query searches on', () => {
  it('drops the commonest words, unless nothing else is left', () => {
    expect(termsOf('Why is the Orders service on Postgres?')).toEqual(['orders', 'service', 'postgres'])
    expect(termsOf('who is it')).toEqual(['who', 'is', 'it'])
  })

  it('keeps what holds at least half the words, most first, else in the order given', () => {
    const items = ['orders only', 'postgres and orders', 'nothing', 'postgres only']
    expect(ranked(items, (item) => item, ['orders', 'postgres'])).toEqual(['postgres and orders', 'orders only', 'postgres only'])
    expect(ranked(items, (item) => item, ['orders', 'postgres', 'only'])).toEqual(['orders only', 'postgres and orders', 'postgres only'])
    expect(ranked(items, (item) => item, [])).toEqual([])
  })

  it('marks every word wherever it appears, whatever its case', () => {
    expect(marked('Orders on postgres', ['orders', 'postgres'])).toEqual([
      { text: 'Orders', mark: true },
      { text: ' on ', mark: false },
      { text: 'postgres', mark: true },
    ])
  })

  it('shows the text around the first word found, cut at words', () => {
    const text = `${'lead '.repeat(40)}the orders table ${'tail '.repeat(40)}`.trim()
    const shown = snippet(text, ['orders'], 60)
    expect(shown.startsWith('…')).toBe(true)
    expect(shown.endsWith('…')).toBe(true)
    expect(shown).toContain('the orders table')
    expect(snippet('short', ['orders'], 60)).toBe('short')
  })
})

describe('a record as prose', () => {
  it('reads its summary first, else its body without Markdown or a heading that repeats its title', () => {
    expect(proseOf(stripe)).toBe('The payment processor behind Orders.')
    expect(proseOf(orders)).toBe('Owns the order lifecycle, from cart to Core fulfilment.')
    expect(plainText('- a [link](https://x) and `code`\n```\nhidden\n```')).toBe('a link and code')
  })
})

describe('what direct search finds besides the records', () => {
  it('finds facts with prose of their own as notes, numbered across the docket', () => {
    const notes = noteHits(platform, graph, termsOf('stripe'))
    expect(notes.map((note) => [note.no, note.title, note.entity])).toEqual([
      // Orders is fact 1 and its link fact 2; Stripe is fact 3.
      ['F-002', 'Orders depends on Stripe', 'service.orders'],
      ['F-003', 'Stripe', 'system.stripe'],
    ])
    expect(notes[0]?.text).toBe('Charges cards through Stripe.')
    // Leaving a record out keeps the others' numbers.
    expect(noteHits(platform, graph, termsOf('stripe'), (record) => record.id !== 'service.orders').map((note) => note.no)).toEqual(['F-003'])
  })

  it('lists what mem0 recalled, with what each record says and how well it matched', () => {
    const entities = new Map(graph.entities.map((record) => [record.id, record]))
    const matches = [
      { id: 'system.stripe', foundBy: ['neo4j', 'mem0'], score: 0.82 },
      { id: 'service.orders', foundBy: ['neo4j'], score: 0.9 },
      { id: 'gone', foundBy: ['mem0'] },
    ]
    expect(memoryHits(platform, matches, entities, ['stripe'])).toEqual([
      { workspace: platform, id: 'system.stripe', title: 'Stripe', type: 'system', text: 'The payment processor behind Orders.', score: 0.82 },
    ])
  })

  it('finds exhibits by their note, location or record, numbered as filed', () => {
    const exhibits = exhibitHits(platform, graph, termsOf('stripe'))
    expect(exhibits.map((exhibit) => [exhibit.no, exhibit.entity, exhibit.text, exhibit.location])).toEqual([
      [2, 'service.orders', 'Calls Stripe before an order is accepted.', 'src/charge.ts'],
      [3, 'service.orders', 'Charges cards through Stripe.', ''],
    ])
    // The Core team's exhibit, filed first, is Ex. 1 whatever is left out.
    expect(exhibitHits(platform, graph, ['core'], (record) => record.id === 'team.core').map((exhibit) => [exhibit.no, exhibit.text])).toEqual([[1, 'teams/core.md']])
  })

  it('finds docket entries by their wording or record, numbered as on the docket sheet', () => {
    const activity: ActivityEntry[] = [
      {
        id: 'a1',
        at: '2026-10-01T09:00:00Z',
        channel: 'mcp',
        action: 'remember',
        actorLabel: '@alice',
        outcome: 'ok',
        resourceId: 'system.stripe',
        documents: [{ path: 'stripe.md', change: 'created' }],
        evidenceCount: 0,
        requestId: 'r1',
      },
    ]
    const entries = entryHits(platform, graph, activity, termsOf('stripe'))
    expect(entries.map((entry) => [entry.no, entry.kind, entry.entity])).toEqual([
      [3, 'change', 'system.stripe'],
      [2, 'observed', 'service.orders'],
    ])
    expect(entries[1]?.text).toBe('Calls Stripe before an order is accepted.')
  })

  it('counts each kind, and all of them', () => {
    expect(countsOf(2, { notes: [], memory: [], exhibits: exhibitHits(platform, graph, ['stripe']), entries: [] })).toEqual({
      notes: 0,
      memory: 0,
      records: 2,
      exhibits: 2,
      entries: 0,
      all: 4,
    })
  })
})

describe('several dockets’ results as one list', () => {
  it('takes each list’s next in turn, then what the longer ones still hold', () => {
    expect(interleave([['a1', 'a2', 'a3'], ['b1'], [], ['c1', 'c2']])).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'a3'])
    expect(interleave([])).toEqual([])
  })
})
