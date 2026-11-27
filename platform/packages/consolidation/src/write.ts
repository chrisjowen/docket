// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { describeResource, putDocument, recordIngest, retireDocument, summaryPath, type StoreContext, type Writer } from '@docket/platform-canonical-store'
import { stringify } from 'yaml'

/** Who the job writes as: the audit actor, and how its documents name it. */
export const CONSOLIDATION_ACTOR = 'system:consolidation'
export const CONSOLIDATION_LABEL = 'docket-cloud consolidation'

/** A run's writer: it logs through enrichment's channel, as the job that follows it. */
export const consolidationWriter = (workspaceId: string, runId: string): Writer => ({
  workspaceId,
  actor: CONSOLIDATION_ACTOR,
  label: CONSOLIDATION_LABEL,
  channel: 'enrichment',
  requestId: `consolidation:${runId}`,
})

/** The frontmatter a summary document carries besides the resource's id, type and title. */
export interface SummaryFrontmatter {
  summary: string
  summary_generated_at: string
  summary_model: string
  summary_confidence: number
  summary_evidence: string[]
  /** The run that wrote it. */
  summary_run: string
  /** The neighbourhood's fingerprint it was written from. */
  summary_checkpoint: string
}

/**
 * Writes a resource's narrative summary into its summary document, replacing
 * the one before, and records it, superseding the summary it replaces: that
 * one's text stays in the document's earlier revision. Null when no document
 * declares the resource any more.
 */
export async function writeSummary(
  ctx: StoreContext,
  writer: Writer,
  input: { runId: string; id: string; summary: string; model: string; confidence: number; evidenceIds: string[]; checkpoint: string; at: Date },
): Promise<{ path: string; revision: number; superseded: boolean } | null> {
  const { workspaceId } = writer
  const declared = await describeResource(ctx, workspaceId, input.id)
  if (!declared) return null
  const path = summaryPath(input.id)
  const fields: SummaryFrontmatter = {
    summary: input.summary,
    summary_generated_at: input.at.toISOString(),
    summary_model: input.model,
    summary_confidence: input.confidence,
    summary_evidence: input.evidenceIds,
    summary_run: input.runId,
    summary_checkpoint: input.checkpoint,
  }
  const frontmatter = {
    id: input.id,
    type: declared.type,
    title: declared.title,
    provenance: { authority: 'inferred', capturedBy: CONSOLIDATION_LABEL },
    ...fields,
  }
  const { document, changed } = await putDocument(ctx, {
    workspaceId,
    path,
    raw: `---\n${stringify(frontmatter, { lineWidth: 0 })}---\n`,
    origin: 'cloud',
    actor: writer.actor,
  })
  if (changed) {
    await recordIngest(ctx, {
      workspaceId,
      channel: writer.channel,
      actor: writer.actor,
      actorLabel: writer.label,
      action: 'infer',
      documents: [{ documentId: document.id, path, resourceId: input.id, revision: document.revision, change: document.revision === 1 ? 'created' : 'updated' }],
      outcome: 'ok',
      detail: { resourceId: input.id },
      requestId: writer.requestId,
    })
  }

  const id = randomUUID()
  const superseded = await ctx.tx.query(
    `UPDATE consolidation_summaries SET superseded_by = $3, superseded_at = $4, superseded_in = $5, superseded_reason = 'replaced'
      WHERE workspace_id = $1 AND resource_id = $2 AND superseded_at IS NULL`,
    [workspaceId, input.id, id, input.at, input.runId],
  )
  await ctx.tx.query(
    `INSERT INTO consolidation_summaries (id, workspace_id, run_id, resource_id, path, revision, model, confidence, evidence_ids, checkpoint, generated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, workspaceId, input.runId, input.id, path, document.revision, input.model, input.confidence, input.evidenceIds, input.checkpoint, input.at],
  )
  return { path, revision: document.revision, superseded: Boolean(superseded.rowCount) }
}

/** Why a live summary was retired with no new one of its own. */
export type RetireReason = 'duplicate' | 'trivial' | 'isolated'

const WHY: Record<RetireReason, string> = {
  duplicate: 'It is a near-duplicate of another resource, whose summary stands for both.',
  trivial: 'Its neighbourhood changed, and the new summary came back too short to keep.',
  isolated: 'It has too few links left to summarize.',
}

/**
 * Retires a resource's live summary that no new one replaces, and why: a
 * near-duplicate's is superseded by the live summary of the resource it
 * duplicates (`keeper`). The document is retired, so its text stays in the
 * document's history. False while the resource, or its keeper, has no live
 * summary.
 */
export async function retireSummary(
  ctx: StoreContext,
  writer: Writer,
  input: { runId: string; id: string; reason: RetireReason; keeper?: string; at: Date },
): Promise<boolean> {
  const { workspaceId } = writer
  const { rows } = await ctx.tx.query<{ id: string; resource_id: string; path: string }>(
    'SELECT id, resource_id, path FROM consolidation_summaries WHERE workspace_id = $1 AND resource_id = ANY($2::text[]) AND superseded_at IS NULL',
    [workspaceId, [input.id, ...(input.keeper ? [input.keeper] : [])]],
  )
  const own = rows.find((row) => row.resource_id === input.id)
  const kept = input.keeper && rows.find((row) => row.resource_id === input.keeper)
  if (!own || (input.keeper && !kept)) return false
  await ctx.tx.query(
    'UPDATE consolidation_summaries SET superseded_by = $2, superseded_at = $3, superseded_in = $4, superseded_reason = $5 WHERE id = $1',
    [own.id, kept ? kept.id : null, input.at, input.runId, input.reason],
  )
  const record = await retireDocument(ctx.tx, { workspaceId, path: own.path })
  await recordIngest(ctx, {
    workspaceId,
    channel: writer.channel,
    actor: writer.actor,
    actorLabel: writer.label,
    action: 'retire-inferred',
    documents: [{ documentId: record.id, path: record.path, resourceId: record.resourceId, revision: record.revision, change: 'retired' }],
    outcome: 'ok',
    detail: { resourceId: input.id, reason: input.keeper ? `${WHY[input.reason]} (${input.keeper})` : WHY[input.reason] },
    requestId: writer.requestId,
  })
  return true
}
