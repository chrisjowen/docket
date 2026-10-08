import type {
  AdapterAnswer,
  CanonicalReference,
  Diagnostic,
  ResultBlock,
  RetrievedEvidence
} from '@docket/contracts'

import type { RequestSnapshot } from './snapshot.js'
import type { FoundReference, ReferenceStatus } from './wire.js'

/** A reference's standing against the files, or `foreign`: it says it belongs to another scope. */
export type ReferenceCheck = ReferenceStatus | 'foreign'

/** The paths a record is read from or points at: where a span within it may lie. */
const pathsOf = (input: NonNullable<ReturnType<RequestSnapshot['record']>>['input']): string[] => {
  switch (input.kind) {
    case 'entity':
      return input.paths
    case 'observation':
      return [...input.sources.map((source) => source.path), ...(input.recordedIn ?? [])]
    case 'document':
      return [input.source.path]
  }
}

/**
 * Checks one reference against the snapshot: the record it names must be in
 * the question's scope, at the revision it names, and any span it gives must
 * lie within that record. A reference that carries a different `scope` of its
 * own is foreign, whatever it names.
 */
export const checkReference = (
  reference: CanonicalReference,
  snapshot: Pick<RequestSnapshot, 'record' | 'scope'>
): ReferenceCheck => {
  const scope = (reference as { scope?: unknown }).scope
  if (scope !== undefined && scope !== snapshot.scope) return 'foreign'
  const derived = snapshot.record(reference.kind, reference.id)
  if (derived === undefined) return 'unresolved'
  if (reference.revision !== undefined && reference.revision !== derived.input.revision) return 'stale'
  const span = reference.span
  if (span !== undefined) {
    if (!pathsOf(derived.input).includes(span.path)) return 'unresolved'
    if (derived.input.kind === 'document' && span.path === derived.input.source.path) {
      const { startLine, endLine } = derived.input.source
      const outside =
        (span.startLine !== undefined && startLine !== undefined && span.startLine < startLine) ||
        (span.endLine !== undefined && endLine !== undefined && span.endLine > endLine)
      if (outside) return 'unresolved'
    }
  }
  return 'resolved'
}

/** Where in an answer a reference was found. */
interface Sighting {
  reference: CanonicalReference
  status: ReferenceStatus
  blockId?: string
  evidenceId?: string
}

export interface CheckedAnswer {
  /** The answer with foreign references dropped, results naming no record in scope left out, and every id namespaced. */
  answer: AdapterAnswer
  /** For each evidence id, as namespaced, its references' statuses in order. */
  references: Record<string, ReferenceStatus[]>
  /** Every reference it kept, where it was found, with namespaced ids. */
  sightings: Sighting[]
  /** Ids of results left out because they name no record in scope. */
  rejected: string[]
}

const listed = (ids: readonly string[]): string => {
  const shown = ids.slice(0, 5).join(', ')
  return ids.length > 5 ? `${shown} and ${ids.length - 5} more` : shown
}

/**
 * Checks one adapter's answer against the snapshot (docs/adapter-spec.md §9,
 * §10 step 3) and namespaces its block and evidence ids by its instance id.
 *
 * - A reference to another scope is dropped wherever it appears; a result
 *   that is nothing but such a reference is dropped with it.
 * - An entities block item naming a record the files do not hold in scope is
 *   left out, as search always has: an adapter cannot introduce entities.
 * - Evidence keeps every in-scope reference, resolved or not - unresolvable
 *   references are reported, never fabricated or silently verified - and the
 *   status of each is returned beside the answer.
 */
