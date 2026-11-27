// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import {
  evidenceKey,
  hasErrors,
  isStale,
  scoreProposal,
  stampAll,
  stampContext,
  wouldCarry,
  type ProposalScore,
  type ProposalStatus,
  type SnapshotProposal,
} from '@chrisjowen/docket/workspace'
import { decryptText, encrypt } from '@docket/platform-keys'

import { parseOntology, type ConfidenceModel, type Diagnostic, type Ontology } from './docket.js'
import { documentAad, type StoreContext } from './documents.js'
import { explainProposal, type Explained } from './explain.js'
import { recordIngest } from './ingest.js'
import { publishedOntology } from './postgres-source.js'
import { orgTrust, trustChanged, trustModel, type OrgTrust } from './trust.js'
import { WRITE_LIMITS, describeResource, lockResource, type EvidenceInput, type StampedEvidence, type Writer } from './write.js'

/**
 * Supersession: facts come from agents and cannot be checked again against a
 * source, so one gone out of date is never deleted. When a newer record
 * contradicts an older one about the same thing, the older is marked
 * superseded - until when it held, the record that replaces it, why, and the
 * evidence - and search answers with the replacement and a note of the
 * change. The documents are untouched, so a record from a repo can be
 * superseded too, and its history stays whole.
 *
 * A supersession is a proposal (docket 0.16): `docket_supersede` records it
 * at once, scored by the workspace's policies over what the org attests -
 * about `supersedes`, or about the replaced record's type - and it is
 * accepted, the older record going out of date, only when its score clears
 * the bar for that type (`trust.accept`). Until then it is pending and the
 * older record stays current: more evidence, a member's confirmation, a new
 * policy or a person's role can carry it, a member can reject it, and an
 * owner or admin can accept it regardless. Accepted stays accepted. An agent
 * proposes (`docket_supersede`); so does consolidation when it finds a clear
 * contradiction, and most of its proposals wait for support.
 */

export type SupersessionSource = 'agent' | 'consolidation'

export interface Supersession {
  id: string
  workspaceId: string
  /** The record gone out of date, or that would. */
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
  /** Pending until its evidence clears the bar, accepted after, or rejected. */
  status: ProposalStatus
  /** Its score and bar when it was last decided or given evidence; null for one recorded before proposals. */
  score: number | null
  threshold: number | null
  /** When it last changed. */
  updatedAt: Date
  decidedAt: Date | null
  /** `score` when its score carried it; otherwise who rejected it, or accepted it regardless. */
  decidedBy: string | null
  /** Recorded before supersessions were scored: accepted as it always was. */
  grandfathered: boolean
  /** Why it was rejected, or accepted regardless. */
  rejection?: string
  override?: string
  /** Lifted: re-pointed to another replacement, kept in the history. */
  liftedAt: Date | null
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
  /** Who found it: an agent through MCP or the web, or a consolidation run. */
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
  override?: string
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

const aadOf = (orgId: string, workspaceId: string, id: string) => documentAad({ orgId, workspaceId, documentId: `supersession:${id}`, revision: 0 })

const refuse = (code: string, message: string, id: string): Diagnostic => ({ severity: 'error', code, message, id })

/** A date an agent gives, or why it will not do. Never later than now: a record cannot stop holding in the future. */
function untilOf(given: string | undefined, now: Date, id: string): Date | Diagnostic {
  if (given === undefined) return now
  const at = /^\d{4}-\d{2}-\d{2}$/.test(given) ? new Date(`${given}T00:00:00.000Z`) : new Date(given)
  if (Number.isNaN(at.getTime())) return refuse('invalid-date', `validUntil must be a date (YYYY-MM-DD) or an ISO timestamp, not "${given}".`, id)
  if (at.getTime() > now.getTime() + 60_000) return refuse('future-date', 'validUntil cannot be in the future: say when the record stopped holding.', id)
  return at
}

async function seal(ctx: StoreContext, workspaceId: string, id: string, sealed: Sealed) {
  const out = await encrypt(ctx.keys.key(), JSON.stringify(sealed), aadOf(ctx.keys.orgId, workspaceId, id))
  return { ciphertext: Buffer.from(out.ciphertext), nonce: Buffer.from(out.nonce), version: ctx.keys.version }
}

async function open(ctx: StoreContext, row: Row): Promise<Supersession> {
  const text = await decryptText(
    ctx.keys.key(row.dek_version),
    { ciphertext: new Uint8Array(row.detail_ciphertext), nonce: new Uint8Array(row.detail_nonce) },
    aadOf(ctx.keys.orgId, row.workspace_id, row.id),
  )
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
    ...(sealed.rejection !== undefined ? { rejection: sealed.rejection } : {}),
    ...(sealed.override !== undefined ? { override: sealed.override } : {}),
    liftedAt: row.lifted_at,
  }
}

