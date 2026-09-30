import type { MemoryDocument } from '../model/index.js'

export interface ProjectionContext {
  /** Absolute path to the repository root (the dir holding `.memory.yaml`). */
  projectRoot: string
  /** Absolute path to the canonical memory root, e.g. `<root>/.memory`. */
  memoryRoot: string
  /** Absolute path to derived state, e.g. `<root>/.memory/.index`. */
  stateRoot: string
}

/**
 * A disposable view over the canonical files. Must be fully rebuildable
 * from `.memory/` alone - never a source of truth.
 */
export interface MemoryProjection {
  readonly name: string

  init?(context: ProjectionContext): Promise<void>

  upsert(document: MemoryDocument): Promise<void>

  remove(id: string): Promise<void>

  /** Drop all derived state. Called by `memory rebuild`. */
  reset?(): Promise<void>

  close?(): Promise<void>
}
