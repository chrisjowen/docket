// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Chat } from '@chrisjowen/docket/adapter-kit'
import { entityProjectionAdapter } from '@chrisjowen/docket/adapter-kit'
import type { MemoryAdapter } from '@chrisjowen/docket/contracts'
import { createMem0Projection, mem0ConfigSchema } from '@chrisjowen/docket/adapters/mem0'
import { createNeo4jProjection, neo4jConfigSchema } from '@chrisjowen/docket/adapters/neo4j'
import type { Neo4jCredentials, QdrantAccess } from '@docket/platform-provisioner'
import { workspaceScope } from '@docket/platform-tenancy'
import { QdrantClient } from '@qdrant/js-client-rest'

export type { MemoryAdapter }

/** The adapter instances every cloud workspace projects into (§6.3), fixed by the cloud (§6.4). */
export type CloudProjection = 'neo4j' | 'mem0'

/** The in-cluster embedding model mem0 vectors are made with (O6): content never leaves the box to be embedded. */
export interface EmbedderConfig {
  /** The Ollama server, for example `https://docket-embedder.docket-cloud.svc:11434`. */
  url: string
  /** For example `nomic-embed-text`. */
  model: string
  dimension: number
}

/** Everything needed to reach one org's stores, minted for one pass. */
export interface StoreAccess {
  neo4j: Neo4jCredentials
  qdrant: QdrantAccess
  embedder: EmbedderConfig
}

export interface OpenOptions {
  orgId: string
  workspaceId: string
  access: StoreAccess
  /**
   * Writes Cypher from a question, for `ask` (§6.3). Absent on the projection
   * and search paths, which need no model (§11): the Neo4j adapter then
   * answers with full-text search.
   */
  cypher?: Chat
  /** Only these instances; all when absent. */
  only?: readonly CloudProjection[]
}

const require = createRequire(import.meta.url)
/** docket's bundled adapters report the docket release they ship in. */
export const ADAPTER_VERSION: string = (require('@chrisjowen/docket/package.json') as { version: string }).version

// mem0 phones home unless told not to, and reads this when it is first loaded.
process.env.MEM0_TELEMETRY = 'false'
// It also keeps an install id in a file; without a writable one it would look
// for it in a Qdrant collection shared by every org, which no org's JWT reaches.
process.env.MEM0_DIR ??= join(tmpdir(), 'docket-mem0')

/**
 * What a manifest is valid for (`AdapterSlot.fingerprint` in docket): the
 * instance, its adapter release, its scope and where its store is. Written
 * for another store or release, a manifest vouches for nothing, and the
 * instance is reset and projected again.
 */
export function projectionFingerprint(instance: CloudProjection, workspaceId: string, access: StoreAccess): string {
  const target =
    instance === 'neo4j'
      ? { url: access.neo4j.url }
      : { url: access.qdrant.url, collection: access.qdrant.collection, model: access.embedder.model, dimension: access.embedder.dimension }
  const text = JSON.stringify({ instance, version: ADAPTER_VERSION, scope: workspaceScope(workspaceId), target })
  return `sha256:${createHash('sha256').update(text).digest('hex')}`
}

/**
 * mem0 needs an LLM to construct, though projection never calls one: every
 * entity is stored verbatim (`infer: false`) and search only embeds. The LLM
 * points nowhere, so nothing in mem0 can spend the org's AI budget outside the
 * metered client (§11).
 */
const UNUSED_LLM = { provider: 'openai', config: { apiKey: 'unused-mem0-never-infers', baseURL: 'http://127.0.0.1:9/v1', model: 'none' } }

/** Where mem0 keeps an install id: one collection for every org, which no org's JWT reaches. */
const SHARED_COLLECTION = 'memory_migrations'

/**
 * A Qdrant client on the org's JWT that leaves mem0's shared install-id
 * collection alone: the id lives in `MEM0_DIR` instead, and no org reads or
 * writes a collection another org could.
 */