const EMPTY_ONTOLOGY: Ontology = { version: 1, resourceTypes: {}, relationships: {} }

async function headOf(ctx: StoreContext, workspaceId: string): Promise<Ontology | null> {
  const head = await publishedOntology(ctx, workspaceId)
  return head ? parseOntology(head.text).ontology : null
}

/** The workspace's confidence model: its published policies over what the org attests. */
export async function proposalModel(ctx: StoreContext, workspaceId: string, trust?: OrgTrust): Promise<ConfidenceModel> {
  const ontology = await headOf(ctx, workspaceId)
  return trustModel(ontology ?? EMPTY_ONTOLOGY, trust ?? (await orgTrust(ctx)))
}

/** A pending proposal as it scores now. */
export interface PendingProposal {
  supersession: Supersession
  score: ProposalScore
  stale: boolean
}

/** Every pending proposal of the workspace, scored now by its policies and what the org attests. */
export async function pendingProposals(ctx: StoreContext, workspaceId: string, now: Date = new Date()): Promise<PendingProposal[]> {
  const { rows } = await ctx.tx.query<Row>(
    "SELECT * FROM supersessions WHERE workspace_id = $1 AND lifted_at IS NULL AND status = 'pending' ORDER BY recorded_at",
    [workspaceId],
  )
  if (!rows.length) return []
  const model = await proposalModel(ctx, workspaceId)
  const out: PendingProposal[] = []
  for (const row of rows) {
    const supersession = await open(ctx, row)
    const type = (await describeResource(ctx, workspaceId, supersession.resourceId))?.type
    out.push({ supersession, score: scoreProposal(model, type, supersession.evidence), stale: isStale(supersession.updatedAt, now) })
  }
  return out
}

/** The pending proposals not yet fact, as reads show them beside the records they touch. */
export async function openProposals(
  ctx: StoreContext,
  workspaceId: string,
  now: Date = new Date(),
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
      stale,
    }))
}

/**
 * Scores a proposal by its evidence now, and accepts it when it clears its
 * bar - lifting the record's earlier accepted supersession, as re-pointing
 * always did. Accepted stays accepted.
 */
