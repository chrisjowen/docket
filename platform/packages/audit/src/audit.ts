// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import type pg from 'pg'

import { argsDigest as digest, eventHash, verifyLinks, type ChainLink, type ChainVerdict } from './chain.js'

/** Who acted (§10). */
export type Actor =
  | `user:${string}`
  | `token:${string}`
  | `oauth:${string}/user:${string}`
  | `system:${string}`
  | 'anonymous'

export type Outcome = 'ok' | 'denied' | 'error' | 'invalid'

/** One audit event per request that authenticates (§10). Arguments are stored as a digest only. */
export interface AuditEvent extends ChainLink {
  actor: Actor
  outcome: Outcome
}

export interface AuditEventInput {
  /** Null for platform events (sign-in, failed auth); the org's id for everything inside an org. */
  orgId: string | null
  workspaceId?: string | null
  actor: Actor
  ip?: string | null
  userAgent?: string | null
  /** For example `members.invite` or `mcp.tools/call docket_remember`. */
  action: string
  /** Resource ids. Kept in the org's log only, never in the platform stream. */
  target?: readonly string[]
  /** Digested and dropped: arguments hold customer content and are never stored. */
  args?: unknown
  outcome: Outcome
  latencyMs: number
  requestId: string
}

type Queryable = Pick<pg.ClientBase, 'query'>

type EventRow = {
  id: string
  at: Date
  org_id: string | null
  workspace_id: string | null
  actor: Actor
  ip: string | null
  user_agent: string | null
  action: string
  target: string[]
  args_digest: string | null
  outcome: Outcome
  latency_ms: number
  request_id: string
  prev_hash: string
  hash: string
}

function fromRow(row: EventRow): AuditEvent {
  return {
    id: row.id,
    at: row.at,
    orgId: row.org_id,
    workspaceId: row.workspace_id,
    actor: row.actor,
    ip: row.ip,
    userAgent: row.user_agent,
    action: row.action,
    target: row.target,
    argsDigest: row.args_digest,
    outcome: row.outcome,
    latencyMs: row.latency_ms,
    requestId: row.request_id,
    prevHash: row.prev_hash,
    hash: row.hash,
  }
}

/**
 * Appends one event to the log in the transaction's `search_path`: an org's
 * own log inside `withTenant`, the platform log inside `withPlatform`. Call it
 * in the same transaction as the change it records (§10), last, because it
 * locks the chain head until the transaction ends.
 */
export async function audit(tx: Queryable, input: AuditEventInput): Promise<AuditEvent> {
  const { rows: head } = await tx.query<{ hash: string }>('SELECT hash FROM audit_head FOR UPDATE')
  const prevHash = head[0]?.hash
  if (!prevHash) throw new Error('audit log has no head row')
  const fields = {
    id: randomUUID(),
    // Millisecond precision, so the time read back from Postgres hashes the same.
    at: new Date(Date.now()),
    orgId: input.orgId,
    workspaceId: input.workspaceId ?? null,
    actor: input.actor,
    ip: input.ip ?? null,
    userAgent: input.userAgent ? input.userAgent.slice(0, 512) : null,
    action: input.action,
    target: [...(input.target ?? [])],
    argsDigest: input.args === undefined ? null : digest(input.args),
    outcome: input.outcome,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    requestId: input.requestId,
  }
  const hash = eventHash(prevHash, fields)
  await tx.query(
    `INSERT INTO audit_event (id, at, org_id, workspace_id, actor, ip, user_agent, action, target,
                              args_digest, outcome, latency_ms, request_id, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      fields.id,
      fields.at,
      fields.orgId,
      fields.workspaceId,
      fields.actor,
      fields.ip,
      fields.userAgent,
      fields.action,
      fields.target,
      fields.argsDigest,
      fields.outcome,
      fields.latencyMs,
      fields.requestId,
      prevHash,
      hash,
    ],
  )
  await tx.query('UPDATE audit_head SET hash = $1', [hash])
  return { ...fields, prevHash, hash }
}

/** Verifies the log in the transaction's `search_path`. */
export async function verifyChainIn(tx: Queryable): Promise<ChainVerdict> {
  const { rows: head } = await tx.query<{ hash: string }>('SELECT hash FROM audit_head')
  const { rows } = await tx.query<EventRow>('SELECT * FROM audit_event ORDER BY seq')
  return verifyLinks(rows.map(fromRow), head[0]?.hash ?? '')
}

/** Verifies one org's log (the nightly check, §10). */
export function verifyChain(
  tenants: { withTenant<T>(orgId: string, fn: (tx: pg.ClientBase) => Promise<T>): Promise<T> },
  orgId: string,
): Promise<ChainVerdict> {
  return tenants.withTenant(orgId, verifyChainIn)
}

export interface AuditQuery {
  /** Exact action, target and lower timestamp bound (org admin API). */
  action?: string
  target?: string
  since?: Date
  /** Database identity filters, including historical workspace ids for a reused slug. */
  workspaceIds?: readonly string[]
  workspaceOnly?: boolean
  /** Only this actor's events: what a member without `audit.view-full` sees. */
  actor?: string
  /** Only these actors' events (with `actor`, either matches): a member's own API tokens, say. */
  actors?: readonly string[]
  /** Only events in this workspace. */
  workspaceId?: string
  /** Only actions starting with one of these, for example `mcp.`. */
  actionPrefixes?: readonly string[]
  /** Only the events of this request: what an activity log entry links to. */
  requestId?: string
  limit?: number
}

/** The newest events of the log in the transaction's `search_path`. */
export async function listAudit(tx: Queryable, query: AuditQuery = {}): Promise<AuditEvent[]> {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500)
  const where: string[] = []
  const values: unknown[] = []
  const param = (value: unknown) => {
    values.push(value)
    return `$${values.length}`
  }
  if (query.actor !== undefined || query.actors !== undefined) {
    const own: string[] = []
    if (query.actor !== undefined) {
      const actor = param(query.actor)
      // An OAuth actor `oauth:<client>/user:<id>` is also the user's own entry.
      own.push(`actor = ${actor}`, `(actor LIKE 'oauth:%' AND right(actor, length(${actor}) + 1) = '/' || ${actor})`)
    }
    if (query.actors !== undefined) own.push(`actor = ANY(${param([...query.actors])}::text[])`)
    where.push(`(${own.join(' OR ')})`)
  }
  if (query.workspaceId !== undefined) where.push(`workspace_id = ${param(query.workspaceId)}`)
  if (query.action !== undefined) where.push(`action = ${param(query.action)}`)
  if (query.workspaceOnly) where.push('workspace_id IS NOT NULL')
  if (query.workspaceIds !== undefined || query.target !== undefined) {
    const database: string[] = []
    if (query.workspaceIds !== undefined) database.push(`workspace_id = ANY(${param([...query.workspaceIds])}::text[])`)
    if (query.target !== undefined) database.push(`${param(query.target)} = ANY(target)`)
    where.push(`(${database.join(' OR ')})`)
  }
  if (query.since !== undefined) where.push(`at >= ${param(query.since)}`)
  if (query.requestId !== undefined) where.push(`request_id = ${param(query.requestId)}`)
  if (query.actionPrefixes !== undefined) {
    where.push(`EXISTS (SELECT 1 FROM unnest(${param([...query.actionPrefixes])}::text[]) AS prefix WHERE starts_with(action, prefix))`)
  }
  const { rows } = await tx.query<EventRow>(
    `SELECT * FROM audit_event ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq DESC LIMIT ${param(limit)}`,
    values,
  )
  return rows.map(fromRow)
}
