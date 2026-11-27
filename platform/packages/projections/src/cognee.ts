// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  AdapterAnswer,
  AdapterDefinition,
  AdapterServices,
  CanonicalReader,
  MemoryAdapter,
} from '@chrisjowen/docket/contracts'
import { workspaceScope } from '@docket/platform-tenancy'

import { ADAPTER_VERSION } from './adapters.js'

/**
 * cognee (https://www.cognee.ai/), the optional projection: docket's cognee
 * adapter (`@docket/adapter-cognee`) on the platform's cognee service, one
 * dataset per workspace. It is loaded from the docket release the cloud runs,
 * like the Neo4j and mem0 adapters, through this one seam: a release that
 * does not bundle it leaves cognee unavailable, and says so, rather than
 * failing the build or the other projections.
 */
export const COGNEE_ADAPTER_MODULE = '@chrisjowen/docket/adapters/cognee'

/** The cognee service the worker reaches: one for the platform, run only where some workspace turns cognee on. */
export interface CogneeAccess {
  /** For example `https://docket-cognee.docket-cloud.svc:8443`. */
  url: string
  /** The service's API key, sent as `X-Api-Key`. Never logged or shown. */
  apiKey: string
  /** Bounds a cognify; a large workspace's first one is the longest. */
  cognifyTimeoutMs?: number
}

/** The adapter is not in the docket release the cloud runs, or its service is not set up. */
export class CogneeUnavailable extends Error {
  override name = 'CogneeUnavailable'
}

/** Loads the cognee adapter's definition. Tests pass their own. */
export type CogneeLoader = () => Promise<AdapterDefinition<unknown>>

/**
 * docket's cognee adapter, from the docket release the cloud runs. The module
 * name is held in a variable so a release without it still builds and the
 * other projections still run; it is refused here, with the release named.
 */
export const loadCogneeAdapter: CogneeLoader = async () => {
  const module = COGNEE_ADAPTER_MODULE
  let loaded: { default?: AdapterDefinition<unknown> }
  try {
    loaded = (await import(module)) as { default?: AdapterDefinition<unknown> }
  } catch {
    throw new CogneeUnavailable(`cognee is not available: @chrisjowen/docket ${ADAPTER_VERSION} does not bundle docket's cognee adapter`)
  }
  const definition = loaded.default
  if (!definition || typeof definition.create !== 'function' || typeof definition.validateConfig !== 'function') {
    throw new CogneeUnavailable(`cognee is not available: @chrisjowen/docket ${ADAPTER_VERSION}'s cognee adapter has no adapter definition`)
  }
  return definition
}

/**
 * The workspace's dataset on the shared cognee service: the org and workspace
 * ids, which are lower-case letters and digits, so the name keeps cognee's
 * rule (no dots, no spaces) and no two workspaces share one.
 */
export const cogneeDataset = (orgId: string, workspaceId: string): string => `docket_org_${orgId}__ws_${workspaceId}`

/** cognee's states of a cognify pipeline still running over a dataset (`PipelineRunStatus`). */
const COGNIFYING = new Set(['DATASET_PROCESSING_INITIATED', 'DATASET_PROCESSING_STARTED'])

/**
 * Whether cognee is cognifying the workspace's dataset now, as its
 * `GET /api/v1/datasets/status` reports it: a cognify the adapter stopped
 * waiting for runs on in cognee, calling its model. A dataset cognee does not
 * hold is not cognifying. Throws when cognee cannot say.
 */
