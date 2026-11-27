// SPDX-License-Identifier: AGPL-3.0-only
import { SEARCH_SCHEMA, type SearchGraph } from '@chrisjowen/docket/mcp/types'

import type { CardLink, CardNode } from '$lib/components/graph/card-graph.svelte'
import { typeCode, weightClass } from '$lib/docket'
import { layoutCards, type Point } from '$lib/graph/cards'
import { edgeKey, slotColour } from '$lib/graph/model'
import { bandOf } from '$lib/trust/bands'

export type { SearchGraph, SearchLink, SearchMatch, SearchNode } from '@chrisjowen/docket/mcp/types'

/** A docket_search result as the Record's network draws it: case cards, their connectors and where each card sits. */
export interface Board {
  nodes: CardNode[]
  links: CardLink[]
  placed: Map<string, Point>
  /** What stays at full strength while nothing is picked: what a projection returned, when one returned a subgraph. */
  emphasis: Set<string> | null
}

/** The search result, when a tool result carries one. */
export const searchOf = (structured: unknown): SearchGraph | null =>
  typeof structured === 'object' && structured !== null && (structured as { schema?: unknown }).schema === SEARCH_SCHEMA
    ? (structured as SearchGraph)
    : null

/** Whether a projection returned a subgraph for the search: anything on the board besides matches it found. */
export const hasSubgraph = (graph: SearchGraph): boolean =>
  graph.links.some((link) => link.via === 'adapter') || graph.nodes.some((node) => !node.match && node.via === 'adapter')

/**
 * Each type's colour, slotted by how many entities the whole docket has of
 * it - most common first - as the graph browser slots them (`typeSlots`), so
 * a type wears the same colour here as in the cloud.
 */
export const typeColours = (graph: SearchGraph): ((type: string) => string) => {
  const ordered = [...graph.types].sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const slots = new Map(ordered.map((type, index) => [type.name, index + 1]))
  return (type) => slotColour(slots.get(type))
}

/** How far a match's evidence carries it; null for what is on the board as context. */
export const weightOf = (graph: SearchGraph, id: string): number | null => graph.matches.find((match) => match.id === id)?.confidence ?? null

/**
 * The board for a search: every node the search put on it as a case card,
 * every link as a connector, laid out once. When a projection returned a
 * subgraph, it stays at full strength and the canonical context fades
 * (docket's adapter spec §13); when none did, nothing fades.
 */
export const boardOf = (graph: SearchGraph): Board => {
  const colourOf = typeColours(graph)
  const nodes: CardNode[] = graph.nodes.map((node) => {
    const weight = weightOf(graph, node.id)
    const weak = weight !== null && weightClass(weight) === 'low'
    return {
      id: node.id,
      title: node.title,
      type: node.type,
      ghost: node.ghost,
      code: node.ghost ? 'REF' : typeCode(node.type),
      colour: node.ghost ? 'var(--mute)' : colourOf(node.type),
      weight,
      exhibits: null,
      flag: node.ghost ? 'Not on record' : null,
      overruled: false,
      weak,
      recent: false,
    }
  })
  const links: CardLink[] = graph.links.map((link) => ({
    key: edgeKey(link),
    source: link.source,
    target: link.target,
    rel: link.rel,
    // The search answer carries no ontology: docket's default bands classify its links.
    weak: link.confidence !== undefined && bandOf(link.confidence) === 'unverified',
  }))
  const placed = layoutCards(
    graph.nodes.map((node) => ({ id: node.id, type: node.ghost ? '' : node.type })),
    graph.links,
  )
  const emphasis = hasSubgraph(graph) ? new Set(graph.nodes.filter((node) => node.via !== 'canonical').map((node) => node.id)) : null
  return { nodes, links, placed, emphasis }
}
