import type { CanonicalReference, RetrievedEvidence } from '@docket/contracts'

import type { UiGraph } from '$lib/types.js'

/**
 * How far a piece of evidence can be trusted as the casebook's own: whether it
 * was derived by an engine, and whether any canonical reference it gives
 * resolves to the files this page has loaded.
 *
 * - `canonical`: retrieved, and a reference resolves.
 * - `derived`: an engine derived it, and a reference resolves to what it was derived from.
 * - `derived-unresolved`: an engine derived it, and nothing ties it to a file.
 * - `unresolved`: retrieved, but no reference resolves.
 */
export type Standing = 'canonical' | 'derived' | 'derived-unresolved' | 'unresolved'

export interface Casebook {
  entities: ReadonlySet<string>
  /** Repo-relative paths of every canonical file. */
  paths: ReadonlySet<string>
}

export const casebookOf = (graph: UiGraph | null): Casebook => ({
  entities: new Set(graph?.entities.map((entity) => entity.id) ?? []),
  paths: new Set(graph?.entities.flatMap((entity) => entity.paths) ?? [])
})

/** A reference resolves when it names a loaded entity, or a span in a loaded file. */
export const resolves = (reference: CanonicalReference, casebook: Casebook): boolean =>
  (reference.kind === 'entity' && casebook.entities.has(reference.id)) ||
  (reference.span !== undefined && casebook.paths.has(reference.span.path))

export const isDerived = (evidence: RetrievedEvidence): boolean =>
  evidence.kind === 'derived-fact' || evidence.derivation !== undefined

export const standingOf = (evidence: RetrievedEvidence, casebook: Casebook): Standing => {
  const resolved = evidence.canonicalRefs.some((reference) => resolves(reference, casebook))
  if (isDerived(evidence)) return resolved ? 'derived' : 'derived-unresolved'
  return resolved ? 'canonical' : 'unresolved'
}

export const STANDING_LABEL: Record<Standing, string> = {
  canonical: 'Canonical source',
  derived: 'Derived from a canonical source',
  'derived-unresolved': 'Derived, unresolved',
  unresolved: 'Source not resolved'
}

/** Says what the standing does and does not establish - for a tooltip or the inspector. */
export const STANDING_DETAIL: Record<Standing, string> = {
  canonical: 'Retrieved from a source that resolves to a file in the casebook.',
  derived: 'An engine derived this; what it was derived from resolves to a file in the casebook. It is not itself on record.',
  'derived-unresolved':
    'An engine derived this and nothing ties it to a file in the casebook. It is not canonical verification.',
  unresolved: 'Retrieved, but none of its references resolve to a file in the casebook.'
}

/** `path:12-40 @ rev`, or the id when there is no span. */
export const referenceLocation = (reference: CanonicalReference): string => {
  const span = reference.span
  const lines =
    span?.startLine === undefined
      ? ''
      : span.endLine === undefined || span.endLine === span.startLine
        ? `:${span.startLine}`
        : `:${span.startLine}-${span.endLine}`
  const where = span ? `${span.path}${lines}` : reference.id
  return reference.revision ? `${where} @ ${reference.revision}` : where
}
