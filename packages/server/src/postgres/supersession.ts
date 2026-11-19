import { randomUUID } from 'node:crypto'

import {
  confidenceModel,
  isStale,
  parseOntology,
  scoreProposal,
  wouldCarry,
  type ConfidenceModel,
  type Diagnostic,
  type ProposalScore,
  type ProposalStatus,
  type SnapshotProposal
} from '../docket.js'
import type { StoreContext } from '../ports.js'
import { dayOf } from '../supersession.js'
import { evidenceKey, hasErrors, stampAll, stampContext } from '../write/evidence.js'
import { WRITE_LIMITS, type EvidenceInput, type StampedEvidence, type Writer } from '../write/inputs.js'
import { recordIngest } from './ingest.js'
import { openText, sealText } from './sealing.js'
import { publishedOntology } from './source.js'
import { describeResource, lockResource } from './write.js'

/**
 * Supersessions as the store keeps them. The documents are untouched, so a
 * record from a repo can be superseded too, and its history stays whole. An
 * agent supersedes directly (`docket_supersede`); consolidation does when it
 * finds a clear contradiction.
 */

export type SupersessionSource = 'agent' | 'consolidation'

export interface Supersession {
  id: string
  workspaceId: string
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
  /** A proposal's state: pending until its evidence clears the bar, accepted after, or rejected. */
  status: ProposalStatus
  /** Its score and bar when it was last decided or given evidence; null for one recorded before proposals. */
  score: number | null
  threshold: number | null
  /** When it last changed. */
  updatedAt: Date
  decidedAt: Date | null
  decidedBy: string | null
  /** Recorded before supersessions were scored: accepted as it always was. */
  grandfathered: boolean
  /** Why it was rejected. */
  rejection?: string
}

/** A proposal as a write leaves it, for its answer. */
export interface ProposalOutcome {
  id: string
  status: ProposalStatus
  score: number
  threshold: number
  carry: { policy: string; source: string; reaches: number }[]
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
  /** The proposal as it stands after the write. */
  proposal?: ProposalOutcome
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
  rejection?: string
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
  lifted_at: Date | null
  status: ProposalStatus
  score: number | null
  threshold: number | null
  updated_at: Date | null
  decided_at: Date | null
  decided_by: string | null
  grandfathered: boolean
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
    workspaceId: row.workspace_id,
    resourceId: row.resource_id,
    supersededBy: row.superseded_by,
    validUntil: row.valid_until,
    source: row.source,
    actorLabel: row.actor_label,
    runId: row.run_id,
    reason: sealed.reason,
    evidence: sealed.evidence,
    recordedAt: row.recorded_at,
    status: row.status,
    score: row.score,
    threshold: row.threshold,
    updatedAt: row.updated_at ?? row.recorded_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    grandfathered: row.grandfathered,
    ...(sealed.rejection !== undefined ? { rejection: sealed.rejection } : {})
  }
}

/** The workspace's confidence model: its published policies and the store's people. */
async function modelOf(ctx: StoreContext, workspaceId: string): Promise<ConfidenceModel> {
  const head = await publishedOntology(ctx, workspaceId)
  const ontology = head ? parseOntology(head.text).ontology : null
  return confidenceModel(ontology ?? { version: 1, resourceTypes: {}, relationships: {} }, ctx.people ? { people: ctx.people } : {})
}

/** A pending proposal as it scores now. */
export interface PendingProposal {
  supersession: Supersession
  score: ProposalScore
  stale: boolean
}

/** Every pending proposal of the workspace, scored now by its policies and people. */
export async function pendingProposals(ctx: StoreContext, workspaceId: string, now: Date = new Date()): Promise<PendingProposal[]> {
  const { rows } = await ctx.tx.query<Row>(
    "SELECT * FROM supersessions WHERE workspace_id = $1 AND lifted_at IS NULL AND status = 'pending' ORDER BY recorded_at",
    [workspaceId]
  )
  if (!rows.length) return []
  const model = await modelOf(ctx, workspaceId)
  const out: PendingProposal[] = []
  for (const row of rows) {
    const supersession = await open(ctx, row)
    const type = (await describeResource(ctx, workspaceId, supersession.resourceId))?.type
    out.push({ supersession, score: scoreProposal(model, type, supersession.evidence), stale: isStale(supersession.updatedAt, now) })
  }
  return out
}

