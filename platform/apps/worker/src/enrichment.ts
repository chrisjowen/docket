// SPDX-License-Identifier: AGPL-3.0-only
import { actorMonthSpend, meteredModel, monthOf, type AiDeps } from '@docket/platform-ai'
import type { Keyring, StoreContext } from '@docket/platform-canonical-store'
import {
  EnrichmentLimitReached,
  dueWorkspaces,
  enrichmentAiActor,
  enrichmentSettings,
  failStaleRuns,
  runEnrichment,
  startRun,
  type Reviewer,
  type RunOutcome,
} from '@docket/platform-enrichment'
import type { TenantRouter } from '@docket/platform-tenancy'

import { activeOrgs, type Logger } from './outbox.js'

export interface EnrichmentLoopOptions {
  router: TenantRouter
  keyring: Keyring
  /** The org's metered, capped models; null when AI is off, and runs go by their rules alone. */
  ai: AiDeps | null
  log: Logger
  /** How often to look for a run that is due or asked for. */
  intervalMs?: number
  now?: () => Date
}

export interface EnrichmentLoop {
  start(): void
  /** Stops after the run in hand, if any. */
  stop(): Promise<void>
  /** Runs every workspace whose run is due, one at a time. For tests. */
  tick(): Promise<RunOutcome[]>
}

/**
 * Background enrichment (off unless a workspace turns it on): every
 * `intervalMs`, runs each workspace whose nightly or weekly run is due or
 * that someone asked to run, one at a time, so a run never competes with
 * reconciliation for more than one connection. A workspace's AI review stops
 * at its own monthly limit, and at the org's cap before that.
 */
export function enrichmentLoop(options: EnrichmentLoopOptions): EnrichmentLoop {
  const now = options.now ?? (() => new Date())
  const intervalMs = options.intervalMs ?? 60_000
  let timer: NodeJS.Timeout | undefined
  let current: Promise<unknown> = Promise.resolve()
  let stopping = false

  const withOrg =
    (orgId: string) =>
    async <T>(fn: (ctx: StoreContext) => Promise<T>): Promise<T> => {
      const keys = await options.keyring.forOrg(orgId)
      return options.router.withTenant(orgId, (tx) => fn({ tx, keys }))
    }

  async function runOne(orgId: string, workspaceId: string): Promise<RunOutcome | null> {
    const inOrg = withOrg(orgId)
    const started = await inOrg(async (ctx) => {
      const run = await startRun(ctx.tx, workspaceId, now())
      return run ? { run, settings: await enrichmentSettings(ctx.tx, workspaceId) } : null
    })
    if (!started) return null
    const actor = enrichmentAiActor(workspaceId)
    const monthSpent = () => options.router.withPlatform((tx) => actorMonthSpend(tx, orgId, actor, monthOf(now())))
    let runSpent = 0
    const spent = async () => runSpent
    const { ai } = options
    const reviewer: Reviewer | null = ai && {
      async beforeCall() {
        const used = await monthSpent()
        if (used >= started.settings.monthlyLimitUsd) throw new EnrichmentLimitReached(used, started.settings.monthlyLimitUsd)
      },
      model: meteredModel(ai, orgId, { workspaceId, actor, onUsage: (call) => void (runSpent += call.costUsd) }, 'cypher', 'enrichment'),
    }
    const outcome = await runEnrichment({ withOrg: inOrg, reviewer, spent, now }, { id: started.run.id, orgId, workspaceId })
    const written = outcome.summary ? Object.values(outcome.summary.written).reduce((sum, n) => sum + n, 0) : 0
    const line = `enrichment org=${orgId} workspace=${workspaceId} run=${started.run.id} ${started.run.trigger} status=${outcome.status} written=${written} cost=$${outcome.costUsd.toFixed(4)}`
    if (outcome.status === 'failed') options.log.error(`${line}: ${outcome.error ?? 'failed'}`)
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
          if (stale) options.log.error(`enrichment org=${orgId}: ${stale} run(s) left running by a stopped worker marked failed`)
          return dueWorkspaces(tx, now())
        })
        for (const workspaceId of due) {
          if (stopping) break
          const outcome = await runOne(orgId, workspaceId)
          if (outcome) outcomes.push(outcome)
        }
      } catch (error) {
        options.log.error(`enrichment org=${orgId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return outcomes
  }

  const schedule = () => {
    if (stopping) return
    timer = setTimeout(() => {
      current = tick()
        .catch((error: unknown) => options.log.error(`enrichment: ${String(error)}`))
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
