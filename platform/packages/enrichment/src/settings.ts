// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from '@docket/platform-tenancy'

/**
 * A workspace's enrichment settings and runs, in the org's schema. Off until
 * someone turns it on; then it runs nightly or weekly, or when asked from
 * Settings, inside its own monthly AI limit.
 */

export const SCHEDULES = ['nightly', 'weekly'] as const
export type Schedule = (typeof SCHEDULES)[number]
export const isSchedule = (value: unknown): value is Schedule => typeof value === 'string' && (SCHEDULES as readonly string[]).includes(value)

export const ENRICHMENT_LIMITS = {
  /** The job's monthly AI limit by default, in US dollars. */
  defaultMonthlyUsd: 2,
  /** The most one run writes; the next run carries on. */
  inferencesPerRun: 50,
  /** A run still running after this long belongs to a worker that stopped. */
  staleAfterMs: 60 * 60_000,
} as const

/** Scheduled runs start at this hour, UTC: nightly every day, weekly on Sundays. */
export const RUN_HOUR_UTC = 2

export interface EnrichmentSettings {
  workspaceId: string
  enabled: boolean
  schedule: Schedule
  monthlyLimitUsd: number
  nextRunAt: Date | null
  requestedAt: Date | null
  updatedBy: string | null
  updatedAt: Date | null
}

type SettingsRow = {
  workspace_id: string
  enabled: boolean
  schedule: Schedule
  monthly_limit_usd: string
  next_run_at: Date | null
  requested_at: Date | null
  updated_by: string
  updated_at: Date
}

const toSettings = (row: SettingsRow): EnrichmentSettings => ({
  workspaceId: row.workspace_id,
  enabled: row.enabled,
  schedule: row.schedule,
  monthlyLimitUsd: Number(row.monthly_limit_usd),
  nextRunAt: row.next_run_at,
  requestedAt: row.requested_at,
  updatedBy: row.updated_by,
  updatedAt: row.updated_at,
})

/** When a schedule next runs after `from`: the next 02:00 UTC, on a Sunday for weekly. */
export function nextRun(schedule: Schedule, from: Date): Date {
  const at = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), RUN_HOUR_UTC))
  if (at <= from) at.setUTCDate(at.getUTCDate() + 1)
  if (schedule === 'weekly') while (at.getUTCDay() !== 0) at.setUTCDate(at.getUTCDate() + 1)
  return at
}

export async function enrichmentSettings(tx: Tx, workspaceId: string): Promise<EnrichmentSettings> {
  const { rows } = await tx.query<SettingsRow>('SELECT * FROM enrichment_settings WHERE workspace_id = $1', [workspaceId])
  return rows[0]
    ? toSettings(rows[0])
    : {
        workspaceId,
        enabled: false,
        schedule: 'nightly',
        monthlyLimitUsd: ENRICHMENT_LIMITS.defaultMonthlyUsd,
        nextRunAt: null,
        requestedAt: null,
        updatedBy: null,
        updatedAt: null,
      }
}

export class EnrichmentSettingsError extends Error {
  override name = 'EnrichmentSettingsError'
}