/** The pending proposals not yet fact, as reads show them. */
export async function openProposals(
  ctx: StoreContext,
  workspaceId: string,
  now: Date = new Date()
): Promise<{ proposal: string; id: string; by: string; reason: string; score: number; threshold: number; stale: boolean }[]> {
  return (await pendingProposals(ctx, workspaceId, now))
    .filter((each) => !each.score.clears)
    .map(({ supersession, score, stale }) => ({
      proposal: supersession.id,
      id: supersession.resourceId,
      by: supersession.supersededBy,
      reason: supersession.reason,
      score: score.score,
      threshold: score.threshold,
      stale
    }))
}

/**
 * Scores a proposal by its evidence now, and accepts it when it clears its
 * bar - lifting the record's earlier accepted supersession, as re-pointing
 * always did. Accepted stays accepted. Returns the outcome and the earlier
 * replacement it took over from, if any.
 */
async function decide(
  ctx: StoreContext,
  model: ConfidenceModel,
  supersession: Supersession,
  now: Date
): Promise<{ outcome: ProposalOutcome; replaced?: string; supersession: Supersession }> {
  const type = (await describeResource(ctx, supersession.workspaceId, supersession.resourceId))?.type
  const score = scoreProposal(model, type, supersession.evidence)
  const startStatus = supersession.status
  const status = startStatus === 'pending' && score.clears ? 'accepted' : startStatus
  const { rows } = await ctx.tx.query<Row>(
    `UPDATE supersessions SET score = $2, threshold = $3, status = $4,
            decided_at = CASE WHEN status <> $4 THEN $5 ELSE decided_at END,
            decided_by = CASE WHEN status <> $4 THEN 'score' ELSE decided_by END
      WHERE id = $1 AND status = $6 AND lifted_at IS NULL RETURNING *`,
    [supersession.id, score.score, score.threshold, status, now, startStatus]
  )
  if (!rows.length) {
    const { rows: fresh } = await ctx.tx.query<Row>('SELECT * FROM supersessions WHERE id = $1', [supersession.id])
    const row = fresh[0] as Row
    return {
      outcome: { id: supersession.id, status: row.status, score: row.score ?? score.score, threshold: row.threshold ?? score.threshold, carry: [] },
      supersession: await open(ctx, row)
    }
  }
  let replaced: string | undefined
  if (startStatus === 'pending' && status === 'accepted') {
    const { rows: earlier } = await ctx.tx.query<{ id: string; superseded_by: string }>(
      "UPDATE supersessions SET lifted_at = $3 WHERE workspace_id = $1 AND resource_id = $2 AND id <> $4 AND lifted_at IS NULL AND status = 'accepted' RETURNING id, superseded_by",
      [supersession.workspaceId, supersession.resourceId, now, supersession.id]
    )
    replaced = earlier[0]?.superseded_by
  }
  return {
    outcome: { id: supersession.id, status, score: score.score, threshold: score.threshold, carry: status === 'pending' ? wouldCarry(model, type, score) : [] },
    ...(replaced !== undefined ? { replaced } : {}),
    supersession: await open(ctx, rows[0] as Row)
  }
}

/** The open supersede proposals a change check decides again: pending ones, and accepted ones recorded since proposals. */
export async function snapshotProposals(ctx: StoreContext, workspaceId: string): Promise<SnapshotProposal[]> {
  const { rows } = await ctx.tx.query<Row>(
    "SELECT * FROM supersessions WHERE workspace_id = $1 AND lifted_at IS NULL AND (status = 'pending' OR (status = 'accepted' AND NOT grandfathered)) ORDER BY recorded_at",
    [workspaceId]
  )
  const out: SnapshotProposal[] = []
  for (const row of rows) {
    const opened = await open(ctx, row)
    out.push({ id: opened.id, resource: opened.resourceId, status: opened.status as 'pending' | 'accepted', evidence: opened.evidence })
  }
  return out
}

/** Scores every pending proposal of the workspace again and accepts those that now clear their bar: after a policy is published. */
export async function promoteProposals(ctx: StoreContext, workspaceId: string, now: Date = new Date()): Promise<Supersession[]> {
  const pending = await pendingProposals(ctx, workspaceId, now)
  const clearing = pending
    .filter((each) => each.score.clears)
    .sort((a, b) => (a.supersession.resourceId < b.supersession.resourceId ? -1 : a.supersession.resourceId > b.supersession.resourceId ? 1 : 0))
  if (!clearing.length) return []
  const model = await modelOf(ctx, workspaceId)
  const promoted: Supersession[] = []
  for (const { supersession } of clearing) {
    await lockResource(ctx, workspaceId, supersession.resourceId)
    const { rows } = await ctx.tx.query<Row>('SELECT * FROM supersessions WHERE id = $1', [supersession.id])
    const row = rows[0]
    if (!row || row.status !== 'pending' || row.lifted_at !== null) continue
    promoted.push((await decide(ctx, model, await open(ctx, row), now)).supersession)
  }
  return promoted
}

