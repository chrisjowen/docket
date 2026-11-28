// SPDX-License-Identifier: AGPL-3.0-only
import type { UiEdge, UiEntity, UiGraph } from '@chrisjowen/docket/open/types'
import { QueryError, capMessage, type AskResponse, type QueryClient } from '@docket/platform-mcp-tools'

import { emptyGroups, entryHits, exhibitHits, interleave, memoryHits, noteHits, proseOf, SENT_TEXT, snippet, termsOf, type ResultGroups } from '$lib/ask/groups'
import {
  failedAnswer,
  facets,
  highlightBoard,
  passes,
  textMatches,
  workspaceAnswer,
  type AskWorkspace,
  type BoardLink,
  type BoardNode,
  type SearchFilters,
  type SearchHit,
  type TypeSlots,
  type WorkspaceAnswer,
} from '$lib/ask/model'
import type { ActivityEntry } from '$lib/graph/browse'
import { typeSlots } from '$lib/graph/model'

/**
 * The Ask page's server side: one question, or one search, over several of
 * the org's workspaces. Each workspace goes through the same path as the MCP
 * endpoint's `docket_ask` and `docket_search` - the worker's query service,
 * which puts it to that workspace's projections and checks every answer
 * against its canonical documents - so the answers are grounded and cited
 * the same way. Asking spends the org's AI budget (checked once per question,
 * as `docket_ask` checks it per call); searching never touches a model.
 */

/** A workspace of the org, as the caller has already checked the member may read it. */
export interface OrgWorkspace extends AskWorkspace {
  id: string
}

/** The graph of a workspace's canonical documents, with how far its index lags them. */
export interface CanonicalGraph {
  entities: readonly UiEntity[]
  edges: readonly Pick<UiEdge, 'source' | 'rel' | 'target'>[]
  types?: UiGraph['types']
  index?: { synced: boolean; behind: number }
}

export interface AskDeps {
  orgId: string
  /** Who asks, as AI usage is metered against (`user:<id>`). */
  actor: string
  /** The member asking: whose question each workspace's trace is (Settings → Queries). */
  userId: string
  query: QueryClient
  /** Throws `AiCapReached` once the budget a call for the docket is held to is spent: its space's slice, and the account's cap unless it pays with its own key. */
  assertWithinCap(workspaceId: string): Promise<void>
  /** Each workspace's canonical graph, read in one transaction as the org: what search filters and draws. */
  graphs(workspaces: readonly OrgWorkspace[]): Promise<Map<string, CanonicalGraph>>
  /** Each workspace's newest activity-log changes (by slug), for the docket entries search finds. */
  activity?(workspaces: readonly OrgWorkspace[]): Promise<Map<string, ActivityEntry[]>>
  /** The title and type of just these resources in each workspace (by slug), read in one transaction as the org. */
  describe(wanted: readonly { workspace: OrgWorkspace; ids: string[] }[]): Promise<Map<string, Map<string, { title: string; type: string }>>>
}

/** The entities an answer points at that the documents still hold, as `workspaceAnswer` lists them. */
const referenced = (response: AskResponse): string[] => [
  ...new Set((response.answer.references ?? []).filter((reference) => reference.status !== 'unresolved').map((reference) => reference.entity ?? reference.id)),
]

/** Puts `question` to every workspace at once; a workspace that fails says why and the others still answer. */
export async function askAcross(deps: Omit<AskDeps, 'graphs'>, workspaces: readonly OrgWorkspace[], question: string): Promise<WorkspaceAnswer[]> {
  const responses = await Promise.all(
    workspaces.map(async (workspace) => {
      try {
        await deps.assertWithinCap(workspace.id)
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'AiCapReached') return { ok: false as const, message: capMessage(cause) }
        throw cause
      }
      return deps.query.ask({ orgId: deps.orgId, workspaceId: workspace.id, question, actor: deps.actor, userId: deps.userId }).then(
        (response) => ({ ok: true as const, response }),
        (cause: unknown) => {
          if (cause instanceof QueryError) return { ok: false as const, message: `The docket could not answer: ${cause.message}` }
          throw cause
        },
      )
    }),
  )
  // Only the sources' titles and types are read, not each workspace's whole graph.
  const described = await deps.describe(
    workspaces.flatMap((workspace, index) => {
      const outcome = responses[index]
      return outcome?.ok ? [{ workspace, ids: referenced(outcome.response) }] : []
    }),
  )
  return workspaces.map((workspace, index) => {
    const outcome = responses[index]
    if (!outcome || !outcome.ok) return failedAnswer(view(workspace), outcome?.message ?? 'No answer.')
    return workspaceAnswer(view(workspace), outcome.response, described.get(workspace.slug) ?? new Map())
  })
}

