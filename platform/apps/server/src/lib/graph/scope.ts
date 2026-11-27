// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the Record's network draws, before its type and relationship filters:
 * a large docket's records up to a limit, its most connected first, or only
 * what a query finds and the records one link away. Either is laid out on its
 * own, so a few results sit together instead of across the whole docket.
 */
import type { UiGraph } from './model'

/** Records drawn at first, and how many more each "Show more" adds. */
export const BOARD_LIMIT = 100

type Graph = Pick<UiGraph, 'entities' | 'edges'>

export interface Scope {
  /** The records drawn and their links; a link to a record no document files stays, as a ghost. */
  graph: Graph
  /** Records drawn. */
  shown: number
  /** Records the board could draw: the docket's, or a query's matches and their neighbours. */
  total: number
  /** A query's matches, best first; null when there is no query. */
  matched: string[] | null
}

/** Only these records, and the links between them or to records no document files, that `keep` allows. */
function cut(graph: Graph, ids: ReadonlySet<string>, keep: (edge: Graph['edges'][number]) => boolean = () => true): Graph {
  const known = new Set(graph.entities.map((entity) => entity.id))
  return {
    entities: graph.entities.filter((entity) => ids.has(entity.id)),
    edges: graph.edges.filter((edge) => ids.has(edge.source) && (ids.has(edge.target) || !known.has(edge.target)) && keep(edge)),
  }
}

/** Puts `id` among the first `limit` of `order`, when it is in it at all. */
function withSelection(order: readonly string[], limit: number, id: string | null): Set<string> {
  const ids = new Set(order.slice(0, Math.max(0, limit)))
  if (id !== null && !ids.has(id) && order.includes(id)) ids.add(id)
  return ids
}

/** The docket's records up to `limit`, the most connected first, with the selection always among them. */
export function cappedScope(graph: Graph, limit: number, selected: string | null = null): Scope {
  const degree = new Map<string, number>()
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }
  const order = graph.entities
    .map((entity) => entity.id)
    .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0))
  const ids = withSelection(order, limit, selected)
  return { graph: cut(graph, ids), shown: ids.size, total: order.length, matched: null }
}

/**
 * A query's matches, best first, and the records one link away from them, up
 * to `limit` with the matches first. Only the matches' own links are drawn,
 * not those between two of their neighbours.
 */
export function resultScope(graph: Graph, matched: readonly string[], limit: number, selected: string | null = null): Scope {
  const known = new Set(graph.entities.map((entity) => entity.id))
  const matches = [...new Set(matched.filter((id) => known.has(id)))]
  const hits = new Set(matches)
  const order = [...matches]
  const pooled = new Set(matches)
  for (const edge of graph.edges) {
    const other = hits.has(edge.source) ? edge.target : hits.has(edge.target) ? edge.source : null
    if (other !== null && known.has(other) && !pooled.has(other)) {
      pooled.add(other)
      order.push(other)
    }
  }
  const ids = withSelection(order, limit, selected)
  return {
    graph: cut(graph, ids, (edge) => hits.has(edge.source) || hits.has(edge.target)),
    shown: ids.size,
    total: order.length,
    matched: matches,
  }
}
