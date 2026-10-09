import type { CanonicalReader, InputKind } from '@docket/contracts'

import { DEFAULT_SCOPE } from '../adapters/docket.js'
import type { ResolvedConfig } from '../config/config.js'
import { validate } from '../commands/validate.js'
import type { Diagnostic, MemoryDocument, MemoryEntity } from '../model/index.js'
import { canonicalState, type CanonicalState, type DerivedInput } from '../sync/inputs.js'

/**
 * The canonical files as they stood when a question was asked: every input
 * they give in the question's scope, read once. Adapters read through it and
 * the coordinator checks their answers against it, so both see the same
 * revisions however the files change while the question is out.
 */
export interface RequestSnapshot {
  resolved: ResolvedConfig
  scope: string
  entities: readonly MemoryEntity[]
  documents: readonly MemoryDocument[]
  /** Paths with an error, whose records sync holds at what it last projected. */
  broken: ReadonlySet<string>
  /** What validating the files found. */
  diagnostics: readonly Diagnostic[]
  state: CanonicalState
  /** The input of `kind` with `id`, and the entity it belongs to. */
  record(kind: InputKind, id: string): DerivedInput | undefined
  entity(id: string): MemoryEntity | undefined
  /** Read-only access to the inputs, as adapters are handed it. */
  reader: CanonicalReader
}

const key = (kind: InputKind, id: string): string => `${kind}\u0000${id}`

/** A snapshot of what `validate` read. */
export const snapshotOf = (
  read: Pick<Awaited<ReturnType<typeof validate>>, 'resolved' | 'entities' | 'documents' | 'broken' | 'diagnostics'>,
  scope: string = DEFAULT_SCOPE
): RequestSnapshot => {
  const state = canonicalState(read.entities, read.documents, scope)
  const records = new Map(state.inputs.map((derived) => [key(derived.input.kind, derived.input.id), derived]))
  const entities = new Map(read.entities.map((entity) => [entity.id, entity]))
  return {
    resolved: read.resolved,
    scope,
    entities: read.entities,
    documents: read.documents,
    broken: read.broken,
    diagnostics: read.diagnostics,
    state,
    record: (kind, id) => records.get(key(kind, id)),
    entity: (id) => entities.get(id),
    reader: {
      get: async (kind, id) => records.get(key(kind, id))?.input,
      list: async (kind) => state.inputs.filter(({ input }) => input.kind === kind).map(({ input }) => input)
    }
  }
}

/** Reads the canonical files under the project `.docket.yaml` at or above `cwd` is in. */
export const takeSnapshot = async (cwd: string): Promise<RequestSnapshot> => snapshotOf(await validate({ cwd }))
