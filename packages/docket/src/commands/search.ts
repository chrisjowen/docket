import { randomUUID } from 'node:crypto'

import type { AdapterAnswer, AskRequest, MemoryAdapter } from '@docket/contracts'

import { DEFAULT_SCOPE, openDocket } from '../adapters/docket.js'
import { warning, type Diagnostic } from '../model/index.js'
import type { SearchHit } from '../projection/projection.js'
import { validate } from './validate.js'

/** Search sets no deadline of its own; this only bounds an adapter that honours one. */
const SEARCH_DEADLINE_MS = 10 * 60_000

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

  // Every configured adapter enabled for query, asked through the adapter
  // contract (docs/adapter-spec.md §15 step 1).
  const docket = await openDocket(resolved)
  const slots = docket.adapters.filter((slot) => slot.roles.includes('query'))

  const answers = await Promise.all(
    slots.map(async (slot): Promise<SourceResult | null> => {
      let adapter: MemoryAdapter | undefined
      try {
        adapter = await slot.create()
        if (!adapter.query) return null
        const answer = await adapter.query.ask(askRequest(query, limit))
        const note = answer.interpretation.description
        return { name: slot.id, hits: hitsOf(answer), ...(note ? { note } : {}) }
      } catch (cause) {
        return { name: slot.id, hits: [], error: cause instanceof Error ? cause.message : String(cause) }
      } finally {
        await adapter?.close().catch(() => undefined)
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

const askRequest = (question: string, limit: number): AskRequest => {
  const now = new Date()
  return {
    requestId: randomUUID(),
    question,
    context: {
      scope: DEFAULT_SCOPE,
      now: now.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    budget: {
      maxResults: limit,
      maxEvidenceBytes: Number.MAX_SAFE_INTEGER,
      deadline: new Date(now.getTime() + SEARCH_DEADLINE_MS).toISOString()
    }
  }
}

/** The documents an answer's entity blocks name, in its own order and terms. */
const hitsOf = (answer: AdapterAnswer): SearchHit[] =>
  answer.blocks.flatMap((block) =>
    block.kind === 'entities'
      ? block.entities.filter((item) => item.ref.kind === 'entity').map((item) => ({
          id: item.ref.id,
          ...(item.score !== undefined ? { score: item.score } : {}),
          ...(item.detail !== undefined ? { detail: item.detail } : {})
        }))
      : []
  )
