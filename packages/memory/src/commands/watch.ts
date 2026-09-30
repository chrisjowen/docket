import type { ResolvedConfig } from '../config/config.js'
import { loadConfig } from '../config/loader.js'
import { error } from '../model/diagnostic.js'
import { ProjectionManager } from '../projection/manager.js'
import { createProjections } from '../projection/registry.js'
import {
  createReconciler,
  stateRootOf,
  type WatchEvent,
  type WatchReporter
} from '../watcher/reconciler.js'
import { watchSource } from '../watcher/watcher.js'

export interface WatchOptions {
  /** Directory to resolve `.memory.yaml` from. Defaults to the cwd. */
  cwd?: string | undefined
  /** Where events go. Defaults to `consoleReporter`. */
  report?: WatchReporter | undefined
  /** Aborting stops the watcher, same as calling `close()`. */
  signal?: AbortSignal | undefined
}

export interface WatchHandle {
  resolved: ResolvedConfig
  /** Idempotent. Resolves once watching has stopped and projections are closed. */
  close(): Promise<void>
}

/**
 * Minimal stdout reporter so `memory watch` is usable on its own (spec §34).
 * The CLI passes its own - formatting is Track E's.
 */
export const consoleReporter: WatchReporter = (event) => {
  switch (event.kind) {
    case 'added':
    case 'updated':
    case 'removed':
      console.log(`✓ ${event.id} ${event.kind}`)
      break
    case 'ontology-reloaded':
      console.log('✓ ontology reloaded')
      break
    case 'diagnostics':
      for (const diagnostic of event.diagnostics) {
        const where = diagnostic.path ? ` ${diagnostic.path}` : ''
        console.error(
          `${diagnostic.severity.toUpperCase()}${where} ${diagnostic.message}`
        )
      }
      break
  }
}

/**
 * Run the foreground watcher (spec §34). Syncs the whole source root first so
 * the index is already correct when the first event arrives, then keeps it that
 * way. Long-running: the returned handle is the only way it stops.
 */
export const watch = async (
  options: WatchOptions = {}
): Promise<WatchHandle> => {
  const resolved = await loadConfig(options.cwd)
  const report = options.report ?? consoleReporter

  const manager = new ProjectionManager(
    createProjections(resolved.config.projections)
  )
  await manager.init({
    projectRoot: resolved.projectRoot,
    memoryRoot: resolved.memoryRoot,
    stateRoot: stateRootOf(resolved)
  })

  const reconciler = createReconciler(resolved, manager, report)
  await reconciler.sync()

  const fail = (cause: unknown): void => {
    const event: WatchEvent = {
      kind: 'diagnostics',
      diagnostics: [
        error(
          'watch-failure',
          cause instanceof Error ? cause.message : String(cause)
        )
      ]
    }
    report(event)
  }

  const watcher = await watchSource(resolved, {
    onSource: (path) => reconciler.reconcile(path),
    onOntology: () => reconciler.reconcileOntology(),
    onError: fail
  })

  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    closing ??= watcher.close().then(() => manager.close())
    return closing
  }

  options.signal?.addEventListener('abort', () => void close(), { once: true })

  return { resolved, close }
}
