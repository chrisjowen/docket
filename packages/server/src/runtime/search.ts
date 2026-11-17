import { askWith, citationsIn, iconFor, MAX_SEARCH_LIMIT, openDocket, SEARCH_SCHEMA, snapshotOf, synthesisPrompt, toSearchResult, validate } from '@chrisjowen/docket'
import type {
  AdapterRegistration,
  AskOutcome,
  CanonicalReader,
  Chat,
  CoordinatedAnswer,
  MemoryAdapter,
  MemoryEntity,
  SearchLink,
  SearchNode,
  SearchPath,
  ValidateResult
} from '@chrisjowen/docket'

import { SEARCH_BACKENDS, type AskQuery, type AskResponse, type SearchBackend, type SearchChange, type SearchQuery, type WorkspaceMatch, type WorkspaceSearch } from '../mcp/query.js'
import type { StoreContext, StoreRunner } from '../ports.js'
import { indexStatus } from '../postgres/index-status.js'
import { listIngests, type IngestEvent } from '../postgres/ingest.js'
import { postgresSource } from '../postgres/source.js'
import { liveSupersessions, type Supersession } from '../postgres/supersession.js'
import { workspaceById } from '../postgres/workspaces.js'
import { changeNote, currentRecord, dayOf } from '../supersession.js'
import type { Logger } from './outbox.js'
import { CUT_MODEL, RETRIEVAL_CUT_MODEL } from './relevance-model.js'
import { coverage, cut, rerankText, unknownNames, vocabularyOf, type Candidate, type Placed, type Vocabulary } from './relevance.js'
import { MAX_TEXTS, type Reranker } from './reranker.js'
import { redactSecrets, workspaceScope } from './scope.js'

/** An error's message, redacted of any secret an adapter's own text may quote. */
const logMessage = (cause: unknown): string => redactSecrets(cause instanceof Error ? cause.message : String(cause))

/**
 * The search pipeline: `docket_search` and `docket_ask` over a workspace's
 * projections. Questions run through docket's own coordinator - the
 * deployment's adapter instances registered directly, scoped to the
 * workspace (`ws_<id>`) - and every answer is checked against the canonical
 * documents in Postgres. A search fuses what the projections found (and the
 * activity log), lets a cross-encoder read the question with each candidate,
 * and keeps only what a fitted model says is relevant: often fewer than its
 * limit, and nothing when nothing answers.
 */

/** The most entities the search board carries, as docket's (`MAX_NODES` in dist/mcp/search.js). */
const MAX_NODES = 60
const MAX_BODY_BYTES = 64 * 1024
/** The newest activity-log events a search reads for its timeline, as the graph tab's timeline does. */
const TIMELINE_READ = 300
/** Notes with fewer words than this, besides the resource's own name, say nothing a graph lookup would not. */
const NEAR_EMPTY_WORDS = 3
/** Content at least this similar (cosine over its words) is the same note twice. */
const NEAR_DUPLICATE = 0.9
/**
 * Hits a search asks of each projection, whatever its limit: the pool the
 * re-ranker reads and the cut model picks from. The search relevance
 * evaluation found each projection's top 20 no better than its top 10, at
 * twice the re-ranker's time.
 */
export const POOL_PER_SOURCE = 10
/** The most candidates the re-ranker reads for one question, best fused first: what keeps its CPU time in budget. */
export const MAX_RERANKED = 20
/**
 * How deep a search asks: each projection's hits, and the most candidates the
 * re-ranker reads, twice that, within what it reads at once. A `pool` below
 * the search's own is no shallower.
 */
export function searchDepth(pool?: number): { perSource: number; reranked: number } {
  const perSource = Math.max(POOL_PER_SOURCE, pool ?? 0)
  return { perSource, reranked: Math.min(MAX_TEXTS, (MAX_RERANKED / POOL_PER_SOURCE) * perSource) }
}
/** Reciprocal rank fusion's constant (Cormack et al., 2009): which candidates the re-ranker reads when there are more than it reads. */
const RRF_K = 60

