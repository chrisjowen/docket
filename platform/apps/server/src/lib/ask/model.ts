// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Ask page's model: a question put to one or more of the org's
 * workspaces, each answered by docket's grounded ask (`docket_ask`'s path),
 * and the direct search over them (no model). Every source and hit names the
 * workspace it came from. Pure, so the page and the server share it.
 */
import type { UiEdge, UiEntity } from '@chrisjowen/docket/open/types'

import { slotColour } from '$lib/graph/model'
import { standingOf } from '$lib/graph/standing'

export interface AskWorkspace {
  slug: string
  name: string
}

/** A canonical record an answer relies on, in the workspace that holds it. */
export interface AnswerSource {
  workspace: string
  id: string
  title: string
  type: string
  /** The model's answer cites it. */
  cited: boolean
  /** The index answered from an older revision than the documents hold. */
  stale: boolean
  /** The projections that found it: `neo4j`, `mem0`. */
  foundBy: string[]
}

/** One workspace's part of an answer. */
export interface WorkspaceAnswer {
  workspace: AskWorkspace
  /** The model's answer, citing exhibits as `[entity.id]`; null when none was written. */
  text: string | null
  model: string | null
  /** Why there is no answer text, or what limits it. */
  notice: string | null
  /** The workspace could not be asked at all. */
  error: string | null
  sources: AnswerSource[]
  /** Projections that failed, with their message. */
  unavailable: string[]
}

/**
 * Each docket's record types ranked as its Record page ranks them, most
 * common first, by docket slug: a type wears the same colour here as there.
 */
export type TypeSlots = Record<string, Record<string, number>>

/** A type's colour in a docket, as its Record page draws it. */
export const colourIn = (slots: TypeSlots, workspace: string, type: string): string => slotColour(slots[workspace]?.[type])

/** What a chat keeps of a question. */
export interface QuestionBody {
  text: string
  workspaces: AskWorkspace[]
}

/** What a chat keeps of an answer. */
export interface AnswerBody {
  answers: WorkspaceAnswer[]
  /** How long the dockets took to answer, in milliseconds; absent from answers kept before it was. */
  tookMs?: number
}

/** One thing the agent looked up, as the page lists it under "What I looked up". */
export interface AgentStep {
  /** The MCP tool it called: `docket_search`, `docket_get`, `docket_ask` or `docket_ontology`. */
  tool: string
  /** The docket it looked in, by slug; null when the call named none it may read. */
  workspace: string | null
  /** What it looked for, in a few words: the query, the id, the question. */
  input: string
  /** What came back, in a few words; empty while it runs. */
  result: string
  state: 'running' | 'done' | 'failed'
  ms: number
}

/**
 * The agent's answer to one question over one or more dockets: what it looked
 * up, step by step, the records that turned up (each naming its docket), and
 * the answer it wrote from them as OpenUI Lang, which the page renders with
 * its own components - record cards, lists and tables linking into the graph,
 * and prose that cites a record for every claim.
 */
export interface AgentAnswer {
  /** The answer as OpenUI Lang; null when none was written. */
  ui: string | null
  model: string | null
  /** What limits the answer, or why there is none. */
  notice: string | null
  /** The question could not be answered at all. */
  error: string | null
  steps: AgentStep[]
  /** Every record the tools returned, cited ones first; `cited` when the answer names it. */
  sources: AnswerSource[]
  /** The dockets it was asked of. */
  workspaces: AskWorkspace[]
  /** What its model turns cost, in US dollars. */
  costUsd: number
}

/** What a chat keeps of the agent's answer. */
export interface AgentAnswerBody {
  agent: AgentAnswer
  tookMs?: number
}

export type ChatBody = QuestionBody | AnswerBody | AgentAnswerBody

export const isAgentAnswer = (body: ChatBody): body is AgentAnswerBody => 'agent' in body
/** An answer of either kind: the agent's, or one grounded memo per docket. */
export const isAnyAnswer = (body: ChatBody): body is AnswerBody | AgentAnswerBody => 'agent' in body || 'answers' in body

export const MAX_QUESTION = 2_000
/** Sources shown per workspace. */
export const MAX_SOURCES = 30

/** The parts of docket's coordinated answer the page reads. */
export interface AskedAnswer {
  synthesis: { text: string; model: string; citedEntities: string[] } | null
  notice?: { message: string }
  references?: { kind: string; id: string; status: 'resolved' | 'stale' | 'unresolved'; entity?: string; foundBy: { adapter: string }[] }[]
  results: ({ adapter: string; state: 'answered' } | { adapter: string; state: 'failed'; error: { message: string } })[]
}

type Described = Pick<UiEntity, 'title' | 'type'>

/**
 * One workspace's answer from docket's coordinated answer: the model's text,
 * and every record the projections found that the documents still hold, once
 * per entity, cited ones first.
 */
