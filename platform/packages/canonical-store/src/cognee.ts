// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from '@docket/platform-tenancy'

import { enqueue } from './workspaces.js'

/**
 * cognee (https://www.cognee.ai/), the optional projection: docket's cognee
 * adapter files a workspace's entities into a cognee dataset and cognifies
 * them into cognee's knowledge graph, and search asks it alongside the fixed
 * projections (`CLOUD_PROJECTIONS`). Off until an owner or admin turns it on
 * for a workspace. Cognify runs a model over every new entity, so it is billed
 * to the org's AI cap, inside the workspace's own cognee limit; its pass runs
 * apart from the fixed projections', so a slow or failing cognify never holds
 * them up.
 */
export const COGNEE = 'cognee'
/** The projections a workspace turns on for itself, beside the fixed ones. */
export const OPTIONAL_PROJECTIONS = [COGNEE] as const
export type OptionalProjection = (typeof OPTIONAL_PROJECTIONS)[number]

export const COGNEE_LIMITS = {
  /**
   * Search keeps cognee's chunks at least this similar to the question
   * (cosine). Without a floor cognee always answers with its nearest chunks:
   * docket's search evaluation measured a no-answer false-positive rate of
   * 1.00 without one, and this floor (its `cognee+floor` strategy, cognee's
   * `maxDistance` 0.42) is what let it answer with nothing.
   */
  defaultFloor: 0.58,
  /** What cognify may spend in a month by default, in US dollars. */
  defaultMonthlyUsd: 2,
} as const

/** Whose spend a workspace's cognify is in the AI usage meter. */
export const cogneeAiActor = (workspaceId: string): string => `cognee:${workspaceId}`

export interface CogneeSettings {
  workspaceId: string
  enabled: boolean
  floor: number
  monthlyLimitUsd: number
  /** The newest outbox row its last successful pass covered. */
  projectedThrough: number | null
  updatedBy: string | null
  updatedAt: Date | null
}

type SettingsRow = {
  workspace_id: string
  enabled: boolean
  floor: string
  monthly_limit_usd: string
  projected_through: string | null
  updated_by: string
  updated_at: Date
}

const toSettings = (row: SettingsRow): CogneeSettings => ({
  workspaceId: row.workspace_id,
  enabled: row.enabled,
  floor: Number(row.floor),
  monthlyLimitUsd: Number(row.monthly_limit_usd),
  projectedThrough: row.projected_through === null ? null : Number(row.projected_through),
  updatedBy: row.updated_by,
  updatedAt: row.updated_at,
})

/** A workspace's cognee settings: off, with the default floor and limit, until someone saves them. */
export async function cogneeSettings(tx: Tx, workspaceId: string): Promise<CogneeSettings> {
  const { rows } = await tx.query<SettingsRow>('SELECT * FROM cognee_settings WHERE workspace_id = $1', [workspaceId])
  return rows[0]
    ? toSettings(rows[0])
    : {
        workspaceId,
        enabled: false,
        floor: COGNEE_LIMITS.defaultFloor,
        monthlyLimitUsd: COGNEE_LIMITS.defaultMonthlyUsd,
        projectedThrough: null,
        updatedBy: null,
        updatedAt: null,
      }
}

export class CogneeSettingsError extends Error {
  override name = 'CogneeSettingsError'
}

/**
 * Saves the settings: the floor between 0 and 1, the limit at most the org's
 * monthly cap. Turning cognee on asks for a pass at once, through the outbox;
 * turning it off leaves the worker to clear what it filed.
 */
