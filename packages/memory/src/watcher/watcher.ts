import { rm, writeFile } from 'node:fs/promises'
import { join, matchesGlob, relative, resolve, sep } from 'node:path'
import { watch as chokidarWatch } from 'chokidar'

import type { ResolvedConfig } from '../config/config.js'
import { createDebouncer } from './debounce.js'

export interface SourceWatcherHandlers {
  /** A watched source file needs re-inspecting. Absolute path. */
  onSource(absolutePath: string): void | Promise<void>
  /** The ontology registry needs re-inspecting (spec §37). */
  onOntology(): void | Promise<void>
  /**
   * Events are now being delivered. Anything that changed before then produced
   * no event, so the whole tree needs one more pass (issue #10).
   */
  onCatchUp(): void | Promise<void>
  /** Anything thrown by a handler, or by chokidar itself. */
  onError(cause: unknown): void
}

export interface SourceWatcher {
  /** Stops watching and waits for the reconciliation in flight, if any. */
  close(): Promise<void>
  /**
   * Resolves once every reconciliation already queued has finished. Changes
   * still inside their debounce window are not queued yet, so are not waited on.
   */
  idle(): Promise<void>
}

/** Path relative to the memory root, always posix-separated, as globs are written. */
const relativeToRoot = (memoryRoot: string, absolute: string): string =>
  relative(memoryRoot, absolute).split(sep).join('/')

/**
 * A pattern excluding everything below a directory also prunes the directory
 * itself: `.index/**` never matches `.index`, but there is no point walking it.
 */
const directoryForm = (pattern: string): string =>
  pattern.replace(/\/\*\*(\/\*)?$/, '')

const isExcluded = (resolved: ResolvedConfig, absolute: string): boolean => {
  if (absolute === resolved.ontologyPath) return false
  const path = relativeToRoot(resolved.memoryRoot, absolute)
  if (path === '' || path.startsWith('..')) return false
  return resolved.config.source.exclude.some(
    (pattern) =>
      matchesGlob(path, pattern) || matchesGlob(path, directoryForm(pattern))
  )
}

const isSourceFile = (resolved: ResolvedConfig, absolute: string): boolean => {
  const path = relativeToRoot(resolved.memoryRoot, absolute)
  if (path.startsWith('..')) return false
  return (
    !isExcluded(resolved, absolute) &&
    resolved.config.source.include.some((pattern) => matchesGlob(path, pattern))
  )
}

/** How long to wait for the probe's event before assuming delivery has started anyway. */
const PROBE_TIMEOUT_MS = 2_000

/**
 * Watch the source root and the ontology file (spec §35, §37).
 *
 * Chokidar's event names are deliberately not exposed: `unlink` is not
 * "resource deleted" and `change` is not "resource updated", because an atomic
 * save unlinks and recreates the same path. Every event is only a hint that a
 * path is dirty - the handler re-reads the filesystem and decides what actually
 * happened. Debouncing per path is what collapses that save dance into one pass.
 *
 * Reconciliations are serialized: projections rewrite whole files, so two
 * overlapping passes would race each other.
 */
export const watchSource = async (
  resolved: ResolvedConfig,
  handlers: SourceWatcherHandlers
): Promise<SourceWatcher> => {
  let queue: Promise<void> = Promise.resolve()

  const debouncer = createDebouncer(
    resolved.config.watch.debounceMs,
    (path) => {
      queue = queue
        .then(() =>
          path === resolved.ontologyPath
            ? handlers.onOntology()
            : handlers.onSource(path)
        )
        .catch(handlers.onError)
    }
  )

  // The ontology normally lives inside the source root, and adding it as a
  // second watch path only duplicates the walk.
  const roots = [resolved.memoryRoot]
  if (relativeToRoot(resolved.memoryRoot, resolved.ontologyPath).startsWith('..')) {
    roots.push(resolved.ontologyPath)
  }

  const watcher = chokidarWatch(roots, {
    // The caller syncs the whole tree before watching, so replaying the initial
    // walk as events would only reconcile everything a second time.
    ignoreInitial: true,
    ignored: (path) => isExcluded(resolved, resolve(path))
  })

  const dirty = (path: string): void => {
    const absolute = resolve(path)
    if (absolute === resolved.ontologyPath || isSourceFile(resolved, absolute)) {
      debouncer.schedule(absolute)
    }
  }

  for (const event of ['add', 'change', 'unlink'] as const) {
    watcher.on(event, dirty)
  }
  watcher.on('error', handlers.onError)

  // Until the initial walk finishes chokidar has not registered the existing
  // tree, and a file created in that window is silently treated as pre-existing.
  await new Promise<void>((done) => watcher.once('ready', done))

  // `ready` only means chokidar's own walk finished. On macOS the OS watch can
  // take a moment longer to start delivering, and a change in that window
  // produces no event at all. Write a throwaway file and wait to hear about it,
  // then catch up on anything that slipped through before events were flowing.
  // It is a dotfile outside `include`, so it never reaches a handler.
  const probe = join(resolved.memoryRoot, `.watch-probe-${process.pid}`)
  let timeout: NodeJS.Timeout | undefined
  const delivering = new Promise<void>((done) => {
    const heard = (path: string): void => {
      if (resolve(path) !== probe) return
      watcher.off('add', heard)
      done()
    }
    watcher.on('add', heard)
    timeout = setTimeout(() => {
      watcher.off('add', heard)
      done()
    }, PROBE_TIMEOUT_MS)
  })
  try {
    await writeFile(probe, '')
    await delivering
  } finally {
    clearTimeout(timeout)
    await rm(probe, { force: true })
  }
  queue = queue.then(() => handlers.onCatchUp()).catch(handlers.onError)
  await queue

  return {
    idle: () => queue,
    async close() {
      debouncer.cancel()
      await watcher.close()
      await queue
    }
  }
}
