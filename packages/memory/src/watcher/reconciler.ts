import { readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import type { ResolvedConfig } from '../config/config.js'
import { readManifest } from '../manifest/manifest.js'
import { type Diagnostic, error, hasErrors } from '../model/diagnostic.js'
import type { MemoryDocument, Ontology } from '../model/index.js'
import { loadOntology } from '../ontology/loader.js'
import { validateDocuments } from '../ontology/validator.js'
import type { ProjectionManager } from '../projection/manager.js'
import { hashContent } from '../source/hashing.js'
import { parseMemoryFile } from '../source/parser.js'
import { scanSource } from '../source/scanner.js'

/**
 * What a reconciliation pass observed. Track E owns how any of this is
 * rendered - the reconciler never prints.
 */
export type WatchEvent =
  | { kind: 'added' | 'updated' | 'removed'; id: string; path: string }
  | { kind: 'ontology-reloaded' }
  /** Reported before the initial sync, so its output reads under the banner. */
  | { kind: 'watching'; root: string }
  | { kind: 'diagnostics'; diagnostics: Diagnostic[] }

export type WatchReporter = (event: WatchEvent) => void

export interface Reconciler {
  /** Reconcile one source path against the projections (spec §36). */
  reconcile(absolutePath: string): Promise<void>
  /** Reload the registry and resync (spec §37). */
  reconcileOntology(): Promise<void>
  /** Full pass over the source root, so the index is correct before watching. */
  sync(): Promise<void>
}

/** What was last handed to the projections for a given path. */
interface Projected {
  id: string
  hash: string
}

/** Path as recorded on documents: repo-relative and always posix-separated. */
const repoRelative = (projectRoot: string, absolute: string): string =>
  relative(projectRoot, absolute).split(sep).join('/')

/**
 * Where the manifest lives. v0 only registers the file projection, so the first
 * projection's output directory is the index root (spec §31, §44).
 */
export const stateRootOf = (resolved: ResolvedConfig): string =>
  resolve(
    resolved.projectRoot,
    resolved.config.projections[0]?.output ?? '.memory/.index'
  )

/**
 * Turns dirty paths into projection mutations (spec §36).
 *
 * Holds the desired state as two indexes - path to what it projected, and id to
 * the path it came from - because identity lives inside the file, not in the
 * path. That is what lets an edit change a document's id without orphaning the
 * old one, and a move re-register an id without its old path's unlink event
 * deleting the resource that just moved.
 *
 * Nothing here throws on bad input: a file that cannot be parsed or validated
 * is reported and keeps whatever it last projected (spec §67).
 */
export const createReconciler = (
  resolved: ResolvedConfig,
  manager: ProjectionManager,
  report: WatchReporter
): Reconciler => {
  const projected = new Map<string, Projected>()
  const pathOfId = new Map<string, string>()
  let ontology: Ontology | null = null
  let ontologyLoaded = false
  let seeded = false

  const reportAll = (diagnostics: Diagnostic[]): void => {
    if (diagnostics.length > 0) report({ kind: 'diagnostics', diagnostics })
  }

  /**
   * The hash gate needs what was last projected, which the file projection
   * already records in its manifest (spec §31). Reading it lets a restarted
   * watcher skip files nothing has touched; an absent manifest simply means
   * everything is reprojected.
   */
  const seed = async (): Promise<void> => {
    if (seeded) return
    seeded = true
    const manifest = await readManifest(stateRootOf(resolved))
    for (const [id, entry] of Object.entries(manifest.documents)) {
      projected.set(entry.path, { id, hash: entry.hash })
      pathOfId.set(id, entry.path)
    }
  }

  const reloadOntology = async (): Promise<boolean> => {
    const loaded = await loadOntology(resolved)
    ontologyLoaded = true
    if (loaded.ontology === null) {
      // A half-saved registry must not quietly turn every document
      // unvalidated, so the last good one stays in force (spec §67).
      reportAll(loaded.diagnostics)
      return false
    }
    ontology = loaded.ontology
    return true
  }

  const ensureOntology = async (): Promise<Ontology | null> => {
    if (!ontologyLoaded) await reloadOntology()
    return ontology
  }

  const forget = async (id: string, path: string): Promise<void> => {
    await manager.remove(id)
    projected.delete(path)
    pathOfId.delete(id)
    report({ kind: 'removed', id, path })
  }

  const project = async (document: MemoryDocument): Promise<void> => {
    const previous = projected.get(document.path)

    // The id lives in the file, so an edit can change it. Without this the old
    // id would stay in the projection with no file behind it (spec §36).
    if (previous && previous.id !== document.id) {
      await forget(previous.id, document.path)
    }

    // The same id arriving from another path is a move. Dropping the old path
    // now means its later unlink event finds nothing to remove, so the resource
    // is never deleted and recreated (spec §36).
    const formerPath = pathOfId.get(document.id)
    if (formerPath !== undefined && formerPath !== document.path) {
      projected.delete(formerPath)
    }

    const known = pathOfId.has(document.id)
    await manager.upsert(document)
    projected.set(document.path, { id: document.id, hash: document.hash })
    pathOfId.set(document.id, document.path)
    report({
      kind: known ? 'updated' : 'added',
      id: document.id,
      path: document.path
    })
  }

  const reconcile = async (absolutePath: string): Promise<void> => {
    await seed()
    const path = repoRelative(resolved.projectRoot, absolutePath)
    const previous = projected.get(path)

    let raw: string
    try {
      raw = await readFile(absolutePath, 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
        reportAll([error('unreadable-file', (cause as Error).message, { path })])
        return
      }
      // The file is gone, so drop whatever this path last projected (spec §36).
      if (previous) await forget(previous.id, path)
      return
    }

    // Identical bytes cannot change the projection, so stop before parsing
    // (spec §24). This is also what makes a no-op rewrite free.
    const hash = hashContent(raw)
    if (previous?.hash === hash) return

    const parsed = parseMemoryFile(raw, path)
    if (!parsed.document) {
      // Half-saved frontmatter keeps the previous projection (spec §67).
      reportAll(parsed.diagnostics)
      return
    }

    const registry = await ensureOntology()
    const diagnostics = [
      ...parsed.diagnostics,
      // A single file cannot see its link targets, and §17 expects the graph to
      // be built incrementally, so unresolvable references are not this pass's
      // business - `memory validate` reports them across the whole set (§40).
      ...(registry
        ? validateDocuments([parsed.document], registry).filter(
            (d) => d.code !== 'dangling-reference'
          )
        : [])
    ]
    reportAll(diagnostics)
    if (hasErrors(diagnostics)) return

    await project(parsed.document)
  }

  const sync = async (): Promise<void> => {
    await seed()
    const registry = await ensureOntology()
    const scan = await scanSource(resolved)
    const diagnostics = registry
      ? [...scan.diagnostics, ...validateDocuments(scan.documents, registry)]
      : scan.diagnostics
    reportAll(diagnostics)

    // Keyed by path because a file that failed to parse never produced an id.
    const broken = new Set(
      diagnostics.flatMap((d) =>
        d.severity === 'error' && d.path !== undefined ? [d.path] : []
      )
    )

    for (const document of scan.documents) {
      if (broken.has(document.path)) continue
      if (projected.get(document.path)?.hash === document.hash) continue
      await project(document)
    }

    // A path that produced a diagnostic still exists on disk - it is broken,
    // not deleted - so only paths the scan never saw at all are removed (§67).
    const seen = new Set([
      ...scan.documents.map((d) => d.path),
      ...diagnostics.flatMap((d) => d.path ?? [])
    ])
    for (const [path, entry] of [...projected]) {
      if (!seen.has(path)) await forget(entry.id, path)
    }
  }

  /**
   * Spec §37: reload, revalidate, report, re-project. The normalized model is
   * ontology-independent - the parser never sees the registry - so nothing can
   * change interpretation in v0, and the hash-gated full sync the spec permits
   * covers the rest: newly valid documents get projected, newly invalid ones are
   * reported and keep what they had.
   */
  const reconcileOntology = async (): Promise<void> => {
    if (!(await reloadOntology())) return
    report({ kind: 'ontology-reloaded' })
    await sync()
  }

  return { reconcile, reconcileOntology, sync }
}