export interface QueryServiceDeps<S extends SearchQuery = SearchQuery, A extends AskQuery = AskQuery> {
  /** The store a query's workspace is in. */
  store(query: S | A): StoreRunner
  /**
   * The projections a query is put to, opened for it; `cypher` is a model a
   * graph projection may write queries with (`docket_ask` only). `read`, when
   * given, hears of the canonical snapshot once it is read, for a projection
   * whose hits resolve through it.
   */
  projections(
    query: S | A,
    options: { cypher?: Chat }
  ): Promise<{ adapters: Readonly<Record<string, MemoryAdapter>>; read?(reader: CanonicalReader): void; close(): Promise<void> }>
  /** The projections whose lag makes the index "behind": those search cannot answer without. */
  instances: readonly string[]
  /** Reads the workspace's canonical documents; `validate` over the store when absent, a deployment's cache otherwise. */
  read?(ctx: StoreContext, workspaceId: string): Promise<ValidateResult>
  /**
   * The models a question may use; null when none is set up. A model call
   * that throws an error named `AiCapReached` or `AiNotConfigured` reads as
   * those notices.
   */
  models?(query: A): Models | null
  /** The cross-encoder a search re-ranks with; null where none runs, when results are cut on the projections' scores alone. */
  reranker: Reranker | null
  /** What each projection's own score means, by instance; `SIGNALS` when absent. */
  signals?: Readonly<Record<string, 'semantic' | 'lexical'>>
  /** Hears of every question once it is answered or has failed: a deployment keeps its traces with it. */
  observe?(event: QueryEvent<S, A>): Promise<void> | void
  log: Logger
}

/** The models a question uses: one writes the summary, and one a graph projection writes queries with. */
export interface Models {
  synthesis?: { model: string; chat: Chat }
  cypher?: Chat
}

/** One question, once it is answered or has failed. */
export type QueryEvent<S extends SearchQuery = SearchQuery, A extends AskQuery = AskQuery> = (
  | { tool: 'search'; query: S; result?: WorkspaceSearch }
  | { tool: 'ask'; query: A; result?: AskResponse }
) & {
  outcome: 'answered' | 'failed'
  durationMs: number
  /** What the question read, when it got as far as reading. */
  asked?: Asked
  error?: string
}

/**
 * The stand-in a deployment's projections factory returns for an instance
 * that could not be opened: it answers every question with why, so the
 * coordinator and observers see it failed.
 */
export function unopenedAdapter(id: string, cause: unknown): MemoryAdapter {
  const message = cause instanceof Error ? cause.message : String(cause)
  return {
    describe: () => ({ name: id, version: 'unavailable', inputs: [], resultKinds: ['entities'], rebuild: 'reconstructible' }),
    status: async () => ({ state: 'unavailable', message }),
    query: {
      ask: async () => {
        throw new Error(message)
      }
    },
    close: async () => undefined
  } as MemoryAdapter
}

/** One of the deployment's adapter instances, offered to docket's coordinator as a registration. */
function registration(id: string, adapter: MemoryAdapter): AdapterRegistration {
  return {
    id,
    roles: ['query'],
    definition: { apiVersion: 1, name: id, validateConfig: (input: unknown) => input, create: async () => adapter }
  }
}

export interface Asked {
  outcome: AskOutcome
  read: ValidateResult
  index: { synced: boolean; behind: number }
  project: { name: string; root: string }
  /** The workspace's records gone out of date, by id: never answered as current. */
  supersessions?: ReadonlyMap<string, Pick<Supersession, 'supersededBy' | 'validUntil' | 'reason'>>
}

/**
 * Reads the workspace once and puts the question to its projections, without
 * a summary: `maxResults` hits asked of each. `docket_search` never has a
 * model; `docket_ask`'s graph projection may write queries with `cypher`.
 */
export async function askProjections<S extends SearchQuery, A extends AskQuery>(
  deps: Pick<QueryServiceDeps<S, A>, 'store' | 'projections' | 'instances' | 'read'>,
  query: S | A,
  question: string,
  maxResults: number,
  cypher?: Chat
): Promise<Asked> {
  const { workspaceId } = query
  const opened = await deps.projections(query, cypher ? { cypher } : {})
  try {
    return await deps.store(query).run(async (ctx) => {
      const workspace = await workspaceById(ctx.tx, workspaceId)
      if (!workspace) throw new QueryFailure(404, 'No such workspace.')
      const read = deps.read ? await deps.read(ctx, workspaceId) : await validate({ source: postgresSource(ctx, workspaceId) })
      const snapshot = snapshotOf(read, workspaceScope(workspaceId))
      opened.read?.(snapshot.reader)
      const docket = await openDocket(snapshot.resolved, {
        registrations: Object.entries(opened.adapters).map(([id, adapter]) => registration(id, adapter)),
        canonical: snapshot.reader
      })
      const outcome = await askWith(snapshot, docket, { question, maxResults, synthesis: false, timezone: 'UTC' })
      const status = await indexStatus(ctx.tx, workspaceId, read, deps.instances)
      const supersessions = new Map((await liveSupersessions(ctx, workspaceId)).map((each) => [each.resourceId, each]))
      return {
        outcome,
        read,
        index: { synced: status.synced, behind: status.behind },
        project: { name: workspace.name, root: workspace.slug },
        supersessions
      }
    })
  } finally {
    await opened.close().catch(() => undefined)
  }
}

