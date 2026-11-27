// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs'
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'

import { openDocket, type AdapterRegistration, type CoordinatedAnswer } from '@chrisjowen/docket'
import type { CanonicalReader, MemoryAdapter } from '@chrisjowen/docket/contracts'
import { MAX_SEARCH_LIMIT } from '@chrisjowen/docket/mcp/search'
import { SEARCH_SCHEMA, type SearchLink, type SearchNode, type SearchPath } from '@chrisjowen/docket/mcp/types'
import { iconFor } from '@chrisjowen/docket/ontology/icons'
import { askWith, type AskOutcome } from '@chrisjowen/docket/query/ask'
import { toSearchResult } from '@chrisjowen/docket/query/legacy'
import { pendingChanges } from '@chrisjowen/docket/workspace'
import { snapshotOf } from '@chrisjowen/docket/query/snapshot'
import { citationsIn, synthesisPrompt } from '@chrisjowen/docket/query/synthesis'
import { AiCapReached, AiNotConfigured, chatOf, modelChoices, type MeteredCall, type Models, type ToolCall, type TurnMessage, type TurnModel, type TurnTool } from '@docket/platform-ai'
import {
  COGNEE,
  changeNote,
  cogneeFloor,
  currentRecord,
  dayOf,
  indexStatus,
  listIngests,
  liveSupersessions,
  openProposals,
  readWorkspace,
  recordQueryTrace,
  workspaceById,
  type IngestEvent,
  type Keyring,
  type MemoryEntity,
  type QueryTool,
  type Supersession,
  type TracedCall,
  type ValidateResult,
} from '@docket/platform-canonical-store'
import {
  QUERY_PATHS,
  SEARCH_BACKENDS,
  TURN_PURPOSES,
  queryAuthorised,
  searchScope,
  type AskQuery,
  type AskResponse,
  type SearchBackend,
  type SearchChange,
  type SearchQuery,
  type TurnPurpose,
  type TurnQuery,
  type TurnResponse,
  type WorkspaceMatch,
  type WorkspaceSearch,
} from '@docket/platform-mcp-tools/query'
import { closeAll, openCognee, openProjections, type CogneeAccess, type OpenCogneeOptions, type StoreAccess } from '@docket/platform-projections'
import { workspaceScope, type TenantRouter } from '@docket/platform-tenancy'

import type { Logger } from './outbox.js'
import { CUT_MODEL, RETRIEVAL_CUT_MODEL } from './relevance-model.js'
import { coverage, cut, rerankText, unknownNames, vocabularyOf, type Candidate, type Placed, type Vocabulary } from './relevance.js'
import { MAX_TEXTS, type Reranker } from './reranker.js'
import { traceOf, type TraceInput } from './trace.js'

/**
 * The query service (§9): `docket_search` and `docket_ask` over a
 * workspace's projections, for the API's MCP endpoint. Only the worker
 * reaches an org's Neo4j pod and Qdrant collections, so the API asks it.
 * Questions run through docket's own coordinator - the cloud's adapter
 * instances registered directly, scoped to the workspace (`ws_<id>`) - and
 * every answer is checked against the canonical documents in Postgres.
 */

/** The most entities the search board carries, as docket's (`MAX_NODES` in dist/mcp/search.js). */
const MAX_NODES = 60
const MAX_BODY_BYTES = 64 * 1024
/** An agent's turn carries the conversation so far, tool results and all. */
const MAX_TURN_BYTES = 1024 * 1024
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

export interface QueryServiceDeps {
  router: TenantRouter
  keyring: Keyring
  /** The docket's stores for one question (tenancy v2 §5: its space's Neo4j or the account's, its own collection or the account's). */
  storeAccess(orgId: string, workspaceId: string): Promise<StoreAccess>
  /**
   * The org's metered, capped models (§11); null when OpenRouter is not set
   * up. `onUsage` hears of each metered call, for the question's trace.
   */
  models(orgId: string, context: { workspaceId: string; actor: string; onUsage(call: MeteredCall): void }): Models | null
  /** The org's metered, capped model for turns (the Ask page's agent, ontology drafts); null when OpenRouter is not set up. */
  turns?(orgId: string, context: { actor: string; purpose: TurnPurpose }): TurnModel | null
  /**
   * The cross-encoder `docket_search` re-ranks with (`reranker.ts`); null
   * where none runs, as in a local preview, when results are cut on the
   * projections' scores alone.
   */
  reranker: Reranker | null
  /**
   * The platform's cognee service, asked alongside the fixed projections for
   * a workspace that turned cognee on, held to its floor; null where none runs.
   */
  cognee?: { access: CogneeAccess; open?(options: OpenCogneeOptions): Promise<MemoryAdapter> } | null
  log: Logger
}

