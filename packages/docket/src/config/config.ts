import { resolve } from 'node:path'
import { z } from 'zod'

/** Writes the normalized model as JSONL - a readable debug view of what projections receive. */
export const jsonlProjectionConfigSchema = z.object({
  type: z.literal('jsonl'),
  output: z.string().default('.docket/.index')
})

/** Which mem0 entity the projected memories are filed under. At least one id is required. */
const mem0ScopeSchema = z
  .object({
    userId: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
    runId: z.string().min(1).optional()
  })
  .refine(
    (scope) => Object.values(scope).some((id) => id !== undefined),
    'mem0 scope needs at least one of userId, agentId or runId'
  )

/**
 * Hits whose semantic similarity is below this are dropped (mem0's own
 * `threshold`). mem0 always returns its top k otherwise, however weak.
 * Model-dependent, so there is no default.
 */
const mem0MinScoreSchema = z.number().min(0).max(1).optional()

/** Hosted mem0 (app.mem0.ai). The key is read from the environment, never from the file. */
const mem0PlatformSchema = z.object({
  type: z.literal('mem0'),
  mode: z.literal('platform'),
  apiKeyEnv: z.string().default('MEM0_API_KEY'),
  host: z.string().url().optional(),
  minScore: mem0MinScoreSchema,
  scope: mem0ScopeSchema.optional()
})

/**
 * Self-hosted mem0 (`mem0ai/oss`). `config` is handed to its `Memory`
 * constructor untouched - embedder, vector store, LLM - so every provider mem0
 * supports works without this package knowing about it.
 */
const mem0OssSchema = z.object({
  type: z.literal('mem0'),
  mode: z.literal('oss'),
  config: z.record(z.string(), z.unknown()).default({}),
  minScore: mem0MinScoreSchema,
  scope: mem0ScopeSchema.optional()
})

/**
 * mem0's self-hosted REST server (`server/` in the mem0 repository), which also
 * serves its dashboard. It speaks its own API, not the hosted one, so it has its
 * own mode. The key is optional because the server can run with auth disabled.
 */
const mem0ServerSchema = z.object({
  type: z.literal('mem0'),
  mode: z.literal('server'),
  url: z.string().url(),
  apiKeyEnv: z.string().default('MEM0_API_KEY'),
  minScore: mem0MinScoreSchema,
  scope: mem0ScopeSchema.optional()
})

export const mem0ProjectionConfigSchema = z.discriminatedUnion('mode', [
  mem0PlatformSchema,
  mem0ServerSchema,
  mem0OssSchema
])

/** A local Ollama chat model. */
export const ollamaModelSchema = z.object({
  provider: z.literal('ollama').default('ollama'),
  url: z.string().url().default('http://localhost:11434'),
  model: z.string().min(1),
  timeoutMs: z.number().int().positive().default(60_000)
})

export type OllamaModelConfig = z.infer<typeof ollamaModelSchema>

/** Claude Code's `claude` CLI, run in print mode with the user's own login. */
export const claudeModelSchema = z.object({
  provider: z.literal('claude'),
  command: z.string().min(1).default('claude'),
  /** Passed as `--model`, e.g. `sonnet` or `haiku`. Unset, Claude Code picks. */
  model: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().default(120_000)
})

export type ClaudeModelConfig = z.infer<typeof claudeModelSchema>

/**
 * What summarizes `docket open`'s chat answers. Claude when unset; a section
 * without `provider` is an Ollama model, as it was before Claude was the default.
 */
export const summarizeConfigSchema = z.union([claudeModelSchema, ollamaModelSchema]).prefault({ provider: 'claude' })

export type SummarizeConfig = z.infer<typeof summarizeConfigSchema>

/**
 * A Neo4j graph of the documents and their links. The password is read from the
 * environment, never from the file; with `passwordEnv` unset the driver
 * connects without auth, as a local `NEO4J_AUTH=none` server expects.
 */
export const neo4jProjectionConfigSchema = z.object({
  type: z.literal('neo4j'),
  url: z.string().default('bolt://localhost:7687'),
  database: z.string().min(1).optional(),
  username: z.string().default('neo4j'),
  passwordEnv: z.string().min(1).optional(),
  /** Every node carries this, so checkouts can share one database. Defaults to one unique to the checkout. */
  scope: z.string().min(1).optional(),
  /**
   * Answer searches by having a local Ollama model write a read-only Cypher
   * query against the graph's schema. Without it, search is full-text only.
   */
  cypher: ollamaModelSchema.optional()
})

export type JsonlProjectionConfig = z.infer<typeof jsonlProjectionConfigSchema>
export type Mem0ProjectionConfig = z.infer<typeof mem0ProjectionConfigSchema>
export type Neo4jProjectionConfig = z.infer<typeof neo4jProjectionConfigSchema>

export const projectionConfigSchema = z.preprocess(
  // `file` was this projection's name before mem0 made it one of several; it
  // writes files, it does not read them, so the old name read backwards.
  (value) =>
    value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'file'
      ? { ...value, type: 'jsonl' }
      : value,
  z.union([jsonlProjectionConfigSchema, mem0ProjectionConfigSchema, neo4jProjectionConfigSchema])
)

export type ProjectionConfig = z.infer<typeof projectionConfigSchema>

export const memoryConfigSchema = z.object({
  version: z.literal(1),
  source: z
    .object({
      root: z.string().default('.docket'),
      include: z.array(z.string()).default(['**/*.md']),
      exclude: z.array(z.string()).default(['.index/**', '.cache/**'])
    })
    .prefault({}),
  ontology: z
    .object({
      file: z.string().default('.docket/entities.yaml')
    })
    .prefault({}),
  /** Derived bookkeeping - the manifest - owned by sync, not by any projection. */
  state: z
    .object({
      dir: z.string().default('.docket/.index')
    })
    .prefault({}),
  watch: z
    .object({
      debounceMs: z.number().int().positive().default(300)
    })
    .prefault({}),
  projections: z.array(projectionConfigSchema).default([
    { type: 'jsonl', output: '.docket/.index' }
  ]),
  /**
   * The model `docket open`'s chat summarizes search results with: the
   * `claude` CLI unless an Ollama model is set here.
   */
  summarize: summarizeConfigSchema
})

export type MemoryConfig = z.infer<typeof memoryConfigSchema>

/** Config plus the absolute paths every other module resolves against. */
export interface ResolvedConfig {
  config: MemoryConfig
  projectRoot: string
  memoryRoot: string
  ontologyPath: string
}

export const CONFIG_FILENAME = '.docket.yaml'

/** Absolute directory holding the manifest (spec §31). */
export const stateRootOf = (resolved: ResolvedConfig): string =>
  resolve(resolved.projectRoot, resolved.config.state.dir)