export function workspaceAnswer(
  workspace: AskWorkspace,
  response: { answer: AskedAnswer; notice?: string },
  entities: ReadonlyMap<string, Described>,
): WorkspaceAnswer {
  const { answer } = response
  const cited = new Set(answer.synthesis?.citedEntities ?? [])
  const sources = new Map<string, AnswerSource>()
  for (const reference of answer.references ?? []) {
    if (reference.status === 'unresolved') continue
    const id = reference.entity ?? reference.id
    const known = sources.get(id)
    const foundBy = reference.foundBy.map((by) => by.adapter)
    if (known) {
      known.foundBy = [...new Set([...known.foundBy, ...foundBy])]
      known.stale ||= reference.status === 'stale'
      continue
    }
    const entity = entities.get(id)
    sources.set(id, {
      workspace: workspace.slug,
      id,
      title: entity?.title ?? id,
      type: entity?.type ?? '',
      cited: cited.has(id),
      stale: reference.status === 'stale',
      foundBy: [...new Set(foundBy)],
    })
  }
  return {
    workspace,
    text: answer.synthesis?.text ?? null,
    model: answer.synthesis?.model ?? null,
    notice: answer.synthesis ? null : (response.notice ?? answer.notice?.message ?? 'No summary was written; the sources stand on their own.'),
    error: null,
    sources: [...sources.values()].sort((a, b) => Number(b.cited) - Number(a.cited)).slice(0, MAX_SOURCES),
    unavailable: answer.results.flatMap((result) => (result.state === 'failed' ? [`${result.adapter}: ${result.error.message}`] : [])),
  }
}

/** A workspace that could not be asked, with the reason the page shows. */
export function failedAnswer(workspace: AskWorkspace, message: string): WorkspaceAnswer {
  return { workspace, text: null, model: null, notice: null, error: message, sources: [], unavailable: [] }
}

export type Segment = { text: string } | { cite: string }

/**
 * An answer's text split into prose and the `[entity.id]` citations among
 * `known`, so each citation can link to its source. Anything else in square
 * brackets - an evidence id, a stray bracket - stays prose.
 */
export function citationSegments(text: string, known: ReadonlySet<string>): Segment[] {
  const segments: Segment[] = []
  let rest = ''
  let last = 0
  for (const match of text.matchAll(/\[([^[\]\s]+)\]/g)) {
    const id = match[1] ?? ''
    if (!known.has(id)) continue
    rest += text.slice(last, match.index)
    if (rest) segments.push({ text: rest })
    rest = ''
    segments.push({ cite: id })
    last = (match.index ?? 0) + match[0].length
  }
  rest += text.slice(last)
  if (rest) segments.push({ text: rest })
  return segments
}

/** What the direct search filters on, besides its text. */
export interface SearchFilters {
  types: string[]
  tags: string[]
}

/** Whether an entity passes the filters: any of the chosen types, and every chosen tag. */
export function passes(entity: Pick<UiEntity, 'type' | 'tags'>, filters: SearchFilters): boolean {
  if (filters.types.length > 0 && !filters.types.includes(entity.type)) return false
  return filters.tags.every((tag) => entity.tags.includes(tag))
}

/**
 * The entities whose id, title, tags or text hold every word of `query`, best
 * first: what direct search falls back to when the index does not answer.
 */
export function textMatches(entities: readonly UiEntity[], query: string): UiEntity[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const scored = entities.flatMap((entity) => {
    const title = `${entity.id} ${entity.title}`.toLowerCase()
    const tags = entity.tags.join(' ').toLowerCase()
    const body = entity.content.toLowerCase()
    let score = 0
    for (const word of words) {
      if (title.includes(word)) score += 3
      else if (tags.includes(word)) score += 2
      else if (body.includes(word)) score += 1
      else return []
    }
    return [{ entity, score }]
  })
  return scored.sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id)).map(({ entity }) => entity)
}

/** One hit of the direct search, in the workspace that holds it. */
export interface SearchHit {
  workspace: AskWorkspace
  id: string
  title: string
  type: string
  tags: string[]
  path: string
  /** `neo4j`, `mem0`, or `documents` for the filter and text fallback. */
  foundBy: string[]
  /** What it says - its summary, else its body - around the query's first word. */
  summary: string | null
  /** Its weight of evidence, 0 to 1, when assessed. */
  weight: number | null
}

export interface BoardNode {
  /** `<workspace>/<id>`: ids are unique within a workspace only. */
  key: string
  id: string
  title: string
  type: string
  ghost: boolean
  workspace: string
  /** Its weight of evidence, 0 to 1, when assessed. */
  weight: number | null
  exhibits: number
  /** Overruled or Uncorroborated, worth flagging on its card. */
  flag: string | null
}

export interface BoardLink {
  key: string
  source: string
  target: string
  rel: string
}

/** The most entities the highlighted graph draws per workspace. */
export const BOARD_MAX = 80

/**
 * The search's hits on the graph: each workspace's matches and what they
 * link to, at most `max` entities per workspace, matches first. Keys carry
 * the workspace, so several workspaces share one board.
 */
