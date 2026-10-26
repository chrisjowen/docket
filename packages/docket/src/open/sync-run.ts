import { randomUUID } from 'node:crypto'

import { openDocket } from '../adapters/docket.js'
import { failureOf, sync, SyncError, type SyncOptions, type SyncResult } from '../commands/sync.js'
import { loadAdapterManifests } from '../manifest/state.js'
import type { PassReport } from '../projection/manager.js'
import { freshnessOf } from '../query/freshness.js'
import { takeSnapshot } from '../query/snapshot.js'
import { readSyncHistory } from '../sync/history.js'
import type { UiSyncAdapterResult, UiSyncRun, UiSyncStatus, UiSyncTarget } from './types.js'

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/** A sync is already running: only one runs at a time. */
export class SyncBusyError extends Error {
  constructor(readonly run: UiSyncRun) {
    super(`A sync is already running - started at ${run.startedAt}. Wait for it to finish.`)
    this.name = 'SyncBusyError'
  }
}

const resultOf = (report: PassReport): UiSyncAdapterResult => {
  const failed = report.error !== undefined || report.failed.length > 0
  return {
    id: report.id,
    state: failed ? 'failed' : 'synced',
    projected: report.upserted.length,
    removed: report.removed.length,
    unchanged: report.unchanged,
    failed: report.failed.length,
    ...(failed ? { error: failureOf(report) } : {})
  }
}

const waiting = (id: string): UiSyncAdapterResult => ({ id, state: 'waiting', projected: 0, removed: 0, unchanged: 0, failed: 0 })

/** Why nothing was projected, when the files themselves stopped it. */
const blocked = (result: SyncResult): string | undefined => {
  if (result.adapters.length > 0) return undefined
  const error = result.diagnostics.find((diagnostic) => diagnostic.severity === 'error' && diagnostic.path === undefined)
  return error ? `Nothing was synced: ${error.message}` : undefined
}

/**
 * Runs `docket sync` for the UI - the CLI's own `sync()`, not a copy - one
 * at a time, keeping the latest run and how far it has got so the page can
 * poll it.
 */
export class SyncRunner {
  #run: UiSyncRun | null = null
  #settled: Promise<void> = Promise.resolve()

  constructor(
    private readonly cwd: string,
    private readonly runSync: (options: SyncOptions) => Promise<SyncResult> = sync
  ) {}

  /** The running sync, or the last one; a copy, so callers cannot change it. */
  get current(): UiSyncRun | null {
    return this.#run === null ? null : structuredClone(this.#run)
  }

  /** Resolves once no sync is running. */
  settled(): Promise<void> {
    return this.#settled
  }

  /** Starts a sync of `adapters` (every instance enabled for projection when null). Throws `SyncBusyError` while one runs. */
  start(adapters: string[] | null): UiSyncRun {
    if (this.#run?.state === 'running') throw new SyncBusyError(structuredClone(this.#run))
    const run: UiSyncRun = {
      id: randomUUID(),
      state: 'running',
      adapters,
      startedAt: new Date().toISOString(),
      stage: 'validating',
      results: [],
      fileErrors: 0
    }
    this.#run = run
    this.#settled = this.#execute(run)
    return structuredClone(run)
  }

  async #execute(run: UiSyncRun): Promise<void> {
    const finish = (result: SyncResult | undefined, error: string | undefined): void => {
      if (result) {
        run.results = result.adapters.map(resultOf)
        run.fileErrors = new Set(result.diagnostics.filter((d) => d.severity === 'error' && d.path).map((d) => d.path)).size
      }
      const reason = error ?? (result ? blocked(result) : undefined)
      run.state = reason === undefined && run.results.every((entry) => entry.state === 'synced') ? 'succeeded' : 'failed'
      if (reason !== undefined) run.error = reason
      run.finishedAt = new Date().toISOString()
      delete run.stage
    }

    try {
      const result = await this.runSync({
        cwd: this.cwd,
        adapters: run.adapters ?? undefined,
        onProgress: (progress) => {
          if (progress.stage === 'synced') {
            run.results = run.results.map((entry) => (entry.id === progress.report.id ? resultOf(progress.report) : entry))
            return
          }
          run.stage = progress.stage
          if (progress.stage === 'projecting') run.results = progress.adapters.map(waiting)
        }
      })
      finish(result, undefined)
    } catch (cause) {
      if (cause instanceof SyncError) {
        const failing = cause.result.adapters.filter((report) => report.error !== undefined || report.failed.length > 0)
        finish(cause.result, `${failing.map((report) => report.id).join(', ')} did not fully sync; the others did.`)
      } else {
        finish(undefined, messageOf(cause))
      }
    }
  }
}

/**
 * Each instance enabled for projection: how far it lags the files - read from
 * its manifest without connecting to it - and when it last synced in full.
 */
export const syncStatus = async (cwd: string, run: UiSyncRun | null): Promise<UiSyncStatus> => {
  const snapshot = await takeSnapshot(cwd)
  const history = await readSyncHistory(snapshot.resolved)
  const syncedAt = (id: string): { lastSyncedAt?: string } => {
    const at = history.adapters[id]?.syncedAt
    return at === undefined ? {} : { lastSyncedAt: at }
  }

  let adapters: UiSyncTarget[]
  let error: string | undefined
  try {
    const docket = await openDocket(snapshot.resolved, { canonical: snapshot.reader })
    const projected = docket.adapters.filter((slot) => slot.roles.includes('projection'))
    const manifests = await loadAdapterManifests(snapshot.resolved, projected, {
      legacyFingerprint: docket.projectionsFingerprint,
      configured: projected.map((slot) => slot.id)
    })
    const freshness = await freshnessOf(docket, snapshot, projected)
    adapters = projected.map((slot): UiSyncTarget => {
      const fresh = freshness.get(slot.id)
      if (manifests.get(slot.id)?.reset) return { id: slot.id, state: 'unsynced', ...syncedAt(slot.id) }
      if (fresh?.state === 'behind') return { id: slot.id, state: 'behind', behind: fresh.behind ?? 0, ...syncedAt(slot.id) }
      return { id: slot.id, state: fresh?.state === 'current' ? 'current' : 'unknown', ...syncedAt(slot.id) }
    })
  } catch (cause) {
    // An adapter module that cannot load: still list every instance, saying why.
    error = `The adapters could not be loaded: ${messageOf(cause)}`
    adapters = snapshot.resolved.config.adapters
      .filter((adapter) => adapter.roles.includes('projection'))
      .map((adapter) => ({ id: adapter.id, state: 'unknown', ...syncedAt(adapter.id) }))
  }

  const times = adapters.flatMap((adapter) => (adapter.lastSyncedAt === undefined ? [] : [adapter.lastSyncedAt])).sort()
  const latest = times[times.length - 1]
  return {
    run,
    adapters,
    outOfDate: adapters.some((adapter) => adapter.state === 'behind' || adapter.state === 'unsynced'),
    ...(latest !== undefined ? { lastSyncedAt: latest } : {}),
    ...(error !== undefined ? { error } : {})
  }
}
