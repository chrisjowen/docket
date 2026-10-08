import type {
  AdapterAnswer,
  AdapterDefinition,
  AdapterDescription,
  AdapterServices,
  ApplyReceipt,
  AskRequest,
  CanonicalReference,
  EntityInput,
  MemoryAdapter,
  ProjectionBatch,
  ResultBlock,
  ResultKind,
  RetrievedEvidence
} from '@docket/contracts'

/**
 * One document a projection judged relevant to a query, in that projection's
 * own terms. Hits are never merged into a common score across projections: a
 * vector similarity, a keyword count and a graph path are different kinds of
 * evidence, and whoever reads them weighs them.
 */
export interface SearchHit {
  /** The canonical document id. */
  id: string
  /** The projection's native score, when it has one. Only comparable within one projection. */
  score?: number
  /** Why it matched, in the projection's own words - e.g. a graph path. */
  detail?: string
  /** The revision of the entity the projection holds, when it keeps one - so an index behind the files shows. */
  revision?: string
  /** What matched, verbatim from what the projection holds: shown as a passage, with the entity as its source. */
  passage?: { text: string; nativeId?: string }
}

/** A projection's answer to a search. */
export interface SearchAnswer {
  hits: SearchHit[]
  /** How the projection read the query, when that is worth showing - e.g. the Cypher it ran. */
  note?: string
}

/** What a projection is opened with: where the project is. */
export interface ProjectionContext {
  /** Absolute path to the repository root (the dir holding `.docket.yaml`). */
  projectRoot: string
}

/**
 * A disposable view over the canonical files. Must be fully rebuildable
 * from `.docket/` alone - never a source of truth.
 *
 * It receives entities, not files: every file that declares an id merged
 * into one, links deduplicated per (source, rel, target), each with the
 * evidence behind it and the confidence computed from that evidence.
 */
export interface EntityProjection {
  readonly name: string

  init?(context: ProjectionContext): Promise<void>

  upsert(entity: EntityInput): Promise<void>

  remove(id: string): Promise<void>

  /**
   * Make every `upsert` and `remove` so far durable. A projection may buffer
   * mutations until then, so callers flush before recording what was projected
   * - sync once per pass, the watcher once per reconciliation. Optional: a
   * projection that writes through has nothing to do.
   */
  flush?(): Promise<void>

  /** Drop all derived state. Called by `docket rebuild`. */
  reset?(): Promise<void>

  /** Documents relevant to `query`, most relevant first. Optional: not every view can search. */
  search?(query: string, limit: number): Promise<SearchAnswer>

  /**
   * Answers a question in full - tables, counts, graphs, passages - in place
   * of `search`, for a projection whose engine can do more than rank
   * documents. Optional; declare what it returns in `resultKinds`.
   */
  answer?(request: AskRequest): Promise<AdapterAnswer>

  /** The block kinds `answer` returns. */
  readonly resultKinds?: readonly ResultKind[]

  /** Releases resources. Flushes first, so nothing buffered is lost. */
  close?(): Promise<void>
}

const bytes = (text: string): number => Buffer.byteLength(text, 'utf8')

/**
 * A search's hits as an answer: the entities in one block, in the
 * projection's order with its scores and details, and each hit's passage as
 * evidence shown in a passages block - within the request's result and
 * evidence budgets. A ranked search is a top-k, never a count.
 */
export const searchAnswer = (
  search: SearchAnswer,
  request: Pick<AskRequest, 'context' | 'budget'>,
  interpretation: Partial<AdapterAnswer['interpretation']> = {}
): AdapterAnswer => {
  const { maxResults, maxEvidenceBytes } = request.budget
  const hits = search.hits.slice(0, maxResults)
  const evidence: RetrievedEvidence[] = []
  let used = 0
  let truncated = search.hits.length >= maxResults
  const refOf = (hit: SearchHit): CanonicalReference => ({
    kind: 'entity',
    id: hit.id,
    ...(hit.revision !== undefined ? { revision: hit.revision } : {})
  })
  for (const hit of hits) {
    if (hit.passage === undefined || hit.passage.text.trim() === '') continue
    const size = bytes(hit.passage.text)
    if (used + size > maxEvidenceBytes) {
      truncated = true
      continue
    }
    used += size
    evidence.push({
      id: `passage-${evidence.length + 1}`,
      ...(hit.passage.nativeId !== undefined ? { nativeId: hit.passage.nativeId } : {}),
      kind: 'passage',
      text: hit.passage.text,
      canonicalRefs: [refOf(hit)],
      ...(hit.score !== undefined && Number.isFinite(hit.score) ? { score: hit.score } : {})
    })
  }

  const blocks: ResultBlock[] = []
  if (hits.length > 0) {
    blocks.push({
      kind: 'entities',
      id: 'hits',
      evidenceIds: evidence.map((item) => item.id),
      entities: hits.map((hit) => ({
        ref: refOf(hit),
        ...(hit.score !== undefined && Number.isFinite(hit.score) ? { score: hit.score } : {}),
        ...(hit.detail !== undefined ? { detail: hit.detail } : {})
      }))
    })
  }
  if (evidence.length > 0) blocks.push({ kind: 'passages', id: 'passages', evidenceIds: evidence.map((item) => item.id) })

  return {
    // The note says how the projection read the query - e.g. the Cypher it ran.
    interpretation: { description: search.note ?? '', assumptions: [], ...interpretation },
    blocks,
    evidence,
    coverage: { mode: 'top-k', truncated, scope: request.context.scope },
    diagnostics: []
  }
}