/** The most results asked of each workspace's search; with a type or tag filter, the most the query service gives, from each projection's hits as deep. */
export const SEARCH_LIMIT = 30
export const FILTERED_SEARCH_LIMIT = 50
/** Hits listed per workspace. */
export const HITS_PER_WORKSPACE = 50

export interface SearchOutcome {
  hits: SearchHit[]
  /** What each workspace's search could not do, or what limits it. */
  notes: { workspace: AskWorkspace; message: string }[]
  /** The hits on each workspace's graph. */
  boards: { workspace: AskWorkspace; nodes: BoardNode[]; links: BoardLink[]; matched: string[] }[]
  facets: ReturnType<typeof facets>
  /** Each type's Lucide icon, as the ontologies name them. */
  icons: Record<string, string>
  /** The notes, memory matches, exhibits and docket entries the text finds besides the records. */
  groups: ResultGroups
  /** How long the search took, in milliseconds. */
  tookMs: number
  /** Each docket's record types, ranked as its Record page ranks them. */
  slots: TypeSlots
}

const view = (workspace: OrgWorkspace): AskWorkspace => ({ slug: workspace.slug, name: workspace.name })

const hitOf = (workspace: OrgWorkspace, entity: UiEntity, foundBy: string[], terms: readonly string[] = []): SearchHit => ({
  workspace: view(workspace),
  id: entity.id,
  title: entity.title,
  type: entity.type,
  tags: entity.tags,
  path: entity.path,
  foundBy,
  summary: snippet(proseOf(entity), terms, SENT_TEXT) || null,
  weight: entity.assessment?.confidence ?? null,
})

/** Whether an entity has gone out of date: the graph reads its supersession into its frontmatter. */
const isSuperseded = (entity: Pick<UiEntity, 'frontmatter'>): boolean => typeof entity.frontmatter.superseded_by === 'string'

/**
 * Direct search, no model: with text, `docket_search` over each workspace's
 * projections (Neo4j full-text and mem0), best first, kept to what the
 * documents still hold and the filters allow; without text, every entity the
 * filters allow. When a workspace's index does not answer, its documents'
 * text is matched instead, and the page says so. A record gone out of date is
 * never a text match; when the search finds one, it answers with the current
 * record and the page notes the change. Text also finds the documents'
 * notes, exhibits and docket entries, and the index's memory (mem0) matches
 * come back beside the records.
 */
