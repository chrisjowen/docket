// SPDX-License-Identifier: AGPL-3.0-only
import { AiCapReached } from '@docket/platform-ai'
import { audit } from '@docket/platform-audit'
import {
  INFERRED_ROOT,
  hasErrors,
  isInferredPath,
  parseMemoryFile,
  postgresSource,
  readDocuments,
  recordIngest,
  retireDocument,
  validate,
  writeInference,
  type CanonicalSource,
  type EvidenceInput,
  type IngestDocument,
  type StoreContext,
  type Writer,
} from '@docket/platform-canonical-store'

import { detect, fingerprint, type Candidate, type InferenceKind } from './detect.js'
import { EnrichmentLimitReached, briefOf, review, type Reviewer } from './judge.js'
import { INFERRED_SOURCE, registersInferred } from './ontology.js'
import { ENRICHMENT_LIMITS, EnrichmentSettingsError, finishRun, knownFingerprints, type RunStatus, type RunSummary } from './settings.js'

/** Who the job writes as: the audit actor, and how its evidence names it. */
export const ENRICHMENT_ACTOR = 'system:enrichment'
export const ENRICHMENT_LABEL = 'docket-cloud enrichment'

/** A run's writer: every document, ingest event and audit event of one run share its request id. */
export const enrichmentWriter = (workspaceId: string, runId: string): Writer => ({
  workspaceId,
  actor: ENRICHMENT_ACTOR,
  label: ENRICHMENT_LABEL,
  channel: 'enrichment',
  requestId: `enrichment:${runId}`,
})

/** How the job's AI spend is metered: one actor per workspace, so its monthly limit is its own. */
export const enrichmentAiActor = (workspaceId: string): string => `${ENRICHMENT_ACTOR}:${workspaceId}`

const KINDS: readonly InferenceKind[] = ['link', 'owner', 'duplicate', 'contradiction']
const NOTE = 1_000
const CITED = 10

const safe = (text: string) => text.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+|-+$/g, '') || 'resource'

/** An inference's own document: under its resource, named for what it says. */
export function inferredPath(candidate: Pick<Candidate, 'kind' | 'from' | 'target'>, rel: string): string {
  return `${INFERRED_ROOT}${safe(candidate.from).slice(0, 150)}/${candidate.kind}--${safe(rel).slice(0, 60)}--${safe(candidate.target).slice(0, 150)}.md`
}

/** The evidence an inference carries: one `inferred` entry per document it was read from, the first with the reasoning. */
export function evidenceOf(candidate: Candidate, reasoning: string): EvidenceInput[] {
  return candidate.cited.slice(0, CITED).map((cited, index) => ({
    source: INFERRED_SOURCE,
    path: cited.path,
    symbol: cited.id,
    note: (index === 0 ? reasoning : `Read here: ${cited.what}.`).slice(0, NOTE),
  }))
}

export interface RunDeps {
  /** One transaction as the run's org, with its data keys. */
  withOrg<T>(fn: (ctx: StoreContext) => Promise<T>): Promise<T>
  /** The org's AI, for candidates the rules leave open; absent when AI is off. */
  reviewer?: Reviewer | null
  /** What this run's own AI calls have cost so far, to cost the run. */
  spent?: () => Promise<number>
  now?: () => Date
}

export interface RunOutcome {
  status: Exclude<RunStatus, 'running'>
  summary: RunSummary | null
  costUsd: number
  error?: string
}

const counts = () => Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<InferenceKind, number>

/**
 * One enrichment run over a workspace (`run` from `startRun`): reads every
 * resource as the documents say it, retires inferences whose resource has
 * gone, finds what the rules imply, has the org's AI review what they leave
 * open within the job's limit, and writes each inference as a document of its
 * own through the canonical write path. Nothing inferred once - written,
 * retired or rejected - is made again. Finishes the run and audits it.
 */
