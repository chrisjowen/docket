import type { SearchHit } from '@docket/adapter-kit'
import type { AdapterAnswer } from '@docket/contracts'

import { warning, type Diagnostic } from '../model/index.js'
import { connectingPaths } from '../open/paths.js'
import type { UiAnswer, UiChatAnswer, UiIndexStatus } from '../open/types.js'
import type { AskOutcome } from './ask.js'

/*
 * The answers docket gave before the coordinator - `docket search`, and the
 * legacy `GET /api/ask` and `GET /api/chat` - translated from a coordinated
 * answer (docs/adapter-spec.md §14, §15 step 5): each adapter's entity blocks
 * are its hits, the entities they name are the documents found.
 */

/**
 * A node of a subgraph a projection returned. Its id is the canonical entity's
 * when it names one the files hold; otherwise it is a ghost, under the id the
 * projection gave it.
 */
export interface SourceGraphNode {
  id: string
  label: string
  type?: string
  /** Whether it names an entity the files hold. */
  canonical: boolean
}

/** A relationship a projection returned, between two of its subgraph's nodes. */
export interface SourceGraphEdge {
  source: string
  rel: string
  target: string
  /** How far the projection holds it supported, from 0 to 1, when it says. */
  confidence?: number
  /** The text of the evidence the projection cited for it: why it holds. */
  why: string[]
}

/**
 * The subgraphs a projection returned (docs/adapter-spec.md §13), as one: its
 * nodes, the relationships it found between them and the paths it used, each
 * an ordered list of node ids. Never relationships guessed between its hits.
 */
export interface SourceGraph {
  nodes: SourceGraphNode[]
  edges: SourceGraphEdge[]
  paths: string[][]
}

