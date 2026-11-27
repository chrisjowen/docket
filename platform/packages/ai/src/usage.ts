// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from '@docket/platform-tenancy'

/**
 * Metering (§11, O2): every AI call's tokens and cost, per org, workspace and
 * actor, from day one, so the cap is enforced here as well as upstream and
 * pricing can be data-led later.
 */
/**
 * `agent`: the Ask page's agent, choosing what to look up and writing the
 * answer. `ontology`: drafting a new docket's ontology from a description.
 */
export type Purpose = 'cypher' | 'synthesis' | 'extraction' | 'enrichment' | 'cognify' | 'agent' | 'ontology'

export interface UsageRecord {
  orgId: string
  workspaceId?: string | null
  actor: string
  purpose: Purpose
  model: string
  generationId?: string | null
  promptTokens: number
  completionTokens: number
  costUsd: number
  /** Which key paid: Docket's, capped per account (the default), or the space's own. */
  paidBy?: PaidBy
}

/** Who paid for a call: the account, on Docket's capped key, or a space, on its own provider key. */
export type PaidBy = 'account' | 'space'

export async function recordUsage(tx: Tx, usage: UsageRecord): Promise<void> {
  await tx.query(
    `INSERT INTO platform.ai_usage (org_id, workspace_id, actor, purpose, model, generation_id, prompt_tokens, completion_tokens, cost_usd, paid_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      usage.orgId,
      usage.workspaceId ?? null,
      usage.actor,
      usage.purpose,
      usage.model,
      usage.generationId ?? null,
      usage.promptTokens,
      usage.completionTokens,
      usage.costUsd,
      usage.paidBy ?? 'account',
    ],
  )
}

/** The calendar month in UTC, `YYYY-MM`: caps reset on the first, as OpenRouter's monthly limits do. */
export function monthOf(at: Date): string {
  return at.toISOString().slice(0, 7)
}

function monthRange(month: string): [Date, Date] {
  const [year, index] = month.split('-').map(Number) as [number, number]
  return [new Date(Date.UTC(year, index - 1, 1)), new Date(Date.UTC(year, index, 1))]
}

/** What one actor - a workspace's enrichment job, say - has spent on AI in a calendar month, in US dollars. */
export async function actorMonthSpend(tx: Tx, orgId: string, actor: string, month: string): Promise<number> {
  const [from, to] = monthRange(month)
  const { rows } = await tx.query<{ spent: string | null }>(
    'SELECT sum(cost_usd) AS spent FROM platform.ai_usage WHERE org_id = $1 AND actor = $2 AND at >= $3 AND at < $4',
    [orgId, actor, from, to],
  )
  return Number(rows[0]?.spent ?? 0)
}

/** What the org has spent on Docket's key in a calendar month, in US dollars: what its cap holds. Spaces' own keys are not counted. */
export async function monthSpend(tx: Tx, orgId: string, month: string): Promise<number> {
  const [from, to] = monthRange(month)
  const { rows } = await tx.query<{ spent: string | null }>(
    "SELECT sum(cost_usd) AS spent FROM platform.ai_usage WHERE org_id = $1 AND paid_by = 'account' AND at >= $2 AND at < $3",
    [orgId, from, to],
  )
  return Number(rows[0]?.spent ?? 0)
}

/** What the dockets in one space have spent on AI in a calendar month, in US dollars: calls made for one of them, on any key. */
export async function spaceMonthSpend(tx: Tx, orgId: string, spaceId: string, month: string): Promise<number> {
  const [from, to] = monthRange(month)
  const { rows } = await tx.query<{ spent: string | null }>(
    `SELECT sum(u.cost_usd) AS spent FROM platform.ai_usage u
       JOIN platform.docket_spaces($1) d ON d.docket_id = u.workspace_id
      WHERE u.org_id = $1 AND d.space_id = $2 AND u.at >= $3 AND u.at < $4`,
    [orgId, spaceId, from, to],
  )
  return Number(rows[0]?.spent ?? 0)
}
