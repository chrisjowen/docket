// SPDX-License-Identifier: AGPL-3.0-only
import { isMap, isScalar, parseDocument } from 'yaml'

import { TEMPLATES, type TemplateId } from './templates.js'

/**
 * The template catalogue New docket searches: the built-in templates and the
 * org's own, each with what it holds (its record types and how many
 * relationships), so a card can say what a template is without opening it.
 */

/** The domains each built-in template is about, which the catalogue filters by. */
export const BUILT_IN_TAGS: Readonly<Record<TemplateId, readonly string[]>> = {
  sdlc: ['software', 'engineering'],
  'lean-catalogue': ['software'],
  'people-org': ['people'],
  crm: ['sales', 'customers'],
  research: ['research'],
  'personal-knowledge': ['personal', 'people'],
  'product-catalogue': ['commerce'],
  blank: [],
}

/** What an ontology holds: its record types, in the file's order, and how many relationships. */
export interface Contents {
  types: string[]
  relationships: number
}

/** The record types and relationship count of an ontology's text; empty for text that is not one. */
export function contentsOf(yaml: string): Contents {
  try {
    const doc = parseDocument(yaml)
    const keys = (name: string) => {
      const node = doc.get(name, true)
      return isMap(node) ? node.items.map((pair) => String(isScalar(pair.key) ? pair.key.value : pair.key)) : []
    }
    return { types: keys('resourceTypes'), relationships: keys('relationships').length }
  } catch {
    return { types: [], relationships: 0 }
  }
}

/** One card in the catalogue. */
export interface CatalogueEntry extends Contents {
  /** A built-in template's id, or `org:<uuid>` for one of the org's. */
  id: string
  kind: 'built-in' | 'org'
  name: string
  description: string
  tags: string[]
}

/** Tags as people type them: lowercase words, trimmed, without repeats, at most 8 of 30 characters each. */
export function normaliseTags(raw: string | readonly string[]): string[] {
  const words = (typeof raw === 'string' ? raw.split(',') : raw).map((tag) => tag.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 30)).filter(Boolean)
  return [...new Set(words)].slice(0, 8)
}

let builtIn: CatalogueEntry[] | undefined

/** The built-in templates as catalogue cards, read once. */
export function builtInCatalogue(): CatalogueEntry[] {
  builtIn ??= TEMPLATES.map((template) => ({
    id: template.id,
    kind: 'built-in' as const,
    name: template.name,
    description: template.description,
    tags: [...BUILT_IN_TAGS[template.id]],
    ...contentsOf(template.yaml),
  }))
  return builtIn
}
