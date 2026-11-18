import { rebuild } from '../commands/rebuild.js'
import { sync, type SyncOptions, type SyncResult } from '../commands/sync.js'
import { SyncBusyError, SyncRunner } from '../open/sync-run.js'
import type { UiSyncRun } from '../open/types.js'

/*
 * Keeps a project's projections up to its files for a server that writes to
 * them (`docket serve`): `docket sync` after each write, one at a time, a
 * write that lands while one runs bringing on another, and on an interval
 * too, for files changed beside the server. A rebuild resets every instance
 * and projects everything again (`docket rebuild`).
 */

export interface ProjectIndexerOptions {
  /** The project's directory. */
  cwd: string
  /** How often to sync whatever changed beside the server; 0 never. Default 60 s. */
  intervalMs?: number | undefined
  /** What runs a sync and a rebuild: docket's own by default; tests stand in their own. */
  runSync?: ((options: SyncOptions) => Promise<SyncResult>) | undefined
  runRebuild?: ((options: SyncOptions) => Promise<SyncResult>) | undefined
}

export class ProjectIndexer {
  /** Runs the syncs, and reports the latest and how each instance stands (`GET /api/sync`). */
  readonly runner: SyncRunner
  #wanted = false
  #fresh = false
  #draining: Promise<void> | null = null
  #timer: NodeJS.Timeout | null = null

  constructor(options: ProjectIndexerOptions) {
    const runSync = options.runSync ?? sync
    const runRebuild = options.runRebuild ?? rebuild
    this.runner = new SyncRunner(options.cwd, (syncOptions) => {
      if (!this.#fresh) return runSync(syncOptions)
      this.#fresh = false
      return runRebuild(syncOptions)
    })
    const intervalMs = options.intervalMs ?? 60_000
    if (intervalMs > 0) {
      this.#timer = setInterval(() => this.kick(), intervalMs)
      this.#timer.unref()
    }
  }

  /** Brings the projections up to the files soon: now, or once the sync running finishes. */
  kick(): void {
    this.#wanted = true
    this.#draining ??= this.#drain().finally(() => {
      this.#draining = null
    })
  }

  async #drain(): Promise<void> {
    while (this.#wanted) {
      this.#wanted = false
      await this.runner.settled()
      try {
        this.runner.start(null)
      } catch (cause) {
        if (!(cause instanceof SyncBusyError)) throw cause
        this.#wanted = true
        continue
      }
      await this.runner.settled()
    }
  }

  /** Resolves once every write so far is projected (or its sync has failed). */
  async idle(): Promise<UiSyncRun | null> {
    while (this.#draining) await this.#draining
    await this.runner.settled()
    return this.runner.current
  }

  /** Resets every instance and projects everything again, after any sync running; the run, once done. */
  async rebuild(): Promise<UiSyncRun | null> {
    await this.idle()
    this.#fresh = true
    this.kick()
    return this.idle()
  }

  /** Stops syncing on the interval, and waits for a sync running to finish. */
  async close(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
    await this.idle()
  }
}