/** Saves the settings. The limit is at most the org's monthly cap; turning it off drops any run still asked for. */
export async function saveSettings(
  tx: Tx,
  workspaceId: string,
  input: { enabled: boolean; schedule: Schedule; monthlyLimitUsd: number; capUsd: number; by: string; now?: Date },
): Promise<EnrichmentSettings> {
  const { monthlyLimitUsd } = input
  if (!Number.isFinite(monthlyLimitUsd) || monthlyLimitUsd < 0 || monthlyLimitUsd > input.capUsd) {
    throw new EnrichmentSettingsError(`The job's monthly AI limit is between $0 and the org's cap, $${input.capUsd.toFixed(2)}.`)
  }
  const now = input.now ?? new Date()
  const { rows } = await tx.query<SettingsRow>(
    `INSERT INTO enrichment_settings (workspace_id, enabled, schedule, monthly_limit_usd, next_run_at, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (workspace_id) DO UPDATE SET enabled = EXCLUDED.enabled, schedule = EXCLUDED.schedule,
       monthly_limit_usd = EXCLUDED.monthly_limit_usd, next_run_at = EXCLUDED.next_run_at, updated_by = EXCLUDED.updated_by,
       updated_at = EXCLUDED.updated_at,
       requested_at = CASE WHEN EXCLUDED.enabled THEN enrichment_settings.requested_at END,
       requested_by = CASE WHEN EXCLUDED.enabled THEN enrichment_settings.requested_by END
     RETURNING *`,
    [workspaceId, input.enabled, input.schedule, Math.round(monthlyLimitUsd * 100) / 100, input.enabled ? nextRun(input.schedule, now) : null, input.by, now],
  )
  return toSettings(rows[0] as SettingsRow)
}

/** Asks for a run now, ahead of the schedule. Only while it is on. */
export async function requestRun(tx: Tx, workspaceId: string, by: string, now: Date = new Date()): Promise<void> {
  const { rowCount } = await tx.query(
    'UPDATE enrichment_settings SET requested_at = $2, requested_by = $3 WHERE workspace_id = $1 AND enabled',
    [workspaceId, now, by],
  )
  if (!rowCount) throw new EnrichmentSettingsError('Turn enrichment on first.')
}

