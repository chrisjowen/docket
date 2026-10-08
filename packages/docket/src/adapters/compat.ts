import { readFileSync } from 'node:fs'

import type {
  AdapterAnswer,
  AdapterDefinition,
  AdapterDescription,
  ApplyReceipt,
  AskRequest,
  EntityInput,
  MemoryAdapter,
  ProjectionBatch
} from '@docket/contracts'
import type { z } from 'zod'

import {
  jsonlProjectionConfigSchema,
  mem0ProjectionConfigSchema,
  neo4jProjectionConfigSchema,
  projectionConfigSchema,
  type ProjectionConfig
} from '../config/config.js'
import type { MemoryEntity } from '../model/index.js'
import type { MemoryProjection, ProjectionContext } from '../projection/projection.js'
import { createProjection } from '../projection/registry.js'

/** The projection types a v1 `.docket.yaml` can configure. */
export type V1ProjectionType = ProjectionConfig['type']

let packageVersion: string | undefined

/** This package's version: what a compatibility adapter reports as its own. */
const docketVersion = (): string => {
  packageVersion ??= (
    JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
  ).version
  return packageVersion
}

/** The canonical entity input for a merged entity: its hash is its revision. */
export const toEntityInput = (entity: MemoryEntity, scope: string): EntityInput => {
  const { hash, ...rest } = entity
  return { ...rest, kind: 'entity', revision: hash, scope }
}

/** The merged entity an entity input carries, as the v1 projections receive it. */
export const toMemoryEntity = (input: EntityInput): MemoryEntity => {
  const { kind: _kind, revision, scope: _scope, ...rest } = input
  return { ...rest, hash: revision } as MemoryEntity
}

export interface ProjectionAdapterOptions {
  rebuild?: AdapterDescription['rebuild']
}

/**
 * Presents a v1 `MemoryProjection` as a `MemoryAdapter`: entity inputs only,
 * and a query port answering with one entities block when it can search.
 * Errors propagate as they always have; a batch that throws acknowledges
 * nothing, and replaying it is safe because upserts and removes are idempotent.
 */
export const projectionAdapter = (
  projection: MemoryProjection,
  options: ProjectionAdapterOptions = {}
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
        await projection.upsert(toMemoryEntity(change.record))
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
      version: docketVersion(),
      inputs: ['entity'],
      resultKinds: search ? ['entities'] : [],
      rebuild: options.rebuild ?? 'deterministic'
    }),
    status: async () => ({ state: 'ready', message: `v1 ${projection.name} projection; its health is not probed` }),
    projection: {
      apply,
      flush: async () => projection.flush?.(),
      // v1 projections hold one namespace each, set in their own config.
      reset: async () => projection.reset?.()
    },
    ...(search ? { query: { ask } } : {}),
    close: async () => projection.close?.()
  }
}

const compatDefinition = <C extends ProjectionConfig>(
  type: C['type'],
  schema: z.ZodType<C, unknown>,
  rebuild: AdapterDescription['rebuild'],
  context: ProjectionContext
): AdapterDefinition<C> => ({
  apiVersion: 1,
  name: type,
  // v1 parsing exactly - including the `file` alias for `jsonl` - so every
  // existing `.docket.yaml` means what it meant before.
  validateConfig(input) {
    const parsed = projectionConfigSchema.parse(input)
    if (parsed.type !== type) throw new Error(`expected a ${type} projection, got ${parsed.type}`)
    return schema.parse(parsed)
  },
  async create(config, services) {
    const projection = createProjection(config)
    await projection.init?.({ ...context, projectRoot: services.projectRoot })
    return projectionAdapter(projection, { rebuild })
  }
})

/**
 * Compatibility definitions for the projections v1 configuration names
 * (docs/adapter-spec.md §15 step 1), so they are created and driven through
 * the adapter contract. `context` is the v1 projection context: the shared
 * state directory rather than a per-adapter one.
 */
export const compatDefinitions = (context: ProjectionContext): Record<V1ProjectionType, AdapterDefinition> => ({
  jsonl: compatDefinition('jsonl', jsonlProjectionConfigSchema, 'deterministic', context) as AdapterDefinition,
  // mem0 extracts memories with a model: rebuilt, but not byte for byte.
  mem0: compatDefinition('mem0', mem0ProjectionConfigSchema, 'reconstructible', context) as AdapterDefinition,
  neo4j: compatDefinition('neo4j', neo4jProjectionConfigSchema, 'deterministic', context) as AdapterDefinition
})
