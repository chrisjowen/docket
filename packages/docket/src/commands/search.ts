import { askProject } from '../query/ask.js'
import { toSearchResult, type SearchResult } from '../query/legacy.js'

export type { FoundDocument, SearchResult, SourceResult } from '../query/legacy.js'

export const DEFAULT_SEARCH_LIMIT = 10

export interface SearchOptions {
  /** Directory to resolve `.docket.yaml` from. Defaults to the working directory. */
  cwd?: string | undefined
  /** Hits asked of each projection. */
  limit?: number | undefined
}

/**
 * Asks every adapter enabled for query, through the shared coordinator, and
 * reports each one's entity hits as it gave them - the document-hit
 * compatibility view of `docket ask` (docs/adapter-spec.md §14). Answers are
 * not merged into one score: a keyword count, a vector similarity and a graph
 * path are different evidence, weighed by whoever reads them.
 *
 * The files stay the truth. Titles and paths are read from them, and a hit for
 * a document that no longer exists - a projection not yet synced - is dropped.
 */
export const search = async (query: string, options: SearchOptions = {}): Promise<SearchResult> =>
  toSearchResult(
    await askProject(options.cwd ?? process.cwd(), {
      question: query,
      maxResults: options.limit ?? DEFAULT_SEARCH_LIMIT,
      synthesis: false
    })
  )
