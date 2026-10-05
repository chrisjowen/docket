import { stateRootOf } from '../config/config.js'
import { warning, type Diagnostic } from '../model/index.js'
import type { MemoryProjection, SearchHit } from '../projection/projection.js'
import { createProjections } from '../projection/registry.js'
import { validate } from './validate.js'

export const DEFAULT_SEARCH_LIMIT = 10

export interface SearchOptions {
  /** Directory to resolve `.docket.yaml` from. Defaults to the working directory. */
  cwd?: string | undefined
  /** Hits asked of each projection. */
  limit?: number | undefined
}

/** One projection's answer, in its own order and its own terms. */
export interface SourceResult {
  name: string
  hits: SearchHit[]
  /** How the projection read the query, when it says - e.g. the Cypher it ran. */
  note?: string
  /** Set when the projection could not answer - e.g. its service is down. */
  error?: string
}

/** A document some projection found, described from the canonical file. */
export interface FoundDocument {
  id: string
  type: string
  title: string
  path: string
  /** How far its evidence supports it - absent while its files do not validate. */
  confidence?: number
  /** The projections that returned it. */
  foundBy: string[]
}

export interface SearchResult {
  query: string
  sources: SourceResult[]
  /** Every document found, by id. No combined ranking: the sources carry the evidence. */
  documents: FoundDocument[]
  diagnostics: Diagnostic[]
}

/**
 * Asks every projection that can search, and reports each answer as it came.
 * Answers are not merged into one score: a keyword count, a vector similarity
 * and a graph path are different evidence, weighed by whoever reads them.
 *
 * The files stay the truth. Titles and paths are read from them, and a hit for
 * a document that no longer exists - a projection not yet synced - is dropped.
 */
export const search = async (
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult> => {
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT
  const scanned = await validate({ cwd: options.cwd })
  const { resolved } = scanned
  const known = new Map(scanned.documents.map((document) => [document.id, document]))
  const entities = new Map(scanned.entities.map((entity) => [entity.id, entity]))

  const projections = createProjections(resolved.config.projections)
  const context = {
    projectRoot: resolved.projectRoot,
    memoryRoot: resolved.memoryRoot,
    stateRoot: stateRootOf(resolved)
  }
  const names = uniqueNames(projections)

  const answers = await Promise.all(
    projections.map(async (projection, index): Promise<SourceResult | null> => {
      if (!projection.search) return null
      const name = names[index] ?? projection.name
      try {
        await projection.init?.(context)
        const answer = await projection.search(query, limit)
        return { name, hits: answer.hits, ...(answer.note ? { note: answer.note } : {}) }
      } catch (cause) {
        return { name, hits: [], error: cause instanceof Error ? cause.message : String(cause) }
      } finally {
        await projection.close?.().catch(() => undefined)
      }
    })
  )

  const diagnostics: Diagnostic[] = []
  const stale = new Set<string>()
  const sources = answers
    .filter((answer): answer is SourceResult => answer !== null)
    .map((source) => ({
      ...source,
      hits: source.hits.filter((hit) => {
        if (known.has(hit.id)) return true
        stale.add(hit.id)
        return false
      })
    }))
  for (const id of [...stale].sort()) {
    diagnostics.push(
      warning('stale-search-hit', `A projection returned ${id}, which no file defines - run \`docket sync\`.`, { id })
    )
  }

  const foundBy = new Map<string, string[]>()
  for (const source of sources) {
    for (const hit of source.hits) {
      const by = foundBy.get(hit.id) ?? []
      if (!by.includes(source.name)) by.push(source.name)
      foundBy.set(hit.id, by)
    }
  }

  const documents = [...foundBy.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([id, by]) => {
      const document = entities.get(id) ?? known.get(id)
      if (!document) return []
      const confidence = entities.get(id)?.confidence
      return [
        {
          id,
          type: document.type,
          title: document.title,
          path: document.path,
          ...(confidence === undefined ? {} : { confidence }),
          foundBy: by
        }
      ]
    })

  return { query, sources, documents, diagnostics }
}

/** Two projections of one type would share a name; number the repeats so answers stay apart. */
const uniqueNames = (projections: readonly MemoryProjection[]): string[] => {
  const seen = new Map<string, number>()
  return projections.map((projection) => {
    const count = (seen.get(projection.name) ?? 0) + 1
    seen.set(projection.name, count)
    return count === 1 ? projection.name : `${projection.name}#${count}`
  })
}
