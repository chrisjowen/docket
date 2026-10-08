import type {
  AdapterAnswer,
  AdapterDefinition,
  AdapterDescription,
  AdapterServices,
  ApplyReceipt,
  AskRequest,
  EntityInput,
  MemoryAdapter,
  ProjectionBatch
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

  /** Releases resources. Flushes first, so nothing buffered is lost. */
  close?(): Promise<void>
}

export interface EntityProjectionAdapterOptions {
  /** The version `describe` reports: the adapter package's. */
  version: string
  rebuild?: AdapterDescription['rebuild']
}

/**
 * Presents an `EntityProjection` as a `MemoryAdapter`: entity inputs only,
 * and a query port answering with one entities block when it can search.
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

  const ask = async (request: AskRequest): Promise<AdapterAnswer> => {
    const limit = request.budget.maxResults
    const answer = await search!(request.question, limit)
    return {
      // The note says how the projection read the query - e.g. the Cypher it ran.
      interpretation: { description: answer.note ?? '', assumptions: [] },
      blocks: [
        {
          kind: 'entities',
          id: 'hits',
          evidenceIds: [],
          entities: answer.hits.map((hit) => ({
            ref: { kind: 'entity', id: hit.id },
            ...(hit.score !== undefined && Number.isFinite(hit.score) ? { score: hit.score } : {}),
            ...(hit.detail !== undefined ? { detail: hit.detail } : {})
          }))
        }
      ],
      evidence: [],
      coverage: { mode: 'top-k', truncated: answer.hits.length >= limit, scope: request.context.scope },
      diagnostics: []
    }
  }

  return {
    describe: () => ({
      name: projection.name,
      version: options.version,
      inputs: ['entity'],
      resultKinds: search ? ['entities'] : [],
      rebuild: options.rebuild ?? 'deterministic'
    }),
    status: async () => ({ state: 'ready', message: `${projection.name} projection; its health is not probed` }),
    projection: {
      apply,
      flush: async () => projection.flush?.(),
      // An entity projection holds one namespace, set in its own config.
      reset: async () => projection.reset?.()
    },
    ...(search ? { query: { ask } } : {}),
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