export interface EntityProjectionAdapterOptions {
  /** The version `describe` reports: the adapter package's. */
  version: string
  rebuild?: AdapterDescription['rebuild']
}

/**
 * Presents an `EntityProjection` as a `MemoryAdapter`: entity inputs only,
 * and a query port answering with its own `answer`, or else with its search
 * hits as an entities block and their passages.
 * Errors propagate as they always have; a batch that throws acknowledges
 * nothing, and replaying it is safe because upserts and removes are idempotent.
 */
export const entityProjectionAdapter = (
  projection: EntityProjection,
  options: EntityProjectionAdapterOptions
): MemoryAdapter => {
  const search = projection.search?.bind(projection)

  const apply = async (batch: ProjectionBatch): Promise<ApplyReceipt> => {
    const receipt: ApplyReceipt = { batchId: batch.batchId, applied: [], failed: [] }
    for (const change of batch.changes) {
      if (change.operation === 'upsert') {
        if (change.record.kind !== 'entity') {
          receipt.failed.push({ id: change.record.id, retryable: false, message: `${projection.name} projects entities only` })
          continue
        }
        await projection.upsert(change.record)
        receipt.applied.push(change.record.id)
      } else {
        if (change.kind !== 'entity') {
          receipt.failed.push({ id: change.id, retryable: false, message: `${projection.name} projects entities only` })
          continue
        }
        await projection.remove(change.id)
        receipt.applied.push(change.id)
      }
    }
    return receipt
  }

  const answer = projection.answer?.bind(projection)
  const ask = async (request: AskRequest): Promise<AdapterAnswer> =>
    answer ? answer(request) : searchAnswer(await search!(request.question, request.budget.maxResults), request)

  return {
    describe: () => ({
      name: projection.name,
      version: options.version,
      inputs: ['entity'],
      resultKinds: answer ? [...(projection.resultKinds ?? [])] : search ? ['entities', 'passages'] : [],
      rebuild: options.rebuild ?? 'deterministic'
    }),
    status: async () => ({ state: 'ready', message: `${projection.name} projection; its health is not probed` }),
    projection: {
      apply,
      flush: async () => projection.flush?.(),
      // An entity projection holds one namespace, set in its own config.
      reset: async () => projection.reset?.()
    },
    ...(answer || search ? { query: { ask } } : {}),
    close: async () => projection.close?.()
  }
}

export interface EntityProjectionDefinitionOptions<C> {
  name: string
  /** The adapter package's version, reported by `describe`. */
  version: string
  rebuild: AdapterDescription['rebuild']
  validateConfig(input: unknown): C
  createProjection(config: C, services: AdapterServices): EntityProjection
}

/**
 * An adapter definition around an `EntityProjection`: `create` builds the
 * projection, initialises it against the project, and closes it again if that
 * fails, so a projection that cannot start never leaks a connection.
 */
export const entityProjectionDefinition = <C>(options: EntityProjectionDefinitionOptions<C>): AdapterDefinition<C> => ({
  apiVersion: 1,
  name: options.name,
  validateConfig: (input) => options.validateConfig(input),
  async create(config, services) {
    const projection = options.createProjection(config, services)
    try {
      await projection.init?.({ projectRoot: services.projectRoot })
    } catch (error) {
      await projection.close?.().catch(() => undefined)
      throw error
    }
    return entityProjectionAdapter(projection, { version: options.version, rebuild: options.rebuild })
  }
})