async function decide(
  ctx: StoreContext,
  model: ConfidenceModel,
  supersession: Supersession,
  now: Date,
  force?: { by: string },
): Promise<{ outcome: ProposalOutcome; replaced?: string; supersession: Supersession }> {
  const type = (await describeResource(ctx, supersession.workspaceId, supersession.resourceId))?.type
  const score = scoreProposal(model, type, supersession.evidence)
  const startStatus = supersession.status
  const status = startStatus === 'pending' && (score.clears || force) ? 'accepted' : startStatus
  const promoting = startStatus === 'pending' && status === 'accepted'
  const decidedBy = force?.by ?? 'score'
  // Promoting lifts the resource's earlier accepted supersession in the same
  // statement as accepting this one, so supersessions_live's partial unique
  // index never sees both rows live at once.
  const { rows } = await ctx.tx.query<Row>(
    promoting
      ? `UPDATE supersessions SET
              score = CASE WHEN id = $1 THEN $2 ELSE score END,
              threshold = CASE WHEN id = $1 THEN $3 ELSE threshold END,
              status = CASE WHEN id = $1 THEN $4 ELSE status END,
              decided_at = CASE WHEN id = $1 THEN $5 ELSE decided_at END,
              decided_by = CASE WHEN id = $1 THEN $9 ELSE decided_by END,
              updated_at = CASE WHEN id = $1 THEN $5 ELSE updated_at END,
              lifted_at = CASE WHEN id <> $1 THEN $5 ELSE lifted_at END
        WHERE workspace_id = $6 AND resource_id = $7 AND lifted_at IS NULL
          AND (id = $1 OR status = 'accepted')
          AND EXISTS (SELECT 1 FROM supersessions self WHERE self.id = $1 AND self.status = $8 AND self.lifted_at IS NULL)
        RETURNING *`
      : `UPDATE supersessions SET score = $2, threshold = $3, status = $4,
              decided_at = CASE WHEN status <> $4 THEN $5 ELSE decided_at END,
              decided_by = CASE WHEN status <> $4 THEN 'score' ELSE decided_by END
        WHERE id = $1 AND status = $6 AND lifted_at IS NULL RETURNING *`,
    promoting
      ? [supersession.id, score.score, score.threshold, status, now, supersession.workspaceId, supersession.resourceId, startStatus, decidedBy.slice(0, 200)]
      : [supersession.id, score.score, score.threshold, status, now, startStatus],
  )
  const selfRow = rows.find((row) => row.id === supersession.id)
  if (!selfRow) {
    const { rows: fresh } = await ctx.tx.query<Row>('SELECT * FROM supersessions WHERE id = $1', [supersession.id])
    const row = fresh[0] as Row
    return {
      outcome: { id: supersession.id, status: row.status, score: row.score ?? score.score, threshold: row.threshold ?? score.threshold, carry: [] },
      supersession: await open(ctx, row),
    }
  }
  const replaced = promoting ? rows.find((row) => row.id !== supersession.id)?.superseded_by : undefined
  return {
    outcome: { id: supersession.id, status, score: score.score, threshold: score.threshold, carry: status === 'pending' ? wouldCarry(model, type, score) : [] },
    ...(replaced !== undefined ? { replaced } : {}),
    supersession: await open(ctx, selfRow),
  }
}

/** The open supersede proposals a change check decides again: pending ones, and accepted ones recorded since proposals. */
export async function snapshotProposals(ctx: StoreContext, workspaceId: string): Promise<SnapshotProposal[]> {
  const { rows } = await ctx.tx.query<Row>(
    "SELECT * FROM supersessions WHERE workspace_id = $1 AND lifted_at IS NULL AND (status = 'pending' OR (status = 'accepted' AND NOT grandfathered)) ORDER BY recorded_at",
    [workspaceId],
  )
  const out: SnapshotProposal[] = []
  for (const row of rows) {
    const opened = await open(ctx, row)
    out.push({ id: opened.id, resource: opened.resourceId, status: opened.status as 'pending' | 'accepted', evidence: opened.evidence })
  }
  return out
}

/**
 * Scores every pending proposal of the workspace again and accepts those that
 * now clear their bar: after a policy is published, or a person's role, a
 * repository's settings or a registered document changes.
 */
export async function promoteProposals(ctx: StoreContext, workspaceId: string, now: Date = new Date()): Promise<Supersession[]> {
  const pending = await pendingProposals(ctx, workspaceId, now)
  const clearing = pending
    .filter((each) => each.score.clears)
    .sort((a, b) => (a.supersession.resourceId < b.supersession.resourceId ? -1 : a.supersession.resourceId > b.supersession.resourceId ? 1 : 0))
  if (!clearing.length) return []
  const model = await proposalModel(ctx, workspaceId)
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
 * After what the org attests changed - a person's role, a registered
 * document, a repository's settings: every workspace projects confidence
 * again, and its pending proposals are scored again, those now clearing their
 * bar accepted. Returns the proposals it accepted.
 */
export async function attestationsChanged(ctx: StoreContext, now: Date = new Date()): Promise<Supersession[]> {
  const promoted: Supersession[] = []
  for (const workspaceId of await trustChanged(ctx.tx)) promoted.push(...(await promoteProposals(ctx, workspaceId, now)))
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
    [workspaceId],
  )
  const live = new Map<string, Supersession>()
  for (const row of rows) live.set(row.resource_id, await open(ctx, row))
  for (const { supersession, score } of await pendingProposals(ctx, workspaceId, now)) if (score.clears) live.set(supersession.resourceId, supersession)
  return [...live.values()].sort((a, b) => (a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0))
}