export async function cogneeCognifying(access: Pick<CogneeAccess, 'url' | 'apiKey'>, orgId: string, workspaceId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const base = access.url.replace(/\/+$/, '')
  const get = async (path: string): Promise<unknown> => {
    const response = await fetchImpl(`${base}${path}`, { headers: { 'X-Api-Key': access.apiKey }, signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`cognee GET ${path.split('?')[0]} failed: ${response.status}`)
    return response.json()
  }
  const name = cogneeDataset(orgId, workspaceId)
  const datasets = await get('/api/v1/datasets')
  const found = (Array.isArray(datasets) ? (datasets as { id?: unknown; name?: unknown }[]) : []).find((dataset) => dataset?.name === name && typeof dataset.id === 'string')
  if (!found) return false
  const id = found.id as string
  const status = (await get(`/api/v1/datasets/status?${new URLSearchParams({ dataset: id })}`)) as Record<string, unknown> | null
  return COGNIFYING.has(String(status?.[id]))
}

/** The cosine distance the adapter cuts at (`maxDistance`) for a similarity floor. */
export const maxDistanceOf = (floor: number): number => Math.round((1 - floor) * 1000) / 1000

/**
 * What a cognee manifest is valid for: the workspace's scope, the service and
 * the dataset. Unlike the fixed projections' it leaves out the docket
 * release: a new release would reset the dataset and cognify every entity
 * again, at the org's expense, where the adapter already finds what it filed
 * and re-files only what renders differently.
 */
export function cogneeFingerprint(orgId: string, workspaceId: string, access: Pick<CogneeAccess, 'url'>): string {
  const text = JSON.stringify({
    instance: 'cognee',
    scope: workspaceScope(workspaceId),
    target: { url: access.url, dataset: cogneeDataset(orgId, workspaceId) },
  })
  return `sha256:${createHash('sha256').update(text).digest('hex')}`
}

/**
 * Search's floor on what cognee answers (the eval's `cognee+floor`): only
 * chunks at least `floor` similar to the question are kept, and what cognee
 * scores as a cosine distance comes back as a similarity, the scale mem0's
 * scores are on, so search ranks the two alike. The adapter is asked with the
 * same cut (`maxDistance`); this holds it whatever the adapter returned, so a
 * question cognee holds nothing about is answered with nothing.
 */
export function floorAnswer(answer: AdapterAnswer, floor: number): AdapterAnswer {
  const cut = maxDistanceOf(floor)
  const kept = (score: number | undefined) => score === undefined || score <= cut
  const similarity = (score: number) => Math.round((1 - score) * 1000) / 1000
  const evidence = answer.evidence
    .filter((item) => item.kind !== 'passage' || kept(item.score))
    .map((item) => (item.kind === 'passage' && item.score !== undefined ? { ...item, score: similarity(item.score) } : item))
  const evidenceIds = new Set(evidence.map((item) => item.id))
  const dropped = answer.evidence.length - evidence.length
  const blocks = answer.blocks
    .map((block) => {
      const shown = block.evidenceIds.filter((id) => evidenceIds.has(id))
      if (block.kind !== 'entities') return { ...block, evidenceIds: shown }
      const entities = block.entities.filter((entity) => kept(entity.score)).map((entity) => (entity.score === undefined ? entity : { ...entity, score: similarity(entity.score) }))
      return { ...block, evidenceIds: shown, entities }
    })
    .filter((block) => (block.kind === 'entities' ? block.entities.length > 0 : block.kind !== 'passages' || block.evidenceIds.length > 0))
  return {
    ...answer,
    interpretation: {
      ...answer.interpretation,
      assumptions: [
        ...answer.interpretation.assumptions.filter((assumption) => !assumption.startsWith('Scores are cognee')),
        `Only chunks at least ${floor} similar to the question (cosine) are kept, so it may answer with nothing; scores are that similarity.`,
      ],
    },
    blocks,
    evidence,
    diagnostics: dropped > 0 ? [...answer.diagnostics, { severity: 'info', code: 'cognee-floor', message: `${dropped} chunk${dropped === 1 ? '' : 's'} under the ${floor} floor left out.` }] : answer.diagnostics,
  }
}

export interface OpenCogneeOptions {
  orgId: string
  workspaceId: string
  access: CogneeAccess
  /** The workspace's canonical records: the adapter re-files what links to a retitled entity and resolves hits through them. */
  canonical: CanonicalReader
  /** Search's floor; absent on the projection path, which answers no question. */
  floor?: number
  load?: CogneeLoader
}

const silent = { debug() {}, info() {}, warn() {}, error() {} }

/**
 * Opens docket's cognee adapter for one workspace: its own dataset on the
 * cognee service, entities only (cognify runs a model over each one), the
 * service's key resolved only for this instance and never put in the
 * environment. With a floor, its answers are held to it (`floorAnswer`).
 */
export async function openCognee(options: OpenCogneeOptions): Promise<MemoryAdapter> {
  const definition = await (options.load ?? loadCogneeAdapter)()
  const apiKeyEnv = 'DOCKET_COGNEE_API_KEY'
  const config = definition.validateConfig({
    url: options.access.url,
    apiKeyEnv,
    dataset: cogneeDataset(options.orgId, options.workspaceId),
    inputs: ['entity'],
    ...(options.floor !== undefined ? { maxDistance: maxDistanceOf(options.floor) } : {}),
    ...(options.access.cognifyTimeoutMs !== undefined ? { cognifyTimeoutMs: options.access.cognifyTimeoutMs } : {}),
  })
  const services: AdapterServices = {
    projectRoot: `/workspaces/${options.workspaceId}`,
    // The adapter keeps its last checkpoint here; the manifest in Postgres is what the worker trusts.
    stateRoot: join(tmpdir(), 'docket-cognee', options.orgId, options.workspaceId),
    scope: workspaceScope(options.workspaceId),
    logger: silent,
    canonical: options.canonical,
    secrets: { getEnv: async (name) => (name === apiKeyEnv ? options.access.apiKey : undefined) },
  }
  const adapter = await definition.create(config, services)
  const { floor } = options
  const query = adapter.query
  if (floor === undefined || !query) return adapter
  return { ...adapter, query: { ...query, ask: async (request) => floorAnswer(await query.ask(request), floor) } }
}
