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
}

export async function recordUsage(tx: Tx, usage: UsageRecord): Promise<void> {
  await tx.query(
    `INSERT INTO platform.ai_usage (org_id, workspace_id, actor, purpose, model, generation_id, prompt_tokens, completion_tokens, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
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

/** What the org has spent on AI in a calendar month, in US dollars. */
export async function monthSpend(tx: Tx, orgId: string, month: string): Promise<number> {
  const [from, to] = monthRange(month)
  const { rows } = await tx.query<{ spent: string | null }>(
    'SELECT sum(cost_usd) AS spent FROM platform.ai_usage WHERE org_id = $1 AND at >= $2 AND at < $3',
    [orgId, from, to],
  )
  return Number(rows[0]?.spent ?? 0)
}
