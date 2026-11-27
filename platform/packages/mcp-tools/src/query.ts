// SPDX-License-Identifier: AGPL-3.0-only
import { hkdfSync, timingSafeEqual } from 'node:crypto'

import type { CoordinatedAnswer } from '@chrisjowen/docket'
import type { SearchGraph, SearchMatch } from '@chrisjowen/docket/mcp/types'
import type { PendingChange } from '@chrisjowen/docket/workspace'
import type { ToolCall, TurnMessage, TurnTool } from '@docket/platform-ai'

/**
 * The worker's query service: the API's MCP endpoint asks the worker to
 * search or ask a workspace's projections, because only the worker reaches
 * an org's Neo4j pod and Qdrant collections (the API pods hold no store
 * credentials and no Kubernetes rights). It is HTTPS inside the cluster with
 * the internal CA's certificate (§7.1), reachable only from the API pods
 * (a NetworkPolicy), and every request carries a key both sides derive from
 * the KEK. The org and workspace come from the API's authenticated principal,
 * never from the MCP client.
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
  /** Supersede proposals not yet fact about records it found: those records are still current. */
  pending?: PendingChange[]
}

export interface SearchQuery {
  orgId: string
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
   * Hits asked of each projection, when more than the search's own pool:
   * a page that filters the results itself asks deeper, so its filters still
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
  orgId: string
  workspaceId: string
  question: string
  maxResults?: number
  /** Who is asking, as the audit log names them: AI usage is metered against it (§11). */
  actor: string
  /** The member asking, through whichever of their credentials: whose question the trace is. */
  userId: string
  /**
   * False: only the projections' grounded retrieval, with no summary and no
   * model call - for a caller (the Ask page's agent) that writes the answer itself.
   */
  summary?: boolean
}

/** What `/query/ask` answers: docket's coordinated answer, with the summary the org's model wrote. */
export interface AskResponse {
  answer: CoordinatedAnswer
  /** Why there is no summary, when there is none: the AI budget is spent, AI is not set up, or the model failed. */
  notice?: string
  /** Out-of-date records the projections found, and the current record for each; absent when there are none. */
  changes?: SearchChange[]
  /** Supersede proposals not yet fact about records it found: those records are still current. */
  pending?: PendingChange[]
}

/**
 * One turn of the Ask page's agent on the org's model (§11): the conversation
 * so far and the tools it may call. Only the worker holds the org's OpenRouter
 * key, so the API's agent loop asks the worker for each turn; the cap is
 * checked and the call metered there, as for every other model call.
 */
export interface TurnQuery {
  orgId: string
  /** Who is asking, as AI usage is metered against (`user:<id>`). */
  actor: string
  userId: string
  messages: TurnMessage[]
  tools: TurnTool[]
  /** `none` asks for the answer now. */
  toolChoice?: 'auto' | 'none'
  /** The most the model may write in this turn. */
  maxTokens?: number
  /** What the turn is metered as: the Ask page's `agent` unless it drafts an ontology. */
  purpose?: TurnPurpose
}

/** What a turn is for, as AI usage records it. */
export const TURN_PURPOSES = ['agent', 'ontology'] as const
export type TurnPurpose = (typeof TURN_PURPOSES)[number]

/** What `/query/turn` answers: the model's turn and what it cost, or why there is no model to ask. */
export type TurnResponse =
  | { content: string; toolCalls: ToolCall[]; model: string; costUsd: number }
  | { unavailable: 'not-configured' | 'cap-reached'; notice: string }

export const QUERY_PATHS = { search: '/query/search', ask: '/query/ask', turn: '/query/turn' } as const

/** The key the API and the worker share, derived from the KEK so neither needs another secret. */
export function queryKey(kek: Uint8Array): string {
  return Buffer.from(hkdfSync('sha256', kek, Buffer.alloc(0), 'docket-cloud worker query v1', 32)).toString('base64url')
}

/** Whether a request's `Authorization` header carries the shared key. */
export function queryAuthorised(header: string | undefined | null, key: string): boolean {
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '')
  const expected = Buffer.from(key)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** The query service answered with an error: its message is safe to show. */
export class QueryError extends Error {
  override name = 'QueryError'
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface QueryClient {
  search(query: SearchQuery): Promise<WorkspaceSearch>
  ask(query: AskQuery): Promise<AskResponse>
  turn(query: TurnQuery): Promise<TurnResponse>
}

/** The API's side: JSON over HTTPS to the worker. `null` url: no worker to ask (a preview without stores). */
export function queryClient(options: { url: string | null; key: string; timeoutMs?: number; fetch?: typeof fetch }): QueryClient {
  const doFetch = options.fetch ?? fetch
  const post = async <T>(path: string, body: unknown, timeoutMs: number): Promise<T> => {
    if (!options.url) throw new QueryError(503, 'The search index is not running on this server.')
    let response: Response
    try {
      response = await doFetch(new URL(path, options.url), {
        method: 'POST',
        headers: { authorization: `Bearer ${options.key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
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
    ask: (query) => post<AskResponse>(QUERY_PATHS.ask, query, timeoutMs * 2),
    // A turn that writes the answer can take a while on a mid-tier model.
    turn: (query) => post<TurnResponse>(QUERY_PATHS.turn, query, timeoutMs * 3),
  }
}