/**
 * Which of a search's candidates are relevant, and how relevant (`relevance.ts`):
 * nothing when the question names something the workspace has never recorded;
 * otherwise the cut model over the re-ranker's scores and the projections',
 * or over the projections' alone when the re-ranker is not there or fails.
 */
export async function rankCandidates(
  reranker: Reranker | null,
  query: string,
  workspace: string,
  asked: Asked,
  options: BoardOptions,
  log: Logger
): Promise<Ranked> {
  const vocabulary = vocabularyOf(workspace, asked.read.entities)
  if (unknownNames(vocabulary, query).length > 0) return { relevance: new Map() }
  const candidates = searchCandidates(query, asked, vocabulary, options, options.reranked)
  const limit = options.limit ?? MAX_SEARCH_LIMIT
  if (candidates.length === 0) return { relevance: new Map() }
  if (reranker) {
    try {
      const logits = await reranker.score(query, candidates.map((candidate) => candidate.text))
      const scored = candidates.map((candidate, index) => ({ ...candidate, logit: logits[index] }))
      return { relevance: new Map(cut(CUT_MODEL, scored, limit).map((kept) => [kept.id, kept.relevance])) }
    } catch (cause) {
      log.error(`search: the re-ranker failed, so results are cut on the projections' scores alone: ${logMessage(cause)}`)
      return {
        relevance: new Map(cut(RETRIEVAL_CUT_MODEL, candidates, limit).map((kept) => [kept.id, kept.relevance])),
        warnings: ['The re-ranker did not answer, so these results are ranked on the projections\' scores alone and may hold more noise.']
      }
    }
  }
  return { relevance: new Map(cut(RETRIEVAL_CUT_MODEL, candidates, limit).map((kept) => [kept.id, kept.relevance])) }
}


