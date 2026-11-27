// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { decryptText, encrypt } from '@docket/platform-keys'

import type { Diagnostic } from './docket.js'
import { documentAad, type StoreContext } from './documents.js'

/**
 * The activity log (§14.2, §18): every change to a workspace's knowledge as
 * one ingest event - who, through which channel, the documents touched, the
 * evidence added and what the validator said - linked to the request's audit
 * event by its request id. Evidence, diagnostics and reasons are customer
 * content, so they are encrypted under the org's data key like the documents.
 */
export type Channel = 'repo' | 'mcp' | 'ui' | 'cli' | 'ontology' | 'enrichment'
export const CHANNELS: readonly Channel[] = ['mcp', 'ui', 'cli', 'repo', 'ontology', 'enrichment']

export type IngestAction =
  | 'remember'
  | 'add-evidence'
  | 'retire'
  | 'supersede'
  | 'propose-ontology'
  | 'publish-ontology'
  | 'push'
  | 'infer'
  | 'retire-inferred'
/** A repo sync's events (`@docket/platform-github`) name no action; the log reads them as this. */
export type LoggedAction = IngestAction | 'repo-sync'
export type IngestOutcome = 'ok' | 'refused' | 'partial' | 'error'

export interface IngestDocument {
  documentId: string
  path: string
  resourceId: string
  revision: number
  change: 'created' | 'updated' | 'retired'
}

/** A document as the log reads it: a repo sync records only its path, resource and `upserted | retired | exported`. */
export type LoggedDocument = Pick<IngestDocument, 'path' | 'resourceId'> &
  Partial<Pick<IngestDocument, 'documentId' | 'revision'>> & { change: IngestDocument['change'] | 'upserted' | 'exported' }

/** What an event carries encrypted. */
export interface IngestDetail {
  /** The resource the write was about, when it was about one. */
  resourceId?: string
  /** The evidence the write added, as stamped (§9.1), by where it went: the resource or `rel -> target`. */
  evidence?: { on: string; entries: Record<string, unknown>[] }[]
  diagnostics?: Pick<Diagnostic, 'severity' | 'code' | 'message'>[]
  /** Why a resource was retired or superseded. */
  reason?: string
  /** For a supersession: the resource that replaces the one the event is about. */
  supersededBy?: string
  /** For an ontology event: the version or draft it made. */
  ontology?: { number?: number; draftId?: string; classification?: string }
}

export interface IngestInput {
  workspaceId: string
  channel: Channel
  actor: string
  actorLabel: string
  action: IngestAction
  documents?: IngestDocument[]
  evidenceCount?: number
  outcome: IngestOutcome
  detail?: IngestDetail
  ontologyDraftId?: string | null
  requestId: string
}

export interface IngestEvent {
  id: string
  workspaceId: string
  channel: Channel
  actor: string
  actorLabel: string
  action: LoggedAction
  documents: LoggedDocument[]
  evidenceCount: number
  outcome: IngestOutcome
  detail: IngestDetail | null
  /** Why the detail did not open, when it did not. */
  detailError?: string
  ontologyDraftId: string | null
  requestId: string
  createdAt: Date
}

const detailAad = (orgId: string, workspaceId: string, id: string) =>
  documentAad({ orgId, workspaceId, documentId: `ingest:${id}`, revision: 0 })

