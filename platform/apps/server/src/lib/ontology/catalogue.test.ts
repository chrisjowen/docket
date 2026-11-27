// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { catalogueTags, filterCatalogue, matchesSearch, type CatalogueCard } from './catalogue'

const card = (id: string, kind: CatalogueCard['kind'], tags: string[], types: string[], name = id): CatalogueCard => ({
  id,
  kind,
  name,
  description: `${name} description`,
  tags,
  types,
  relationships: 0,
})

const cards = [
  card('crm', 'built-in', ['sales', 'customers'], ['account', 'support_case'], 'Customer relationships (CRM)'),
  card('research', 'built-in', ['research'], ['paper', 'author']),
  card('org:1', 'org', ['sales'], ['deal', 'territory'], 'Field sales'),
]

describe('the template catalogue', () => {
  it('searches names, descriptions, tags and record types, every word', () => {
    expect(matchesSearch(cards[0] as CatalogueCard, 'support case')).toBe(true)
    expect(matchesSearch(cards[0] as CatalogueCard, 'CRM account')).toBe(true)
    expect(matchesSearch(cards[0] as CatalogueCard, 'crm paper')).toBe(false)
    expect(matchesSearch(cards[0] as CatalogueCard, '  ')).toBe(true)
  })

  it('narrows by built-in or organisation, by tag, and by search', () => {
    const ids = (filter: Parameters<typeof filterCatalogue>[1]) => filterCatalogue(cards, filter).map((each) => each.id)
    expect(ids({ query: '', kind: 'all', tag: null })).toEqual(['crm', 'research', 'org:1'])
    expect(ids({ query: '', kind: 'org', tag: null })).toEqual(['org:1'])
    expect(ids({ query: '', kind: 'built-in', tag: 'sales' })).toEqual(['crm'])
    expect(ids({ query: 'territory', kind: 'all', tag: 'sales' })).toEqual(['org:1'])
  })

  it('offers the tags the cards carry, most used first', () => {
    expect(catalogueTags(cards)).toEqual(['sales', 'customers', 'research'])
  })
})
