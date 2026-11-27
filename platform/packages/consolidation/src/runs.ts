// SPDX-License-Identifier: AGPL-3.0-only
import { LIMITS, type Tx } from '@docket/platform-tenancy'

/**
 * A workspace's consolidation runs and checkpoints, in the org's schema.
 * There are no settings of its own: while enrichment is on, a run follows
 * each finished enrichment run, and another starts on the worker's own
 * schedule - every four hours unless it says otherwise - when none has
 * started since.
 */

/** How often a workspace with enrichment on is consolidated, besides after each enrichment run. */
export const CONSOLIDATION_EVERY_MS = 4 * 3_600_000

/** The worker's schedule: a workspace is due when no run of it has started in the last `everyMs`. */
export interface Schedule {
  now: Date
  everyMs: number
}

export const CONSOLIDATION_LIMITS = {
  /** The most summaries one run asks the AI for; the next run carries on. */
  summariesPerRun: 100,
  /** A resource with fewer direct links than this has no neighbourhood to summarize. */
  minLinks: 2,
  /** A shorter answer says nothing worth keeping. */
  minSummaryChars: 50,
  /** Two candidates whose title, notes and attributes embed closer than this are the same thing. */
  duplicateSimilarity: 0.9,
  /** Two records of one type that embed closer than this are about the same thing, and are checked for a contradiction. */
  sameSubjectSimilarity: 0.8,
  /** The most pairs one run asks the AI to judge for a contradiction; the next run carries on. */
  contradictionChecksPerRun: 20,
  /** New summary documents stop here, leaving the rest of the workspace's document limit to people and repos. */
  summaryDocumentsUntil: Math.floor(LIMITS.documentsPerWorkspace * 0.9),
  /** A run still running after this long belongs to a worker that stopped. */
  staleAfterMs: 60 * 60_000,
} as const

export type RunStatus = 'running' | 'ok' | 'limited' | 'failed'

/** What a run found and did. Counts only: never document text. */
export interface RunSummary {
  /** Resources a person, repo or checkout declares. */
  considered: number
  summarized: number
  /** Live summaries the run's replaced. */
  superseded: number
  /** Live summaries the run's retired with no new one of their own: a near-duplicate's, a too-short regeneration's, or a near-isolated resource's. */
  retired: number
  /** Resources whose summary failed; they are tried again next run. */
  failed: number
  skipped: { unchanged: number; isolated: number; duplicate: number; trivial: number; overLimit: number }
  aiCalls: number
  /** Why AI stopped short, when it did. */
  aiStopped?: 'limit' | 'cap' | 'off'
  /** Resources the embedder could not embed, so not checked for near-duplicates this run. */
  duplicatesUnchecked?: number
  /** Resources left without a first summary because the workspace is near its document limit. */
  documentsFull?: number
  /** Pairs of records about the same thing checked for a contradiction, and the older records superseded for one. */
  /** Pairs judged; proposals accepted at once (`superseded`); proposals left pending, waiting for support (`proposed`). */
  contradictions?: { checked: number; superseded: number; proposed?: number }
}

export interface ConsolidationRun {
  id: string
  workspaceId: string
  /** The enrichment run it followed; null for a run on the worker's own schedule. */
  enrichmentRunId: string | null
  status: RunStatus
  startedAt: Date
  finishedAt: Date | null
  summary: RunSummary | null
  costUsd: number
  error: string | null
}

type RunRow = {
  id: string
  workspace_id: string
  enrichment_run_id: string | null
  status: RunStatus
  started_at: Date
  finished_at: Date | null
  summary: RunSummary | null
  cost_usd: string
  error: string | null
}

const toRun = (row: RunRow): ConsolidationRun => ({
  id: row.id,
  workspaceId: row.workspace_id,
  enrichmentRunId: row.enrichment_run_id,
  status: row.status,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  summary: row.summary,
  costUsd: Number(row.cost_usd),
  error: row.error,
})

/** The workspace's latest finished enrichment run, while enrichment is on and no enrichment run is running. */
const AFTER_ENRICHMENT = `
  SELECT e.id, e.workspace_id FROM enrichment_settings s
    CROSS JOIN LATERAL (
      SELECT id, workspace_id FROM enrichment_runs WHERE workspace_id = s.workspace_id AND status <> 'running' ORDER BY started_at DESC LIMIT 1
    ) e
   WHERE s.enabled
     AND NOT EXISTS (SELECT 1 FROM enrichment_runs r WHERE r.workspace_id = s.workspace_id AND r.status = 'running')`

/** Workspaces with enrichment on and no enrichment run running, whose last consolidation run started before `$1`, or that have none. */
const ON_SCHEDULE = `
  SELECT s.workspace_id FROM enrichment_settings s
   WHERE s.enabled
     AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = s.workspace_id AND w.deleted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM enrichment_runs r WHERE r.workspace_id = s.workspace_id AND r.status = 'running')
     AND NOT EXISTS (SELECT 1 FROM consolidation_runs c WHERE c.workspace_id = s.workspace_id AND c.started_at > $1)`

const since = (schedule: Schedule) => new Date(schedule.now.getTime() - schedule.everyMs)

/**
 * The org's workspaces with a run due: an enrichment run has finished that no
 * consolidation run has followed yet, or, on a `schedule`, no run has started
 * within its interval.
 */
