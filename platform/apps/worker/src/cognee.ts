// SPDX-License-Identifier: AGPL-3.0-only
import type { CanonicalInput, CanonicalReader, InputKind, MemoryAdapter } from '@chrisjowen/docket/contracts'
import { canonicalState } from '@chrisjowen/docket/sync/inputs'
import { AiCapReached, actorMonthSpend, monthOf, spaceOfDocket, type AiDeps } from '@docket/platform-ai'
import { redactSecrets } from '@docket/platform-audit'
import {
  COGNEE,
  cogneeAiActor,
  cogneeSettings,
  cogneeWork,
  forgetCognee,
  markCogneeProjected,
  postgresManifests,
  postgresSource,
  recordSyncRun,
  validate,
  type Keyring,
  type SyncTrigger,
} from '@docket/platform-canonical-store'
import { cogneeCognifying, cogneeFingerprint, openCognee, type CogneeAccess, type OpenCogneeOptions } from '@docket/platform-projections'
import { workspaceScope, type TenantRouter } from '@docket/platform-tenancy'

import { currentLease, leaseKeeper, StaleCognify, type HeldLease, type LeaseKeeper } from './cognify-lease.js'
import { activeOrgs, type Logger } from './outbox.js'
import { messageOf, projectInstance, recordStatus, type InstanceReport } from './reconcile.js'

export interface CogneeLoopOptions {
  router: TenantRouter
  keyring: Keyring
  /** The platform's cognee service. */
  access: CogneeAccess
  /** The org's metered, capped AI; null when AI is off or the platform has no OpenRouter key of its own, and cognee then waits: cognify needs a model. */
  ai: AiDeps | null
  log: Logger
  /** How often to look for a workspace whose cognee is behind. */
  intervalMs?: number
  /** The cognify lease its passes and clears hold; `cogneeLeases` on the service by default. */
  leases?: LeaseKeeper
  now?: () => Date
  /** Opens docket's cognee adapter. Tests pass their own. */
  open?(options: OpenCogneeOptions): Promise<MemoryAdapter>
}

export interface CogneeLoop {
  start(): void
  /** Stops after the pass in hand, if any. */
  stop(): Promise<void>
  /** Clears and projects every workspace that needs it, one at a time. For tests. */
  tick(): Promise<CogneePass[]>
}

export interface CogneePass {
  orgId: string
  workspaceId: string
  /** `skipped`: another cognify held the lease, so the pass waits for the next tick. */
  outcome: 'ok' | 'failed' | 'skipped' | 'cleared'
  report?: InstanceReport
}

/** The canonical records a pass read, as docket's `CanonicalReader`: what the adapter re-files links and resolves hits by. */
export function readerOf(inputs: readonly { input: CanonicalInput }[]): CanonicalReader {
  const byKey = new Map(inputs.map(({ input }) => [`${input.kind}\u0000${input.id}`, input]))
  return {
    get: async (kind, id) => byKey.get(`${kind}\u0000${id}`),
    list: async (kind: InputKind) => inputs.map(({ input }) => input).filter((input) => input.kind === kind),
  }
}

const EMPTY: CanonicalReader = { get: async () => undefined, list: async () => [] }

/**
 * The cognify lease on the platform's cognee service: a hold lasts the
 * adapter's cognify timeout and ten minutes more, renewed before each batch,
 * and once it lapses it is given up only when cognee says the holder's
 * dataset is no longer cognifying.
 */
export function cogneeLeases(options: { router: TenantRouter; access: CogneeAccess; now?: () => Date; leaseMs?: number; stuckAfterMs?: number }): LeaseKeeper {
  const { access } = options
  return leaseKeeper({
    router: options.router,
    leaseMs: options.leaseMs ?? (access.cognifyTimeoutMs ?? 3_600_000) + 10 * 60_000,
    ...(options.stuckAfterMs !== undefined ? { stuckAfterMs: options.stuckAfterMs } : {}),
    now: options.now ?? (() => new Date()),
    cognifying: (orgId, workspaceId) => cogneeCognifying(access, orgId, workspaceId),
  })
}

