import { askProject } from '../query/ask.js';
import { toSearchResult } from '../query/legacy.js';
export const DEFAULT_SEARCH_LIMIT = 10;
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
export const search = async (query, options = {}) => toSearchResult(await askProject(options.cwd ?? process.cwd(), {
    question: query,
    maxResults: options.limit ?? DEFAULT_SEARCH_LIMIT,
    synthesis: false
}));