export function highlightBoard(
  workspace: string,
  graph: {
    entities: readonly (Pick<UiEntity, 'id' | 'title' | 'type'> & Partial<Pick<UiEntity, 'assessment' | 'evidence' | 'frontmatter'>>)[]
    edges: readonly Pick<UiEdge, 'source' | 'rel' | 'target'>[]
  },
  matched: readonly string[],
  max = BOARD_MAX,
): { nodes: BoardNode[]; links: BoardLink[]; matched: string[] } {
  const entities = new Map(graph.entities.map((entity) => [entity.id, entity]))
  const kept: string[] = matched.filter((id) => entities.has(id)).slice(0, max)
  const hits = new Set(kept)
  for (const edge of graph.edges) {
    if (kept.length >= max) break
    const other = hits.has(edge.source) ? edge.target : hits.has(edge.target) ? edge.source : null
    if (other !== null && entities.has(other) && !kept.includes(other)) kept.push(other)
  }
  const on = new Set(kept)
  const key = (id: string) => `${workspace}/${id}`
  return {
    nodes: kept.map((id) => {
      const entity = entities.get(id)
      const standing = entity ? standingOf({ assessment: entity.assessment, evidence: entity.evidence ?? [], frontmatter: entity.frontmatter ?? {} }) : null
      return {
        key: key(id),
        id,
        title: entity?.title ?? id,
        type: entity?.type ?? '',
        ghost: false,
        workspace,
        weight: entity?.assessment?.confidence ?? null,
        exhibits: entity?.assessment?.evidenceCount ?? entity?.evidence?.length ?? 0,
        flag: standing && (standing.key === 'overruled' || standing.key === 'uncorroborated') ? standing.label : null,
      }
    }),
    links: graph.edges
      .filter((edge) => on.has(edge.source) && on.has(edge.target))
      .map((edge) => ({ key: `${key(edge.source)}\u0000${edge.rel}\u0000${key(edge.target)}`, source: key(edge.source), target: key(edge.target), rel: edge.rel })),
    matched: [...hits].map(key),
  }
}

/** Counts of each type and tag across the workspaces searched, for the filters. */
export function facets(entities: readonly Pick<UiEntity, 'type' | 'tags'>[]): { types: { name: string; count: number }[]; tags: { name: string; count: number }[] } {
  const types = new Map<string, number>()
  const tags = new Map<string, number>()
  for (const entity of entities) {
    types.set(entity.type, (types.get(entity.type) ?? 0) + 1)
    for (const tag of entity.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1)
  }
  const sorted = (counts: Map<string, number>) => [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
  return { types: sorted(types), tags: sorted(tags) }
}

/** The workspaces chosen, in the org's order, from the slugs a form or URL named; unknown slugs are dropped. */
export function chosenWorkspaces<W extends AskWorkspace>(all: readonly W[], slugs: readonly string[]): W[] {
  const wanted = new Set(slugs)
  return all.filter((workspace) => wanted.has(workspace.slug))
}

/** What a deleted docket's part of a saved answer becomes (the canonical store's `WORKSPACE_DELETED_MARKER`). */
export const WORKSPACE_DELETED = 'Source removed - workspace deleted'

/**
 * The agent's answer without what the `gone` dockets contributed: their steps
 * and records go, and since the answer's words cannot be told apart by docket,
 * so does the answer itself when it looked in any of them. Null when every
 * docket it was asked of is gone.
 */
export function agentWithout(agent: AgentAnswer, gone: ReadonlySet<string>): AgentAnswer | null {
  if (agent.workspaces.every((workspace) => gone.has(workspace.slug))) return null
  const touched = agent.steps.some((step) => step.workspace !== null && gone.has(step.workspace)) || agent.sources.some((source) => gone.has(source.workspace))
  if (!touched) return { ...agent, workspaces: agent.workspaces.filter((workspace) => !gone.has(workspace.slug)) }
  return {
    ...agent,
    ui: null,
    notice: null,
    error: WORKSPACE_DELETED,
    steps: agent.steps.filter((step) => step.workspace === null || !gone.has(step.workspace)),
    sources: agent.sources.filter((source) => !gone.has(source.workspace)),
    workspaces: agent.workspaces.filter((workspace) => !gone.has(workspace.slug)),
  }
}

/** The workspaces asked that still exist, and their parts of the answer. */
export function survivingAnswers<W extends AskWorkspace & { id: string }>(
  asked: readonly W[],
  answers: readonly WorkspaceAnswer[],
  existing: ReadonlySet<string>,
): { workspaces: W[]; answers: WorkspaceAnswer[] } {
  const workspaces = asked.filter((workspace) => existing.has(workspace.id))
  const slugs = new Set(workspaces.map((workspace) => workspace.slug))
  return { workspaces, answers: answers.filter((answer) => slugs.has(answer.workspace.slug)) }
}