/** A proposal in the queue: the supersession and, for a pending one, how it scores now and what would carry it. */
export interface ListedProposal {
  supersession: Supersession
  score: number | null
  threshold: number | null
  stale: boolean
  carry: { policy: string; source: string; reaches: number }[]
}

/** The workspace's proposals, newest first: pending ones scored now, decided ones as they were decided. */
export async function listProposals(
  ctx: StoreContext,
  workspaceId: string,
  options: { status?: ProposalStatus; limit?: number; now?: Date } = {},
): Promise<ListedProposal[]> {
  const now = options.now ?? new Date()
  const { rows } = await ctx.tx.query<Row>(
    `SELECT * FROM supersessions WHERE workspace_id = $1 AND lifted_at IS NULL AND ($2::text IS NULL OR status = $2)
      ORDER BY recorded_at DESC LIMIT $3`,
    [workspaceId, options.status ?? null, Math.min(Math.max(options.limit ?? 100, 1), 500)],
  )
  if (!rows.length) return []
  const model = await proposalModel(ctx, workspaceId)
  const out: ListedProposal[] = []
  for (const row of rows) {
    const supersession = await open(ctx, row)
    if (supersession.status !== 'pending') {
      out.push({ supersession, score: supersession.score, threshold: supersession.threshold, stale: false, carry: [] })
      continue
    }
    const type = (await describeResource(ctx, workspaceId, supersession.resourceId))?.type
    const score = scoreProposal(model, type, supersession.evidence)
    out.push({
      supersession,
      score: score.score,
      threshold: score.threshold,
      stale: isStale(supersession.updatedAt, now),
      carry: score.clears ? [] : wouldCarry(model, type, score),
    })
  }
  return out
}

/** A proposal as its page shows it: as the queue lists it, its evidence explained, and what a confirmation would make it. */
export interface ProposalDetail extends ListedProposal {
  /** The type of the record it would replace, which picks the bar. */
  type: string | null
  /** Its own evidence, observation by observation, about `supersedes` or that type. */
  explained: Explained
  /** What its score would be with the viewer's confirmation: first-hand evidence from them, scored like any other. Null once decided. */
  confirmed: number | null
}

/** One proposal for its page, by its id or a prefix of at least eight characters; null when there is none. */
export async function proposalDetail(
  ctx: StoreContext,
  workspaceId: string,
  proposal: string,
  options: { viewer?: Writer; now?: Date } = {},
): Promise<ProposalDetail | null> {
  const now = options.now ?? new Date()
  const writer = options.viewer
  const row = await proposalRow(ctx, workspaceId, proposal)
  if (!row) return null
  const supersession = await open(ctx, row)
  const trust = await orgTrust(ctx)
  const ontology = await headOf(ctx, supersession.workspaceId)
  const model = trustModel(ontology ?? EMPTY_ONTOLOGY, trust)
  const type = (await describeResource(ctx, supersession.workspaceId, supersession.resourceId))?.type ?? null
  const explained = explainProposal(model, type ?? undefined, supersession.evidence)
  if (supersession.status !== 'pending') {
    return { supersession, score: supersession.score, threshold: supersession.threshold, stale: false, carry: [], type, explained, confirmed: null }
  }
  const score = scoreProposal(model, type ?? undefined, supersession.evidence)
  let confirmed: number | null = null
  if (writer) {
    // A confirmation is the note `confirmProposal` writes, stamped as the viewer's own: scored, not written.
    const stamping = stampAll([{ note: 'Confirmed.' }], writer, now, stampContext(ontology, trust.people), { where: { id: supersession.resourceId }, subject: `proposal ${supersession.id}` })
    if (!hasErrors(stamping.diagnostics)) confirmed = scoreProposal(model, type ?? undefined, [...supersession.evidence, ...stamping.stamped]).score
  }
  return {
    supersession,
    score: score.score,
    threshold: score.threshold,
    stale: isStale(supersession.updatedAt, now),
    carry: score.clears ? [] : wouldCarry(model, type ?? undefined, score),
    type,
    explained,
    confirmed,
  }
}