/** Appends an event to the workspace's activity log, in the transaction that made the change. */
export async function recordIngest(ctx: StoreContext, input: IngestInput): Promise<string> {
  const id = randomUUID()
  let sealed: { ciphertext: Buffer; nonce: Buffer; version: number } | null = null
  if (input.detail && Object.keys(input.detail).length > 0) {
    const out = await encrypt(ctx.keys.key(), JSON.stringify(input.detail), detailAad(ctx.keys.orgId, input.workspaceId, id))
    sealed = { ciphertext: Buffer.from(out.ciphertext), nonce: Buffer.from(out.nonce), version: ctx.keys.version }
  }
  await ctx.tx.query(
    `INSERT INTO ingest_events (id, workspace_id, channel, actor, actor_label, action, documents, evidence_count, outcome,
                                detail_ciphertext, detail_nonce, dek_version, ontology_draft_id, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      id,
      input.workspaceId,
      input.channel,
      input.actor,
      input.actorLabel.slice(0, 200),
      input.action,
      JSON.stringify(input.documents ?? []),
      input.evidenceCount ?? 0,
      input.outcome,
      sealed?.ciphertext ?? null,
      sealed?.nonce ?? null,
      sealed?.version ?? null,
      input.ontologyDraftId ?? null,
      input.requestId,
    ],
  )
  return id
}

type IngestRow = {
  id: string
  workspace_id: string
  channel: Channel
  actor: string
  actor_label: string | null
  action: IngestAction | null
  documents: LoggedDocument[]
  evidence_count: number
  outcome: IngestOutcome
  detail_ciphertext: Buffer | null
  detail_nonce: Buffer | null
  dek_version: number | null
  ontology_draft_id: string | null
  request_id: string
  created_at: Date
}

export interface IngestQuery {
  workspaceId: string
  channel?: Channel
  actor?: string
  /** Only events about this resource. */
  resourceId?: string
  limit?: number
  /** `false`: leave each event's sealed detail unopened, for a reader that needs only what is in the clear. */
  detail?: false
}

/** The newest events of a workspace's activity log, decrypted. */
export async function listIngests(ctx: StoreContext, query: IngestQuery): Promise<IngestEvent[]> {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500)
  const values: unknown[] = [query.workspaceId]
  const where = ['workspace_id = $1']
  const param = (value: unknown) => {
    values.push(value)
    return `$${values.length}`
  }
  if (query.channel) where.push(`channel = ${param(query.channel)}`)
  if (query.actor) where.push(`actor = ${param(query.actor)}`)
  if (query.resourceId) where.push(`documents @> ${param(JSON.stringify([{ resourceId: query.resourceId }]))}::jsonb`)
  const { rows } = await ctx.tx.query<IngestRow>(
    `SELECT * FROM ingest_events WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id LIMIT ${param(limit)}`,
    values,
  )
  return Promise.all(
    rows.map(async (row) => {
      const event: IngestEvent = {
        id: row.id,
        workspaceId: row.workspace_id,
        channel: row.channel,
        actor: row.actor,
        actorLabel: row.actor_label ?? row.actor,
        action: row.action ?? 'repo-sync',
        documents: row.documents,
        evidenceCount: row.evidence_count,
        outcome: row.outcome,
        detail: null,
        ontologyDraftId: row.ontology_draft_id,
        requestId: row.request_id,
        createdAt: row.created_at,
      }
      if (query.detail === false || !row.detail_ciphertext || !row.detail_nonce || row.dek_version === null) return event
      try {
        const text = await decryptText(
          ctx.keys.key(row.dek_version),
          { ciphertext: new Uint8Array(row.detail_ciphertext), nonce: new Uint8Array(row.detail_nonce) },
          detailAad(ctx.keys.orgId, row.workspace_id, row.id),
        )
        event.detail = JSON.parse(text) as IngestDetail
      } catch (cause) {
        event.detailError = cause instanceof Error ? cause.message : String(cause)
      }
      return event
    }),
  )
}

/** The actors that appear in a workspace's activity log, with how the evidence names each, for a filter. */
export async function ingestActors(ctx: StoreContext, workspaceId: string): Promise<{ actor: string; label: string }[]> {
  const { rows } = await ctx.tx.query<{ actor: string; label: string }>(
    `SELECT DISTINCT ON (actor) actor, coalesce(actor_label, actor) AS label FROM ingest_events
      WHERE workspace_id = $1 ORDER BY actor, created_at DESC LIMIT 200`,
    [workspaceId],
  )
  return rows
}
