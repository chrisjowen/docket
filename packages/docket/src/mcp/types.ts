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
 * One entity on the search's board: a match, or a resource one link away from
 * one. A ghost is a link target no file defines yet.
 */
export interface SearchNode {
  id: string
  type: string
  title: string
  /** Its canonical file; absent for a ghost. */
  path?: string
  match: boolean
  ghost: boolean
}

/** A relationship between two entities on the board, as the source's file declares it. */
export interface SearchLink {
  source: string
  rel: string
  target: string
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
  /** The matches and their neighbours, at most `MAX_NODES` of them. */
  nodes: SearchNode[]
  links: SearchLink[]
  /** Neighbours left off the board to keep it readable. */
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
