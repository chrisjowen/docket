import { hkdfSync, timingSafeEqual } from 'node:crypto'

import type { SearchGraph } from '@chrisjowen/docket/mcp/types'

import type { AskResponse, SearchBackend, WorkspaceSearch } from '../docket.js'

/**
 * The query protocol: how the MCP tools ask a workspace's projections to
 * search or answer a question. A deployment answers in-process, or from a
 * query service of its own (Docket Cloud's worker, the only process that
 * reaches an organisation's stores), over `queryClient`. The workspace comes
 * from the caller's credential, never from the MCP client.
 */

export type { SearchGraph }
export { MIN_CONFIDENCE_IGNORED, SEARCH_BACKENDS, searchScope, type AskResponse, type SearchBackend, type SearchChange, type WorkspaceMatch, type WorkspaceSearch } from '../docket.js'

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

export interface AskQuery {
  workspaceId: string
  question: string
  maxResults?: number
  /** Who is asking, as the audit log names them: AI usage is metered against it. */
  actor: string
  /** The member asking, through whichever of their credentials: whose question the trace is. */
  userId: string
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
