import type { MemoryEntity } from '../model/index.js'

export interface ProjectionContext {
  /** Absolute path to the repository root (the dir holding `.docket.yaml`). */
  projectRoot: string
  /** Absolute path to the canonical memory root, e.g. `<root>/.docket`. */
  memoryRoot: string
  /** Absolute path to derived state, e.g. `<root>/.docket/.index`. */
  stateRoot: string
}

/**
 * One document a projection judged relevant to a query, in that projection's
 * own terms. Hits are never merged into a common score across projections: a
 * vector similarity, a keyword count and a graph path are different kinds of
 * evidence, and whoever reads them weighs them.
 */
export interface SearchHit {
  /** The canonical document id. */
  id: string
  /** The projection's native score, when it has one. Only comparable within one projection. */
  score?: number
  /** Why it matched, in the projection's own words - e.g. a graph path. */
  detail?: string
}

/** A projection's answer to a search. */
export interface SearchAnswer {
  hits: SearchHit[]
  /** How the projection read the query, when that is worth showing - e.g. the Cypher it ran. */
  note?: string
}

/**
 * A disposable view over the canonical files. Must be fully rebuildable
 * from `.docket/` alone - never a source of truth.
 *
 * It receives entities, not files: every file that declares an id merged
 * into one, links deduplicated per (source, rel, target), each with the
 * evidence behind it and the confidence computed from that evidence.
 */
export interface MemoryProjection {
  readonly name: string

  init?(context: ProjectionContext): Promise<void>

  upsert(entity: MemoryEntity): Promise<void>

  remove(id: string): Promise<void>

  /**
   * Make every `upsert` and `remove` so far durable. A projection may buffer
   * mutations until then, so callers flush before recording what was projected
   * - sync once per pass, the watcher once per reconciliation. Optional: a
   * projection that writes through has nothing to do.
   */
  flush?(): Promise<void>

  /** Drop all derived state. Called by `docket rebuild`. */
  reset?(): Promise<void>

  /** Documents relevant to `query`, most relevant first. Optional: not every view can search. */
  search?(query: string, limit: number): Promise<SearchAnswer>

  /** Releases resources. Flushes first, so nothing buffered is lost. */
  close?(): Promise<void>
}