/** One projection's answer, in its own order and its own terms. */
export interface SourceResult {
  name: string
  hits: SearchHit[]
  /** The subgraph it returned, when it returned one. */
  graph?: SourceGraph
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
 * A path step by step, each with the relationship returned between the two
 * nodes in its direction: `a -depends_on-> b <-owned_by- c`, and `--` where
 * none was returned.
 */
export const describePath = (edges: readonly { source: string; rel: string; target: string }[], path: readonly string[]): string =>
  path
    .map((id, index) => {
      const previous = path[index - 1]
      if (previous === undefined) return id
      const forward = edges.find((edge) => edge.source === previous && edge.target === id)
      if (forward) return ` -${forward.rel}-> ${id}`
      const backward = edges.find((edge) => edge.source === id && edge.target === previous)
      return backward ? ` <-${backward.rel}- ${id}` : ` -- ${id}`
    })
    .join('')

/** The entities each answering adapter's entity blocks name, in its own order and terms. */
const hitsOf = (outcome: AskOutcome['answer']['results'][number]): SearchHit[] => {
  if (outcome.state !== 'answered') return []
  const seen = new Set<string>()
  return outcome.answer.blocks.flatMap((block) =>
    block.kind === 'entities'
      ? block.entities.flatMap((item) => {
          if (item.ref.kind !== 'entity' || seen.has(item.ref.id)) return []
          seen.add(item.ref.id)
          return [
            {
              id: item.ref.id,
              ...(item.score !== undefined ? { score: item.score } : {}),
              ...(item.detail !== undefined ? { detail: item.detail } : {})
            }
          ]
        })
      : []
  )
}

/**
 * The graph blocks of one answer, as one subgraph in canonical terms: a node
 * naming an entity the files hold takes its id, and any other keeps the id the
 * adapter gave it - prefixed with the adapter's, should that be an entity's id
 * it did not claim. Each edge carries the text of the evidence it cites.
 */
const graphOf = (
  adapter: string,
  answer: AdapterAnswer,
  snapshot: AskOutcome['snapshot']
): SourceGraph | undefined => {
  const blocks = answer.blocks.flatMap((block) => (block.kind === 'graph' ? [block] : []))
  if (blocks.length === 0) return undefined
  const evidence = new Map(answer.evidence.map((item) => [item.id, item.text]))
  const nodes = new Map<string, SourceGraphNode>()
  const edges = new Map<string, SourceGraphEdge>()
  const paths = new Map<string, string[]>()
  for (const block of blocks) {
    const ids = new Map<string, string>()
    for (const node of block.nodes) {
      const named = node.ref?.kind === 'entity' ? snapshot.entity(node.ref.id) : undefined
      const own = node.ref?.id ?? node.id
      const id = named ? named.id : snapshot.entity(own) ? `${adapter}:${own}` : own
      ids.set(node.id, id)
      if (nodes.has(id)) continue
      nodes.set(id, {
        id,
        label: node.label || (named?.title ?? own),
        ...(named ? { type: named.type } : node.type !== undefined ? { type: node.type } : {}),
        canonical: named !== undefined
      })
    }
    // The contract keeps every edge end and path step among the block's nodes.
    const idOf = (local: string): string => ids.get(local) ?? local
    for (const edge of block.edges) {
      const [source, target] = [idOf(edge.source), idOf(edge.target)]
      const key = `${source}\u0000${edge.rel}\u0000${target}`
      const why = (edge.evidenceIds ?? []).flatMap((id) => {
        const text = evidence.get(id)
        return text === undefined ? [] : [text]
      })
      const known = edges.get(key)
      if (known) {
        for (const text of why) if (!known.why.includes(text)) known.why.push(text)
        if (edge.confidence !== undefined && (known.confidence === undefined || edge.confidence > known.confidence)) known.confidence = edge.confidence
        continue
      }
      edges.set(key, { source, rel: edge.rel, target, ...(edge.confidence !== undefined ? { confidence: edge.confidence } : {}), why: [...new Set(why)] })
    }
    for (const path of block.paths ?? []) {
      const steps = path.map(idOf)
      paths.set(steps.join('\u0000'), steps)
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], paths: [...paths.values()] }
}

/**
 * The coordinated answer as `docket search` reports it: every adapter that can
 * answer, its entity hits, the subgraph it returned and how it read the query, and each document found,
 * described from the canonical files. A hit for a record the files no longer
 * hold - an index not yet synced - was left out, with a warning.
 */
export const toSearchResult = ({ answer, snapshot, rejected }: AskOutcome): SearchResult => {
  const sources: SourceResult[] = answer.results
    .filter((result) => !(result.state === 'failed' && result.error.code === 'unsupported'))
    .map((result) => {
      if (result.state === 'failed') return { name: result.adapter, hits: [], error: result.error.message }
      const note = result.answer.interpretation.description
      const graph = graphOf(result.adapter, result.answer, snapshot)
      return { name: result.adapter, hits: hitsOf(result), ...(graph ? { graph } : {}), ...(note ? { note } : {}) }
    })

  const diagnostics: Diagnostic[] = [...new Set([...rejected.values()].flat())]
    .sort()
    .map((id) => warning('stale-search-hit', `A projection returned ${id}, which no file defines - run \`docket sync\`.`, { id }))

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
    .flatMap(([id, by]): FoundDocument[] => {
      const entity = snapshot.entity(id)
      const document = entity ?? snapshot.documents.find((candidate) => candidate.id === id)
      if (!document) return []
      return [
        {
          id,
          type: document.type,
          title: document.title,
          path: document.path,
          ...(entity?.confidence === undefined ? {} : { confidence: entity.confidence }),
          foundBy: by
        }
      ]
    })

  return { query: answer.question, sources, documents, diagnostics }
}

/** The legacy `GET /api/ask` answer: search's, with the canonical paths joining what it found. */
export const toLegacyAnswer = (outcome: AskOutcome, index: UiIndexStatus): UiAnswer => {
  const search = toSearchResult(outcome)
  // Most relevant first: the order the first answering source ranked them in.
  const ranked = [
    ...new Set([...search.sources.flatMap((source) => source.hits.map((hit) => hit.id)), ...search.documents.map((document) => document.id)])
  ]
  const edges = outcome.snapshot.entities.flatMap((entity) =>
    entity.links.map((link) => ({ source: entity.id, rel: link.rel, target: link.target }))
  )
  return {
    query: search.query,
    sources: search.sources,
    documents: search.documents,
    paths: connectingPaths(edges, ranked),
    diagnostics: search.diagnostics,
    index
  }
}

/** The legacy `GET /api/chat` reply: the legacy answer, with the coordinator's summary as its summary. */
export const toLegacyChat = (outcome: AskOutcome, index: UiIndexStatus): UiChatAnswer => {
  const { synthesis, notice } = outcome.answer
  return {
    query: outcome.answer.question,
    answer: toLegacyAnswer(outcome, index),
    summary: synthesis
      ? {
          text: synthesis.text,
          cited: synthesis.citedEntities,
          model: synthesis.model,
          cached: synthesis.cached ?? false,
          createdAt: synthesis.createdAt ?? new Date().toISOString()
        }
      : null,
    ...(notice && notice.reason !== 'disabled' ? { notice: { reason: notice.reason, message: notice.message } } : {})
  }
}