export const checkAnswer = (
  adapter: string,
  answer: AdapterAnswer,
  snapshot: Pick<RequestSnapshot, 'record' | 'scope'>
): CheckedAnswer => {
  const prefix = `${adapter}:`
  const id = (local: string): string => `${prefix}${local}`
  const ids = (locals: readonly string[] | undefined): string[] => (locals ?? []).map(id)

  const sightings: Sighting[] = []
  const rejected: string[] = []
  const foreign: string[] = []
  let stale = 0
  const check = (reference: CanonicalReference): ReferenceCheck => {
    const status = checkReference(reference, snapshot)
    if (status === 'foreign') foreign.push(reference.id)
    if (status === 'stale') stale += 1
    return status
  }

  const references: Record<string, ReferenceStatus[]> = {}
  const evidence: RetrievedEvidence[] = answer.evidence.map((item) => {
    const kept: CanonicalReference[] = []
    const statuses: ReferenceStatus[] = []
    for (const reference of item.canonicalRefs) {
      const status = check(reference)
      if (status === 'foreign') continue
      kept.push(reference)
      statuses.push(status)
      sightings.push({ reference, status, evidenceId: id(item.id) })
    }
    references[id(item.id)] = statuses
    return { ...item, id: id(item.id), canonicalRefs: kept }
  })

  const blocks: ResultBlock[] = answer.blocks.flatMap((block): ResultBlock[] => {
    const base = { id: id(block.id), evidenceIds: ids(block.evidenceIds) }
    switch (block.kind) {
      case 'entities': {
        const entities = block.entities.filter((item) => {
          const status = check(item.ref)
          if (status === 'foreign') return false
          if (status === 'unresolved') {
            rejected.push(item.ref.id)
            return false
          }
          sightings.push({ reference: item.ref, status, blockId: base.id })
          return true
        })
        return entities.length === 0 && block.entities.length > 0 ? [] : [{ ...block, ...base, entities }]
      }
      case 'graph':
        return [
          {
            ...block,
            ...base,
            nodes: block.nodes.map((node) => {
              if (node.ref === undefined) return node
              const status = check(node.ref)
              if (status === 'foreign') {
                const { ref: _foreign, ...rest } = node
                return rest
              }
              sightings.push({ reference: node.ref, status, blockId: base.id })
              return node
            }),
            edges: block.edges.map((edge) => (edge.evidenceIds ? { ...edge, evidenceIds: ids(edge.evidenceIds) } : edge))
          }
        ]
      case 'table': {
        const references = new Set(block.columns.filter((column) => column.type === 'reference').map((column) => column.key))
        return [
          {
            ...block,
            ...base,
            rows: block.rows.map((row) => ({
              ...row,
              cells: Object.fromEntries(
                Object.entries(row.cells).map(([key, cell]) => {
                  if (!references.has(key) || cell === null || typeof cell !== 'object') return [key, cell]
                  const status = check(cell)
                  if (status === 'foreign') return [key, null]
                  sightings.push({ reference: cell, status, blockId: base.id })
                  return [key, cell]
                })
              ),
              ...(row.evidenceIds ? { evidenceIds: ids(row.evidenceIds) } : {})
            }))
          }
        ]
      }
      case 'timeline':
        return [
          {
            ...block,
            ...base,
            events: block.events.map((event) => (event.evidenceIds ? { ...event, evidenceIds: ids(event.evidenceIds) } : event))
          }
        ]
      default:
        return [{ ...block, ...base }]
    }
  })

  const diagnostics: Diagnostic[] = [...answer.diagnostics]
  if (rejected.length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'reference-not-in-scope',
      message: `${rejected.length === 1 ? 'A result names a record' : `${rejected.length} results name records`} the canonical files do not hold in scope "${snapshot.scope}", left out: ${listed(rejected)}. If they were removed from the files, run \`docket sync\`.`
    })
  }
  if (foreign.length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'foreign-reference',
      // Not named: another scope's ids are its own.
      message: `${foreign.length === 1 ? 'A reference' : `${foreign.length} references`} to another scope ${foreign.length === 1 ? 'was' : 'were'} dropped.`
    })
  }
  if (stale > 0) {
    diagnostics.push({
      severity: 'info',
      code: 'stale-reference',
      message: `${stale === 1 ? 'A reference names' : `${stale} references name`} an older revision than the files hold: this answer came from an index behind the files. Run \`docket sync\`.`
    })
  }

  return {
    answer: { ...answer, blocks, evidence, diagnostics },
    references,
    sightings,
    rejected
  }
}

/** The weakest standing first: a record seen resolved anywhere is resolved. */
const RANK: Record<ReferenceStatus, number> = { resolved: 2, stale: 1, unresolved: 0 }

/**
 * Every canonical record the answers point at, once each, in the order first
 * seen, with each adapter that pointed at it and where. Deduplicating the
 * references keeps every adapter's own blocks and evidence: two readings of
 * one record stay two readings.
 */
export const foundReferences = (
  checked: readonly { adapter: string; sightings: readonly Sighting[] }[],
  snapshot: Pick<RequestSnapshot, 'record'>
): FoundReference[] => {
  const found = new Map<string, FoundReference>()
  for (const { adapter, sightings } of checked) {
    for (const sighting of sightings) {
      const { kind, id } = sighting.reference
      const key = `${kind}\u0000${id}`
      let entry = found.get(key)
      if (!entry) {
        const derived = snapshot.record(kind, id)
        entry = {
          kind,
          id,
          status: sighting.status,
          ...(derived ? { revision: derived.input.revision, entity: derived.owner } : {}),
          foundBy: []
        }
        found.set(key, entry)
      } else if (RANK[sighting.status] > RANK[entry.status]) {
        entry.status = sighting.status
      }
      let by = entry.foundBy.find((item) => item.adapter === adapter)
      if (!by) {
        by = { adapter, blockIds: [], evidenceIds: [] }
        entry.foundBy.push(by)
      }
      if (sighting.blockId !== undefined && !by.blockIds.includes(sighting.blockId)) by.blockIds.push(sighting.blockId)
      if (sighting.evidenceId !== undefined && !by.evidenceIds.includes(sighting.evidenceId)) by.evidenceIds.push(sighting.evidenceId)
    }
  }
  return [...found.values()]
}