export function queryService<S extends SearchQuery = SearchQuery, A extends AskQuery = AskQuery>(deps: QueryServiceDeps<S, A>) {
  /** The workspace's newest activity-log events, for a search's timeline. */
  const timelineOf = (query: S): Promise<NonNullable<BoardOptions['timeline']>> =>
    deps.store(query).run((ctx) => listIngests(ctx, { workspaceId: query.workspaceId, limit: TIMELINE_READ, detail: false }))

  /**
   * Runs one question and tells `observe`, answered or failed. Observing never
   * fails the question: an observer that throws is logged and the answer goes
   * back as it is.
   */
  async function observed<T extends WorkspaceSearch | AskResponse>(
    event: { tool: 'search'; query: S } | { tool: 'ask'; query: A },
    run: (seen: { asked?: Asked }) => Promise<T>
  ): Promise<T> {
    const started = performance.now()
    const seen: { asked?: Asked } = {}
    const tell = async (outcome: 'answered' | 'failed', extra: { result?: T; error?: string }) => {
      if (!deps.observe) return
      try {
        await deps.observe({ ...event, outcome, durationMs: performance.now() - started, ...(seen.asked ? { asked: seen.asked } : {}), ...extra } as QueryEvent<S, A>)
      } catch (cause) {
        deps.log.error(`query: observing a ${event.tool}: ${logMessage(cause)}`)
      }
    }
    let value: T
    try {
      value = await run(seen)
    } catch (cause) {
      // A workspace that does not exist has nothing to observe.
      if (!(cause instanceof QueryFailure && cause.status === 404)) await tell('failed', { error: logMessage(cause) })
      throw cause
    }
    await tell('answered', { result: value })
    return value
  }

  return {
    search: (query: S): Promise<WorkspaceSearch> =>
      observed({ tool: 'search', query }, async (seen) => {
        const include = query.include ?? [...SEARCH_BACKENDS]
        const depth = searchDepth(query.pool)
        const [asked, timeline] = await Promise.all([
          askProjections(deps, query, query.query, depth.perSource),
          include.includes('timeline') ? timelineOf(query) : []
        ])
        seen.asked = asked
        const options: BoardOptions = { include, limit: query.limit, timeline, reranked: depth.reranked, ...(deps.signals ? { signals: deps.signals } : {}) }
        const ranked = await rankCandidates(deps.reranker, query.query, query.workspaceId, asked, options, deps.log)
        return searchBoard(query.query, asked, ranked, options)
      }),

    ask: (query: A): Promise<AskResponse> =>
      observed({ tool: 'ask', query }, async (seen) => {
        const models = deps.models?.(query) ?? null
        const asked = await askProjections(deps, query, query.question, query.maxResults ?? 20, models?.cypher)
        seen.asked = asked
        return summarise(models, asked)
      })
  }

  async function summarise(models: Models | null, asked: Asked): Promise<AskResponse> {
    const changes = changesFound(asked)
    const reply = await summarised(models, asked, changes)
    return changes.length ? { ...reply, changes } : reply
  }

  async function summarised(models: Models | null, asked: Asked, changes: readonly SearchChange[]): Promise<AskResponse> {
    const { answer, snapshot } = asked.outcome
    if (!models?.synthesis) return { answer, notice: 'AI is not set up on this server, so here is what the projections found; search still works.' }
    const built = synthesisPrompt({
      question: answer.question,
      context: answer.context ?? { scope: snapshot.scope, now: new Date().toISOString(), timezone: 'UTC' },
      results: answer.results,
      references: answer.references ?? [],
      connections: answer.connections ?? [],
      snapshot
    })
    if (built.exhibits.length === 0 && built.evidence.length === 0) {
      return { answer, notice: 'The projections found nothing, so there is nothing to summarise.' }
    }
    // Out-of-date records are never answered as current: the model is told what replaced each.
    const prompt = changes.length
      ? {
          ...built.prompt,
          user: [
            built.prompt.user,
            '',
            'Out of date - these records were superseded by newer ones. Never present them as current; answer with the current record and say what changed:',
            ...changes.map((change) => `- ${change.note}`)
          ].join('\n')
        }
      : built.prompt
    try {
      const text = (await models.synthesis.chat(prompt)).trim()
      const synthesis: CoordinatedAnswer['synthesis'] = {
        text,
        citedEntities: citationsIn(text, new Set(built.exhibits.map((exhibit) => exhibit.id))),
        citedEvidence: citationsIn(text, new Set(built.evidence)),
        model: models.synthesis.model,
        createdAt: new Date().toISOString()
      }
      // The coordinator's "no summary was asked for" no longer holds.
      const summarised: CoordinatedAnswer = { ...answer, synthesis }
      delete summarised.notice
      return { answer: summarised }
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : ''
      if (name === 'AiCapReached') return { answer, notice: 'AI budget for this month reached — search still works; ask an owner to raise the cap.' }
      if (name === 'AiNotConfigured') return { answer, notice: 'AI is not set up for this organisation yet; search still works.' }
      deps.log.error(`ask: synthesis failed for workspace ${asked.project.root}: ${logMessage(cause)}`)
      return { answer, notice: 'The model could not write a summary just now, so here is what the projections found.' }
    }
  }
}

export type QueryService<S extends SearchQuery = SearchQuery, A extends AskQuery = AskQuery> = ReturnType<typeof queryService<S, A>>

/** What a search reads besides the projections' answer, and how it narrows it. */
export interface BoardOptions {
  /** Where to look; every backend when omitted. */
  include?: readonly SearchBackend[] | undefined
  /** The most matches kept, best first; `MAX_SEARCH_LIMIT` when omitted. */
  limit?: number | undefined
  /** The workspace's activity log, as `listIngests` reads it, for the timeline to match. */
  timeline?: readonly Pick<IngestEvent, 'documents'>[] | undefined
  /** The most candidates the re-ranker reads, best fused first; `MAX_RERANKED` when omitted. */
  reranked?: number | undefined
  /** What each projection's own score means, by instance; `SIGNALS` when omitted. */
  signals?: Readonly<Record<string, 'semantic' | 'lexical'>> | undefined
}

/**
 * What `rankCandidates` kept of a search's candidates: each match's id with
 * its probability of being relevant, and why the ranking is degraded, when it is.
 */