export async function saveCogneeSettings(
  tx: Tx,
  workspaceId: string,
  input: { enabled: boolean; floor: number; monthlyLimitUsd: number; capUsd: number; by: string; now?: Date },
): Promise<CogneeSettings> {
  const { floor, monthlyLimitUsd } = input
  if (!Number.isFinite(floor) || floor < 0 || floor > 1) throw new CogneeSettingsError('The search floor is a similarity between 0 and 1.')
  if (!Number.isFinite(monthlyLimitUsd) || monthlyLimitUsd < 0 || monthlyLimitUsd > input.capUsd) {
    throw new CogneeSettingsError(`cognee's monthly AI limit is between $0 and the org's cap, $${input.capUsd.toFixed(2)}.`)
  }
  const before = await cogneeSettings(tx, workspaceId)
  const { rows } = await tx.query<SettingsRow>(
    `INSERT INTO cognee_settings (workspace_id, enabled, floor, monthly_limit_usd, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id) DO UPDATE SET enabled = EXCLUDED.enabled, floor = EXCLUDED.floor,
       monthly_limit_usd = EXCLUDED.monthly_limit_usd, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at,
       projected_through = CASE WHEN EXCLUDED.enabled THEN cognee_settings.projected_through END
     RETURNING *`,
    [workspaceId, input.enabled, Math.round(floor * 100) / 100, Math.round(monthlyLimitUsd * 100) / 100, input.by, input.now ?? new Date()],
  )
  if (input.enabled && !before.enabled) await enqueue(tx, workspaceId, 'recheck')
  return toSettings(rows[0] as SettingsRow)
}

/** The floor search asks cognee with, or null while the workspace has cognee off. */
export async function cogneeFloor(tx: Tx, workspaceId: string): Promise<number | null> {
  const settings = await cogneeSettings(tx, workspaceId)
  return settings.enabled ? settings.floor : null
}

export interface CogneeWork {
  /** Workspaces with cognee on and changes it has not projected, not backing off after a failure. */
  due: { workspaceId: string; upTo: number }[]
  /** Workspaces whose cognee was turned off with what it filed still to clear, not backing off after a failure. A deleted workspace's is cleared by its purge. */
  clear: string[]
}

/**
 * What the cognee pass has to do in the org: each workspace with cognee on
 * whose outbox has moved past what it projected (or that it never projected),
 * and each whose cognee was turned off while cognee still holds a manifest
 * for it.
 */
export async function cogneeWork(tx: Tx, now: Date): Promise<CogneeWork> {
  const due = await tx.query<{ workspace_id: string; up_to: string }>(
    `SELECT c.workspace_id, max(o.seq) AS up_to
       FROM cognee_settings c
       JOIN outbox o ON o.workspace_id = c.workspace_id
      WHERE c.enabled
        AND NOT EXISTS (SELECT 1 FROM projection_status s WHERE s.workspace_id = c.workspace_id AND s.instance_id = $2 AND s.retry_at > $1)
      GROUP BY c.workspace_id, c.projected_through
     HAVING max(o.seq) > coalesce(c.projected_through, 0)
      ORDER BY min(o.seq)`,
    [now, COGNEE],
  )
  const clear = await tx.query<{ workspace_id: string }>(
    `SELECT m.workspace_id FROM adapter_manifests m
       LEFT JOIN cognee_settings c ON c.workspace_id = m.workspace_id
      WHERE m.instance_id = $1 AND c.enabled IS NOT TRUE
        AND NOT EXISTS (SELECT 1 FROM projection_status s WHERE s.workspace_id = m.workspace_id AND s.instance_id = $1 AND s.retry_at > $2)
      ORDER BY m.workspace_id`,
    [COGNEE, now],
  )
  return {
    due: due.rows.map((row) => ({ workspaceId: row.workspace_id, upTo: Number(row.up_to) })),
    clear: clear.rows.map((row) => row.workspace_id),
  }
}

/** Records that a cognee pass projected everything up to outbox row `upTo`. */
export async function markCogneeProjected(tx: Tx, workspaceId: string, upTo: number): Promise<void> {
  await tx.query('UPDATE cognee_settings SET projected_through = greatest(coalesce(projected_through, 0), $2) WHERE workspace_id = $1', [workspaceId, upTo])
}

/** Forgets what cognee filed for a workspace once it is cleared: its manifest and its standing. */
export async function forgetCognee(tx: Tx, workspaceId: string): Promise<void> {
  await tx.query('DELETE FROM adapter_manifests WHERE workspace_id = $1 AND instance_id = $2', [workspaceId, COGNEE])
  await tx.query('DELETE FROM projection_status WHERE workspace_id = $1 AND instance_id = $2', [workspaceId, COGNEE])
  await tx.query('UPDATE cognee_settings SET projected_through = NULL WHERE workspace_id = $1', [workspaceId])
}
