import { randomUUID } from 'node:crypto'

import { parseOntology, type Diagnostic } from '../docket.js'
import type { StoreContext } from '../ports.js'
import { dayOf } from '../supersession.js'
import { hasErrors, stampAll, stampContext } from '../write/evidence.js'
import { WRITE_LIMITS, type EvidenceInput, type StampedEvidence, type Writer } from '../write/inputs.js'
import { recordIngest } from './ingest.js'
import { openText, sealText } from './sealing.js'
import { publishedOntology } from './source.js'
import { lockResource } from './write.js'

/**
 * Supersessions as the store keeps them. The documents are untouched, so a
 * record from a repo can be superseded too, and its history stays whole. An
 * agent supersedes directly (`docket_supersede`); consolidation does when it
 * finds a clear contradiction.
 */

export type SupersessionSource = 'agent' | 'consolidation'

export interface Supersession {
  id: string
  /** The record gone out of date. */
  resourceId: string
  /** The record that replaces it. */
  supersededBy: string
  /** Until when the older record held. */
  validUntil: Date
  source: SupersessionSource
  /** Who recorded it, as evidence names them. */
  actorLabel: string
  /** The consolidation run that found it, when one did. */
  runId: string | null
  reason: string
  evidence: StampedEvidence[]
  recordedAt: Date
}

export interface SupersedeInput {
  /** The record gone out of date. */
  id: string
  /** The record that replaces it. */
  by: string
  reason: string
  evidence: EvidenceInput[]
  /** Until when the older record held: `YYYY-MM-DD` or an ISO timestamp; now when not given. */
  validUntil?: string
}

export interface SupersedeOptions {
  now?: () => Date
  /** Who found it: an agent through MCP or a web app, or a consolidation run. */
  source?: SupersessionSource
  runId?: string
}

export interface SupersedeResult {
  supersession?: Supersession
  /** False for a refusal, or when the record was already superseded by the same replacement. */
  changed: boolean
  /** The replacement this one took over from, when the record was superseded by another before. */
  replaced?: string
  diagnostics: Diagnostic[]
  ingestId?: string
}

/** What a supersession carries sealed: customer content, like the activity log's detail. */
interface Sealed {
  reason: string
  evidence: StampedEvidence[]
}

type Row = {
  id: string
  workspace_id: string
  resource_id: string
  superseded_by: string
  valid_until: Date
  source: SupersessionSource
  actor_label: string
  run_id: string | null
  detail_ciphertext: Buffer
  detail_nonce: Buffer
  dek_version: number
  recorded_at: Date
}

/** What a supersession's detail is sealed against: a revision 0 of `supersession:<id>`. */
const refOf = (workspaceId: string, id: string) => ({ workspaceId, documentId: `supersession:${id}`, revision: 0 })

const refuse = (code: string, message: string, id: string): Diagnostic => ({ severity: 'error', code, message, id })

/** A date an agent gives, or why it will not do. Never later than now: a record cannot stop holding in the future. */
function untilOf(given: string | undefined, now: Date, id: string): Date | Diagnostic {
  if (given === undefined) return now
  const at = /^\d{4}-\d{2}-\d{2}$/.test(given) ? new Date(`${given}T00:00:00.000Z`) : new Date(given)
  if (Number.isNaN(at.getTime())) return refuse('invalid-date', `validUntil must be a date (YYYY-MM-DD) or an ISO timestamp, not "${given}".`, id)
  if (at.getTime() > now.getTime() + 60_000) return refuse('future-date', 'validUntil cannot be in the future: say when the record stopped holding.', id)
  return at
}

async function open(ctx: StoreContext, row: Row): Promise<Supersession> {
  const text = await openText(ctx.codec, { ciphertext: row.detail_ciphertext, nonce: row.detail_nonce, keyVersion: row.dek_version }, refOf(row.workspace_id, row.id))
  const sealed = JSON.parse(text) as Sealed
  return {
    id: row.id,
    resourceId: row.resource_id,
    supersededBy: row.superseded_by,
    validUntil: row.valid_until,
    source: row.source,
    actorLabel: row.actor_label,
    runId: row.run_id,
    reason: sealed.reason,
    evidence: sealed.evidence,
    recordedAt: row.recorded_at
  }
}

/** The workspace's live supersessions, one per superseded record, opened. */
export async function liveSupersessions(ctx: StoreContext, workspaceId: string): Promise<Supersession[]> {
  const { rows } = await ctx.tx.query<Row>('SELECT * FROM supersessions WHERE workspace_id = $1 AND lifted_at IS NULL ORDER BY resource_id', [workspaceId])
  return Promise.all(rows.map((row) => open(ctx, row)))
}

/**
 * Marks a record superseded by another, with why and the evidence, in the
 * caller's transaction. Both must be on file and different, and the
 * replacement must be current itself. A record already superseded by the
 * same replacement is left as it is; one superseded by another is re-pointed,
 * and the earlier supersession kept in the history. Nothing is deleted: the
 * record stays on file, and leaves search's answers as current.
 */
