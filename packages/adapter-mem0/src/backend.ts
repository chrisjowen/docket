import type { Mem0Config } from './config.js'
import { connectServer } from './server-backend.js'
import { resultsOf, scopeFilters } from './wire-format.js'

/** Who the projected memories belong to in mem0. mem0 requires at least one. */
export interface Mem0Scope {
  userId?: string
  agentId?: string
  runId?: string
}

export interface StoredMemory {
  id: string
  metadata?: Record<string, unknown> | null
  /** Similarity to the query, on search results only. */
  score?: number
}

/**
 * The slice of mem0 this projection needs, identical for the hosted client and
 * the self-hosted `Memory`. Everything is already bound to one scope.
 */
export interface Mem0Backend {
  /** Store `text` verbatim. Returns the new memory ids when mem0 reports them. */
  add(text: string, metadata: Record<string, unknown>): Promise<string[]>
  /** Every memory in the scope. */
  list(): Promise<StoredMemory[]>
  delete(memoryId: string): Promise<void>
  /** Every memory in the scope. */
  deleteAll(): Promise<void>
  /** Memories in the scope most similar to `query`, best first. */
  search(query: string, limit: number): Promise<StoredMemory[]>
}

/** Hosted `getAll` page size. */
const PAGE_SIZE = 100
/** Self-hosted `getAll` has no pagination, only a cap - set well past spec §73's 10,000. */
const OSS_LIST_LIMIT = 100_000

/**
 * mem0ai is an optional dependency: only repositories that configure a mem0
 * projection need it installed, so it is loaded on first use.
 */
const loadMem0 = async <T>(specifier: 'mem0ai' | 'mem0ai/oss'): Promise<T> => {
  try {
    return (await import(specifier)) as T
  } catch (cause) {
    throw new Error(
      `The mem0 projection needs the "mem0ai" package. Install it next to ` +
        `@chrisjowen/docket (e.g. \`pnpm add mem0ai\`). (${(cause as Error).message})`
    )
  }
}

/** `minScore` in mem0's own terms, when set. */
const threshold = (config: Mem0Config): { threshold?: number } =>
  config.minScore === undefined ? {} : { threshold: config.minScore }

type PlatformModule = typeof import('mem0ai')
type OssModule = typeof import('mem0ai/oss')

const connectPlatform = async (
  config: Extract<Mem0Config, { mode: 'platform' }>,
  scope: Mem0Scope
): Promise<Mem0Backend> => {
  const apiKey = process.env[config.apiKeyEnv]
  if (!apiKey) {
    throw new Error(
      `The mem0 projection is in platform mode but ${config.apiKeyEnv} is not set.`
    )
  }
  const { default: MemoryClient } = await loadMem0<PlatformModule>('mem0ai')
  const client = new MemoryClient({ apiKey, ...(config.host ? { host: config.host } : {}) })
  const filters = scopeFilters(scope)
  const entries = Object.entries(filters)
  const filter =
    entries.length === 1 ? filters : { AND: entries.map(([key, value]) => ({ [key]: value })) }

  return {
    async add(text, metadata) {
      const response = await client.add([{ role: 'user', content: text }], {
        ...scope,
        metadata,
        infer: false
      })
      return resultsOf(response).map((memory) => memory.id)
    },
    async list() {
      const memories: StoredMemory[] = []
      for (let page = 1; ; page += 1) {
        const response = await client.getAll({ filters: filter, page, pageSize: PAGE_SIZE })
        const results = resultsOf(response)
        memories.push(...results)
        const next = (response as { next?: unknown } | null)?.next
        if (results.length < PAGE_SIZE || next === null) return memories
      }
    },
    async delete(memoryId) {
      await client.delete(memoryId)
    },
    async deleteAll() {
      await client.deleteAll(scope)
    },
    async search(query, limit) {
      return resultsOf(
        await client.search(query, { filters: filter, topK: limit, ...threshold(config) })
      )
    }
  }
}

const connectOss = async (
  config: Extract<Mem0Config, { mode: 'oss' }>,
  scope: Mem0Scope
): Promise<Mem0Backend> => {
  const { Memory } = await loadMem0<OssModule>('mem0ai/oss')
  const memory = new Memory(config.config as ConstructorParameters<typeof Memory>[0])
  const filters = scopeFilters(scope)

  return {
    async add(text, metadata) {
      const response = await memory.add([{ role: 'user', content: text }], {
        ...scope,
        metadata,
        infer: false
      })
      return resultsOf(response).map((item) => item.id)
    },
    async list() {
      return resultsOf(await memory.getAll({ filters, topK: OSS_LIST_LIMIT }))
    },
    async delete(memoryId) {
      await memory.delete(memoryId)
    },
    async deleteAll() {
      await memory.deleteAll(scope)
    },
    async search(query, limit) {
      return resultsOf(await memory.search(query, { filters, topK: limit, ...threshold(config) }))
    }
  }
}

export const connectMem0 = (
  config: Mem0Config,
  scope: Mem0Scope
): Promise<Mem0Backend> => {
  switch (config.mode) {
    case 'platform':
      return connectPlatform(config, scope)
    case 'server':
      return connectServer(config, scope)
    case 'oss':
      return connectOss(config, scope)
  }
}