export async function runEnrichment(deps: RunDeps, run: { id: string; orgId: string; workspaceId: string }): Promise<RunOutcome> {
  const now = deps.now ?? (() => new Date())
  const startedAt = performance.now()
  const writer = enrichmentWriter(run.workspaceId, run.id)
  const finish = async (outcome: RunOutcome) => {
    await deps.withOrg(async (ctx) => {
      await finishRun(ctx.tx, run.id, { ...outcome, at: now() })
      await audit(ctx.tx, {
        orgId: run.orgId,
        workspaceId: run.workspaceId,
        actor: ENRICHMENT_ACTOR,
        action: 'enrichment.run',
        target: [run.workspaceId],
        args: outcome.summary ?? { error: outcome.error },
        outcome: outcome.status === 'failed' ? 'error' : 'ok',
        latencyMs: performance.now() - startedAt,
        requestId: writer.requestId,
      })
    })
    return outcome
  }

  try {
    const read = await deps.withOrg(async (ctx) => {
      const opened = await readDocuments(ctx, run.workspaceId)
      const own = opened.filter((document) => !isInferredPath(document.path))
      // Inferences never build on inferences: the rules read what people, repos and checkouts wrote.
      const source: CanonicalSource = {
        ...postgresSource(ctx, run.workspaceId),
        async *documents() {
          for (const document of own) {
            if (document.raw === undefined) yield { path: document.path, error: document.error ?? 'unreadable' }
            else yield { path: document.path, raw: document.raw, hash: document.hash }
          }
        },
      }
      const inferred = opened
        .filter((document) => isInferredPath(document.path) && document.raw !== undefined)
        .flatMap((document) => parseMemoryFile(document.raw as string, document.path).document?.links.map((link) => ({ path: document.path, from: document.resourceId, rel: link.rel, target: link.target })) ?? [])
      return { validation: await validate({ source }), known: await knownFingerprints(ctx.tx, run.workspaceId), documents: opened, inferred }
    })
    const { ontology, entities } = read.validation
    if (!ontology) return await finish({ status: 'failed', summary: null, costUsd: 0, error: 'The published ontology does not load.' })

    const summary: RunSummary = {
      found: counts(),
      written: counts(),
      skipped: { known: 0, rejected: 0, undecided: 0, refused: 0, overRunLimit: 0 },
      orphansRetired: 0,
      aiCalls: 0,
    }

    // An inference outlives nothing: once no other document declares its resource or its target, it goes.
    const declared = new Set(read.documents.filter((document) => !isInferredPath(document.path)).map((document) => document.resourceId))
    const dangling = new Set(read.inferred.filter((link) => !declared.has(link.target)).map((link) => link.path))
    const orphans = read.documents.filter((document) => isInferredPath(document.path) && (!declared.has(document.resourceId) || dangling.has(document.path)))
    const orphaned = new Set(orphans.map((orphan) => orphan.path))
    if (orphans.length) {
      await deps.withOrg(async (ctx) => {
        const retired: IngestDocument[] = []
        for (const orphan of orphans) {
          const record = await retireDocument(ctx.tx, { workspaceId: run.workspaceId, path: orphan.path })
          retired.push({ documentId: record.id, path: record.path, resourceId: record.resourceId, revision: record.revision, change: 'retired' })
        }
        await ctx.tx.query('UPDATE enrichment_inferences SET retired_at = $3 WHERE workspace_id = $1 AND path = ANY($2::text[]) AND retired_at IS NULL', [
          run.workspaceId,
          orphans.map((orphan) => orphan.path),
          now(),
        ])
        await recordIngest(ctx, {
          workspaceId: run.workspaceId,
          channel: writer.channel,
          actor: writer.actor,
          actorLabel: writer.label,
          action: 'retire-inferred',
          documents: retired,
          outcome: 'ok',
          detail: { reason: 'Their resources or targets are no longer declared by any other document.' },
          requestId: writer.requestId,
        })
      })
      summary.orphansRetired = orphans.length
    }

    if (!registersInferred(ontology)) {
      return await finish({
        status: 'failed',
        summary,
        costUsd: 0,
        error: `The ontology does not register the ${INFERRED_SOURCE} evidence source: turn enrichment off and on again in Settings to add it.`,
      })
    }

    const resources = entities.filter((entity) => declared.has(entity.id))
    const candidates = detect({ resources, ontology, inferred: read.inferred.filter((link) => !orphaned.has(link.path)) })
    for (const candidate of candidates) summary.found[candidate.kind] = (summary.found[candidate.kind] ?? 0) + 1
    const fresh = candidates.filter((candidate) => {
      if (!read.known.has(fingerprint(candidate))) return true
      summary.skipped.known += 1
      return false
    })

    type Accepted = { candidate: Candidate; rel: string; reasoning: string }
    const accepted: Accepted[] = fresh.filter((candidate) => candidate.certain).map((candidate) => ({ candidate, rel: candidate.rels[0] as string, reasoning: candidate.reasoning }))
    const rejected: Candidate[] = []
    const open = fresh.filter((candidate) => !candidate.certain)
    let status: RunOutcome['status'] = 'ok'
    if (open.length && !deps.reviewer) {
      summary.skipped.undecided += open.length
      summary.aiStopped = 'off'
    } else if (open.length && deps.reviewer) {
      const briefs = new Map(resources.map((resource) => [resource.id, briefOf(resource)]))
      let reviewed = 0
      try {
        // Review only what the run could still write: the rest waits, unreviewed and unrecorded, for the next run.
        await review(
          deps.reviewer,
          open,
          briefs,
          async (batch, verdicts) => {
            summary.aiCalls += 1
            reviewed += batch.length
            batch.forEach((candidate, index) => {
              const verdict = verdicts[index]
              if (!verdict) summary.skipped.undecided += 1
              else if (verdict.rel === null) rejected.push(candidate)
              else accepted.push({ candidate, rel: verdict.rel, reasoning: `${candidate.reasoning} Reviewed: ${verdict.reasoning}` })
            })
          },
          () => ENRICHMENT_LIMITS.inferencesPerRun - accepted.length,
        )
        summary.skipped.overRunLimit += open.length - reviewed
      } catch (caught) {
        if (!(caught instanceof EnrichmentLimitReached) && !(caught instanceof AiCapReached)) throw caught
        summary.aiStopped = caught instanceof EnrichmentLimitReached ? 'limit' : 'cap'
        summary.skipped.undecided += open.length - reviewed
        status = 'limited'
      }
    }

    const record = (ctx: StoreContext, candidate: Candidate, outcome: 'written' | 'rejected', rel?: string, path?: string) =>
      ctx.tx.query(
        `INSERT INTO enrichment_inferences (workspace_id, run_id, fingerprint, kind, outcome, resource_id, target, rel, path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (workspace_id, fingerprint) DO NOTHING`,
        [run.workspaceId, run.id, fingerprint(candidate), candidate.kind, outcome, candidate.from, candidate.target, rel ?? null, path ?? null],
      )
    if (rejected.length) {
      await deps.withOrg(async (ctx) => {
        for (const candidate of rejected) await record(ctx, candidate, 'rejected')
      })
      summary.skipped.rejected = rejected.length
    }

    const writing = accepted.slice(0, ENRICHMENT_LIMITS.inferencesPerRun)
    summary.skipped.overRunLimit += accepted.length - writing.length
    for (const { candidate, rel, reasoning } of writing) {
      // One transaction each: a refusal leaves the others, and is logged on its own.
      await deps.withOrg(async (ctx) => {
        const path = inferredPath(candidate, rel)
        const result = await writeInference(
          ctx,
          writer,
          { id: candidate.from, path, links: [{ rel, target: candidate.target, evidence: evidenceOf(candidate, reasoning) }] },
          { now },
        )
        if (hasErrors(result.diagnostics)) {
          summary.skipped.refused += 1
          return
        }
        await record(ctx, candidate, 'written', rel, path)
        summary.written[candidate.kind] = (summary.written[candidate.kind] ?? 0) + 1
      })
    }

    const costUsd = (await deps.spent?.()) ?? 0
    return await finish({ status, summary, costUsd })
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : String(caught)
    const costUsd = (await deps.spent?.().catch(() => 0)) ?? 0
    return finish({ status: 'failed', summary: null, costUsd, error })
  }
}