/** One proposal by its id, or a prefix of at least eight characters, opened; null when there is none. */
export async function proposalById(ctx: StoreContext, workspaceId: string, proposal: string): Promise<Supersession | null> {
  const row = await proposalRow(ctx, workspaceId, proposal)
  return row ? open(ctx, row) : null
}

/**
 * Proposes that a record is superseded by another, with why and the
 * evidence, in the caller's transaction. Both must be on file and different,
 * and the replacement must be current itself. The proposal is scored at once
 * and accepted when it clears its bar; the same proposal again adds its
 * evidence; a pending one to another replacement is lifted for this one, kept
 * in the history. Nothing is deleted.
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

  const trust = await orgTrust(ctx)
  if (id && by && id !== by) {
    const { rows: known } = await ctx.tx.query<{ resource_id: string }>(
      'SELECT DISTINCT resource_id FROM documents WHERE workspace_id = $1 AND resource_id = ANY($2::text[]) AND retired_at IS NULL',
      [workspaceId, [id, by]],
    )
    const onFile = new Set(known.map((row) => row.resource_id))
    for (const each of [id, by]) if (!onFile.has(each)) diagnostics.push(refuse('unknown-resource', `There is no resource ${each} in this workspace.`, each))
    const replacement = (await liveSupersessions(ctx, workspaceId, now)).find((each) => each.resourceId === by)
    if (replacement) {
      diagnostics.push(
        refuse(
          'replacement-superseded',
          `${by} is itself out of date: it was superseded by ${replacement.supersededBy} on ${dayOf(replacement.validUntil)}. Supersede ${id} with the current record.`,
          by,
        ),
      )
    }
  }

  const ontology = await headOf(ctx, workspaceId)
  const stamping = stampAll(input.evidence, writer, now, stampContext(ontology, trust.people), { where: { id }, subject: `the supersession of ${id}` })
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
        ...(reason ? { reason: reason.slice(0, WRITE_LIMITS.reasonLength) } : {}),
      },
    })
    return { changed: false, diagnostics, ingestId }
  }

  const model = trustModel(ontology ?? EMPTY_ONTOLOGY, trust)
  const { rows: current } = await ctx.tx.query<Row>(
    "SELECT * FROM supersessions WHERE workspace_id = $1 AND resource_id = $2 AND lifted_at IS NULL AND status IN ('accepted', 'pending')",
    [workspaceId, id],
  )
  const accepted = current.find((row) => row.status === 'accepted')
  if (accepted?.superseded_by === by) {
    const decided = await decide(ctx, model, await open(ctx, accepted), now)
    return { supersession: decided.supersession, proposal: decided.outcome, changed: false, diagnostics }
  }

  // The same proposal again: its evidence is added to the pending one.
  const pendingRow = current.find((row) => row.status === 'pending')
  if (pendingRow?.superseded_by === by) {
    const added = await appendEvidence(ctx, model, await open(ctx, pendingRow), stamping.stamped, now)
    if (added.evidenceAdded) await logEvidence(ctx, logged, id, by, reason, added.fresh, diagnostics)
    return {
      supersession: added.supersession,
      proposal: added.outcome,
      changed: added.evidenceAdded > 0,
      ...(added.replaced ? { replaced: added.replaced } : {}),
      diagnostics,
    }
  }
  if (pendingRow) {
    diagnostics.push({
      severity: 'warning',
      code: 'repointed',
      message: `A pending proposal said ${id} was replaced by ${pendingRow.superseded_by}; this one, to ${by}, takes its place, and the earlier one stays in its history.`,
      id,
    })
    await ctx.tx.query('UPDATE supersessions SET lifted_at = $2 WHERE id = $1', [pendingRow.id, now])
  }

  const evidence = stamping.stamped
  const rowId = randomUUID()
  const sealed = await seal(ctx, workspaceId, rowId, { reason, evidence })
  const { rows } = await ctx.tx.query<Row>(
    `INSERT INTO supersessions (id, workspace_id, resource_id, superseded_by, valid_until, source, actor, actor_label, run_id,
                                detail_ciphertext, detail_nonce, dek_version, request_id, recorded_at, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending', $14) RETURNING *`,
    [rowId, workspaceId, id, by, until, source, writer.actor, writer.label.slice(0, 200), options.runId ?? null, sealed.ciphertext, sealed.nonce, sealed.version, writer.requestId, now],
  )
  const decided = await decide(ctx, model, await open(ctx, rows[0] as Row), now)
  if (decided.replaced) {
    diagnostics.push({
      severity: 'warning',
      code: 'repointed',
      message: `${id} was superseded by ${decided.replaced}; it now points to ${by}, and the earlier supersession stays in its history.`,
      id,
    })
  }
  const ingestId = await logEvidence(ctx, logged, id, by, reason, evidence, diagnostics)
  return {
    supersession: decided.supersession,
    proposal: decided.outcome,
    changed: true,
    ...(decided.replaced ? { replaced: decided.replaced } : {}),
    diagnostics,
    ingestId,
  }
}

type Logged = { workspaceId: string; channel: Writer['channel']; actor: string; actorLabel: string; action: 'supersede'; requestId: string }

/** Records a supersede write in the activity log. */
async function logEvidence(
  ctx: StoreContext,
  logged: Logged,
  id: string,
  by: string,
  reason: string,
  evidence: readonly StampedEvidence[],
  diagnostics: readonly Diagnostic[],
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
      ...(diagnostics.length ? { diagnostics: diagnostics.map(({ severity, code, message }) => ({ severity, code, message })) } : {}),
    },
  })
}