/**
 * The workspace's live supersessions, one per superseded record, opened:
 * every accepted one, and a pending one whose evidence clears its bar now -
 * a policy or a person's role can carry it before anything is written. A
 * write or a publish records it accepted.
 */
export async function liveSupersessions(ctx: StoreContext, workspaceId: string, now: Date = new Date()): Promise<Supersession[]> {
  const { rows } = await ctx.tx.query<Row>(
    "SELECT * FROM supersessions WHERE workspace_id = $1 AND lifted_at IS NULL AND status = 'accepted' ORDER BY resource_id",
    [workspaceId]
  )
  const live = new Map<string, Supersession>()
  for (const row of rows) live.set(row.resource_id, await open(ctx, row))
  for (const { supersession, score } of await pendingProposals(ctx, workspaceId, now)) if (score.clears) live.set(supersession.resourceId, supersession)
  return [...live.values()].sort((a, b) => (a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0))
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

  if (id && by && id !== by) {
    const { rows: known } = await ctx.tx.query<{ resource_id: string }>(
      'SELECT DISTINCT resource_id FROM documents WHERE workspace_id = $1 AND resource_id = ANY($2::text[]) AND retired_at IS NULL',
      [workspaceId, [id, by]]
    )
    const onFile = new Set(known.map((row) => row.resource_id))
    for (const each of [id, by]) if (!onFile.has(each)) diagnostics.push(refuse('unknown-resource', `There is no resource ${each} in this workspace.`, each))
    const replacement = (await liveSupersessions(ctx, workspaceId, now)).find((each) => each.resourceId === by)
    if (replacement) {
      diagnostics.push(
        refuse(
          'replacement-superseded',
          `${by} is itself out of date: it was superseded by ${replacement.supersededBy} on ${dayOf(replacement.validUntil)}. Supersede ${id} with the current record.`,
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

  const model = await modelOf(ctx, workspaceId)
  const { rows: open_ } = await ctx.tx.query<Row>(
    "SELECT * FROM supersessions WHERE workspace_id = $1 AND resource_id = $2 AND lifted_at IS NULL AND status IN ('accepted', 'pending')",
    [workspaceId, id]
  )
  const accepted = open_.find((row) => row.status === 'accepted')
  if (accepted?.superseded_by === by) {
    const decided = await decide(ctx, model, await open(ctx, accepted), now)
    return { supersession: decided.supersession, proposal: decided.outcome, changed: false, diagnostics }
  }

  // The same proposal again: its evidence is added to the pending one.
  const pendingRow = open_.find((row) => row.status === 'pending')
  if (pendingRow?.superseded_by === by) {
    const added = await appendEvidence(ctx, model, await open(ctx, pendingRow), stamping.stamped, now)
    if (added.evidenceAdded) await logEvidence(ctx, logged, id, by, reason, added.fresh, diagnostics)
    return {
      supersession: added.supersession,
      proposal: added.outcome,
      changed: added.evidenceAdded > 0,
      ...(added.replaced ? { replaced: added.replaced } : {}),
      diagnostics
    }
  }
  if (pendingRow) {
    diagnostics.push({
      severity: 'warning',
      code: 'repointed',
      message: `A pending proposal said ${id} was replaced by ${pendingRow.superseded_by}; this one, to ${by}, takes its place, and the earlier one stays in its history.`,
      id
    })
    await ctx.tx.query('UPDATE supersessions SET lifted_at = $2 WHERE id = $1', [pendingRow.id, now])
  }

  const evidence = stamping.stamped
  const rowId = randomUUID()
  const sealed = await sealText(ctx.codec, JSON.stringify({ reason, evidence } satisfies Sealed), refOf(workspaceId, rowId))
  const { rows } = await ctx.tx.query<Row>(
    `INSERT INTO supersessions (id, workspace_id, resource_id, superseded_by, valid_until, source, actor, actor_label, run_id,
                                detail_ciphertext, detail_nonce, dek_version, request_id, recorded_at, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending', $14) RETURNING *`,
    [rowId, workspaceId, id, by, until, source, writer.actor, writer.label.slice(0, 200), options.runId ?? null, sealed.ciphertext, sealed.nonce, sealed.keyVersion, writer.requestId, now]
  )
  const decided = await decide(ctx, model, await open(ctx, rows[0] as Row), now)
  if (decided.replaced) {
    diagnostics.push({
      severity: 'warning',
      code: 'repointed',
      message: `${id} was superseded by ${decided.replaced}; it now points to ${by}, and the earlier supersession stays in its history.`,
      id
    })
  }
  const ingestId = await logEvidence(ctx, logged, id, by, reason, evidence, diagnostics)
  return {
    supersession: decided.supersession,
    proposal: decided.outcome,
    changed: true,
    ...(decided.replaced ? { replaced: decided.replaced } : {}),
    diagnostics,
    ingestId
  }
}

/** Records a supersede write in the activity log. */
async function logEvidence(
  ctx: StoreContext,
  logged: { workspaceId: string; channel: Writer['channel']; actor: string; actorLabel: string; action: 'supersede'; requestId: string },
  id: string,
  by: string,
  reason: string,
  evidence: readonly StampedEvidence[],
  diagnostics: readonly Diagnostic[]
): Promise<string> {
  return recordIngest(ctx, {
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
}

/** Appends new evidence to a proposal - sealed again with it - and scores it again. */
async function appendEvidence(
  ctx: StoreContext,
  model: ConfidenceModel,
  supersession: Supersession,
  stamped: readonly StampedEvidence[],
  now: Date
): Promise<{ supersession: Supersession; outcome: ProposalOutcome; replaced?: string; evidenceAdded: number; fresh: StampedEvidence[] }> {
  const known = new Set(supersession.evidence.map((entry) => evidenceKey(entry as unknown as Record<string, unknown>)))
  const fresh = stamped.filter((entry) => !known.has(evidenceKey(entry as unknown as Record<string, unknown>)))
  let current = supersession
  if (fresh.length) {
    const evidence = [...supersession.evidence, ...fresh]
    const sealed = await sealText(
      ctx.codec,
      JSON.stringify({ reason: supersession.reason, evidence, ...(supersession.rejection !== undefined ? { rejection: supersession.rejection } : {}) } satisfies Sealed),
      refOf(supersession.workspaceId, supersession.id)
    )
    const { rows } = await ctx.tx.query<Row>(
      'UPDATE supersessions SET detail_ciphertext = $2, detail_nonce = $3, dek_version = $4, updated_at = $5 WHERE id = $1 RETURNING *',
      [supersession.id, sealed.ciphertext, sealed.nonce, sealed.keyVersion, now]
    )
    current = await open(ctx, rows[0] as Row)
  }
  const decided = await decide(ctx, model, current, now)
  return { ...decided, evidenceAdded: fresh.length, fresh }
}

/** What adding evidence to a proposal, or rejecting one, did. */
export interface ProposalWriteResult {
  proposal?: ProposalOutcome & { resource: string; supersededBy: string }
  changed: boolean
  evidenceAdded: number
  diagnostics: Diagnostic[]
  ingestId?: string
}

async function proposalRow(ctx: StoreContext, workspaceId: string, proposal: string): Promise<Row | undefined> {
  const exact = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proposal)
  const { rows } = exact
    ? await ctx.tx.query<Row>('SELECT * FROM supersessions WHERE workspace_id = $1 AND id = $2', [workspaceId, proposal])
    : proposal.length >= 8
      ? await ctx.tx.query<Row>('SELECT * FROM supersessions WHERE workspace_id = $1 AND lifted_at IS NULL AND id::text LIKE $2', [workspaceId, `${proposal.toLowerCase()}%`])
      : { rows: [] as Row[] }
  return rows.length === 1 ? rows[0] : undefined
}

/**
 * `docket_add_evidence` for a proposal: its evidence, appended, and the
 * proposal scored again - accepted when it now clears the bar. A confirmation
 * is evidence like any other: the person's own, cited by nothing.
 */
export async function addProposalEvidence(
  ctx: StoreContext,
  writer: Writer,
  input: { supersession: string; evidence: EvidenceInput[] },
  options: { now?: () => Date } = {}
): Promise<ProposalWriteResult> {
  const now = (options.now ?? (() => new Date()))()
  const { workspaceId } = writer
  const row = await proposalRow(ctx, workspaceId, input.supersession)
  if (row) await lockResource(ctx, workspaceId, row.resource_id)
  const where = row?.resource_id ?? input.supersession
  const diagnostics: Diagnostic[] = []
  if (!row || row.lifted_at !== null) diagnostics.push(refuse('unknown-proposal', `There is no open supersede proposal ${input.supersession} in this workspace.`, where))
  else if (row.status === 'rejected') diagnostics.push(refuse('rejected-proposal', `Proposal ${row.id} was rejected; propose it again with docket_supersede.`, where))
  if (input.evidence.length === 0) diagnostics.push(refuse('missing-evidence', 'Give at least one piece of evidence for the proposal.', where))
  else if (input.evidence.length > WRITE_LIMITS.evidencePerCall) diagnostics.push(refuse('too-much-evidence', `A write carries at most ${WRITE_LIMITS.evidencePerCall} evidence entries.`, where))
  const head = await publishedOntology(ctx, workspaceId)
  const stamping = stampAll(input.evidence, writer, now, stampContext(head ? parseOntology(head.text).ontology : null, ctx.people), {
    where: { id: where },
    subject: `proposal ${input.supersession}`
  })
  diagnostics.push(...stamping.diagnostics)
  if (hasErrors(diagnostics) || !row) return { changed: false, evidenceAdded: 0, diagnostics }

  const supersession = await open(ctx, row)
  const added = await appendEvidence(ctx, await modelOf(ctx, workspaceId), supersession, stamping.stamped, now)
  const logged = { workspaceId, channel: writer.channel, actor: writer.actor, actorLabel: writer.label, action: 'supersede' as const, requestId: writer.requestId }
  const ingestId = added.evidenceAdded ? await logEvidence(ctx, logged, row.resource_id, row.superseded_by, supersession.reason, added.fresh, diagnostics) : undefined
  return {
    proposal: { ...added.outcome, resource: row.resource_id, supersededBy: row.superseded_by },
    changed: added.evidenceAdded > 0,
    evidenceAdded: added.evidenceAdded,
    diagnostics,
    ...(ingestId ? { ingestId } : {})
  }
}

/** Turns a pending proposal down, with why: the older record stays current, and both are kept. */
export async function rejectProposal(
  ctx: StoreContext,
  writer: Writer,
  input: { supersession: string; reason: string },
  options: { now?: () => Date } = {}
): Promise<ProposalWriteResult> {
  const now = (options.now ?? (() => new Date()))()
  const row = await proposalRow(ctx, writer.workspaceId, input.supersession)
  if (row) await lockResource(ctx, writer.workspaceId, row.resource_id)
  const reason = input.reason.trim()
  const where = row?.resource_id ?? input.supersession
  const diagnostics: Diagnostic[] = []
  if (!row || row.lifted_at !== null) diagnostics.push(refuse('unknown-proposal', `There is no open supersede proposal ${input.supersession} in this workspace.`, where))
  else if (row.status !== 'pending') diagnostics.push(refuse('decided-proposal', `Proposal ${row.id} is already ${row.status}.`, where))
  if (!reason) diagnostics.push(refuse('missing-reason', 'Say why the proposal is rejected.', where))
  else if (reason.length > WRITE_LIMITS.reasonLength) diagnostics.push(refuse('reason-too-long', `A reason is at most ${WRITE_LIMITS.reasonLength} characters.`, where))
  if (hasErrors(diagnostics) || !row) return { changed: false, evidenceAdded: 0, diagnostics }
  const supersession = await open(ctx, row)
  const sealed = await sealText(ctx.codec, JSON.stringify({ reason: supersession.reason, evidence: supersession.evidence, rejection: reason } satisfies Sealed), refOf(row.workspace_id, row.id))
  const { rows: updated } = await ctx.tx.query<{ id: string }>(
    "UPDATE supersessions SET status = 'rejected', decided_at = $2, decided_by = $3, updated_at = $2, detail_ciphertext = $4, detail_nonce = $5, dek_version = $6 WHERE id = $1 AND status = 'pending' AND lifted_at IS NULL RETURNING id",
    [row.id, now, (writer.principal ?? writer.label).slice(0, 200), sealed.ciphertext, sealed.nonce, sealed.keyVersion]
  )
  if (!updated.length) {
    diagnostics.push(refuse('decided-proposal', `Proposal ${row.id} is already decided.`, where))
    return { changed: false, evidenceAdded: 0, diagnostics }
  }
  return {
    proposal: { id: row.id, status: 'rejected', score: row.score ?? 0, threshold: row.threshold ?? 0, carry: [], resource: row.resource_id, supersededBy: row.superseded_by },
    changed: true,
    evidenceAdded: 0,
    diagnostics
  }
}