/**
 * Retires everything one run wrote that is still live, once it has finished: its
 * documents leave the graph at the next reconciliation, and their inferences
 * stay recorded, so no later run writes them again. One ingest event, by the
 * person who asked.
 */
export async function retireRun(
  ctx: StoreContext,
  input: { workspaceId: string; runId: string; actor: string; label: string; requestId: string; now?: Date },
): Promise<{ retired: number }> {
  const at = input.now ?? new Date()
  const run = await ctx.tx.query<{ status: RunStatus }>('SELECT status FROM enrichment_runs WHERE workspace_id = $1 AND id = $2 FOR UPDATE', [
    input.workspaceId,
    input.runId,
  ])
  if (run.rows[0]?.status === 'running') throw new EnrichmentSettingsError('This run is still writing: retire what it added once it finishes.')
  const { rows } = await ctx.tx.query<{ id: string; path: string }>(
    `SELECT id, path FROM enrichment_inferences
      WHERE workspace_id = $1 AND run_id = $2 AND outcome = 'written' AND retired_at IS NULL ORDER BY path FOR UPDATE`,
    [input.workspaceId, input.runId],
  )
  const retired: IngestDocument[] = []
  for (const row of rows) {
    const live = await ctx.tx.query('SELECT 1 FROM documents WHERE workspace_id = $1 AND path = $2 AND retired_at IS NULL', [input.workspaceId, row.path])
    if (!live.rowCount) continue
    const record = await retireDocument(ctx.tx, { workspaceId: input.workspaceId, path: row.path })
    retired.push({ documentId: record.id, path: record.path, resourceId: record.resourceId, revision: record.revision, change: 'retired' })
  }
  await ctx.tx.query('UPDATE enrichment_inferences SET retired_at = $3 WHERE workspace_id = $1 AND run_id = $2 AND retired_at IS NULL', [
    input.workspaceId,
    input.runId,
    at,
  ])
  await ctx.tx.query('UPDATE enrichment_runs SET retired_at = $3, retired_by = $4 WHERE workspace_id = $1 AND id = $2', [
    input.workspaceId,
    input.runId,
    at,
    input.actor,
  ])
  if (retired.length) {
    await recordIngest(ctx, {
      workspaceId: input.workspaceId,
      channel: 'ui',
      actor: input.actor,
      actorLabel: input.label,
      action: 'retire-inferred',
      documents: retired,
      outcome: 'ok',
      detail: { reason: `Retired everything enrichment run ${input.runId.slice(0, 8)} added.` },
      requestId: input.requestId,
    })
  }
  return { retired: retired.length }
}