/** Appends new evidence to a proposal - sealed again with it - and scores it again. */
async function appendEvidence(
  ctx: StoreContext,
  model: ConfidenceModel,
  supersession: Supersession,
  stamped: readonly StampedEvidence[],
  now: Date,
): Promise<{ supersession: Supersession; outcome: ProposalOutcome; replaced?: string; evidenceAdded: number; fresh: StampedEvidence[] }> {
  const known = new Set(supersession.evidence.map((entry) => evidenceKey(entry as unknown as Record<string, unknown>)))
  const fresh = stamped.filter((entry) => !known.has(evidenceKey(entry as unknown as Record<string, unknown>)))
  let current = supersession
  if (fresh.length) {
    const sealed = await seal(ctx, supersession.workspaceId, supersession.id, {
      reason: supersession.reason,
      evidence: [...supersession.evidence, ...fresh],
      ...(supersession.rejection !== undefined ? { rejection: supersession.rejection } : {}),
    })
    const { rows } = await ctx.tx.query<Row>(
      'UPDATE supersessions SET detail_ciphertext = $2, detail_nonce = $3, dek_version = $4, updated_at = $5 WHERE id = $1 RETURNING *',
      [supersession.id, sealed.ciphertext, sealed.nonce, sealed.version, now],
    )
    current = await open(ctx, rows[0] as Row)
  }
  const decided = await decide(ctx, model, current, now)
  return { ...decided, evidenceAdded: fresh.length, fresh }
}

