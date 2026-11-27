// SPDX-License-Identifier: AGPL-3.0-only
import { actorMonthSpend, meteredModel, monthOf, type AiDeps } from '@docket/platform-ai'
import type { Keyring, StoreContext } from '@docket/platform-canonical-store'
import type { EmbedderConfig } from '@docket/platform-projections'
import { CONSOLIDATION_EVERY_MS, dueWorkspaces, failStaleRuns, runConsolidation, startRun, type RunOutcome, type Summarizer } from '@docket/platform-consolidation'
import { EnrichmentLimitReached, enrichmentAiActor, enrichmentSettings } from '@docket/platform-enrichment'
import type { TenantRouter } from '@docket/platform-tenancy'

import { activeOrgs, type Logger } from './outbox.js'

export interface ConsolidationLoopOptions {
  router: TenantRouter
  keyring: Keyring
  /** The org's metered, capped models; null when AI is off, and runs summarize nothing. */
  ai: AiDeps | null
  /** The in-cluster embedder, to tell near-duplicates apart; absent, none are looked for. */
  embedder?: EmbedderConfig
  log: Logger
  /** How often to look for a workspace with a run due. */
  intervalMs?: number
  /** How often each workspace with enrichment on is consolidated besides after its enrichment runs; `CONSOLIDATION_EVERY_MS` (four hours) by default. */
  everyMs?: number
  now?: () => Date
}

export interface ConsolidationLoop {
  start(): void
  /** Stops after the run in hand, if any. */
  stop(): Promise<void>
  /** Runs every workspace whose run is due, one at a time. For tests. */
  tick(): Promise<RunOutcome[]>
}

/**
 * Background consolidation, behind the enrichment settings: every
 * `intervalMs`, follows each finished enrichment run with one consolidation
 * run over its workspace, and runs each workspace no run has started on for
 * `everyMs` (four hours by default), one workspace at a time. Its AI spend is the
 * enrichment job's - the same actor, inside the same monthly limit - and stops
 * at the org's cap before that.
 */
export function consolidationLoop(options: ConsolidationLoopOptions): ConsolidationLoop {
  const now = options.now ?? (() => new Date())
  const intervalMs = options.intervalMs ?? 60_000
  const everyMs = options.everyMs ?? CONSOLIDATION_EVERY_MS
  let timer: NodeJS.Timeout | undefined
  let current: Promise<unknown> = Promise.resolve()
  let stopping = false

  const withOrg =
    (orgId: string) =>
    async <T>(fn: (ctx: StoreContext) => Promise<T>): Promise<T> => {
      const keys = await options.keyring.forOrg(orgId)
      return options.router.withTenant(orgId, (tx) => fn({ tx, keys }))
    }

  const { embedder } = options
  const embed =
    embedder &&
    (async (texts: string[]): Promise<number[][]> => {
      const response = await fetch(new URL('/api/embed', embedder.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: embedder.model, input: texts }),
      })
      if (!response.ok) throw new Error(`the embedder answered ${response.status}`)
      return ((await response.json()) as { embeddings: number[][] }).embeddings
    })

  async function runOne(orgId: string, workspaceId: string): Promise<RunOutcome | null> {
    const inOrg = withOrg(orgId)
    const started = await inOrg(async (ctx) => {
      const run = await startRun(ctx.tx, workspaceId, now(), { now: now(), everyMs })
      return run ? { run, settings: await enrichmentSettings(ctx.tx, workspaceId) } : null
    })
    if (!started) return null
    const actor = enrichmentAiActor(workspaceId)
    const monthSpent = () => options.router.withPlatform((tx) => actorMonthSpend(tx, orgId, actor, monthOf(now())))
    let runSpent = 0
    let answeredBy = ''
    const spent = async () => runSpent
    const { ai } = options
    const model =
      ai &&
      meteredModel(
        ai,
        orgId,
        {
          workspaceId,
          actor,
          onUsage: (call) => {
            runSpent += call.costUsd
            answeredBy = call.model
          },
        },
        'cypher',
        'enrichment',
      )
    const summarizer: Summarizer | null = model && {
      async beforeCall() {
        const used = await monthSpent()
        if (used >= started.settings.monthlyLimitUsd) throw new EnrichmentLimitReached(used, started.settings.monthlyLimitUsd)
      },
      model: {
        async chat(messages, request) {
          const text = await model.chat(messages, request)
          return { text, model: answeredBy }
        },
      },
    }
    const outcome = await runConsolidation({ withOrg: inOrg, summarizer, spent, ...(embed ? { embed } : {}), now }, { id: started.run.id, orgId, workspaceId })
    const line = `consolidation org=${orgId} workspace=${workspaceId} run=${started.run.id} status=${outcome.status} summarized=${outcome.summary?.summarized ?? 0} superseded-records=${outcome.summary?.contradictions?.superseded ?? 0} proposed=${outcome.summary?.contradictions?.proposed ?? 0} failed=${outcome.summary?.failed ?? 0} cost=$${outcome.costUsd.toFixed(4)}`
    if (outcome.error) options.log.error(`${line}: ${outcome.error}`)
    else options.log.info(line)
    return outcome
  }

  async function tick(): Promise<RunOutcome[]> {
    const outcomes: RunOutcome[] = []
    for (const orgId of await activeOrgs(options.router)) {
      if (stopping) break
      try {
        const due = await options.router.withTenant(orgId, async (tx) => {
          const stale = await failStaleRuns(tx, now())
          if (stale) options.log.error(`consolidation org=${orgId}: ${stale} run(s) left running by a stopped worker marked failed`)
          return dueWorkspaces(tx, { now: now(), everyMs })
        })
        for (const workspaceId of due) {
          if (stopping) break
          const outcome = await runOne(orgId, workspaceId)
          if (outcome) outcomes.push(outcome)
        }
      } catch (error) {
        options.log.error(`consolidation org=${orgId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return outcomes
  }

  const schedule = () => {
    if (stopping) return
    timer = setTimeout(() => {
      current = tick()
        .catch((error: unknown) => options.log.error(`consolidation: ${String(error)}`))
        .finally(schedule)
    }, intervalMs)
  }

  return {
    start: schedule,
    async stop() {
      stopping = true
      clearTimeout(timer)
      await current
    },
    tick,
  }
}