/** The org's workspaces with a run due: asked for, or scheduled for now or earlier. */
export async function dueWorkspaces(tx: Tx, now: Date): Promise<string[]> {
  const { rows } = await tx.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM enrichment_settings
      WHERE enabled AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_id AND w.deleted_at IS NULL)
        AND (requested_at IS NOT NULL OR next_run_at <= $1) ORDER BY coalesce(requested_at, next_run_at)`,
    [now],
  )
  return rows.map((row) => row.workspace_id)
}

export type RunStatus = 'running' | 'ok' | 'limited' | 'failed'

/** What a run found and did, by kind. Counts only: never document text. */
export interface RunSummary {
  found: Record<string, number>
  written: Record<string, number>
  /** Candidates left alone: already inferred once, rejected by review, ambiguous without AI, refused, or over the run's limit. */
  skipped: { known: number; rejected: number; undecided: number; refused: number; overRunLimit: number }
  /** Inferred documents retired because their resource is gone. */
  orphansRetired: number
  aiCalls: number
  /** Why AI review stopped short, when it did. */
  aiStopped?: 'limit' | 'cap' | 'off'
}

export interface EnrichmentRun {
  id: string
  workspaceId: string
  trigger: 'schedule' | 'manual'
  requestedBy: string | null
  status: RunStatus
  startedAt: Date
  finishedAt: Date | null
  summary: RunSummary | null
  costUsd: number
  error: string | null
  retiredAt: Date | null
  retiredBy: string | null
  /** Inferences it wrote that are still live. */
  live: number
}

type RunRow = {
  id: string
  workspace_id: string
  trigger: 'schedule' | 'manual'
  requested_by: string | null
  status: RunStatus
  started_at: Date
  finished_at: Date | null
  summary: RunSummary | null
  cost_usd: string
  error: string | null
  retired_at: Date | null
  retired_by: string | null
  live: string
}

const toRun = (row: RunRow): EnrichmentRun => ({
  id: row.id,
  workspaceId: row.workspace_id,
  trigger: row.trigger,
  requestedBy: row.requested_by,
  status: row.status,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  summary: row.summary,
  costUsd: Number(row.cost_usd),
  error: row.error,
  retiredAt: row.retired_at,
  retiredBy: row.retired_by,
  live: Number(row.live),
})

const RUN_COLUMNS = `r.*, (SELECT count(*) FROM enrichment_inferences i WHERE i.run_id = r.id AND i.outcome = 'written' AND i.retired_at IS NULL) AS live`

/**
 * Starts a run if none is running: takes the asked-for run if there is one,
 * else the scheduled one, and moves the schedule on. Null when another
 * worker got there first or nothing is due any more.
 */
export async function startRun(tx: Tx, workspaceId: string, now: Date): Promise<EnrichmentRun | null> {
  const { rows } = await tx.query<SettingsRow & { requested_by: string | null }>(
    `SELECT * FROM enrichment_settings WHERE workspace_id = $1 AND enabled AND (requested_at IS NOT NULL OR next_run_at <= $2)
      FOR UPDATE SKIP LOCKED`,
    [workspaceId, now],
  )
  const settings = rows[0]
  if (!settings) return null
  const running = await tx.query("SELECT 1 FROM enrichment_runs WHERE workspace_id = $1 AND status = 'running'", [workspaceId])
  if (running.rowCount) return null
  const manual = settings.requested_at !== null
  await tx.query('UPDATE enrichment_settings SET requested_at = NULL, requested_by = NULL, next_run_at = $2 WHERE workspace_id = $1', [
    workspaceId,
    manual && settings.next_run_at && settings.next_run_at > now ? settings.next_run_at : nextRun(settings.schedule, now),
  ])
  const { rows: run } = await tx.query<RunRow>(
    `INSERT INTO enrichment_runs (workspace_id, trigger, requested_by, started_at) VALUES ($1, $2, $3, $4)
     RETURNING *, 0 AS live`,
    [workspaceId, manual ? 'manual' : 'schedule', manual ? settings.requested_by : null, now],
  )
  return toRun(run[0] as RunRow)
}

export async function finishRun(
  tx: Tx,
  runId: string,
  outcome: { status: Exclude<RunStatus, 'running'>; summary?: RunSummary | null; costUsd?: number; error?: string | null; at: Date },
): Promise<void> {
  await tx.query(
    `UPDATE enrichment_runs SET status = $2, summary = $3, cost_usd = $4, error = $5, finished_at = $6 WHERE id = $1`,
    [runId, outcome.status, outcome.summary ? JSON.stringify(outcome.summary) : null, outcome.costUsd ?? 0, outcome.error?.slice(0, 1_000) ?? null, outcome.at],
  )
}

/** Fails runs a stopped worker left running, so the workspace can run again. */
export async function failStaleRuns(tx: Tx, now: Date, staleAfterMs: number = ENRICHMENT_LIMITS.staleAfterMs): Promise<number> {
  const { rowCount } = await tx.query(
    `UPDATE enrichment_runs SET status = 'failed', error = 'the worker stopped while running it', finished_at = $1
      WHERE status = 'running' AND started_at < $2`,
    [now, new Date(now.getTime() - staleAfterMs)],
  )
  return rowCount ?? 0
}

/** The workspace's most recent runs, newest first. */
export async function recentRuns(tx: Tx, workspaceId: string, limit = 5): Promise<EnrichmentRun[]> {
  const { rows } = await tx.query<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM enrichment_runs r WHERE r.workspace_id = $1 ORDER BY r.started_at DESC LIMIT $2`,
    [workspaceId, limit],
  )
  return rows.map(toRun)
}

export async function runById(tx: Tx, workspaceId: string, runId: string): Promise<EnrichmentRun | null> {
  if (!/^[0-9a-f-]{36}$/.test(runId)) return null
  const { rows } = await tx.query<RunRow>(`SELECT ${RUN_COLUMNS} FROM enrichment_runs r WHERE r.workspace_id = $1 AND r.id = $2`, [
    workspaceId,
    runId,
  ])
  return rows[0] ? toRun(rows[0]) : null
}

/** Every fingerprint the workspace has ever inferred, live or retired: none is written twice. */
export async function knownFingerprints(tx: Tx, workspaceId: string): Promise<Set<string>> {
  const { rows } = await tx.query<{ fingerprint: string }>('SELECT fingerprint FROM enrichment_inferences WHERE workspace_id = $1', [workspaceId])
  return new Set(rows.map((row) => row.fingerprint))
}