export interface Ranked {
  relevance: ReadonlyMap<string, number>
  warnings?: readonly string[]
}

/**
 * The out-of-date records among what the projections and the timeline
 * found, each with the record current now: `ids` in the order found, each
 * once, the superseded ones only.
 */
function changesOf(ids: Iterable<string>, asked: Asked): SearchChange[] {
  const supersessions = asked.supersessions ?? new Map()
  const entities = new Map(asked.read.entities.map((entity) => [entity.id, entity]))
  const out = new Map<string, SearchChange>()
  for (const id of ids) {
    const held = supersessions.get(id)
    if (!held || out.has(id)) continue
    const entity = entities.get(id)
    const currentId = currentRecord(supersessions, id)
    const current = entities.get(currentId)
    const old = { id, type: entity?.type ?? '', title: entity?.title ?? id }
    const now = current && !supersessions.has(currentId) ? { id: current.id, type: current.type, title: current.title } : null
    out.set(id, {
      ...old,
      supersededBy: held.supersededBy,
      current: now,
      since: dayOf(held.validUntil),
      reason: held.reason,
      note: changeNote(old, now, held)
    })
  }
  return [...out.values()]
}

/** The out-of-date records `docket_ask`'s projections found. */
export function changesFound(asked: Asked): SearchChange[] {
  return changesOf(
    toSearchResult(asked.outcome).sources.flatMap((source) => source.hits.map((hit) => hit.id)),
    asked
  )
}

/** The words of a text, lower-cased. */
const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1)

/** Cosine similarity of two texts' word counts. */
function similarity(a: string, b: string): number {
  const counts = (text: string) => {
    const vector = new Map<string, number>()
    for (const word of wordsOf(text)) vector.set(word, (vector.get(word) ?? 0) + 1)
    return vector
  }
  const [left, right] = [counts(a), counts(b)]
  const norm = (vector: Map<string, number>) => Math.sqrt([...vector.values()].reduce((sum, n) => sum + n * n, 0))
  let dot = 0
  for (const [word, n] of left) dot += n * (right.get(word) ?? 0)
  return dot / (norm(left) * norm(right) || 1)
}

/**
 * What each projection's own score means, by instance: mem0's is a cosine similarity, Neo4j's a full-text (Lucene)
 * score, and cognee's the cosine similarity its floor turns cognee's distance into. A deployment with other
 * projections names theirs in `BoardOptions.signals`.
 */
export const SIGNALS: Readonly<Record<string, 'semantic' | 'lexical'>> = { mem0: 'semantic', neo4j: 'lexical', cognee: 'semantic' }

/** One resource a search found, wherever it found it. */
interface Found {
  foundIn: Set<SearchBackend>
  foundBy: Set<string>
  semantic?: Placed | undefined
  lexical?: Placed | undefined
  /** Its reciprocal-rank fusion over the projections: which candidates the re-ranker reads first. */
  fused: number
}

const better = (a: Placed | undefined, b: Placed | undefined) => (!a ? b : !b ? a : a.rank <= b.rank ? a : b)

/**
 * Everything a search found, as one candidate per resource: each projection's
 * hits (facts) and the resources the activity log names in the query's words
 * (timeline), tagged with where each was found - graph too, when a
 * projection's subgraph holds it. A record gone out of date is never a
 * candidate: what found it finds the record current now instead. Untitled
 * resources are never candidates, nor near-empty ones - no evidence,
 * attributes or evidenced link of their own, and notes that barely go past
 * their name. Of notes that say the same thing only the best-evidenced is
 * kept. Node confidence decides none of it.
 */