/** An instance that could not be opened: it answers every question with why, so the coordinator and the trace show it failed. */
function unopened(id: string, cause: unknown): MemoryAdapter {
  const message = cause instanceof Error ? cause.message : String(cause)
  return {
    describe: () => ({ name: id, version: 'unavailable', inputs: [], resultKinds: ['entities'], rebuild: 'reconstructible' }),
    status: async () => ({ state: 'unavailable', message }),
    query: {
      ask: async () => {
        throw new Error(message)
      },
    },
    close: async () => undefined,
  } as MemoryAdapter
}

/**
 * The workspace's cognee, when it turned it on: docket's cognee adapter on the
 * platform's service, asked with the workspace's floor so it can answer with
 * nothing. Its hits resolve through the snapshot the question reads, handed
 * over once it is read. Null while cognee is off or no service runs.
 */
async function openWorkspaceCognee(
  deps: Pick<QueryServiceDeps, 'router' | 'cognee'>,
  orgId: string,
  workspaceId: string,
): Promise<{ adapter: MemoryAdapter; read(reader: CanonicalReader): void } | null> {
  const { cognee } = deps
  if (!cognee) return null
  const floor = await deps.router.withTenant(orgId, (tx) => cogneeFloor(tx, workspaceId))
  if (floor === null) return null
  let reader: CanonicalReader | undefined
  const canonical: CanonicalReader = {
    get: async (kind, id) => reader?.get(kind, id),
    list: async (kind) => (reader ? reader.list(kind) : []),
  }
  try {
    const adapter = await (cognee.open ?? openCognee)({ orgId, workspaceId, access: cognee.access, canonical, floor })
    return { adapter, read: (snapshot) => void (reader = snapshot) }
  } catch (cause) {
    return { adapter: unopened(COGNEE, cause), read: () => undefined }
  }
}

/** One of the cloud's adapter instances, offered to docket's coordinator as a registration. */
function registration(id: string, adapter: MemoryAdapter): AdapterRegistration {
  return {
    id,
    roles: ['query'],
    definition: { apiVersion: 1, name: id, validateConfig: (input: unknown) => input, create: async () => adapter },
  }
}

export interface Asked {
  outcome: AskOutcome
  read: ValidateResult
  index: { synced: boolean; behind: number }
  project: { name: string; root: string }
  /** The workspace's records gone out of date, by id: never answered as current. */
  supersessions?: ReadonlyMap<string, Pick<Supersession, 'supersededBy' | 'validUntil' | 'reason'>>
  /** Its supersede proposals not yet fact: the records they would replace are still current. */
  pending?: Awaited<ReturnType<typeof openProposals>>
}

/**
 * Reads the workspace once and puts the question to its projections, without
 * a summary: `maxResults` hits asked of each. `docket_search` never has a
 * model (§11); `docket_ask`'s Neo4j writes Cypher with the org's.
 */