export async function dueWorkspaces(tx: Tx, schedule?: Schedule): Promise<string[]> {
  const { rows } = await tx.query<{ workspace_id: string }>(
    `SELECT a.workspace_id FROM (${AFTER_ENRICHMENT}) a
      WHERE NOT EXISTS (SELECT 1 FROM consolidation_runs c WHERE c.enrichment_run_id = a.id)
     ${schedule ? `UNION SELECT workspace_id FROM (${ON_SCHEDULE}) d` : ''} ORDER BY 1`,
    schedule ? [since(schedule)] : [],
  )
  return rows.map((row) => row.workspace_id)
}

/**
 * Starts the run that follows the workspace's latest finished enrichment run,
 * or, on a `schedule`, a run of its own when none has started within its
 * interval. Null when nothing is due, or another worker got there first: one
 * run per enrichment run, and one running per workspace.
 */
export async function startRun(tx: Tx, workspaceId: string, now: Date, schedule?: Schedule): Promise<ConsolidationRun | null> {
  const { rows } = await tx.query<RunRow>(
    `INSERT INTO consolidation_runs (workspace_id, enrichment_run_id, started_at)
     SELECT a.workspace_id, a.id, $2 FROM (${AFTER_ENRICHMENT}) a WHERE a.workspace_id = $1
     ON CONFLICT DO NOTHING RETURNING *`,
    [workspaceId, now],
  )
  if (rows[0]) return toRun(rows[0])
  if (!schedule) return null
  const { rows: scheduled } = await tx.query<RunRow>(
    `INSERT INTO consolidation_runs (workspace_id, enrichment_run_id, started_at)
     SELECT d.workspace_id, NULL, $3 FROM (${ON_SCHEDULE}) d WHERE d.workspace_id = $2
     ON CONFLICT DO NOTHING RETURNING *`,
    [since(schedule), workspaceId, now],
  )
  return scheduled[0] ? toRun(scheduled[0]) : null
}

export async function finishRun(
  tx: Tx,
  runId: string,
  outcome: { status: Exclude<RunStatus, 'running'>; summary?: RunSummary | null; costUsd?: number; error?: string | null; at: Date },
): Promise<void> {
  await tx.query(
    `UPDATE consolidation_runs SET status = $2, summary = $3, cost_usd = $4, error = $5, finished_at = $6 WHERE id = $1`,
    [runId, outcome.status, outcome.summary ? JSON.stringify(outcome.summary) : null, outcome.costUsd ?? 0, outcome.error?.slice(0, 1_000) ?? null, outcome.at],
  )
}

/** Fails runs a stopped worker left running, so the workspace can run again. */
export async function failStaleRuns(tx: Tx, now: Date, staleAfterMs: number = CONSOLIDATION_LIMITS.staleAfterMs): Promise<number> {
  const { rowCount } = await tx.query(
    `UPDATE consolidation_runs SET status = 'failed', error = 'the worker stopped while running it', finished_at = $1
      WHERE status = 'running' AND started_at < $2`,
    [now, new Date(now.getTime() - staleAfterMs)],
  )
  return rowCount ?? 0
}

/** The workspace's most recent runs, newest first. */
export async function recentRuns(tx: Tx, workspaceId: string, limit = 5): Promise<ConsolidationRun[]> {
  const { rows } = await tx.query<RunRow>('SELECT * FROM consolidation_runs WHERE workspace_id = $1 ORDER BY started_at DESC LIMIT $2', [
    workspaceId,
    limit,
  ])
  return rows.map(toRun)
}

/** Each resource's neighbourhood fingerprint when it was last summarized (marked when the answer was too short to keep). */
export async function checkpoints(tx: Tx, workspaceId: string): Promise<Map<string, string>> {
  const { rows } = await tx.query<{ resource_id: string; fingerprint: string }>(
    'SELECT resource_id, fingerprint FROM consolidation_checkpoints WHERE workspace_id = $1',
    [workspaceId],
  )
  return new Map(rows.map((row) => [row.resource_id, row.fingerprint]))
}

/** Records the neighbourhood a resource was summarized from, so an unchanged one is skipped while its summary stands. */
export async function touchCheckpoint(tx: Tx, workspaceId: string, resourceId: string, fingerprint: string, at: Date): Promise<void> {
  await tx.query(
    `INSERT INTO consolidation_checkpoints (workspace_id, resource_id, fingerprint, seen_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, resource_id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, seen_at = EXCLUDED.seen_at`,
    [workspaceId, resourceId, fingerprint, at],
  )
}

/** The pairs consolidation has judged for a contradiction, keyed `older\u0000newer`, with what both records said when it did. */
export async function contradictionChecks(tx: Tx, workspaceId: string): Promise<Map<string, string>> {
  const { rows } = await tx.query<{ older_id: string; newer_id: string; fingerprint: string }>(
    'SELECT older_id, newer_id, fingerprint FROM contradiction_checks WHERE workspace_id = $1',
    [workspaceId],
  )
  return new Map(rows.map((row) => [`${row.older_id}\u0000${row.newer_id}`, row.fingerprint]))
}

/** Records how a pair was judged, so it is not asked about again while neither record changes. */
export async function recordContradictionCheck(
  tx: Tx,
  workspaceId: string,
  check: { olderId: string; newerId: string; fingerprint: string; verdict: 'supersedes' | 'distinct' | 'unsure'; at: Date },
): Promise<void> {
  await tx.query(
    `INSERT INTO contradiction_checks (workspace_id, older_id, newer_id, fingerprint, verdict, checked_at) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id, older_id, newer_id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, verdict = EXCLUDED.verdict, checked_at = EXCLUDED.checked_at`,
    [workspaceId, check.olderId, check.newerId, check.fingerprint, check.verdict, check.at],
  )
}