function gather(query: string, asked: Asked, options: BoardOptions) {
  const include = new Set(options.include ?? SEARCH_BACKENDS)
  const result = toSearchResult(asked.outcome)
  const { read } = asked
  const documents = new Map(result.documents.map((document) => [document.id, document]))
  const entities = new Map(read.entities.map((entity) => [entity.id, entity]))
  const subgraphs = include.has('graph') ? result.sources.flatMap((source) => (source.graph ? [{ by: source.name, ...source.graph }] : [])) : []
  const supersessions = asked.supersessions ?? new Map()
  const superseded = new Set(supersessions.keys())
  /** The superseded records found, in the order found, and the current records that stand in for them. */
  const stale: string[] = []
  const standsFor = new Map<string, Set<string>>()

  const nearEmpty = (entity: MemoryEntity) => {
    if (entity.evidenceCount > 0 || Object.keys(entity.attributes).length > 0 || entity.links.some((link) => link.evidenceCount > 0)) return false
    const named = new Set(wordsOf(`${entity.id} ${entity.title}`))
    return wordsOf(entity.content).filter((word) => !named.has(word)).length < NEAR_EMPTY_WORDS
  }
  const rejected = new Set([...entities.values(), ...documents.values()].filter((record) => !record.title.trim()).map((record) => record.id))

  const found = new Map<string, Found>()
  const find = (hit: string, backend: SearchBackend, by?: string, placed?: { signal: 'semantic' | 'lexical'; rank: number; score: number }) => {
    let id = hit
    if (superseded.has(hit)) {
      if (!stale.includes(hit)) stale.push(hit)
      id = currentRecord(supersessions, hit)
      if (superseded.has(id)) return
      standsFor.set(id, (standsFor.get(id) ?? new Set()).add(hit))
    }
    const entity = entities.get(id)
    if (rejected.has(id) || !(entity || documents.has(id)) || (entity && nearEmpty(entity))) return
    const known = found.get(id) ?? { foundIn: new Set<SearchBackend>(), foundBy: new Set<string>(), fused: 0 }
    known.foundIn.add(backend)
    if (by !== undefined) known.foundBy.add(by)
    if (placed) {
      known[placed.signal] = better(known[placed.signal], { rank: placed.rank, score: placed.score })
      known.fused += 1 / (RRF_K + placed.rank + 1)
    }
    found.set(id, known)
  }
  if (include.has('facts')) {
    for (const source of result.sources) {
      const signal = (options.signals ?? SIGNALS)[source.name]
      source.hits.forEach((hit, rank) =>
        find(hit.id, 'facts', source.name, signal && hit.score !== undefined && Number.isFinite(hit.score) ? { signal, rank, score: hit.score } : undefined)
      )
    }
  }
  const terms = [...new Set(wordsOf(query))]
  const logged = new Set((options.timeline ?? []).flatMap((event) => event.documents.map((document) => document.resourceId)))
  for (const id of include.has('timeline') && terms.length > 0 ? logged : []) {
    const words = new Set(wordsOf(`${id} ${entities.get(id)?.title ?? ''}`))
    if (terms.some((term) => words.has(term))) find(id, 'timeline')
  }
  for (const subgraph of subgraphs) {
    for (const node of subgraph.nodes) {
      const known = found.get(superseded.has(node.id) ? currentRecord(supersessions, node.id) : node.id)
      if (!known) continue
      known.foundIn.add('graph')
      known.foundBy.add(subgraph.by)
    }
  }

  // Of notes that say the same thing, the one with the most evidence, then the most confidence, then the most to say.
  const best = [...found.keys()].sort((a, b) => {
    const [left, right] = [entities.get(a), entities.get(b)]
    return (
      (right?.evidenceCount ?? 0) - (left?.evidenceCount ?? 0) ||
      (right?.confidence ?? 0) - (left?.confidence ?? 0) ||
      (right?.content.length ?? 0) - (left?.content.length ?? 0)
    )
  })
  const kept: string[] = []
  for (const id of best) {
    const entity = entities.get(id)
    const same = entity?.content.trim()
      ? kept.find((other) => {
          const twin = entities.get(other)
          return twin?.type === entity.type && twin.content.trim() !== '' && similarity(entity.content, twin.content) > NEAR_DUPLICATE
        })
      : undefined
    const into = same === undefined ? undefined : found.get(same)
    if (!into) {
      kept.push(id)
      continue
    }
    const from = found.get(id) as Found
    for (const backend of from.foundIn) into.foundIn.add(backend)
    for (const by of from.foundBy) into.foundBy.add(by)
    into.semantic = better(into.semantic, from.semantic)
    into.lexical = better(into.lexical, from.lexical)
    into.fused = Math.max(into.fused, from.fused)
    rejected.add(id)
  }
  // Best fused first; what only the timeline found after what a projection did, in the order found.
  const order = new Map([...found.keys()].map((id, index) => [id, index]))
  kept.sort((a, b) => (found.get(b) as Found).fused - (found.get(a) as Found).fused || (order.get(a) as number) - (order.get(b) as number))
  return { include, result, entities, documents, subgraphs, supersessions, superseded, stale, standsFor, rejected, found, kept }
}