function orgQdrantClient(access: QdrantAccess): QdrantClient {
  const client = new QdrantClient({ url: access.url, apiKey: access.token, checkCompatibility: false })
  const untouched: Record<string, unknown> = { scroll: { points: [] }, upsert: {}, createCollection: true, getCollection: {}, createPayloadIndex: {} }
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof property !== 'string' || !(property in untouched) || typeof value !== 'function') return value
      return (collection: unknown, ...rest: unknown[]) =>
        collection === SHARED_COLLECTION ? Promise.resolve(untouched[property]) : (value as (...a: unknown[]) => unknown).call(target, collection, ...rest)
    },
  })
}

let passwordSlot = 0

/** Neo4j's answer to a schema rule another session created a moment before. */
const EQUIVALENT_SCHEMA_RULE = 'Neo.ClientError.Schema.EquivalentSchemaRuleAlreadyExists'

async function openNeo4j(options: OpenOptions): Promise<MemoryAdapter> {
  const { neo4j } = options.access
  // docket's adapter reads its password from the environment; a slot of our
  // own per connection, emptied again once the driver holds it.
  const passwordEnv = `DOCKET_NEO4J_PASSWORD_${process.pid}_${(passwordSlot += 1)}`
  const config = neo4jConfigSchema.parse({
    type: 'neo4j',
    url: neo4j.url,
    username: neo4j.username,
    passwordEnv,
    scope: workspaceScope(options.workspaceId),
  })
  const projection = createNeo4jProjection(config, options.cypher ? { chat: options.cypher } : {})
  process.env[passwordEnv] = neo4j.password
  const init = () => projection.init?.({ projectRoot: `/workspaces/${options.workspaceId}` })
  try {
    await init()?.catch(async (error: unknown) => {
      // Two callers starting the adapter on a fresh Neo4j race its
      // `CREATE ... IF NOT EXISTS`, and the loser is told the index already
      // exists. It does now, so a second init passes.
      if ((error as { code?: unknown } | null)?.code !== EQUIVALENT_SCHEMA_RULE) throw error
      await projection.close?.()
      await init()
    })
  } catch (error) {
    await projection.close?.().catch(() => undefined)
    throw error
  } finally {
    delete process.env[passwordEnv]
  }
  return entityProjectionAdapter(projection, { version: ADAPTER_VERSION, rebuild: 'deterministic' })
}

async function openMem0(options: OpenOptions): Promise<MemoryAdapter> {
  const { qdrant, embedder } = options.access
  const config = mem0ConfigSchema.parse({
    type: 'mem0',
    mode: 'oss',
    // mem0's scope for the workspace (§5.3): one org collection, one userId per workspace.
    scope: { userId: workspaceScope(options.workspaceId) },
    config: {
      version: 'v1.1',
      embedder: { provider: 'ollama', config: { url: embedder.url, model: embedder.model, embeddingDims: embedder.dimension } },
      vectorStore: {
        provider: 'qdrant',
        // The org's JWT, which reaches its collections only (§5.3).
        config: { collectionName: qdrant.collection, dimension: qdrant.dimension, client: orgQdrantClient(qdrant) },
      },
      llm: UNUSED_LLM,
      disableHistory: true,
    },
  })
  const projection = createMem0Projection(config)
  try {
    await projection.init?.({ projectRoot: `/workspaces/${options.workspaceId}` })
  } catch (error) {
    await projection.close?.().catch(() => undefined)
    throw error
  }
  return entityProjectionAdapter(projection, { version: ADAPTER_VERSION, rebuild: 'reconstructible' })
}

/**
 * Opens the org's projections for one workspace: docket's own Neo4j and mem0
 * adapters, each scoped to `ws_<workspaceId>` on the org's own stores.
 */
export async function openProjections(options: OpenOptions): Promise<Partial<Record<CloudProjection, MemoryAdapter>>> {
  const wanted = new Set(options.only ?? (['neo4j', 'mem0'] as const))
  const opened: Partial<Record<CloudProjection, MemoryAdapter>> = {}
  try {
    if (wanted.has('neo4j')) opened.neo4j = await openNeo4j(options)
    if (wanted.has('mem0')) opened.mem0 = await openMem0(options)
  } catch (error) {
    await closeAll(opened)
    throw error
  }
  return opened
}

export async function closeAll(adapters: Partial<Record<CloudProjection, MemoryAdapter>>): Promise<void> {
  await Promise.all(Object.values(adapters).map((adapter) => adapter?.close().catch(() => undefined)))
}
