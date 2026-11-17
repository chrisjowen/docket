import { hkdfSync, timingSafeEqual } from 'node:crypto'

import type { CoordinatedAnswer } from '@chrisjowen/docket'
import type { SearchGraph, SearchMatch } from '@chrisjowen/docket/mcp/types'

/**
 * The query protocol: how the MCP tools ask a workspace's projections to
 * search or answer a question. A deployment answers in-process, or from a
 * query service of its own (Docket Cloud's worker, the only process that
 * reaches an organisation's stores), over `queryClient`. The workspace comes
 * from the caller's credential, never from the MCP client.
 */

export type { SearchGraph }

/** Where a search looks: the projections' hits, the subgraphs they returned, and the workspace's activity log. */
export const SEARCH_BACKENDS = ['facts', 'graph', 'timeline'] as const
export type SearchBackend = (typeof SEARCH_BACKENDS)[number]

/** A result found in several places, collapsed into one: where it was found and how it ranks. */
export interface WorkspaceMatch extends SearchMatch {
  foundIn: SearchBackend[]
  /**
   * How probably it answers the query, from 0 to 1: a cross-encoder's reading
   * of the query and the record together, with the projections' own scores.
   * Its `confidence` is how well its evidence supports it, shown beside it and
   * never part of this.
   */
  score: number
  /** The out-of-date records the search found that this one replaces: it stands in for them. */
  supersedes?: string[]
}

/**
 * A record the question found that has gone out of date: never a match
 * itself, it names the current record that stands in for it and what changed.
 */
export interface SearchChange {
  id: string
  type: string
  title: string
  /** The record that replaced it. */
  supersededBy: string
  /** The record current now, at the end of the chain of replacements; null when it is no longer on file. */
  current: { id: string; type: string; title: string } | null
  /** Until when the older record held, YYYY-MM-DD. */
  since: string
  reason: string
  /** The change in one line, e.g. 'Out of date: "Sophia" (agent.sophia) is superseded by "Captin" (agent.captin) since 2026-11-01. ...'. */
  note: string
}

/** `docket_search`'s board, its matches collapsed by entity and ranked by score. */
export interface WorkspaceSearch extends SearchGraph {
  matches: WorkspaceMatch[]
  /** The out-of-date records the search found, each answered by its current record among the matches; absent when there are none. */
  changes?: SearchChange[]
}

export interface SearchQuery {
  workspaceId: string
  query: string
  /** The most matches returned; fewer, or none, when fewer are relevant. */
  limit: number
  /** Who is asking, as the audit log names them, for the question's trace. */
  actor?: string
  /** The member asking, through whichever of their credentials: whose question the trace is. */
  userId: string
  /** Where to look; every backend when omitted. */
  include?: SearchBackend[]
  /**
   * Hits asked of each projection, when more than the search's own pool: a
   * page that filters the results itself asks deeper, so its filters still
   * find what the index ranks below other types.
   */
  pool?: number
  /** Deprecated, and ignored: relevance decides what is returned, and confidence is shown with each result. */
  minConfidence?: number
}

/** Why a search ignores `minConfidence`, told to whoever still passes it. */
export const MIN_CONFIDENCE_IGNORED = 'minConfidence is ignored: results are cut on relevance, and confidence is shown with each result.'

/** A search's `include` and `minConfidence`, checked, or why they will not do. */
export function searchScope(include: unknown, minConfidence: unknown): Pick<SearchQuery, 'include' | 'minConfidence'> | string {
  if (include !== undefined && (!Array.isArray(include) || include.length === 0 || include.some((value) => !SEARCH_BACKENDS.includes(value as SearchBackend)))) {
    return `include must list one or more of ${SEARCH_BACKENDS.map((backend) => `"${backend}"`).join(', ')}.`
  }
  if (minConfidence !== undefined && (typeof minConfidence !== 'number' || !(minConfidence >= 0 && minConfidence <= 1))) {
    return 'minConfidence must be a number from 0 to 1.'
  }
  return { ...(include !== undefined ? { include: [...new Set(include as SearchBackend[])] } : {}), ...(minConfidence !== undefined ? { minConfidence } : {}) }
}

export interface AskQuery {
  workspaceId: string
  question: string
  maxResults?: number
  /** Who is asking, as the audit log names them: AI usage is metered against it. */
  actor: string
  /** The member asking, through whichever of their credentials: whose question the trace is. */
  userId: string
}

/** What an ask answers: docket's coordinated answer, with the summary a model wrote. */
export interface AskResponse {
  answer: CoordinatedAnswer
  /** Why there is no summary, when there is none: the AI budget is spent, AI is not set up, or the model failed. */
  notice?: string
  /** Out-of-date records the projections found, and the current record for each; absent when there are none. */
  changes?: SearchChange[]
}

export interface QueryClient {
  search(query: SearchQuery): Promise<WorkspaceSearch>
  ask(query: AskQuery): Promise<AskResponse>
}

/** The query service answered with an error: its message is safe to show. */
export class QueryError extends Error {
  override name = 'QueryError'
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export const QUERY_PATHS = { search: '/query/search', ask: '/query/ask' } as const

/** The key an API and its query service share, derived from a key both hold so neither needs another secret. */
export function queryKey(kek: Uint8Array): string {
  return Buffer.from(hkdfSync('sha256', kek, Buffer.alloc(0), 'docket-cloud worker query v1', 32)).toString('base64url')
}

/** Whether a request's `Authorization` header carries the shared key. */
export function queryAuthorised(header: string | undefined | null, key: string): boolean {
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '')
  const expected = Buffer.from(key)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * A query service's client: JSON over HTTP(S) to `url`, authenticated by
 * the shared key. A query carries whatever else the service needs (an
 * organisation, say) alongside the protocol's fields. `null` url: no service
 * to ask.
 */
export function queryClient<S extends SearchQuery = SearchQuery, A extends AskQuery = AskQuery>(options: {
  url: string | null
  key: string
  timeoutMs?: number
  fetch?: typeof fetch
}): { search(query: S): Promise<WorkspaceSearch>; ask(query: A): Promise<AskResponse> } {
  const doFetch = options.fetch ?? fetch
  const post = async <T>(path: string, body: unknown, timeoutMs: number): Promise<T> => {
    if (!options.url) throw new QueryError(503, 'The search index is not running on this server.')
    let response: Response
    try {
      response = await doFetch(new URL(path, options.url), {
        method: 'POST',
        headers: { authorization: `Bearer ${options.key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (cause) {
      throw new QueryError(503, `The search index did not answer: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    const text = await response.text()
    if (!response.ok) {
      let message = `The search index answered ${response.status}.`
      try {
        const parsed = JSON.parse(text) as { error?: unknown }
        if (typeof parsed.error === 'string') message = parsed.error
      } catch {
        // Not JSON: keep the status.
      }
      throw new QueryError(response.status, message)
    }
    return JSON.parse(text) as T
  }
  const timeoutMs = options.timeoutMs ?? 30_000
  return {
    search: (query) => post<{ graph: WorkspaceSearch }>(QUERY_PATHS.search, query, timeoutMs).then((body) => body.graph),
    // Synthesis takes a model call on top of the projections.
    ask: (query) => post<AskResponse>(QUERY_PATHS.ask, query, timeoutMs * 2)
  }
}