/**
 * A search's candidates, best fused first and at most `most`: each
 * with what the re-ranker reads of it, where each projection ranked it and
 * its own score there, and how much of the question it holds.
 */
export function searchCandidates(query: string, asked: Asked, vocabulary: Vocabulary, options: BoardOptions = {}, most = MAX_RERANKED): (Candidate & { text: string })[] {
  const { entities, documents, found, kept } = gather(query, asked, options)
  const titleOf = (id: string) => entities.get(id)?.title
  return kept.slice(0, most).map((id) => {
    const at = found.get(id) as Found
    const record = entities.get(id) ?? { ...(documents.get(id) as { id: string; type: string; title: string }), content: '' }
    return { id, text: rerankText(record, titleOf), semantic: at.semantic, lexical: at.lexical, coverage: coverage(vocabulary, query, record) }
  })
}

/**
 * `docket_search`'s board, as docket's `searchGraph` draws it
 * (dist/mcp/search.js), over the workspace as a whole: the candidates the
 * search found (`gather`) that `ranked` keeps are its matches, most probably
 * relevant first, at most `limit` - none at all when nothing is relevant.
 * Then the subgraphs the projections returned, as context for the matches
 * (none when nothing matched), then the matches' neighbours
 * read from the canonical documents, at most 60 entities; a subgraph's other
 * nodes are context, never matches. A record gone out of date is never a
 * match nor on the board: the record current now stands in for it, and the
 * board names the change in `changes`. docket builds it over a project's own
 * files and adapters; here the adapters are the deployment's and the documents
 * are in Postgres, so the same steps run over what `ask` read.
 */
