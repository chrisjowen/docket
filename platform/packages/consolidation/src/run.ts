// SPDX-License-Identifier: AGPL-3.0-only
import { AiCapReached } from '@docket/platform-ai'
import { audit } from '@docket/platform-audit'
import {
  DocumentError,
  countDocuments,
  hasErrors,
  isInferredPath,
  summaryPath,
  supersedeResource,
  workspaceById,
  workspaceGraph,
  type StoreContext,
} from '@docket/platform-canonical-store'
import { EnrichmentLimitReached } from '@docket/platform-enrichment'

import { contradictionCandidates, explicitReason, heldUntil, judge, pairFingerprint, type Judgement } from './contradict.js'
import {
  CONSOLIDATION_LIMITS,
  checkpoints,
  contradictionChecks,
  finishRun,
  recordContradictionCheck,
  touchCheckpoint,
  type RunStatus,
  type RunSummary,
} from './runs.js'
import { fingerprintOf, summarize, summaryPrompt, type SummaryModel } from './summarize.js'
import { duplicateCandidates, indexGraph, walkNeighbourhood } from './walk.js'
import { CONSOLIDATION_ACTOR, consolidationWriter, retireSummary, writeSummary, type RetireReason } from './write.js'

/** How many texts go to the embedder in one call. */
const EMBED_BATCH = 64

const cosine = (a: readonly number[], b: readonly number[]) => {
  let dot = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) dot += (a[i] ?? 0) * (b[i] ?? 0)
  return dot / (Math.hypot(...a) * Math.hypot(...b) || 1)
}

/** A checkpoint for a neighbourhood whose summary came back too short to keep: it has no summary document to look for. */
const trivialMark = (fingerprint: string) => `trivial:${fingerprint}`

/** The org's model for summaries: checked against the shared monthly limit before every call. */
export interface Summarizer {
  /** Throws `EnrichmentLimitReached` once the enrichment job's monthly limit is spent. */
  beforeCall(): Promise<void>
  model: SummaryModel
}

export interface RunDeps {
  /** One transaction as the run's org, with its data keys. */
  withOrg<T>(fn: (ctx: StoreContext) => Promise<T>): Promise<T>
  /** Absent when AI is off: the run then summarizes nothing. */
  summarizer: Summarizer | null
  /** What this run's own AI calls have cost so far, to cost the run. */
  spent?: () => Promise<number>
  /** The in-cluster embedder, to tell near-duplicates apart; absent, or failing for a resource, none are looked for it. */
  embed?: (texts: string[]) => Promise<number[][]>
  now?: () => Date
}

export interface RunOutcome {
  status: Exclude<RunStatus, 'running'>
  summary: RunSummary | null
  costUsd: number
  error?: string
}

/**
 * One consolidation run over a workspace (`run` from `startRun`): reads the
 * workspace graph once, and first looks for records gone out of date: two
 * current records of one type where the newer says outright it is the older
 * renamed, or, with the org's AI, where the newer says it replaces the older
 * or two about the same thing that it judges a clear conflict
 * (`contradict.ts`). It proposes that the newer supersedes the older - kept
 * on file, with until when it held and why - as any writer does, scored by the
 * workspace's policies: its `inferred` evidence rarely clears the bar alone,
 * so most proposals wait, the older record current, until a person or more
 * evidence carries them. Each pair is judged once while neither record changes. Without AI only an outright rename supersedes; any other
 * pair waits for the AI. Then it walks the neighbourhood of every current resource a person,
 * repo or checkout declares, and has the org's AI summarize each one whose
 * neighbourhood changed since its last summary, or whose summary document is
 * gone, up to the run's limit, resources with more standing first. A
 * resource is a near-duplicate of one of its type within two hops whose
 * title, notes and attributes embed close to its own; once the one with most
 * standing among them has a live summary, the others are not summarized, and
 * their live summaries are retired in favour of its. An answer too short to
 * keep is remembered, so the same neighbourhood is not asked about again, and
 * retires the summary it was meant to replace, as dropping below two links
 * does. A resource with no summary
 * yet gets one only while the workspace is short of its document limit, so no
 * model call is spent on a summary it cannot keep. Each
 * summary replaces the resource's last in its summary document and moves its
 * checkpoint on; a summary that fails leaves the checkpoint where it was, so
 * the next run tries again. Finishes the run and audits it.
 */
