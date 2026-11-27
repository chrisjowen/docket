// SPDX-License-Identifier: AGPL-3.0-only
/**
 * New docket's template catalogue, in the browser: search, the built-in or
 * organisation filter and the domain tags narrow the cards as they change.
 */

/** One card, as the page's load gives it (`CatalogueEntry` in the ontology service). */
export interface CatalogueCard {
  id: string
  kind: 'built-in' | 'org'
  name: string
  description: string
  tags: string[]
  types: string[]
  relationships: number
}

export type CatalogueKind = 'all' | CatalogueCard['kind']

export interface CatalogueFilter {
  query: string
  kind: CatalogueKind
  /** A domain tag every card shown carries; null for any. */
  tag: string | null
}

/** Whether a card has every word typed in its name, description, tags or record types. */
export function matchesSearch(card: Pick<CatalogueCard, 'name' | 'description' | 'tags' | 'types'>, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = [card.name, card.description, ...card.tags, ...card.types.map((type) => type.replace(/[_-]/g, ' '))].join(' ').toLowerCase()
  return words.every((word) => text.includes(word))
}

export function filterCatalogue<T extends CatalogueCard>(cards: readonly T[], filter: CatalogueFilter): T[] {
  return cards.filter(
    (card) => (filter.kind === 'all' || card.kind === filter.kind) && (filter.tag === null || card.tags.includes(filter.tag)) && matchesSearch(card, filter.query),
  )
}

/** Every tag the cards carry, most used first, then alphabetically. */
export function catalogueTags(cards: readonly Pick<CatalogueCard, 'tags'>[]): string[] {
  const counts = new Map<string, number>()
  for (const card of cards) for (const tag of card.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag)
}

/** The record types a card names before "+N more". */
export const TYPES_SHOWN = 6

/** A type's name as a card shows it: `support_case` as "support case". */
export const typeLabel = (type: string) => type.replace(/[_-]/g, ' ')
