import { readFile } from 'node:fs/promises'
import { relative, sep } from 'node:path'

import { DEFAULT_SCOPE } from '../adapters/docket.js'
import { failureOf } from '../commands/sync.js'
import type { ResolvedConfig } from '../config/config.js'
import { aggregate } from '../evidence/aggregate.js'
import { confidenceModel } from '../evidence/confidence.js'
import { entryPaths, type IndexManifest } from '../manifest/manifest.js'
import { manifestEntry, planProjection } from '../manifest/plan.js'
import { type Diagnostic, error, hasErrors } from '../model/diagnostic.js'
import type { MemoryDocument, Ontology } from '../model/index.js'
import { loadOntology } from '../ontology/loader.js'
import { validateDocuments } from '../ontology/validator.js'
import type { ProjectionManager } from '../projection/manager.js'
import { hashContent } from '../source/hashing.js'
import { parseMemoryFile } from '../source/parser.js'
import { scanSource } from '../source/scanner.js'
import { canonicalState } from '../sync/inputs.js'

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

/** The last read of one source path. */
interface SourceFile {
  /** Of the raw bytes, so an unchanged rewrite is skipped before parsing. Empty when unknown. */
  hash: string
  /** Absent when the file did not parse. */
  document?: MemoryDocument
  /** Had an error, so it contributes nothing and holds what it last projected (spec §67). */
  broken: boolean
}

/** Path as recorded on documents: repo-relative and always posix-separated. */
const repoRelative = (projectRoot: string, absolute: string): string =>
  relative(projectRoot, absolute).split(sep).join('/')

const NO_ONTOLOGY: Ontology = { version: 1, resourceTypes: {}, relationships: {} }

/**
 * Turns dirty paths into projection mutations (spec §36).
 *
 * Several files may declare one id, so projections receive entities - every
 * file of an id merged - and a change to one path re-aggregates the ids it
 * touched: the id it declared before and the id it declares now. That is what
 * lets an edit change a document's id without orphaning the old one, and a
 * move register an id at its new path without its old path's unlink event
 * deleting the resource that just moved.
 *
 * Holds the last read of every path, and what each id was last read from.
 * Each adapter instance is planned against its own manifest by the manager,
 * which hands it the entities, observations and documents of the ids a pass
 * touched. Nothing here throws on bad input: a file that cannot be parsed or
 * validated is reported and its id keeps whatever it last projected (spec
 * §67). An instance that fails is reported, and the others carry on.
 *
 * Mutations are buffered: each pass ends with one `commit`, which flushes
 * each instance and then records its manifest, so a full sync over thousands
 * of files writes each derived file once rather than once per entity.
 */
