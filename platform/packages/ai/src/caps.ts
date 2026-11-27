// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from '@docket/platform-tenancy'

import { monthOf, monthSpend } from './usage.js'

/** The beta's monthly AI budget per org (§12), and the most an owner may raise it to. */
export const DEFAULT_MONTHLY_CAP_USD = 20
export const MAX_MONTHLY_CAP_USD = 100
/** Owners are warned once a month when spend reaches this share of the cap (§11). */
export const WARN_AT = 0.8

/** The AI budget is spent: refused with the message §11 asks for. Search never raises it. */
export class AiCapReached extends Error {
  override name = 'AiCapReached'
  constructor(
    readonly orgId: string,
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super('AI budget for this month reached — search still works; ask an owner to raise the cap')
  }
}

export interface CapStatus {
  orgId: string
  month: string
  capUsd: number
  spentUsd: number
  /** spent / cap; 1 or more is over. A zero cap is always over. */
  fraction: number
  /** When this month's owner warning went out. */
  warnedAt: Date | null
}

/** One owner warning: sent once per org and month, at `WARN_AT` of the cap. */
export interface CapWarning {
  orgId: string
  month: string
  spentUsd: number
  capUsd: number
}

export interface CapsDeps {
  /** Runs a query as the request role on the platform schema. */
  platform<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
  /**
   * Tells the org's owners, inside the transaction that records the warning:
   * if it throws, the warning is not recorded and goes out on the next call.
   */
  notifyOwners(tx: Tx, warning: CapWarning): Promise<void>
  now?: () => Date
}

export interface AiCaps {
  status(orgId: string): Promise<CapStatus>
  /**
   * Refuses an AI call once the month's spend reaches the cap, and sends the
   * owners one warning when it first passes 80%. Called before every model
   * call - never on the search path, which needs no model (§11).
   */
  assertWithinCap(orgId: string): Promise<void>
}

/** The org's monthly cap in US dollars: its own, or the beta default. */
export async function capOf(tx: Tx, orgId: string): Promise<number> {
  const { rows } = await tx.query<{ monthly_usd: string }>('SELECT monthly_usd FROM platform.ai_caps WHERE org_id = $1', [orgId])
  return rows[0] ? Number(rows[0].monthly_usd) : DEFAULT_MONTHLY_CAP_USD
}

export class CapError extends Error {
  override name = 'CapError'
}

/** Sets the org's cap (owners only, §4), within the platform's maximum. */
export async function setCap(tx: Tx, orgId: string, monthlyUsd: number, by: string): Promise<void> {
  if (!Number.isFinite(monthlyUsd) || monthlyUsd < 0 || monthlyUsd > MAX_MONTHLY_CAP_USD) {
    throw new CapError(`A monthly AI cap is between $0 and $${MAX_MONTHLY_CAP_USD} in the beta.`)
  }
  await tx.query(
    `INSERT INTO platform.ai_caps (org_id, monthly_usd, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (org_id) DO UPDATE SET monthly_usd = EXCLUDED.monthly_usd, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [orgId, Math.round(monthlyUsd * 100) / 100, by],
  )
}

async function statusIn(tx: Tx, orgId: string, now: Date): Promise<CapStatus> {
  const month = monthOf(now)
  const [capUsd, spentUsd, warned] = await Promise.all([
    capOf(tx, orgId),
    monthSpend(tx, orgId, month),
    tx.query<{ sent_at: Date }>(
      'SELECT sent_at FROM platform.ai_cap_warnings WHERE org_id = $1 AND month = $2 AND threshold = $3',
      [orgId, month, Math.round(WARN_AT * 100)],
    ),
  ])
  return {
    orgId,
    month,
    capUsd,
    spentUsd,
    fraction: capUsd > 0 ? spentUsd / capUsd : Number.POSITIVE_INFINITY,
    warnedAt: warned.rows[0]?.sent_at ?? null,
  }
}

export function aiCaps(deps: CapsDeps): AiCaps {
  const now = deps.now ?? (() => new Date())
  return {
    status: (orgId) => deps.platform((tx) => statusIn(tx, orgId, now())),

    async assertWithinCap(orgId) {
      const status = await deps.platform(async (tx) => {
        const current = await statusIn(tx, orgId, now())
        if (current.fraction >= WARN_AT && !current.warnedAt) {
          const { rowCount } = await tx.query(
            `INSERT INTO platform.ai_cap_warnings (org_id, month, threshold, spent_usd, cap_usd) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [orgId, current.month, Math.round(WARN_AT * 100), current.spentUsd, current.capUsd],
          )
          // Concurrent calls race to the insert; only the one that made the row tells the owners.
          if (rowCount) await deps.notifyOwners(tx, { orgId, month: current.month, spentUsd: current.spentUsd, capUsd: current.capUsd })
        }
        return current
      })
      if (status.fraction >= 1) throw new AiCapReached(orgId, status.spentUsd, status.capUsd)
    },
  }
}
