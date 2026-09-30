import { resolve } from 'node:path'
import { z } from 'zod'

/** Writes the normalized model as JSONL - a readable debug view of what projections receive. */
export const jsonlProjectionConfigSchema = z.object({
  type: z.literal('jsonl'),
  output: z.string().default('.memory/.index')
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

/** Hosted mem0 (app.mem0.ai). The key is read from the environment, never from the file. */
const mem0PlatformSchema = z.object({
  type: z.literal('mem0'),
  mode: z.literal('platform'),
  apiKeyEnv: z.string().default('MEM0_API_KEY'),
  host: z.string().url().optional(),
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
  scope: mem0ScopeSchema.optional()
})

export const mem0ProjectionConfigSchema = z.discriminatedUnion('mode', [
  mem0PlatformSchema,
  mem0OssSchema
])

export type JsonlProjectionConfig = z.infer<typeof jsonlProjectionConfigSchema>
export type Mem0ProjectionConfig = z.infer<typeof mem0ProjectionConfigSchema>

export const projectionConfigSchema = z.preprocess(
  // `file` was this projection's name before mem0 made it one of several; it
  // writes files, it does not read them, so the old name read backwards.
  (value) =>
    value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'file'
      ? { ...value, type: 'jsonl' }
      : value,
  z.union([jsonlProjectionConfigSchema, mem0ProjectionConfigSchema])
)

export type ProjectionConfig = z.infer<typeof projectionConfigSchema>

export const memoryConfigSchema = z.object({
  version: z.literal(1),
  source: z
    .object({
      root: z.string().default('.memory'),
      include: z.array(z.string()).default(['**/*.md']),
      exclude: z.array(z.string()).default(['.index/**'])
    })
    .prefault({}),
  ontology: z
    .object({
      file: z.string().default('.memory/entities.yaml')
    })
    .prefault({}),
  /** Derived bookkeeping - the manifest - owned by sync, not by any projection. */
  state: z
    .object({
      dir: z.string().default('.memory/.index')
    })
    .prefault({}),
  watch: z
    .object({
      debounceMs: z.number().int().positive().default(300)
    })
    .prefault({}),
  projections: z.array(projectionConfigSchema).default([
    { type: 'jsonl', output: '.memory/.index' }
  ])
})

export type MemoryConfig = z.infer<typeof memoryConfigSchema>

/** Config plus the absolute paths every other module resolves against. */
export interface ResolvedConfig {
  config: MemoryConfig
  projectRoot: string
  memoryRoot: string
  ontologyPath: string
}

export const CONFIG_FILENAME = '.memory.yaml'

/** Absolute directory holding the manifest (spec §31). */
export const stateRootOf = (resolved: ResolvedConfig): string =>
  resolve(resolved.projectRoot, resolved.config.state.dir)
