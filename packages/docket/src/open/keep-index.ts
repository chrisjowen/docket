import type { ResolvedConfig } from '../config/config.js'
import { watchSource } from '../watcher/watcher.js'
import { SyncBusyError, type SyncRunner } from './sync-run.js'
import type { UiSyncRun } from './types.js'

export interface IndexKeeper {
  /** Stops watching and waits for the catch-up in flight, if any. */
  close(): Promise<void>
  /** Resolves once no catch-up is queued or running. */
  idle(): Promise<void>
}

export interface KeepIndexOptions {
  /** Told of each sync the keeper ran, once it finished. */
  onRun?: ((run: UiSyncRun) => void) | undefined
  /** Anything that went wrong watching or syncing. */
  onError?: ((cause: unknown) => void) | undefined
}

/**
 * `docket open --watch`: syncs every instance enabled for projection that is
 * missing or behind the files - at once, so a fresh clone whose generated
 * index was never built does not serve empty searches - and again whenever a
 * source file or the ontology changes. Each catch-up is the UI's own sync
 * (`runner`), so the page shows it as it runs, a sync the page started is
 * waited for rather than raced, and only the instances that lag are synced:
 * one that is current is not opened at all. An instance that fails to sync
 * fails that run alone, as `docket sync` does, and is tried again on the next
 * change.
 */
export const keepIndex = async (resolved: ResolvedConfig, runner: SyncRunner, options: KeepIndexOptions = {}): Promise<IndexKeeper> => {
  const onError = options.onError ?? (() => undefined)
  let closed = false
  let wanted = false
  let active: Promise<void> | null = null

  const catchUp = async (): Promise<void> => {
    while (wanted && !closed) {
      wanted = false
      await runner.settled()
      const stale = (await runner.status()).adapters.filter((adapter) => adapter.state !== 'current').map((adapter) => adapter.id)
      if (stale.length === 0 || closed) continue
      try {
        runner.start(stale)
      } catch (cause) {
        // The page started one between the two: wait for it, then look again.
        if (!(cause instanceof SyncBusyError)) throw cause
        wanted = true
        continue
      }
      await runner.settled()
      const run = runner.current
      if (run) options.onRun?.(run)
    }
  }

  const schedule = (): void => {
    wanted = true
    active ??= catchUp()
      .catch(onError)
      .finally(() => {
        active = null
        // A change that arrived as the last pass was finishing.
        if (wanted && !closed) schedule()
      })
  }

  schedule()
  const watcher = await watchSource(resolved, {
    onSource: schedule,
    onOntology: schedule,
    onCatchUp: schedule,
    onError
  })

  const idle = async (): Promise<void> => {
    await watcher.idle()
    while (active) await active
  }

  return {
    idle,
    async close() {
      closed = true
      await watcher.close()
      while (active) await active
    }
  }
}