/** The cognify lease is held by another workspace's cognify, so what needs it waits; `halted` when that cognify is stuck. */
export class CognifyLeaseHeld extends Error {
  override name = 'CognifyLeaseHeld'
  constructor(
    message: string,
    readonly halted: boolean,
  ) {
    super(message)
  }
}

/**
 * Why a workspace waits on another's stuck cognify, if it does. Nothing tells
 * cognee's model calls apart by dataset, so no other cognify may run beside
 * it; every workspace waiting says so on Settings → Sync.
 */
async function haltedBy(router: TenantRouter, orgId: string, workspaceId: string): Promise<string | null> {
  const held = await router.withPlatform((tx) => currentLease(tx))
  if (!held?.stuckAt || (held.orgId === orgId && held.workspaceId === workspaceId)) return null
  return "cognee is halted for every workspace: another workspace's cognify has run on in cognee for hours after its pass, and no other may run beside it until a platform operator releases it (docs/cognee.md)"
}

/**
 * Opens a workspace's cognee to clear what it filed, holding the cognify
 * lease until it is closed: no cognify of the workspace runs on while its
 * items are deleted, and none starts until they are. Throws
 * `CognifyLeaseHeld` while another holds it.
 */
export async function openCogneeToClear(
  leases: LeaseKeeper,
  options: { router: TenantRouter; orgId: string; workspaceId: string; access: CogneeAccess; open?(options: OpenCogneeOptions): Promise<MemoryAdapter> },
): Promise<MemoryAdapter> {
  const { orgId, workspaceId, access } = options
  const held = await leases.takeToClear({ orgId, workspaceId })
  if (!held) {
    const halted = await haltedBy(options.router, orgId, workspaceId)
    throw new CognifyLeaseHeld(halted ?? "another cognify holds the cognify lease, so clearing this workspace's cognee waits for it", halted !== null)
  }
  let adapter: MemoryAdapter
  try {
    adapter = await (options.open ?? openCognee)({ orgId, workspaceId, access, canonical: EMPTY })
  } catch (cause) {
    await held.release()
    throw cause
  }
  return {
    ...adapter,
    close: async () => {
      try {
        await adapter.close()
      } finally {
        await held.release()
      }
    },
  }
}

/** The adapter with the lease renewed before each batch it applies. */
function renewing(adapter: MemoryAdapter, held: HeldLease): MemoryAdapter {
  const port = adapter.projection
  if (!port) return adapter
  return {
    ...adapter,
    projection: {
      ...port,
      apply: async (batch, signal) => {
        await held.renew()
        return port.apply(batch, signal)
      },
    },
  }
}

/**
 * The cognee pass (off unless a workspace turns cognee on): every
 * `intervalMs`, each workspace whose documents moved past what cognee holds
 * is projected into its cognee dataset by docket's cognee adapter, which
 * cognifies what it filed. It runs apart from the fixed projections' pass -
 * its own manifest, status and backoff - so however long cognify takes, or
 * however often it fails, writes and the other stores carry on.
 *
 * Cognify runs a model over every new entity, so a pass starts only while
 * the org's AI is on, under its cap and the workspace's own cognee limit, and
 * holds the cognify lease the gateway bills cognee's model calls to. A pass
 * refused for any of those is a failed pass, retried with backoff and shown
 * on Settings → Sync with why; one waiting for another org's cognify is not,
 * unless that cognify is stuck, when every waiting workspace shows it.
 * A workspace that turned cognee off has what it filed cleared.
 */