export function searchBoard(query: string, asked: Asked, ranked: Ranked, options: BoardOptions = {}): WorkspaceSearch {
  const { include, result, entities, documents, subgraphs, superseded, stale, standsFor, rejected, found, kept } = gather(query, asked, options)
  const { read } = asked
  const edges = read.entities.flatMap((entity) => entity.links.map((link) => ({ source: entity.id, rel: link.rel, target: link.target })))

  const matches: WorkspaceMatch[] = kept
    .filter((id) => ranked.relevance.has(id))
    .sort((a, b) => (ranked.relevance.get(b) as number) - (ranked.relevance.get(a) as number))
    .slice(0, options.limit ?? MAX_SEARCH_LIMIT)
    .map((id) => {
      const at = found.get(id) as Found
      const record = (entities.get(id) ?? documents.get(id)) as { type: string; title: string; path: string; confidence?: number }
      const replaces = standsFor.get(id)
      return {
        id,
        type: record.type,
        title: record.title,
        path: record.path,
        ...(record.confidence !== undefined ? { confidence: record.confidence } : {}),
        foundBy: [...at.foundBy],
        foundIn: SEARCH_BACKENDS.filter((backend) => at.foundIn.has(backend)),
        score: Math.round((ranked.relevance.get(id) as number) * 1000) / 1000,
        ...(replaces ? { supersedes: [...replaces] } : {})
      }
    })

  const nodeOf = (id: string, match: boolean, via: SearchNode['via'], returned?: { type?: string; label?: string }): SearchNode => {
    const entity = entities.get(id)
    if (entity) return { id, type: entity.type, title: entity.title, path: entity.path, match, ghost: false, via }
    const document = documents.get(id)
    return document
      ? { id, type: document.type, title: document.title, path: document.path, match, ghost: false, via }
      : { id, type: returned?.type ?? '', title: returned?.label || id, match, ghost: true, via }
  }
  const board = new Map(matches.map((match) => [match.id, nodeOf(match.id, true, match.foundBy.length > 0 ? 'adapter' : 'canonical')]))
  const returned = new Map<string, SearchNode>()
  // Context for the matches: with none, nothing - unless the graph alone was searched, which matches nothing itself.
  const context = matches.length > 0 || !(include.has('facts') || include.has('timeline'))
  for (const subgraph of context ? subgraphs : []) {
    for (const node of subgraph.nodes) {
      if (!board.has(node.id) && !returned.has(node.id) && !rejected.has(node.id) && !superseded.has(node.id)) returned.set(node.id, nodeOf(node.id, false, 'adapter', node))
    }
  }
  const neighbours: string[] = []
  for (const match of matches) {
    for (const edge of edges) {
      const other = edge.source === match.id ? edge.target : edge.target === match.id ? edge.source : null
      if (other !== null && !board.has(other) && !returned.has(other) && !rejected.has(other) && !superseded.has(other) && !neighbours.includes(other)) neighbours.push(other)
    }
  }
  const room = Math.max(0, MAX_NODES - board.size)
  const shown = [...returned.values()].slice(0, room)
  for (const node of shown) board.set(node.id, node)
  const left = Math.max(0, room - shown.length)
  for (const id of neighbours.slice(0, left)) board.set(id, nodeOf(id, false, 'canonical'))

  const keyOf = (link: { source: string; rel: string; target: string }) => `${link.source}\u0000${link.rel}\u0000${link.target}`
  const links = new Map<string, SearchLink>()
  for (const subgraph of subgraphs) {
    for (const edge of subgraph.edges) {
      if (!board.has(edge.source) || !board.has(edge.target)) continue
      const known = links.get(keyOf(edge))
      if (!known) {
        links.set(keyOf(edge), {
          source: edge.source,
          rel: edge.rel,
          target: edge.target,
          via: 'adapter',
          foundBy: [subgraph.by],
          ...(edge.confidence !== undefined ? { confidence: edge.confidence } : {}),
          ...(edge.why.length > 0 ? { why: [...edge.why] } : {})
        })
        continue
      }
      if (!known.foundBy?.includes(subgraph.by)) known.foundBy = [...(known.foundBy ?? []), subgraph.by]
      if (edge.confidence !== undefined && (known.confidence === undefined || edge.confidence > known.confidence)) known.confidence = edge.confidence
      const why = [...new Set([...(known.why ?? []), ...edge.why])]
      if (why.length > 0) known.why = why
    }
  }
  for (const edge of edges) {
    if (!board.has(edge.source) || !board.has(edge.target) || links.has(keyOf(edge))) continue
    links.set(keyOf(edge), { source: edge.source, rel: edge.rel, target: edge.target, via: 'canonical' })
  }
  const paths = new Map<string, SearchPath>()
  for (const subgraph of subgraphs) {
    for (const path of subgraph.paths) {
      if (!path.every((id) => board.has(id))) continue
      const known = paths.get(path.join('\u0000'))
      if (!known) paths.set(path.join('\u0000'), { nodes: [...path], foundBy: [subgraph.by] })
      else if (!known.foundBy.includes(subgraph.by)) known.foundBy.push(subgraph.by)
    }
  }
  for (const path of paths.values()) {
    const steps = new Set(path.nodes.slice(1).flatMap((id, index) => [`${path.nodes[index]}\u0000${id}`, `${id}\u0000${path.nodes[index]}`]))
    const why = [...new Set([...links.values()].filter((link) => link.via === 'adapter' && steps.has(`${link.source}\u0000${link.target}`)).flatMap((link) => link.why ?? []))]
    if (why.length > 0) path.why = why
  }
  const counts = new Map<string, number>()
  for (const entity of read.entities) counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1)
  const declared = read.ontology?.resourceTypes ?? {}
  const names = [...new Set([...Object.keys(declared), ...counts.keys()])].sort()
  // Only the changes a match answers for: what found an out-of-date record found its current one.
  const matched = new Set(matches.map((match) => match.id))
  const changes = changesOf(stale.filter((id) => matched.has(currentRecord(asked.supersessions ?? new Map(), id))), asked)
  return {
    schema: SEARCH_SCHEMA,
    query,
    project: asked.project,
    matches,
    ...(changes.length ? { changes } : {}),
    nodes: [...board.values()],
    links: [...links.values()],
    paths: [...paths.values()],
    omitted: returned.size - shown.length + Math.max(0, neighbours.length - left),
    types: names.map((name) => ({ name, icon: iconFor(name, declared[name]?.icon), count: counts.get(name) ?? 0 })),
    sources: result.sources.map((source) => ({
      name: source.name,
      hits: source.hits.length,
      ...(source.note ? { note: source.note } : {}),
      ...(source.error ? { error: redactSecrets(source.error) } : {})
    })),
    index: asked.index,
    viewer: null,
    warnings: [...result.diagnostics.map((diagnostic) => diagnostic.message), ...(ranked.warnings ?? [])]
  }
}

/** A refusal a query service may pass on to the MCP client as it is. */
export class QueryFailure extends Error {
  override name = 'QueryFailure'
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