export const createReconciler = (
  resolved: ResolvedConfig,
  manager: ProjectionManager,
  report: WatchReporter
): Reconciler => {
  const files = new Map<string, SourceFile>()
  let projected: IndexManifest['documents'] = {}
  /**
   * Mutation events wait for the commit, so whoever hears one can rely on the
   * derived files already reflecting it.
   */
  let pending: WatchEvent[] = []
  let ontology: Ontology | null = null
  let ontologyLoaded = false
  let seeded = false

  const reportAll = (diagnostics: Diagnostic[]): void => {
    if (diagnostics.length > 0) report({ kind: 'diagnostics', diagnostics })
  }

  /**
   * Which files each id was last read from, as the instances' manifests
   * record it (spec §31), so a restarted watcher knows what a path
   * contributed before reading anything. The manager already reset any
   * instance whose manifest vouched for nothing.
   */
  const seed = async (): Promise<void> => {
    if (seeded) return
    seeded = true
    projected = {}
    for (const [id, { paths, revision }] of manager.knownOwners()) {
      const [path] = paths
      if (path !== undefined) projected[id] = { path, ...(paths.length > 1 ? { paths } : {}), hash: revision ?? '' }
    }
  }

  const reportFailures = (failures: readonly { id: string; message: string }[]): void => {
    reportAll(failures.map(({ id, message }) => error('projection-failure', `adapter ${id}: ${message}`)))
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

  /**
   * Ends every pass, so a restarted watcher can trust the manifests. Each
   * instance that was handed anything is flushed before its manifest is
   * written: the manifest vouches for what it holds, so it must never get
   * ahead of it.
   */
  const commit = async (): Promise<void> => {
    reportFailures((await manager.commit()).map(({ id, error }) => ({ id, message: error })))
    const committed = pending
    pending = []
    for (const event of committed) report(event)
  }

  /**
   * Re-aggregates `ids` from the files as last read and applies the
   * difference. Scoped to those ids, so a pass over one path never touches
   * entities whose files it did not read.
   */
  const apply = async (ids: ReadonlySet<string> | 'all'): Promise<void> => {
    const inScope = (id: string): boolean => ids === 'all' || ids.has(id)
    const broken = new Set<string>()
    const documents: MemoryDocument[] = []
    for (const [path, file] of files) {
      if (file.broken) broken.add(path)
      else if (file.document && inScope(file.document.id)) documents.push(file.document)
    }

    const merged = aggregate(documents, confidenceModel(ontology ?? NO_ONTOLOGY))
    reportAll(merged.diagnostics)
    for (const diagnostic of merged.diagnostics) {
      if (diagnostic.severity === 'error' && diagnostic.path !== undefined) broken.add(diagnostic.path)
    }

    const previous = Object.fromEntries(Object.entries(projected).filter(([id]) => inScope(id)))
    const plan = planProjection(merged.entities, broken, previous)

    for (const id of plan.removals) {
      const entry = projected[id]
      delete projected[id]
      pending.push({ kind: 'removed', id, path: entry?.path ?? '' })
    }
    for (const entity of plan.upserts) {
      const known = entity.id in projected
      projected[entity.id] = manifestEntry(entity)
      pending.push({ kind: known ? 'updated' : 'added', id: entity.id, path: entity.path })
    }

    // Each instance plans for itself: one lagging behind gets what it lacks
    // even when the files did not change.
    const state = canonicalState(merged.entities, documents, DEFAULT_SCOPE)
    const passes = await manager.apply(state, broken, ids === 'all' ? undefined : ids)
    reportFailures(
      passes.flatMap((pass) =>
        pass.error !== undefined || pass.failed.length > 0
          ? [{ id: pass.id, message: failureOf(pass) }]
          : []
      )
    )
  }

  /** Ids a path contributes to: as last read, and as the manifest last recorded. */
  const idsAt = (path: string): string[] => {
    const declared = files.get(path)?.document?.id
    return [
      ...(declared === undefined ? [] : [declared]),
      ...Object.entries(projected)
        .filter(([, entry]) => entryPaths(entry).includes(path))
        .map(([id]) => id)
    ]
  }

  const reconcile = async (absolutePath: string): Promise<void> => {
    await seed()
    await reconcileFile(absolutePath)
    await commit()
  }

  const reconcileFile = async (absolutePath: string): Promise<void> => {
    const path = repoRelative(resolved.projectRoot, absolutePath)
    const before = new Set(idsAt(path))

    let raw: string
    try {
      raw = await readFile(absolutePath, 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
        reportAll([error('unreadable-file', (cause as Error).message, { path })])
        return
      }
      // The file is gone, so whatever it contributed goes with it (spec §36).
      files.delete(path)
      if (before.size > 0) await apply(before)
      return
    }

    // Identical bytes cannot change the projection, so stop before parsing
    // (spec §24). This is also what makes a no-op rewrite free.
    const hash = hashContent(raw)
    if (files.get(path)?.hash === hash) return

    const parsed = parseMemoryFile(raw, path)
    if (!parsed.document) {
      // Half-saved frontmatter keeps the previous projection (spec §67).
      reportAll(parsed.diagnostics)
      files.set(path, { hash, broken: true })
      return
    }

    const registry = await ensureOntology()
    const diagnostics = [
      ...parsed.diagnostics,
      // A single file cannot see its link targets, and §17 expects the graph to
      // be built incrementally, so unresolvable references are not this pass's
      // business - `docket validate` reports them across the whole set (§40).
      ...(registry
        ? validateDocuments([parsed.document], registry).filter(
            (d) => d.code !== 'dangling-reference'
          )
        : [])
    ]
    reportAll(diagnostics)
    files.set(path, { hash, document: parsed.document, broken: hasErrors(diagnostics) })

    await apply(new Set([...before, parsed.document.id]))
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

    // The scan is the whole truth: a path it never saw is gone, and a path
    // that produced a diagnostic still exists - it is broken, not deleted (§67).
    files.clear()
    for (const document of scan.documents) {
      files.set(document.path, {
        hash: document.hash,
        document,
        broken: broken.has(document.path)
      })
    }
    for (const path of broken) {
      if (!files.has(path)) files.set(path, { hash: '', broken: true })
    }

    await apply('all')
    await commit()
  }

  /**
   * Spec §37: reload, revalidate, report, re-project. Confidence rules live in
   * the registry, so a reload can change what an entity projects; the
   * hash-gated full sync covers that along with the rest - newly valid
   * documents get projected, newly invalid ones are reported and keep what
   * they had.
   */
  const reconcileOntology = async (): Promise<void> => {
    if (!(await reloadOntology())) return
    report({ kind: 'ontology-reloaded' })
    await sync()
  }

  return { reconcile, reconcileOntology, sync }
}