export function cogneeLoop(options: CogneeLoopOptions): CogneeLoop {
  const now = options.now ?? (() => new Date())
  const intervalMs = options.intervalMs ?? 60_000
  const open = options.open ?? openCognee
  const { router, access } = options
  const leases = options.leases ?? cogneeLeases({ router, access, now })
  let timer: NodeJS.Timeout | undefined
  let current: Promise<unknown> = Promise.resolve()
  let stopping = false

  /** Why cognify may not spend now, if it may not. */
  async function refusal(orgId: string, workspaceId: string, limitUsd: number): Promise<string | null> {
    const { ai } = options
    if (!ai) return "AI is not set up on this server: cognee cognifies on the platform's own OpenRouter key, which is not configured, so it waits"
    try {
      await ai.caps.assertWithinCap(orgId, { spaceId: await router.withPlatform((tx) => spaceOfDocket(tx, orgId, workspaceId)) })
    } catch (cause) {
      if (cause instanceof AiCapReached) {
        return cause.spaceId
          ? "The space's AI budget for this month is spent, so cognee waits; search still works"
          : "The org's AI budget for this month is spent, so cognee waits; search still works"
      }
      throw cause
    }
    const spent = await router.withPlatform((tx) => actorMonthSpend(tx, orgId, cogneeAiActor(workspaceId), monthOf(now())))
    if (spent >= limitUsd) return `cognee's monthly AI limit of $${limitUsd.toFixed(2)} is spent, so it waits for next month or a higher limit`
    return null
  }

  async function record(orgId: string, workspaceId: string, startedAt: Date, report: InstanceReport, triggers: SyncTrigger[], done: { upTo: number; rebuild: number | null } | null) {
    const ok = report.error === undefined && report.failed === 0
    await router.withTenant(orgId, async (tx) => {
      const at = now()
      await recordStatus(tx, workspaceId, report, ok && report.reset ? (done?.rebuild ?? null) : null, at)
      if (ok && done) await markCogneeProjected(tx, workspaceId, done.upTo)
      await recordSyncRun(tx, {
        workspaceId,
        startedAt,
        finishedAt: at,
        triggers,
        ok,
        instances: [
          {
            id: COGNEE,
            applied: report.applied,
            failed: report.failed,
            reset: report.reset,
            ...(report.error !== undefined ? { error: redactSecrets(report.error) } : {}),
            upserts: report.changes.upserts,
            deletes: report.changes.deletes,
            changes: report.changes.named,
          },
        ],
      })
    })
  }

  async function project(orgId: string, workspaceId: string, upTo: number): Promise<CogneePass> {
    const startedAt = now()
    const keys = await options.keyring.forOrg(orgId)
    const read = await router.withTenant(orgId, async (tx) => {
      const settings = await cogneeSettings(tx, workspaceId)
      const outbox = await tx.query<{ kinds: SyncTrigger[] | null; rebuild: string | null }>(
        `SELECT array_agg(DISTINCT kind ORDER BY kind) AS kinds, max(seq) FILTER (WHERE kind = 'rebuild') AS rebuild
           FROM outbox WHERE workspace_id = $1 AND seq > $2 AND seq <= $3`,
        [workspaceId, settings.projectedThrough ?? 0, upTo],
      )
      const status = await tx.query<{ rebuilt_through: string | null }>(
        'SELECT rebuilt_through FROM projection_status WHERE workspace_id = $1 AND instance_id = $2',
        [workspaceId, COGNEE],
      )
      const rebuild = outbox.rows[0]?.rebuild ? Number(outbox.rows[0].rebuild) : null
      const owesRebuild = rebuild !== null && Number(status.rows[0]?.rebuilt_through ?? 0) < rebuild
      return { settings, triggers: outbox.rows[0]?.kinds ?? [], rebuild, owesRebuild }
    })
    const blank: InstanceReport = { id: COGNEE, applied: 0, failed: 0, reset: false, checkpoint: null, changes: { upserts: 0, deletes: 0, named: [] } }

    const refused = await refusal(orgId, workspaceId, read.settings.monthlyLimitUsd)
    if (refused) {
      const report = { ...blank, error: refused }
      await record(orgId, workspaceId, startedAt, report, read.triggers, null)
      return { orgId, workspaceId, outcome: 'failed', report }
    }
    let held: HeldLease | null
    try {
      held = await leases.take({ orgId, workspaceId, monthlyLimitUsd: read.settings.monthlyLimitUsd })
    } catch (cause) {
      if (!(cause instanceof StaleCognify)) throw cause
      const report = { ...blank, error: cause.message }
      await record(orgId, workspaceId, startedAt, report, read.triggers, null)
      return { orgId, workspaceId, outcome: 'failed', report }
    }
    if (!held) {
      const halted = await haltedBy(router, orgId, workspaceId)
      if (!halted) return { orgId, workspaceId, outcome: 'skipped' }
      const report = { ...blank, error: halted }
      await record(orgId, workspaceId, startedAt, report, read.triggers, null)
      return { orgId, workspaceId, outcome: 'failed', report }
    }
    let report: InstanceReport
    try {
      const snap = await router.withTenant(orgId, async (tx) => {
        const validation = await validate({ source: postgresSource({ tx, keys }, workspaceId) })
        if (!validation.ontology) throw new Error(validation.diagnostics.find((d) => d.code.startsWith('ontology-'))?.message ?? 'no published ontology')
        return {
          state: canonicalState(validation.entities, validation.documents, workspaceScope(workspaceId)),
          broken: new Set(validation.diagnostics.flatMap((d) => (d.severity === 'error' && d.path !== undefined ? [d.path] : []))),
          loaded: await postgresManifests(tx, workspaceId).read(COGNEE),
        }
      })
      const canonical = readerOf(snap.state.inputs)
      const target = { id: COGNEE, fingerprint: cogneeFingerprint(orgId, workspaceId, access), loaded: snap.loaded, open: async () => renewing(await open({ orgId, workspaceId, access, canonical }), held) }
      report = (await projectInstance({ router }, orgId, workspaceId, target, snap, read.owesRebuild)).report
    } catch (cause) {
      report = { ...blank, error: messageOf(cause) }
    } finally {
      await held.release().catch((cause: unknown) => options.log.error(`cognee: returning the cognify lease: ${messageOf(cause)}`))
    }
    await record(orgId, workspaceId, startedAt, report, read.triggers, { upTo, rebuild: read.rebuild })
    const ok = report.error === undefined && report.failed === 0
    return { orgId, workspaceId, outcome: ok ? 'ok' : 'failed', report }
  }

  /** Deletes what cognee filed for a workspace that turned it off, then forgets its manifest and standing. */
  async function clear(orgId: string, workspaceId: string): Promise<CogneePass> {
    try {
      const adapter = await openCogneeToClear(leases, { router, orgId, workspaceId, access, open })
      try {
        await adapter.projection?.reset(workspaceScope(workspaceId))
      } finally {
        await adapter.close().catch(() => undefined)
      }
      await router.withTenant(orgId, (tx) => forgetCognee(tx, workspaceId))
      return { orgId, workspaceId, outcome: 'cleared' }
    } catch (cause) {
      if (cause instanceof CognifyLeaseHeld && !cause.halted) return { orgId, workspaceId, outcome: 'skipped' }
      const report = { id: COGNEE, applied: 0, failed: 0, reset: false, checkpoint: null, error: `clearing cognee after it was turned off: ${messageOf(cause)}`, changes: { upserts: 0, deletes: 0, named: [] } }
      await router.withTenant(orgId, (tx) => recordStatus(tx, workspaceId, report, null, now()))
      return { orgId, workspaceId, outcome: 'failed', report }
    }
  }

  async function tick(): Promise<CogneePass[]> {
    const passes: CogneePass[] = []
    for (const orgId of await activeOrgs(router)) {
      if (stopping) break
      try {
        const work = await router.withTenant(orgId, (tx) => cogneeWork(tx, now()))
        for (const workspaceId of work.clear) {
          if (stopping) break
          passes.push(await clear(orgId, workspaceId))
        }
        for (const { workspaceId, upTo } of work.due) {
          if (stopping) break
          const pass = await project(orgId, workspaceId, upTo)
          passes.push(pass)
          const line = `cognee org=${orgId} ws=${workspaceId} ${pass.outcome}${pass.report ? ` applied=${pass.report.applied} failed=${pass.report.failed}` : ''}`
          if (pass.outcome === 'failed') options.log.error(`${line}: ${redactSecrets(pass.report?.error ?? 'failed')}`)
          else options.log.info(line)
        }
      } catch (cause) {
        options.log.error(`cognee org=${orgId}: ${messageOf(cause)}`)
      }
    }
    return passes
  }

  const schedule = () => {
    if (stopping) return
    timer = setTimeout(() => {
      current = tick()
        .catch((cause: unknown) => options.log.error(`cognee: ${messageOf(cause)}`))
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
