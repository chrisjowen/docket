import { createHash } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'

import type { McpHandlerOptions } from '../mcp/handler.js'
import type { AuditSink } from '../ports.js'
import type { TokenPrincipal, ServeResource } from './tokens.js'

/*
 * What `docket serve` asks of where it keeps its workspaces: a project's
 * files (the default, needing no database) or a Postgres canonical store.
 * The HTTP server, the tokens and the MCP pipeline are the same over both.
 */

/** One workspace the server serves. */
export interface ServedWorkspace {
  slug: string
  /** The id its documents and principals carry. */
  id: string
}

/** A document as `GET .../documents` lists it for `docket cloud push|pull|status`. */
export interface ListedDocument {
  path: string
  hash: string
  origin: string
  originRef?: string | null
  updatedAt?: string
  raw?: string
}

export interface DocumentsQuery {
  origin: 'cli' | 'cloud'
  originRef?: string | undefined
  raw?: boolean | undefined
  /** The page after this path; the first page when absent. */
  after?: string | undefined
  limit: number
}

export interface PushRequest {
  checkout: string
  upsert: { path: string; raw: string }[]
  remove: string[]
}

export interface PushAnswer {
  ok: boolean
  dryRun: boolean
  created: string[]
  updated: string[]
  unchanged: string[]
  removed: string[]
  diagnostics: { severity: 'error' | 'warning'; code: string; message: string; path?: string }[]
}

/** Who pushes, as the activity log names them. */
export interface PushWriter {
  actor: string
  label: string
  requestId: string
}

export interface ServeBackend {
  readonly kind: 'files' | 'postgres'
  readonly workspaces: readonly ServedWorkspace[]
  /** The MCP pipeline's per-workspace parts: where its documents are, and its tools. */
  mcp(workspace: ServedWorkspace): Pick<McpHandlerOptions<TokenPrincipal, ServeResource>, 'store' | 'query' | 'tools' | 'source' | 'modelGate'>
  /** Told after a request that may have written, so the projections catch up. */
  written(workspace: ServedWorkspace): void
  /** The documents API (`docket cloud push|pull|status`). */
  documents(workspace: ServedWorkspace, query: DocumentsQuery): Promise<{ documents: ListedDocument[]; next?: string }>
  push(workspace: ServedWorkspace, writer: PushWriter, request: PushRequest, dryRun: boolean): Promise<PushAnswer>
  /** docket open's page and its reads over the workspace, for a signed-in browser. */
  readViews(workspace: ServedWorkspace): (request: IncomingMessage, response: ServerResponse) => Promise<void>
  /** Resolves once the projections have caught up with every write so far. */
  indexed(workspace: ServedWorkspace): Promise<void>
  /** Resets the workspace's projections and projects every document again. */
  rebuild(workspace: ServedWorkspace): Promise<void>
  /** Whether the server can answer: its store is reachable. */
  ready(): Promise<{ ok: boolean; detail: string }>
  close(): Promise<void>
}

/** One line of the audit log: who called what, when, and how it went; arguments as a digest, never as content. */
export interface AuditLine {
  at: string
  workspace: string | null
  actor: string
  action: string
  outcome: string
  target: readonly string[]
  latencyMs: number
  requestId: string
  ip: string | null
  userAgent: string | null
  argsSha256?: string
}

/**
 * The audit log, as JSON lines appended to `file`: one per request that
 * authenticated, and one per refused credential. Arguments hold the
 * workspace's content, so only their digest is kept.
 */
export function fileAuditLog(file: string, slugOf: (workspaceId: string) => string | null): AuditSink & { line(line: AuditLine): Promise<void> } {
  let ready: Promise<unknown> | null = null
  let pending: Promise<void> = Promise.resolve()
  const line = (entry: AuditLine): Promise<void> => {
    ready ??= mkdir(dirname(file), { recursive: true })
    const write = pending.then(async () => {
      await ready
      await appendFile(file, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 })
    })
    pending = write.catch(() => undefined)
    return write
  }
  return {
    line,
    async record(_ctx, event) {
      await line({
        at: new Date().toISOString(),
        workspace: event.workspaceId ? slugOf(event.workspaceId) : null,
        actor: event.actor,
        action: event.action,
        outcome: event.outcome,
        target: event.target ?? [],
        latencyMs: event.latencyMs,
        requestId: event.requestId,
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
        ...(event.args !== undefined ? { argsSha256: createHash('sha256').update(JSON.stringify(event.args)).digest('hex') } : {})
      })
    }
  }
}
