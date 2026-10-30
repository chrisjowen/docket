/*
 * The wire format of docket's MCP server (docs/mcp.md): what `docket_search`
 * returns as `structuredContent`, which its app (`ui://docket/search.html`,
 * built from docket-ui's src/mcp-app) draws. Defined once, here; the app
 * imports these types.
 */

/** `structuredContent.schema` of a `docket_search` result. */
export const SEARCH_SCHEMA = 'docket-search.v1'

/** A resource the search found, described from its canonical file. */
export interface SearchMatch {
  id: string
  type: string
  title: string
  /** Its canonical file, relative to the repository root. */
  path: string
  /** How far its evidence supports it; absent while its files do not validate. */
  confidence?: number
  /** The projections that returned it. */
  foundBy: string[]
}

/**
 * Why something is on the board: a projection returned it (a match, or part of
 * the subgraph a projection returned), or it is canonical context - a resource
 * one link away from a match, or a link between two resources on the board,
 * read from the canonical files rather than returned.
 */
export type SearchVia = 'adapter' | 'canonical'

/**
 * One entity on the search's board: a match, a node of a subgraph a projection
 * returned, or a resource one link away from a match. A ghost is a link target
 * or a returned node that no file defines.
 */
export interface SearchNode {
  id: string
  type: string
  title: string
  /** Its canonical file; absent for a ghost. */
  path?: string
  match: boolean
  ghost: boolean
  via: SearchVia
}

/**
 * A relationship between two entities on the board: one a projection returned,
 * or one the source's file declares.
 */
export interface SearchLink {
  source: string
  rel: string
  target: string
  via: SearchVia
  /** The projections that returned it; absent for canonical context. */
  foundBy?: string[]
  /** How far a projection holds it supported, from 0 to 1 - the highest any gave - when one says. */
  confidence?: number
  /** The text of the evidence the projections cited for it: why it holds. */
  why?: string[]
}

/** A path a projection used, as the ordered ids of the entities on it, each on the board. */
export interface SearchPath {
  nodes: string[]
  foundBy: string[]
}

/**
 * A resource type, with its icon and how many entities the whole docket has of
 * it, so the app colours each type as the casebook does.
 */
export interface SearchType {
  name: string
  icon: string
  count: number
}

/** How one projection answered: its hit count, how it read the query, or why it could not. */
export interface SearchSource {
  name: string
  hits: number
  note?: string
  error?: string
}

/** `docket_search`'s `structuredContent`. */
export interface SearchGraph {
  schema: typeof SEARCH_SCHEMA
  query: string
  project: { name: string; root: string }
  /** What the projections found, most relevant first. */
  matches: SearchMatch[]
  /** The matches, the subgraphs the projections returned, then the matches' neighbours: at most `MAX_NODES`. */
  nodes: SearchNode[]
  links: SearchLink[]
  /** The paths the projections used, most relevant first. */
  paths: SearchPath[]
  /** Returned nodes and neighbours left off the board to keep it readable. */
  omitted: number
  types: SearchType[]
  sources: SearchSource[]
  /** Whether every projection is synced with the files: when not, the search may miss what they hold. */
  index: { synced: boolean; behind: number }
  /** `docket open`'s page, where the casebook shows a resource at `<viewer>#<id>`; null when not served by it. */
  viewer: string | null
  /** Warnings, such as a hit for a resource no file defines any more. */
  warnings: string[]
}