export async function askProjections(
  deps: Pick<QueryServiceDeps, 'router' | 'keyring' | 'storeAccess' | 'cognee'>,
  orgId: string,
  workspaceId: string,
  question: string,
  maxResults: number,
  models: Models | null,
): Promise<Asked> {
  const keys = await deps.keyring.forOrg(orgId)
  const access = await deps.storeAccess(orgId, workspaceId)
  const adapters = await openProjections({ orgId, workspaceId, access, ...(models?.cypher ? { cypher: chatOf(models.cypher) } : {}) })
  const cognee = await openWorkspaceCognee(deps, orgId, workspaceId).catch(async (cause: unknown) => {
    await closeAll(adapters).catch(() => undefined)
    throw cause
  })
  try {
    return await deps.router.withTenant(orgId, async (tx) => {
      const workspace = await workspaceById(tx, workspaceId)
      if (!workspace) throw new QueryFailure(404, 'No such workspace.')
      const read = await readWorkspace({ tx, keys }, workspaceId)
      const snapshot = snapshotOf(read, workspaceScope(workspaceId))
      cognee?.read(snapshot.reader)
      const registered: [string, MemoryAdapter][] = [...Object.entries(adapters), ...(cognee ? [[COGNEE, cognee.adapter] as [string, MemoryAdapter]] : [])]
      const docket = await openDocket(snapshot.resolved, {
        registrations: registered.map(([id, adapter]) => registration(id, adapter)),
        canonical: snapshot.reader,
      })
      const outcome = await askWith(snapshot, docket, { question, maxResults, synthesis: false, timezone: 'UTC' })
      const status = await indexStatus(tx, workspaceId, read)
      const supersessions = new Map((await liveSupersessions({ tx, keys }, workspaceId)).map((each) => [each.resourceId, each]))
      const pending = await openProposals({ tx, keys }, workspaceId)
      return {
        outcome,
        read,
        index: { synced: status.synced, behind: status.behind },
        project: { name: workspace.name, root: workspace.slug },
        supersessions,
        ...(pending.length ? { pending } : {}),
      }
    })
  } finally {
    await closeAll(adapters).catch(() => undefined)
    await cognee?.adapter.close().catch(() => undefined)
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
  log: Logger,
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
      log.error(`search: the re-ranker failed, so results are cut on the projections' scores alone: ${cause instanceof Error ? cause.message : String(cause)}`)
      return {
        relevance: new Map(cut(RETRIEVAL_CUT_MODEL, candidates, limit).map((kept) => [kept.id, kept.relevance])),
        warnings: ['The re-ranker did not answer, so these results are ranked on the projections\' scores alone and may hold more noise.'],
      }
    }
  }
  return { relevance: new Map(cut(RETRIEVAL_CUT_MODEL, candidates, limit).map((kept) => [kept.id, kept.relevance])) }
}

