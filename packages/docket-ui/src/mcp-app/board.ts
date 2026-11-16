import { SEARCH_SCHEMA, type SearchGraph } from '../../../docket/src/mcp/types.js'
import type { CardLink, CardNode } from '$lib/components/card-graph.svelte'
import { edgeKey, neighbourhood, slotColour, slotsByCount, typeCode } from '$lib/model.js'

export type { SearchGraph, SearchMatch, SearchNode } from '../../../docket/src/mcp/types.js'

export interface Board {
  nodes: CardNode[]
  links: CardLink[]
  /** What stays at full strength once a resource is picked: it, its neighbours and its links. Null: everything. */
  emphasis: { nodes: Set<string>; links: Set<string> } | null
}

/** Whether a projection returned a subgraph for the search: anything on the board besides matches it found. */
export const hasSubgraph = (graph: SearchGraph): boolean =>
  graph.links.some((link) => link.via === 'adapter') || graph.nodes.some((node) => !node.match && node.via === 'adapter')

/**
 * The evidence board for a search, as the casebook draws it - a case card for
 * each resource, as Docket Cloud draws its network: every match,
 * every node and link of the subgraphs the projections returned, and the
 * canonical context - neighbours one link away and the links the files
 * declare between them - labelled as the casebook labels its board. When a
 * projection returned a subgraph, it stays at full strength and the canonical
 * context fades (docs/adapter-spec.md §13); when none did, nothing fades. With
 * a resource picked, it and what it links to stand out.
 */
export const boardOf = (graph: SearchGraph, selected: string | null): Board => {
  const colour = typeColours(graph)
  const confidence = new Map(graph.matches.map((match) => [match.id, match.confidence]))
  const nodes: CardNode[] = graph.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    type: node.type,
    ghost: node.ghost,
    code: node.ghost ? '' : typeCode(node.type),
    colour: node.ghost ? 'var(--graph-other)' : colour(node.type),
    weight: confidence.get(node.id) ?? null,
    note: node.ghost ? null : node.match ? 'match' : node.via === 'adapter' ? 'returned' : 'one link away',
    weak: false
  }))
  const links: CardLink[] = graph.links.map((link) => ({
    key: edgeKey(link),
    source: link.source,
    rel: link.rel,
    target: link.target,
    weak: link.confidence !== undefined && link.confidence < 0.5
  }))
  if (selected !== null && graph.nodes.some((node) => node.id === selected)) {
    return {
      nodes,
      links,
      emphasis: {
        nodes: neighbourhood(graph.links, selected),
        links: new Set(links.filter((link) => link.source === selected || link.target === selected).map((link) => link.key))
      }
    }
  }
  if (!hasSubgraph(graph)) return { nodes, links, emphasis: null }
  return {
    nodes,
    links,
    emphasis: {
      nodes: new Set(graph.nodes.filter((node) => node.via !== 'canonical').map((node) => node.id)),
      links: new Set(graph.links.filter((link) => link.via !== 'canonical').map(edgeKey))
    }
  }
}

/** Each type's colour, slotted by how many entities the whole docket has of it, as the casebook does. */
export const typeColours = (graph: SearchGraph): ((type: string) => string) => {
  const slots = slotsByCount(new Map(graph.types.map((type) => [type.name, type.count])))
  return (type) => slotColour(slots.get(type))
}

/** The search result, when a tool result carries one. */
export const searchOf = (structured: unknown): SearchGraph | null =>
  typeof structured === 'object' && structured !== null && (structured as { schema?: unknown }).schema === SEARCH_SCHEMA
    ? (structured as SearchGraph)
    : null
