import { z } from 'zod'

/** Which mem0 entity the projected memories are filed under. At least one id is required. */
const mem0ScopeSchema = z
  .strictObject({
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

const mem0Type = z.literal('mem0').default('mem0')

/** Hosted mem0 (app.mem0.ai). The key is read from the environment, never from the file. */
const mem0PlatformSchema = z.strictObject({
  type: mem0Type,
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
const mem0OssSchema = z.strictObject({
  type: mem0Type,
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
const mem0ServerSchema = z.strictObject({
  type: mem0Type,
  mode: z.literal('server'),
  url: z.string().url(),
  apiKeyEnv: z.string().default('MEM0_API_KEY'),
  minScore: mem0MinScoreSchema,
  scope: mem0ScopeSchema.optional()
})

export const mem0ConfigSchema = z.discriminatedUnion('mode', [mem0PlatformSchema, mem0ServerSchema, mem0OssSchema])

export type Mem0Config = z.infer<typeof mem0ConfigSchema>