export function queryService(deps: QueryServiceDeps) {
  const ask = (orgId: string, workspaceId: string, question: string, maxResults: number, models: Models | null) =>
    askProjections(deps, orgId, workspaceId, question, maxResults, models)

  /** The workspace's newest activity-log events, for a search's timeline. */
  async function timelineOf(orgId: string, workspaceId: string): Promise<NonNullable<BoardOptions['timeline']>> {
    const keys = await deps.keyring.forOrg(orgId)
    return deps.router.withTenant(orgId, (tx) => listIngests({ tx, keys }, { workspaceId, limit: TIMELINE_READ, detail: false }))
  }

  /**
   * Runs one question and keeps its trace (Settings → Queries), answered or
   * failed. Keeping the trace never fails the question: a trace that cannot
   * be written is logged and the answer goes back as it is.
   */
  async function traced<T>(
    query: { orgId: string; workspaceId: string; actor?: string | undefined; userId: string },
    tool: QueryTool,
    question: string,
    run: (trace: { calls: TracedCall[]; done(input: Omit<TraceInput, 'question' | 'calls'>): void }) => Promise<T>,
  ): Promise<T> {
    const started = performance.now()
    const calls: TracedCall[] = []
    let finished: Omit<TraceInput, 'question' | 'calls'> | undefined
    const keep = async (outcome: 'answered' | 'failed', input: Omit<TraceInput, 'question' | 'calls'>) => {
      try {
        const keys = await deps.keyring.forOrg(query.orgId)
        await deps.router.withTenant(query.orgId, (tx) =>
          recordQueryTrace(
            { tx, keys },
            {
              workspaceId: query.workspaceId,
              tool,
              actor: query.actor ?? 'unknown',
              userId: query.userId,
              outcome,
              durationMs: performance.now() - started,
              detail: traceOf({ question, calls, ...input }),
            },
          ),
        )
      } catch (cause) {
        deps.log.error(`query: keeping the trace for org ${query.orgId}: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
    let value: T
    try {
      value = await run({ calls, done: (input) => (finished = input) })
    } catch (cause) {
      // A workspace that does not exist has nowhere to keep a trace.
      if (!(cause instanceof QueryFailure && cause.status === 404)) {
        await keep('failed', { ...finished, error: cause instanceof Error ? cause.message : String(cause) })
      }
      throw cause
    }
    await keep('answered', finished ?? {})
    return value
  }

  /** What a trace says the documents held, and the exhibits' titles to name the stores' hits by. */
  const traceRead = (asked: Asked) => ({
    answer: asked.outcome.answer,
    entities: new Map(asked.read.entities.map((entity) => [entity.id, { title: entity.title, type: entity.type }])),
    read: { exhibits: asked.read.entities.length, documents: asked.read.documents.length, indexBehind: asked.index.behind, indexSynced: asked.index.synced },
  })

  return {
    search: (query: SearchQuery): Promise<WorkspaceSearch> =>
      traced(query, 'search', query.query, async (trace) => {
        const include = query.include ?? [...SEARCH_BACKENDS]
        const depth = searchDepth(query.pool)
        const [asked, timeline] = await Promise.all([
          ask(query.orgId, query.workspaceId, query.query, depth.perSource, null),
          include.includes('timeline') ? timelineOf(query.orgId, query.workspaceId) : [],
        ])
        trace.done(traceRead(asked))
        const options: BoardOptions = { include, limit: query.limit, timeline, reranked: depth.reranked }
        const ranked = await rankCandidates(deps.reranker, query.query, `${query.orgId}/${query.workspaceId}`, asked, options, deps.log)
        return searchBoard(query.query, asked, ranked, options)
      }),

    ask: (query: AskQuery): Promise<AskResponse> =>
      traced(query, 'ask', query.question, async (trace) => {
        const onUsage = (call: MeteredCall) => trace.calls.push(call)
        const response = await answer(query, deps.models(query.orgId, { workspaceId: query.workspaceId, actor: query.actor, onUsage }), (asked) =>
          trace.done(traceRead(asked)),
        )
        trace.done({ ...traceRead(response.asked), ...(response.reply.notice ? { notice: response.reply.notice } : {}), answer: response.reply.answer })
        return response.reply
      }),

    /** One turn on the org's model: the cap checked, the call metered as its purpose (`agent` by default). */
    async turn(query: TurnQuery): Promise<TurnResponse> {
      const model = deps.turns?.(query.orgId, { actor: query.actor, purpose: query.purpose ?? 'agent' }) ?? null
      if (!model) return { unavailable: 'not-configured', notice: 'AI is not set up on this server; search still works.' }
      try {
        const result = await model.turn({
          messages: query.messages,
          tools: query.tools,
          ...(query.toolChoice ? { toolChoice: query.toolChoice } : {}),
          ...(query.maxTokens ? { maxTokens: query.maxTokens } : {}),
        })
        return { content: result.content, toolCalls: result.toolCalls, model: result.model, costUsd: result.usage.costUsd }
      } catch (cause) {
        if (cause instanceof AiCapReached) return { unavailable: 'cap-reached', notice: 'AI budget for this month reached — search still works; ask an owner to raise the cap.' }
        if (cause instanceof AiNotConfigured) return { unavailable: 'not-configured', notice: 'AI is not set up for this organisation yet; search still works.' }
        deps.log.error(`turn: the model failed for org ${query.orgId}: ${cause instanceof Error ? cause.message : String(cause)}`)
        throw new QueryFailure(502, 'The model could not answer just now.')
      }
    },
  }

  /** `docket_ask`: the projections' answer, and the summary the org's model writes over it. */
  async function answer(query: AskQuery, models: Models | null, read: (asked: Asked) => void): Promise<{ asked: Asked; reply: AskResponse }> {
    const asked = await ask(query.orgId, query.workspaceId, query.question, query.maxResults ?? 20, models)
    read(asked)
    // The Ask page's agent writes the answer itself: the grounded retrieval alone, with no summary.
    const reply = query.summary === false ? withChanges({ answer: asked.outcome.answer }, changesFound(asked)) : await summarise(query, models, asked)
    return { asked, reply: withPending(reply, pendingFound(asked)) }
  }

  async function summarise(query: AskQuery, models: Models | null, asked: Asked): Promise<AskResponse> {
    const changes = changesFound(asked)
    return withChanges(await summarised(query, models, asked, changes), changes)
  }

  async function summarised(query: AskQuery, models: Models | null, asked: Asked, changes: readonly SearchChange[]): Promise<AskResponse> {
    const { answer, snapshot } = asked.outcome
    if (!models?.synthesis) return { answer, notice: 'AI is not set up on this server, so here is what the projections found; search still works.' }
    const built = synthesisPrompt({
      question: answer.question,
      context: answer.context ?? { scope: snapshot.scope, now: new Date().toISOString(), timezone: 'UTC' },
      results: answer.results,
      references: answer.references ?? [],
      connections: answer.connections ?? [],
      snapshot,
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
            ...changes.map((change) => `- ${change.note}`),
          ].join('\n'),
        }
      : built.prompt
    try {
      const text = (await chatOf(models.synthesis)(prompt)).trim()
      const model = (await deps.router.withPlatform((tx) => modelChoices(tx, query.orgId, query.workspaceId))).synthesis
      const synthesis: CoordinatedAnswer['synthesis'] = {
        text,
        citedEntities: citationsIn(text, new Set(built.exhibits.map((exhibit) => exhibit.id))),
        citedEvidence: citationsIn(text, new Set(built.evidence)),
        model,
        createdAt: new Date().toISOString(),
      }
      // The coordinator's "no summary was asked for" no longer holds.
      const summarised: CoordinatedAnswer = { ...answer, synthesis }
      delete summarised.notice
      return { answer: summarised }
    } catch (cause) {
      if (cause instanceof AiCapReached) return { answer, notice: 'AI budget for this month reached — search still works; ask an owner to raise the cap.' }
      if (cause instanceof AiNotConfigured) return { answer, notice: 'AI is not set up for this organisation yet; search still works.' }
      deps.log.error(`ask: synthesis failed for org ${query.orgId}: ${cause instanceof Error ? cause.message : String(cause)}`)
      return { answer, notice: 'The model could not write a summary just now, so here is what the projections found.' }
    }
  }
}

const withChanges = (reply: AskResponse, changes: readonly SearchChange[]): AskResponse => (changes.length ? { ...reply, changes: [...changes] } : reply)

const withPending = (reply: AskResponse, pending: ReturnType<typeof pendingChanges>): AskResponse => (pending.length ? { ...reply, pending } : reply)

/** The supersede proposals not yet fact that touch what `docket_ask`'s projections found: those records are still current. */
export function pendingFound(asked: Asked): ReturnType<typeof pendingChanges> {
  if (!asked.pending?.length) return []
  return pendingChanges(asked.pending, toSearchResult(asked.outcome).sources.flatMap((source) => source.hits.map((hit) => hit.id)))
}

export type QueryService = ReturnType<typeof queryService>

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
      note: changeNote(old, now, held),
    })
  }
  return [...out.values()]
}

/** The out-of-date records `docket_ask`'s projections found. */
export function changesFound(asked: Asked): SearchChange[] {
  return changesOf(
    toSearchResult(asked.outcome).sources.flatMap((source) => source.hits.map((hit) => hit.id)),
    asked,
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
 * What each projection's own score means: mem0's is a cosine similarity, Neo4j's a full-text (Lucene) score, and
 * cognee's the cosine similarity its floor turns cognee's distance into, over the same in-cluster embedder as mem0's.
 */
const SIGNALS: Readonly<Record<string, 'semantic' | 'lexical'>> = { mem0: 'semantic', neo4j: 'lexical', [COGNEE]: 'semantic' }

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
      const signal = SIGNALS[source.name]
      source.hits.forEach((hit, rank) =>
        find(hit.id, 'facts', source.name, signal && hit.score !== undefined && Number.isFinite(hit.score) ? { signal, rank, score: hit.score } : undefined),
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
 * files and adapters; here the adapters are the org's and the documents are
 * in Postgres, so the same steps run over what `ask` read.
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
        ...(replaces ? { supersedes: [...replaces] } : {}),
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
          ...(edge.why.length > 0 ? { why: [...edge.why] } : {}),
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
  // Proposals not yet fact about a match: it is still current, and the reader is told what may replace it.
  const pending = asked.pending?.length ? pendingChanges(asked.pending, matches.map((match) => match.id)) : []
  return {
    schema: SEARCH_SCHEMA,
    query,
    project: asked.project,
    matches,
    ...(changes.length ? { changes } : {}),
    ...(pending.length ? { pending } : {}),
    nodes: [...board.values()],
    links: [...links.values()],
    paths: [...paths.values()],
    omitted: returned.size - shown.length + Math.max(0, neighbours.length - left),
    types: names.map((name) => ({ name, icon: iconFor(name, declared[name]?.icon), count: counts.get(name) ?? 0 })),
    sources: result.sources.map((source) => ({
      name: source.name,
      hits: source.hits.length,
      ...(source.note ? { note: source.note } : {}),
      ...(source.error ? { error: source.error } : {}),
    })),
    index: asked.index,
    viewer: null,
    warnings: [...result.diagnostics.map((diagnostic) => diagnostic.message), ...(ranked.warnings ?? [])],
  }
}

/** A refusal the API may pass on to the MCP client as it is. */
export class QueryFailure extends Error {
  override name = 'QueryFailure'
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const ID = /^[a-z0-9]{1,40}$/

export function parseSearch(body: Record<string, unknown>): SearchQuery {
  const { orgId, workspaceId, query, limit, actor, userId, include, pool, minConfidence } = body
  if (typeof orgId !== 'string' || !ID.test(orgId) || typeof workspaceId !== 'string' || !ID.test(workspaceId)) throw new QueryFailure(400, 'orgId and workspaceId are required.')
  if (typeof query !== 'string' || !query.trim() || query.length > 2_000) throw new QueryFailure(400, 'query is required.')
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new QueryFailure(400, 'limit must be 1 to 50.')
  if (actor !== undefined && (typeof actor !== 'string' || !actor || actor.length > 300)) throw new QueryFailure(400, 'actor must be a short string.')
  if (typeof userId !== 'string' || !userId || userId.length > 100) throw new QueryFailure(400, 'userId is required.')
  if (pool !== undefined && (typeof pool !== 'number' || !Number.isInteger(pool) || pool < 1 || pool > 50)) throw new QueryFailure(400, 'pool must be 1 to 50.')
  const scope = searchScope(include, minConfidence)
  if (typeof scope === 'string') throw new QueryFailure(400, scope)
  return { orgId, workspaceId, query: query.trim(), limit, userId, ...(actor !== undefined ? { actor } : {}), ...(pool !== undefined ? { pool } : {}), ...scope }
}

function parseAsk(body: Record<string, unknown>): AskQuery {
  const { orgId, workspaceId, question, maxResults, actor, userId, summary } = body
  if (typeof orgId !== 'string' || !ID.test(orgId) || typeof workspaceId !== 'string' || !ID.test(workspaceId)) throw new QueryFailure(400, 'orgId and workspaceId are required.')
  if (typeof question !== 'string' || !question.trim() || question.length > 2_000) throw new QueryFailure(400, 'question is required.')
  if (typeof actor !== 'string' || !actor || actor.length > 300) throw new QueryFailure(400, 'actor is required.')
  if (typeof userId !== 'string' || !userId || userId.length > 100) throw new QueryFailure(400, 'userId is required.')
  if (maxResults !== undefined && (typeof maxResults !== 'number' || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50)) {
    throw new QueryFailure(400, 'maxResults must be 1 to 50.')
  }
  if (summary !== undefined && typeof summary !== 'boolean') throw new QueryFailure(400, 'summary must be true or false.')
  return { orgId, workspaceId, question: question.trim(), actor, userId, ...(maxResults !== undefined ? { maxResults } : {}), ...(summary !== undefined ? { summary } : {}) }
}

const isText = (value: unknown, most: number): value is string => typeof value === 'string' && value.length <= most
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function parseToolCalls(raw: unknown): ToolCall[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 16) return null
  const calls: ToolCall[] = []
  for (const call of raw) {
    if (!isRecord(call) || !isText(call.id, 200) || !isText(call.name, 64) || !TOOL_NAME.test(call.name) || !isText(call.arguments, 20_000)) return null
    calls.push({ id: call.id, name: call.name, arguments: call.arguments })
  }
  return calls
}

function parseMessage(raw: unknown): TurnMessage | null {
  if (!isRecord(raw) || !isText(raw.content, 200_000)) return null
  if (raw.role === 'system' || raw.role === 'user') return { role: raw.role, content: raw.content }
  if (raw.role === 'tool') return isText(raw.toolCallId, 200) ? { role: 'tool', toolCallId: raw.toolCallId, content: raw.content } : null
  if (raw.role !== 'assistant') return null
  const toolCalls = parseToolCalls(raw.toolCalls)
  return toolCalls ? { role: 'assistant', content: raw.content, ...(toolCalls.length ? { toolCalls } : {}) } : null
}

export function parseTurn(body: Record<string, unknown>): TurnQuery {
  const { orgId, actor, userId, messages, tools, toolChoice, maxTokens, purpose } = body
  if (typeof orgId !== 'string' || !ID.test(orgId)) throw new QueryFailure(400, 'orgId is required.')
  if (typeof actor !== 'string' || !actor || actor.length > 300) throw new QueryFailure(400, 'actor is required.')
  if (typeof userId !== 'string' || !userId || userId.length > 100) throw new QueryFailure(400, 'userId is required.')
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100) throw new QueryFailure(400, 'messages must list 1 to 100 messages.')
  const parsed = messages.map(parseMessage)
  if (parsed.some((message) => message === null)) throw new QueryFailure(400, 'Each message needs a role and its content.')
  if (!Array.isArray(tools) || tools.length > 16) throw new QueryFailure(400, 'tools must list at most 16 tools.')
  const parsedTools: TurnTool[] = []
  for (const tool of tools) {
    if (!isRecord(tool) || !isText(tool.name, 64) || !TOOL_NAME.test(tool.name) || !isText(tool.description, 4_000) || !isRecord(tool.parameters)) {
      throw new QueryFailure(400, 'Each tool needs a name, a description and its parameters.')
    }
    parsedTools.push({ name: tool.name, description: tool.description, parameters: tool.parameters })
  }
  if (toolChoice !== undefined && toolChoice !== 'auto' && toolChoice !== 'none') throw new QueryFailure(400, 'toolChoice must be "auto" or "none".')
  if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8_000)) {
    throw new QueryFailure(400, 'maxTokens must be 1 to 8000.')
  }
  if (purpose !== undefined && !(TURN_PURPOSES as readonly unknown[]).includes(purpose)) throw new QueryFailure(400, `purpose must be one of ${TURN_PURPOSES.join(', ')}.`)
  return {
    orgId,
    actor,
    userId,
    messages: parsed as TurnMessage[],
    tools: parsedTools,
    ...(toolChoice !== undefined ? { toolChoice } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(purpose !== undefined ? { purpose: purpose as TurnPurpose } : {}),
  }
}

async function readJson(req: IncomingMessage, most = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > most) throw new QueryFailure(413, 'The request is too large.')
    chunks.push(chunk as Buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Answered below.
  }
  throw new QueryFailure(400, 'Send one JSON object.')
}

/**
 * Serves the query service: HTTPS with the internal CA's certificate in the
 * cluster; plain HTTP on loopback only, and never in production, for a local
 * preview or the end-to-end suite.
 */
export function startQueryServer(options: {
  service: QueryService
  key: string
  port: number
  host: string
  tls: { certFile: string; keyFile: string } | null
  production: boolean
  log: Logger
}): Server {
  if (!options.tls && (options.production || !['127.0.0.1', '::1', 'localhost'].includes(options.host))) {
    throw new Error('the query service needs DOCKET_QUERY_TLS_CERT and DOCKET_QUERY_TLS_KEY outside a loopback preview')
  }
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    }
    try {
      const paths: readonly string[] = Object.values(QUERY_PATHS)
      if (req.method !== 'POST' || !req.url || !paths.includes(req.url)) return reply(404, { error: 'Not found.' })
      if (!queryAuthorised(req.headers.authorization, options.key)) return reply(401, { error: 'Not authorised.' })
      const body = await readJson(req, req.url === QUERY_PATHS.turn ? MAX_TURN_BYTES : MAX_BODY_BYTES)
      if (req.url === QUERY_PATHS.search) return reply(200, { graph: await options.service.search(parseSearch(body)) })
      if (req.url === QUERY_PATHS.turn) return reply(200, await options.service.turn(parseTurn(body)))
      return reply(200, await options.service.ask(parseAsk(body)))
    } catch (cause) {
      if (cause instanceof QueryFailure) return reply(cause.status, { error: cause.message })
      options.log.error(`query: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`)
      return reply(500, { error: 'The search index failed to answer.' })
    }
  }
  const listener = (req: IncomingMessage, res: ServerResponse) => void handle(req, res)
  const tls = options.tls
  const credentials = () => (tls ? { cert: readFileSync(tls.certFile), key: readFileSync(tls.keyFile) } : null)
  const first = credentials()
  const server = first ? createHttpsServer({ ...first, minVersion: 'TLSv1.2' }, listener) : createHttpServer(listener)
  if (first && 'setSecureContext' in server) {
    // cert-manager renews the certificate in place: pick the new one up within the hour.
    const https = server
    const timer = setInterval(() => {
      try {
        https.setSecureContext({ ...(credentials() ?? {}), minVersion: 'TLSv1.2' })
      } catch (cause) {
        options.log.error(`query service: reloading its certificate: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }, 60 * 60_000)
    timer.unref()
    server.on('close', () => clearInterval(timer))
  }
  server.listen(options.port, options.host)
  options.log.info(`query service on ${options.tls ? 'https' : 'http'}://${options.host}:${options.port}`)
  return server
}