/** What adding evidence to a proposal, rejecting one or accepting one regardless did. */
export interface ProposalWriteResult {
  proposal?: ProposalOutcome & { resource: string; supersededBy: string }
  changed: boolean
  evidenceAdded: number
  diagnostics: Diagnostic[]
  ingestId?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function proposalRow(ctx: StoreContext, workspaceId: string, proposal: string): Promise<Row | undefined> {
  const given = proposal.trim()
  const { rows } = UUID.test(given)
    ? await ctx.tx.query<Row>('SELECT * FROM supersessions WHERE workspace_id = $1 AND id = $2', [workspaceId, given])
    : /^[0-9a-f-]{8,35}$/i.test(given)
      ? await ctx.tx.query<Row>('SELECT * FROM supersessions WHERE workspace_id = $1 AND lifted_at IS NULL AND id::text LIKE $2', [workspaceId, `${given.toLowerCase()}%`])
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
  options: { now?: () => Date } = {},
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
  const trust = await orgTrust(ctx)
  const ontology = await headOf(ctx, workspaceId)
  const stamping = stampAll(input.evidence, writer, now, stampContext(ontology, trust.people), { where: { id: where }, subject: `proposal ${input.supersession}` })
  diagnostics.push(...stamping.diagnostics)
  if (hasErrors(diagnostics) || !row) return { changed: false, evidenceAdded: 0, diagnostics }

  const supersession = await open(ctx, row)
  const added = await appendEvidence(ctx, trustModel(ontology ?? EMPTY_ONTOLOGY, trust), supersession, stamping.stamped, now)
  const logged: Logged = { workspaceId, channel: writer.channel, actor: writer.actor, actorLabel: writer.label, action: 'supersede', requestId: writer.requestId }
  const ingestId = added.evidenceAdded ? await logEvidence(ctx, logged, row.resource_id, row.superseded_by, supersession.reason, added.fresh, diagnostics) : undefined
  return {
    proposal: { ...added.outcome, resource: row.resource_id, supersededBy: row.superseded_by },
    changed: added.evidenceAdded > 0,
    evidenceAdded: added.evidenceAdded,
    diagnostics,
    ...(ingestId ? { ingestId } : {}),
  }
}

/**
 * A member confirms a pending proposal: first-hand evidence from the person
 * they are, which the policies score like any other, so a lead's confirmation
 * may carry it and an intern's may not. It never skips the score.
 */
export function confirmProposal(
  ctx: StoreContext,
  writer: Writer,
  input: { supersession: string; note?: string },
  options: { now?: () => Date } = {},
): Promise<ProposalWriteResult> {
  const note = input.note?.trim() || 'Confirmed.'
  return addProposalEvidence(ctx, writer, { supersession: input.supersession, evidence: [{ note: note.slice(0, 1000) }] }, options)
}

/** Turns a pending proposal down, with why: the older record stays current, and both are kept. */
export async function rejectProposal(
  ctx: StoreContext,
  writer: Writer,
  input: { supersession: string; reason: string },
  options: { now?: () => Date } = {},
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
  const sealed = await seal(ctx, row.workspace_id, row.id, { reason: supersession.reason, evidence: supersession.evidence, rejection: reason })
  const { rows: updated } = await ctx.tx.query<{ id: string }>(
    `UPDATE supersessions SET status = 'rejected', decided_at = $2, decided_by = $3, updated_at = $2, detail_ciphertext = $4, detail_nonce = $5, dek_version = $6
      WHERE id = $1 AND status = 'pending' AND lifted_at IS NULL RETURNING id`,
    [row.id, now, (writer.principal ?? writer.label).slice(0, 200), sealed.ciphertext, sealed.nonce, sealed.version],
  )
  if (!updated.length) {
    diagnostics.push(refuse('decided-proposal', `Proposal ${row.id} is already decided.`, where))
    return { changed: false, evidenceAdded: 0, diagnostics }
  }
  const ingestId = await recordIngest(ctx, {
    workspaceId: writer.workspaceId,
    channel: writer.channel,
    actor: writer.actor,
    actorLabel: writer.label,
    action: 'supersede',
    outcome: 'ok',
    detail: { resourceId: row.resource_id, supersededBy: row.superseded_by, reason: `Rejected the proposal that ${row.superseded_by} replaces it: ${reason}`.slice(0, WRITE_LIMITS.reasonLength) },
    requestId: writer.requestId,
  })
  return {
    proposal: { id: row.id, status: 'rejected', score: row.score ?? 0, threshold: row.threshold ?? 0, carry: [], resource: row.resource_id, supersededBy: row.superseded_by },
    changed: true,
    evidenceAdded: 0,
    diagnostics,
    ingestId,
  }
}

/**
 * An owner or admin accepts a pending proposal regardless of its score, with
 * why: the older record goes out of date as if the score had carried it, and
 * the override is recorded - who, and their reason - with the proposal. The
 * caller checks the role.
 */
export async function overrideProposal(
  ctx: StoreContext,
  writer: Writer,
  input: { supersession: string; reason: string },
  options: { now?: () => Date } = {},
): Promise<ProposalWriteResult> {
  const now = (options.now ?? (() => new Date()))()
  const { workspaceId } = writer
  const row = await proposalRow(ctx, workspaceId, input.supersession)
  if (row) await lockResource(ctx, workspaceId, row.resource_id)
  const reason = input.reason.trim()
  const where = row?.resource_id ?? input.supersession
  const diagnostics: Diagnostic[] = []
  if (!row || row.lifted_at !== null) diagnostics.push(refuse('unknown-proposal', `There is no open supersede proposal ${input.supersession} in this workspace.`, where))
  else if (row.status !== 'pending') diagnostics.push(refuse('decided-proposal', `Proposal ${row.id} is already ${row.status}.`, where))
  if (!reason) diagnostics.push(refuse('missing-reason', 'Say why it is accepted regardless of its score.', where))
  else if (reason.length > WRITE_LIMITS.reasonLength) diagnostics.push(refuse('reason-too-long', `A reason is at most ${WRITE_LIMITS.reasonLength} characters.`, where))
  if (row && !hasErrors(diagnostics)) {
    const replacement = (await liveSupersessions(ctx, workspaceId, now)).find((each) => each.resourceId === row.superseded_by)
    if (replacement) diagnostics.push(refuse('replacement-superseded', `${row.superseded_by} is itself out of date now: it was superseded by ${replacement.supersededBy}.`, where))
  }
  if (hasErrors(diagnostics) || !row) return { changed: false, evidenceAdded: 0, diagnostics }

  const supersession = await open(ctx, row)
  const sealed = await seal(ctx, workspaceId, row.id, { reason: supersession.reason, evidence: supersession.evidence, override: reason })
  await ctx.tx.query('UPDATE supersessions SET detail_ciphertext = $2, detail_nonce = $3, dek_version = $4 WHERE id = $1', [
    row.id,
    sealed.ciphertext,
    sealed.nonce,
    sealed.version,
  ])
  const decider = `override:${(writer.principal ?? writer.label).slice(0, 180)}`
  const decided = await decide(ctx, await proposalModel(ctx, workspaceId), await open(ctx, { ...row, detail_ciphertext: sealed.ciphertext, detail_nonce: sealed.nonce, dek_version: sealed.version }), now, { by: decider })
  const ingestId = await recordIngest(ctx, {
    workspaceId,
    channel: writer.channel,
    actor: writer.actor,
    actorLabel: writer.label,
    action: 'supersede',
    outcome: 'ok',
    detail: { resourceId: row.resource_id, supersededBy: row.superseded_by, reason: `Accepted regardless of its score: ${reason}`.slice(0, WRITE_LIMITS.reasonLength) },
    requestId: writer.requestId,
  })
  return {
    proposal: { ...decided.outcome, resource: row.resource_id, supersededBy: row.superseded_by },
    changed: decided.outcome.status === 'accepted',
    evidenceAdded: 0,
    diagnostics: decided.replaced
      ? [...diagnostics, { severity: 'warning', code: 'repointed', message: `${row.resource_id} was superseded by ${decided.replaced}; it now points to ${row.superseded_by}.`, id: row.resource_id }]
      : diagnostics,
    ingestId,
  }
}

/**
 * The record a superseded one points to now: its replacement's replacement,
 * and so on, to the first that is not superseded. A chain that loops ends
 * where it would revisit a record.
 */
export function currentRecord(supersessions: ReadonlyMap<string, Pick<Supersession, 'supersededBy'>>, id: string): string {
  const seen = new Set([id])
  let at = id
  for (;;) {
    const next = supersessions.get(at)?.supersededBy
    if (next === undefined || seen.has(next)) return at
    seen.add(next)
    at = next
  }
}

/** A day, as a change note gives it. */
export const dayOf = (at: Date | string): string => (typeof at === 'string' ? at : at.toISOString()).slice(0, 10)

/** One line saying a record is out of date and what replaces it, for search, ask, get and the inspector. */
export function changeNote(
  old: { id: string; title: string },
  current: { id: string; title: string } | null,
  supersession: Pick<Supersession, 'validUntil' | 'reason'>,
): string {
  const now = current ? `superseded by "${current.title}" (${current.id})` : 'superseded by a record no longer on file'
  const reason = supersession.reason.trim().replace(/\s+/g, ' ')
  return `Out of date: "${old.title}" (${old.id}) is ${now} since ${dayOf(supersession.validUntil)}.${reason ? ` ${reason.replace(/([^.!?])$/, '$1.')}` : ''}`
}
