// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { decryptText, encrypt } from '@docket/platform-keys'

import { documentAad, type StoreContext } from './documents.js'
import { HISTORY_DAYS, HISTORY_LIMIT } from './sync-runs.js'

/**
 * Query traces (Settings → Queries): each question put to a workspace's
 * projections, step by step - what was read, which stores were asked and
 * what each returned, the query that ran and who wrote it, what went into the
 * answer and what it cost. The question and its steps are customer content,
 * sealed with the org's data key; they carry ids and titles only, never a
 * document's body or an evidence excerpt. Bounded like the sync history.
 */
export type QueryTool = 'search' | 'ask'

/** Who wrote the query a store ran: a fixed template, or a model from the question. */
export type QueryAuthor = 'template' | 'model'

export interface TracedQuery {
  /** The query as the store ran it: Cypher, or a description of the vector search. */
  text: string
  by: QueryAuthor
  /** The model that wrote it, when one did. */
  model?: string
  /** Why the template ran instead of a model's query, when a model's query failed or found nothing. */
  fallback?: string
}

export interface TracedHit {
  id: string
  title?: string
  type?: string
}

/** One store's part of the answer. */
export interface TracedStore {
  /** The adapter instance: `neo4j` (the graph) or `mem0` (the search index). */
  adapter: string
  state: 'answered' | 'failed'
  durationMs?: number
  /** How the store read the question, as it says itself. */
  interpretation?: string
  assumptions?: string[]
  query?: TracedQuery
  /** The canonical records it pointed at, the first few of them. */
  hits: TracedHit[]
  hitCount: number
  /** `exhaustive`, `top-k` or `unknown`, and whether the store cut its results short. */
  coverage?: { mode: string; truncated: boolean }
  /** Table rows a model's query returned. */
  rows?: number
  freshness?: { state: string; behind?: number }
  error?: string
  notes: string[]
}

export interface TracedReference {
  id: string
  entity?: string
  title?: string
  kind: string
  status: 'resolved' | 'stale' | 'unresolved'
  foundBy: string[]
}

export interface TracedCall {
  purpose: string
  model: string
  promptTokens: number
  completionTokens: number
  costUsd: number
}

export interface QueryTraceDetail {
  question: string
  /** What the documents held when the question was asked. */
  read: { exhibits: number; documents: number; indexBehind: number; indexSynced: boolean }
  stores: TracedStore[]
  answer: {
    references: TracedReference[]
    counts: { resolved: number; stale: number; unresolved: number }
    connections: number
    /** The summary's model and the exhibits it cited; never its text. */
    synthesis?: { model: string; citedEntities: string[]; citedEvidence: number }
    /** Why there is no summary, when there is none. */
    notice?: string
  }
  calls: TracedCall[]
  /** Why the question failed, when it did. */
  error?: string
}

export interface QueryTraceInput {
  workspaceId: string
  tool: QueryTool
  actor: string
  /** The member who asked, whichever of their credentials they asked through. */
  userId: string
  outcome: 'answered' | 'failed'
  durationMs: number
  detail: QueryTraceDetail
}

export interface QueryTrace extends Omit<QueryTraceInput, 'detail'> {
  id: string
  at: Date
  costUsd: number
  detail: QueryTraceDetail | null
  /** Why the detail did not open, when it did not. */
  detailError?: string
}

const traceAad = (orgId: string, workspaceId: string, id: string) => documentAad({ orgId, workspaceId, documentId: `query:${id}`, revision: 0 })

/** Records a question's trace and drops what is past the bound. */
export async function recordQueryTrace(ctx: StoreContext, input: QueryTraceInput): Promise<string> {
  const id = randomUUID()
  const sealed = await encrypt(ctx.keys.key(), JSON.stringify(input.detail), traceAad(ctx.keys.orgId, input.workspaceId, id))
  const cost = input.detail.calls.reduce((sum, call) => sum + call.costUsd, 0)
  await ctx.tx.query(
    `INSERT INTO query_traces (id, workspace_id, tool, actor, user_id, outcome, duration_ms, cost_usd, detail_ciphertext, detail_nonce, dek_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      input.workspaceId,
      input.tool,
      input.actor.slice(0, 300),
      input.userId,
      input.outcome,
      Math.max(0, Math.round(input.durationMs)),
      cost,
      Buffer.from(sealed.ciphertext),
      Buffer.from(sealed.nonce),
      ctx.keys.version,
    ],
  )
  await ctx.tx.query(
    `DELETE FROM query_traces WHERE workspace_id = $1
       AND (at < now() - make_interval(days => $2)
            OR seq < (SELECT min(seq) FROM (SELECT seq FROM query_traces WHERE workspace_id = $1 ORDER BY seq DESC LIMIT $3) kept))`,
    [input.workspaceId, HISTORY_DAYS, HISTORY_LIMIT],
  )
  return id
}

type TraceRow = {
  id: string
  workspace_id: string
  tool: QueryTool
  actor: string
  user_id: string
  outcome: 'answered' | 'failed'
  duration_ms: number
  cost_usd: string
  at: Date
  detail_ciphertext: Buffer
  detail_nonce: Buffer
  dek_version: number
}

/**
 * The workspace's newest traces, newest first, decrypted: everyone's, or with
 * `askedBy` only the questions that member asked.
 */
export async function listQueryTraces(ctx: StoreContext, workspaceId: string, options: { limit?: number; askedBy?: string } = {}): Promise<QueryTrace[]> {
  const { rows } = await ctx.tx.query<TraceRow>(
    'SELECT * FROM query_traces WHERE workspace_id = $1 AND ($3::text IS NULL OR user_id = $3) ORDER BY seq DESC LIMIT $2',
    [workspaceId, Math.min(Math.max(options.limit ?? 50, 1), HISTORY_LIMIT), options.askedBy ?? null],
  )
  return Promise.all(
    rows.map(async (row) => {
      const trace: QueryTrace = {
        id: row.id,
        workspaceId: row.workspace_id,
        tool: row.tool,
        actor: row.actor,
        userId: row.user_id,
        outcome: row.outcome,
        durationMs: row.duration_ms,
        costUsd: Number(row.cost_usd),
        at: row.at,
        detail: null,
      }
      try {
        const text = await decryptText(
          ctx.keys.key(row.dek_version),
          { ciphertext: new Uint8Array(row.detail_ciphertext), nonce: new Uint8Array(row.detail_nonce) },
          traceAad(ctx.keys.orgId, row.workspace_id, row.id),
        )
        trace.detail = JSON.parse(text) as QueryTraceDetail
      } catch (cause) {
        trace.detailError = cause instanceof Error ? cause.message : String(cause)
      }
      return trace
    }),
  )
}