export async function supersedeResource(ctx: StoreContext, writer: Writer, input: SupersedeInput, options: SupersedeOptions = {}): Promise<SupersedeResult> {
  const now = (options.now ?? (() => new Date()))()
  const { workspaceId } = writer
  const id = input.id.trim()
  const by = input.by.trim()
  const reason = input.reason.trim()
  for (const each of [id, by].sort()) if (each) await lockResource(ctx, workspaceId, each)

  const diagnostics: Diagnostic[] = []
  if (!id || !by) diagnostics.push(refuse('missing-resource', 'Give the record that went out of date (id) and the one that replaces it (by).', id))
  else if (id === by) diagnostics.push(refuse('same-resource', 'A record cannot supersede itself: name the record that replaces it.', id))
  if (!reason) diagnostics.push(refuse('missing-reason', 'Say why the record is out of date.', id))
  else if (reason.length > WRITE_LIMITS.reasonLength) diagnostics.push(refuse('reason-too-long', `A reason is at most ${WRITE_LIMITS.reasonLength} characters.`, id))
  if (input.evidence.length === 0) diagnostics.push(refuse('missing-evidence', 'Give at least one piece of evidence that the record changed: where the newer fact was seen.', id))
  else if (input.evidence.length > WRITE_LIMITS.evidencePerCall) diagnostics.push(refuse('too-much-evidence', `A write carries at most ${WRITE_LIMITS.evidencePerCall} evidence entries.`, id))
  const until = untilOf(input.validUntil, now, id)
  if (!(until instanceof Date)) diagnostics.push(until)

  let live: Row | undefined
  if (id && by && id !== by) {
    const { rows: known } = await ctx.tx.query<{ resource_id: string }>(
      'SELECT DISTINCT resource_id FROM documents WHERE workspace_id = $1 AND resource_id = ANY($2::text[]) AND retired_at IS NULL',
      [workspaceId, [id, by]]
    )
    const onFile = new Set(known.map((row) => row.resource_id))
    for (const each of [id, by]) if (!onFile.has(each)) diagnostics.push(refuse('unknown-resource', `There is no resource ${each} in this workspace.`, each))
    const { rows } = await ctx.tx.query<Row>('SELECT * FROM supersessions WHERE workspace_id = $1 AND resource_id = ANY($2::text[]) AND lifted_at IS NULL', [workspaceId, [id, by]])
    live = rows.find((row) => row.resource_id === id)
    const replacement = rows.find((row) => row.resource_id === by)
    if (replacement) {
      diagnostics.push(
        refuse(
          'replacement-superseded',
          `${by} is itself out of date: it was superseded by ${replacement.superseded_by} on ${dayOf(replacement.valid_until)}. Supersede ${id} with the current record.`,
          by
        )
      )
    }
  }

  const head = await publishedOntology(ctx, workspaceId)
  const stamping = stampAll(input.evidence, writer, now, stampContext(head ? parseOntology(head.text).ontology : null, ctx.people), {
    where: { id },
    subject: `the supersession of ${id}`
  })
  diagnostics.push(...stamping.diagnostics)

  const source = options.source ?? 'agent'
  const logged = { workspaceId, channel: writer.channel, actor: writer.actor, actorLabel: writer.label, action: 'supersede' as const, requestId: writer.requestId }
  if (hasErrors(diagnostics)) {
    const ingestId = await recordIngest(ctx, {
      ...logged,
      outcome: 'refused',
      detail: {
        resourceId: id,
        ...(by ? { supersededBy: by } : {}),
        diagnostics: diagnostics.map(({ severity, code, message }) => ({ severity, code, message })),
        ...(reason ? { reason: reason.slice(0, WRITE_LIMITS.reasonLength) } : {})
      }
    })
    return { changed: false, diagnostics, ingestId }
  }
  if (live?.superseded_by === by) return { supersession: await open(ctx, live), changed: false, diagnostics }
  if (live) {
    diagnostics.push({
      severity: 'warning',
      code: 'repointed',
      message: `${id} was superseded by ${live.superseded_by}; it now points to ${by}, and the earlier supersession stays in its history.`,
      id
    })
    await ctx.tx.query('UPDATE supersessions SET lifted_at = $2 WHERE id = $1', [live.id, now])
  }

  const evidence = stamping.stamped
  const rowId = randomUUID()
  const sealed = await sealText(ctx.codec, JSON.stringify({ reason, evidence } satisfies Sealed), refOf(workspaceId, rowId))
  const { rows } = await ctx.tx.query<Row>(
    `INSERT INTO supersessions (id, workspace_id, resource_id, superseded_by, valid_until, source, actor, actor_label, run_id,
                                detail_ciphertext, detail_nonce, dek_version, request_id, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
    [rowId, workspaceId, id, by, until, source, writer.actor, writer.label.slice(0, 200), options.runId ?? null, sealed.ciphertext, sealed.nonce, sealed.keyVersion, writer.requestId, now]
  )
  const ingestId = await recordIngest(ctx, {
    ...logged,
    outcome: 'ok',
    evidenceCount: evidence.length,
    detail: {
      resourceId: id,
      supersededBy: by,
      reason: `Superseded by ${by}: ${reason}`.slice(0, WRITE_LIMITS.reasonLength),
      evidence: [{ on: id, entries: evidence as unknown as Record<string, unknown>[] }],
      ...(diagnostics.length ? { diagnostics: diagnostics.map(({ severity, code, message }) => ({ severity, code, message })) } : {})
    }
  })
  return {
    supersession: await open(ctx, rows[0] as Row),
    changed: true,
    ...(live ? { replaced: live.superseded_by } : {}),
    diagnostics,
    ingestId
  }
}