export async function runConsolidation(deps: RunDeps, run: { id: string; orgId: string; workspaceId: string }): Promise<RunOutcome> {
  const now = deps.now ?? (() => new Date())
  const startedAt = performance.now()
  const writer = consolidationWriter(run.workspaceId, run.id)
  const finish = async (outcome: RunOutcome) => {
    await deps.withOrg(async (ctx) => {
      await finishRun(ctx.tx, run.id, { ...outcome, at: now() })
      await audit(ctx.tx, {
        orgId: run.orgId,
        workspaceId: run.workspaceId,
        actor: CONSOLIDATION_ACTOR,
        action: 'consolidation.run',
        target: [run.workspaceId],
        args: outcome.summary ?? { error: outcome.error },
        outcome: outcome.status === 'failed' ? 'error' : 'ok',
        latencyMs: performance.now() - startedAt,
        requestId: writer.requestId,
      })
    })
    return outcome
  }
  const cost = async () => (await deps.spent?.().catch(() => 0)) ?? 0

  try {
    const summary: RunSummary = {
      considered: 0,
      summarized: 0,
      superseded: 0,
      retired: 0,
      failed: 0,
      skipped: { unchanged: 0, isolated: 0, duplicate: 0, trivial: 0, overLimit: 0 },
      aiCalls: 0,
      contradictions: { checked: 0, superseded: 0, proposed: 0 },
    }
    const { summarizer } = deps

    const read = await deps.withOrg(async (ctx) => {
      const workspace = await workspaceById(ctx.tx, run.workspaceId)
      if (!workspace) throw new Error('The workspace is gone.')
      return {
        graph: await workspaceGraph(ctx, workspace, { root: '.' }),
        seen: await checkpoints(ctx.tx, run.workspaceId),
        documents: await countDocuments(ctx.tx, run.workspaceId),
        judged: await contradictionChecks(ctx.tx, run.workspaceId),
      }
    })
    const index = indexGraph(read.graph)
    let status: RunOutcome['status'] = 'ok'
    let firstError: string | undefined
    let documents = read.documents
    type Entity = (typeof read.graph.entities)[number]
    const declared = (entity: { paths: readonly string[] }) => entity.paths.some((path) => !isInferredPath(path))
    const links = (id: string) => index.edges.get(id)?.length ?? 0
    const stands = (a: Entity, b: Entity) => Number(declared(b)) - Number(declared(a)) || links(b.id) - links(a.id) || (a.id < b.id ? -1 : 1)
    const live = new Set(read.graph.entities.filter((entity) => entity.paths.includes(summaryPath(entity.id))).map((entity) => entity.id))
    const candidates = new Map(read.graph.entities.filter(declared).map((entity) => [entity.id, duplicateCandidates(index, entity.id)]))
    const vectors = new Map<string, number[]>()
    if (deps.embed && summarizer) {
      const needed = new Map<string, Entity>()
      for (const entity of read.graph.entities) {
        const near = candidates.get(entity.id) ?? []
        if (near.length) for (const each of [entity, ...near]) needed.set(each.id, each)
      }
      const texts = [...needed.values()]
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const batch = texts.slice(i, i + EMBED_BATCH)
        try {
          const embedded = await deps.embed(batch.map((entity) => [entity.title, entity.content, JSON.stringify(entity.attributes)].join('\n')))
          batch.forEach((entity, j) => {
            const vector = embedded[j]
            if (vector) vectors.set(entity.id, vector)
          })
        } catch {
          summary.duplicatesUnchecked = (summary.duplicatesUnchecked ?? 0) + batch.length
        }
      }
    }
    const nearDuplicates = (entity: Entity) => {
      const own = vectors.get(entity.id)
      if (!own) return []
      // A record gone out of date never keeps the summary for the one that replaced it.
      return (candidates.get(entity.id) ?? []).filter((other) => {
        const vector = vectors.get(other.id)
        return !superseded.has(other.id) && vector !== undefined && cosine(own, vector) > CONSOLIDATION_LIMITS.duplicateSimilarity
      })
    }
    const keeperOf = (entity: Entity) => {
      let keeper = entity
      for (;;) {
        const [best = keeper] = [keeper, ...nearDuplicates(keeper)].sort(stands)
        if (best === keeper) return keeper
        keeper = best
      }
    }
    const retire = async (id: string, reason: RetireReason, keeper?: string) => {
      if (await deps.withOrg((ctx) => retireSummary(ctx, writer, { runId: run.id, id, reason, ...(keeper ? { keeper } : {}), at: now() }))) {
        summary.retired += 1
        live.delete(id)
        documents -= 1
      }
    }
    const failure = (id: string, caught: unknown) => {
      summary.failed += 1
      firstError ??= `${id}: ${caught instanceof Error ? caught.message : String(caught)}`
    }

    // Records gone out of date: superseded by the newer record that contradicts them, before anything is summarized.
    const contradictions = summary.contradictions as NonNullable<RunSummary['contradictions']>
    const superseded = new Set(read.graph.entities.filter((entity) => typeof entity.frontmatter.superseded_by === 'string').map((entity) => entity.id))
    const sameSubject = (entity: Entity) => {
      const own = vectors.get(entity.id)
      if (!own) return []
      return (candidates.get(entity.id) ?? []).filter((other) => {
        const vector = vectors.get(other.id)
        return vector !== undefined && cosine(own, vector) > CONSOLIDATION_LIMITS.sameSubjectSimilarity
      })
    }
    let judgements = 0
    for (const pair of contradictionCandidates(read.graph.entities, sameSubject, (entity) => declared(entity) && !superseded.has(entity.id))) {
      if (superseded.has(pair.older.id) || superseded.has(pair.newer.id)) continue
      const fingerprint = pairFingerprint(pair)
      if (read.judged.get(`${pair.older.id}\u0000${pair.newer.id}`) === fingerprint) continue
      let judgement: Judgement | null = null
      if (summarizer && !summary.aiStopped && judgements < CONSOLIDATION_LIMITS.contradictionChecksPerRun) {
        try {
          await summarizer.beforeCall()
          summary.aiCalls += 1
          judgements += 1
          judgement = await judge(pair, summarizer.model)
        } catch (caught) {
          if (caught instanceof EnrichmentLimitReached || caught instanceof AiCapReached) {
            summary.aiStopped = caught instanceof EnrichmentLimitReached ? 'limit' : 'cap'
            status = 'limited'
          } else {
            failure(pair.older.id, caught)
            continue
          }
        }
      }
      // Without the AI, only the newer record's own outright rename supersedes; any other pair waits for it.
      if (!judgement) {
        if (pair.ground !== 'renamed') continue
        judgement = { verdict: 'supersedes', reason: explicitReason(pair) }
      }
      contradictions.checked += 1
      const decided = judgement
      try {
        await deps.withOrg(async (ctx) => {
          const at = now()
          await recordContradictionCheck(ctx.tx, run.workspaceId, { olderId: pair.older.id, newerId: pair.newer.id, fingerprint, verdict: decided.verdict, at })
          if (decided.verdict !== 'supersedes') return
          const result = await supersedeResource(
            ctx,
            writer,
            {
              id: pair.older.id,
              by: pair.newer.id,
              reason: decided.reason,
              validUntil: heldUntil(pair, at).toISOString(),
              evidence: [{ source: 'inferred', path: pair.newer.path, note: pair.statement ?? decided.reason }],
            },
            { source: 'consolidation', runId: run.id, now },
          )
          if (hasErrors(result.diagnostics)) throw new Error(result.diagnostics.map((d) => d.message).join(' '))
          // A proposal like any other: inferred evidence rarely clears the bar alone, so most wait, the older record still current.
          if (result.changed && result.proposal?.status === 'accepted') {
            contradictions.superseded += 1
            superseded.add(pair.older.id)
          } else if (result.changed) contradictions.proposed = (contradictions.proposed ?? 0) + 1
        })
      } catch (caught) {
        failure(pair.older.id, caught)
      }
    }
    if (!summarizer) {
      const error = firstError && `${summary.failed} contradiction checks failed and are tried again next run; the first, ${firstError}`
      return await finish({ status, summary: { ...summary, aiStopped: 'off' }, costUsd: 0, ...(error ? { error } : {}) })
    }
    const documentsFull = () => {
      summary.documentsFull = (summary.documentsFull ?? 0) + 1
      status = 'limited'
    }

    // A record gone out of date is not summarized: search answers with its replacement.
    for (const entity of read.graph.entities.filter((entity) => declared(entity) && !superseded.has(entity.id)).sort(stands)) {
      const neighbourhood = walkNeighbourhood(index, entity.id)
      if (!neighbourhood) continue
      summary.considered += 1
      const first = !live.has(entity.id)
      const retiring = async (reason: RetireReason, keeper?: string) => {
        try {
          if (!first) await retire(entity.id, reason, keeper)
        } catch (caught) {
          failure(entity.id, caught)
        }
      }
      if (neighbourhood.direct.length < CONSOLIDATION_LIMITS.minLinks) {
        summary.skipped.isolated += 1
        await retiring('isolated')
        continue
      }
      const prompt = summaryPrompt(neighbourhood)
      const fingerprint = fingerprintOf(neighbourhood, prompt)
      const seen = read.seen.get(entity.id)
      const unchanged = seen === trivialMark(fingerprint) || (!first && seen === fingerprint)
      if (unchanged && first) {
        summary.skipped.unchanged += 1
        continue
      }
      const keeper = keeperOf(entity)
      if (keeper !== entity && live.has(keeper.id)) {
        summary.skipped.duplicate += 1
        await retiring('duplicate', keeper.id)
        continue
      }
      if (unchanged) {
        summary.skipped.unchanged += 1
        continue
      }
      if (summary.aiStopped || summary.aiCalls >= CONSOLIDATION_LIMITS.summariesPerRun) {
        summary.skipped.overLimit += 1
        continue
      }
      if (first && documents >= CONSOLIDATION_LIMITS.summaryDocumentsUntil) {
        documentsFull()
        continue
      }

      try {
        await summarizer.beforeCall()
        summary.aiCalls += 1
        const result = await summarize(neighbourhood, prompt, summarizer.model)
        const at = now()
        if (result.text.length < CONSOLIDATION_LIMITS.minSummaryChars) {
          summary.skipped.trivial += 1
          if (!first) await retire(entity.id, 'trivial')
          await deps.withOrg((ctx) => touchCheckpoint(ctx.tx, run.workspaceId, entity.id, trivialMark(fingerprint), at))
          continue
        }
        const written = await deps.withOrg(async (ctx) => {
          const out = await writeSummary(ctx, writer, {
            runId: run.id,
            id: entity.id,
            summary: result.text,
            model: result.model,
            confidence: result.confidence,
            evidenceIds: result.citedEvidence,
            checkpoint: fingerprint,
            at,
          })
          if (out) await touchCheckpoint(ctx.tx, run.workspaceId, entity.id, fingerprint, at)
          return out
        })
        if (!written) throw new Error('no document declares it any more')
        summary.summarized += 1
        live.add(entity.id)
        if (first) documents += 1
        if (written.superseded) summary.superseded += 1
      } catch (caught) {
        if (caught instanceof EnrichmentLimitReached || caught instanceof AiCapReached) {
          summary.aiStopped = caught instanceof EnrichmentLimitReached ? 'limit' : 'cap'
          status = 'limited'
          summary.skipped.overLimit += 1
          continue
        }
        if (caught instanceof DocumentError && caught.code === 'limit') {
          documents = CONSOLIDATION_LIMITS.summaryDocumentsUntil
          documentsFull()
          continue
        }
        failure(entity.id, caught)
      }
    }

    const error = firstError && `${summary.failed} summaries failed and are tried again next run; the first, ${firstError}`
    return await finish({ status, summary, costUsd: await cost(), ...(error ? { error } : {}) })
  } catch (caught) {
    return finish({ status: 'failed', summary: null, costUsd: await cost(), error: caught instanceof Error ? caught.message : String(caught) })
  }
}