export async function searchAcross(
  deps: Pick<AskDeps, 'orgId' | 'actor' | 'userId' | 'query' | 'graphs' | 'activity'>,
  workspaces: readonly OrgWorkspace[],
  query: string,
  filters: SearchFilters,
): Promise<SearchOutcome> {
  const started = performance.now()
  const terms = query ? termsOf(query) : []
  const [graphs, activity] = await Promise.all([deps.graphs(workspaces), query && deps.activity ? deps.activity(workspaces) : new Map<string, ActivityEntry[]>()])
  /** What the text finds besides the records, about records the filters allow; an out-of-date record's notes never read as current. */
  const besides = (workspace: OrgWorkspace, graph: CanonicalGraph, allowed: readonly UiEntity[]): Omit<ResultGroups, 'memory'> => {
    if (!query) return { notes: [], exhibits: [], entries: [] }
    const kept = new Set(allowed.map((entity) => entity.id))
    const filtered = filters.types.length > 0 || filters.tags.length > 0
    return {
      notes: noteHits(view(workspace), graph, terms, (entity) => kept.has(entity.id) && !isSuperseded(entity)),
      exhibits: exhibitHits(view(workspace), graph, terms, (entity) => kept.has(entity.id)),
      entries: entryHits(view(workspace), graph, activity.get(workspace.slug) ?? [], terms).filter((entry) => (entry.entity ? kept.has(entry.entity) : !filtered)),
    }
  }
  const searched = await Promise.all(
    workspaces.map(async (workspace) => {
      const graph = graphs.get(workspace.slug) ?? { entities: [], edges: [] }
      const allowed = graph.entities.filter((entity) => passes(entity, filters))
      const notes: string[] = []
      if (graph.index && (!graph.index.synced || graph.index.behind > 0)) {
        notes.push(`The index is ${graph.index.behind} changes behind the documents, so search may miss the latest.`)
      }
      if (!query) {
        const hits = [...allowed].sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title)).map((entity) => hitOf(workspace, entity, ['documents']))
        return { workspace, graph, hits, notes: [], groups: emptyGroups() }
      }
      const entities = new Map(allowed.map((entity) => [entity.id, entity]))
      const current = allowed.filter((entity) => !isSuperseded(entity))
      const filtered = filters.types.length > 0 || filters.tags.length > 0
      try {
        const found = await deps.query.search({
          orgId: deps.orgId,
          workspaceId: workspace.id,
          query,
          limit: filtered ? FILTERED_SEARCH_LIMIT : SEARCH_LIMIT,
          ...(filtered ? { pool: FILTERED_SEARCH_LIMIT } : {}),
          actor: deps.actor,
          userId: deps.userId,
        })
        const hits = found.matches.flatMap((match) => {
          const entity = entities.get(match.id)
          return entity ? [hitOf(workspace, entity, [...new Set(match.foundBy)], terms)] : []
        })
        if (filtered) {
          // The index ranks across every type, so its top results can miss what the filters keep: the documents' text fills in.
          const seen = new Set(hits.map((hit) => hit.id))
          for (const entity of textMatches(current, query)) if (!seen.has(entity.id)) hits.push(hitOf(workspace, entity, ['documents'], terms))
        }
        for (const change of found.changes ?? []) notes.push(change.note)
        for (const source of found.sources) if (source.error) notes.push(`${source.name}: ${source.error}`)
        return { workspace, graph, hits, notes, groups: { ...besides(workspace, graph, allowed), memory: memoryHits(view(workspace), found.matches, entities, terms) } }
      } catch (cause) {
        if (!(cause instanceof QueryError)) throw cause
        notes.push(`The search index did not answer (${cause.message}), so this matches the documents' text instead.`)
        return {
          workspace,
          graph,
          hits: textMatches(current, query).map((entity) => hitOf(workspace, entity, ['documents'], terms)),
          notes,
          groups: { ...besides(workspace, graph, allowed), memory: [] },
        }
      }
    }),
  )
  const listed = searched.map(({ hits }) => hits.slice(0, HITS_PER_WORKSPACE))
  return {
    hits: query ? interleave(listed) : listed.flat(),
    notes: searched.flatMap(({ workspace, notes }) => notes.map((message) => ({ workspace: view(workspace), message }))),
    boards: searched.map(({ workspace, graph, hits }) => ({
      workspace: view(workspace),
      ...highlightBoard(
        workspace.slug,
        graph,
        hits.slice(0, HITS_PER_WORKSPACE).map((hit) => hit.id),
      ),
    })),
    facets: facets(workspaces.flatMap((workspace) => graphs.get(workspace.slug)?.entities ?? [])),
    icons: Object.fromEntries(workspaces.flatMap((workspace) => graphs.get(workspace.slug)?.types ?? []).map((type) => [type.name, type.icon])),
    groups: {
      notes: interleave(searched.map(({ groups }) => groups.notes)),
      memory: interleave(searched.map(({ groups }) => groups.memory)),
      exhibits: interleave(searched.map(({ groups }) => groups.exhibits)),
      entries: interleave(searched.map(({ groups }) => groups.entries)),
    },
    tookMs: Math.round(performance.now() - started),
    slots: Object.fromEntries(workspaces.map((workspace) => [workspace.slug, Object.fromEntries(typeSlots(graphs.get(workspace.slug)?.entities ?? []))])),
  }
}
