import { SEARCH_SCHEMA, type SearchGraph } from '../../../docket/src/mcp/types.js'
import type { GraphLink, GraphNode } from '$lib/components/graph-view.svelte'
import { edgeKey, neighbourhood, slotColour, slotsByCount } from '$lib/model.js'

export type { SearchGraph, SearchMatch, SearchNode } from '../../../docket/src/mcp/types.js'

export interface Board {
  nodes: GraphNode[]
  links: GraphLink[]
  /** What stays at full strength once a resource is picked: it, its neighbours and its links. Null: everything. */
  emphasis: { nodes: Set<string>; links: Set<string> } | null
}

/**
 * The evidence board for a search, as the casebook draws it: every match and
 * neighbour, every link between them, labelled as the casebook labels its
 * board. With a resource picked, it and what it links to stand out.
 */
export const boardOf = (graph: SearchGraph, selected: string | null): Board => {
  const nodes: GraphNode[] = graph.nodes.map((node) => ({ id: node.id, title: node.title, type: node.type, ghost: node.ghost }))
  const links: GraphLink[] = graph.links.map((link) => ({ key: edgeKey(link), ...link }))
  if (selected === null || !graph.nodes.some((node) => node.id === selected)) return { nodes, links, emphasis: null }
  return {
    nodes,
    links,
    emphasis: {
      nodes: neighbourhood(graph.links, selected),
      links: new Set(links.filter((link) => link.source === selected || link.target === selected).map((link) => link.key))
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
