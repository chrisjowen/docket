import { resolve } from 'node:path'

import { ollamaModelSchema } from '@docket/adapter-kit'
import { z } from 'zod'

import { runtimeReferenceSchema, runtimesConfigSchema } from '../runtime/config.js'

/** Claude Code's `claude` CLI, run in print mode with the user's own login. */
export const claudeModelSchema = z.object({
  provider: z.literal('claude'),
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
 * The adapter package each v1 `projections` type is served by. Core knows
 * these names, not their configuration: each adapter validates its own entry.
 */
export const V1_PROJECTION_MODULES = {
  jsonl: '@docket/adapter-jsonl',
  mem0: '@docket/adapter-mem0',
  neo4j: '@docket/adapter-neo4j'
} as const

export type V1ProjectionType = keyof typeof V1_PROJECTION_MODULES

/**
 * One v1 `projections` entry: its `type` picks the adapter, and every other
 * field is that adapter's configuration, passed through untouched.
 */
export const projectionConfigSchema = z.preprocess(
  // `file` was this projection's name before mem0 made it one of several; it
  // writes files, it does not read them, so the old name read backwards.
  (value) =>
    value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'file'
      ? { ...value, type: 'jsonl' }
      : value,
  z.looseObject({
    type: z.enum(Object.keys(V1_PROJECTION_MODULES) as [V1ProjectionType, ...V1ProjectionType[]])
  })
)

export type ProjectionConfig = z.infer<typeof projectionConfigSchema>

/**
 * A `projections` entry: the projection's own config plus the instance-level
 * `runtime` reference, which the projection never sees (adapter spec §6).
 */
export const projectionEntrySchema = z.intersection(projectionConfigSchema, runtimeReferenceSchema)

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
  projections: z.array(projectionEntrySchema).default([
    { type: 'jsonl', output: '.docket/.index' }
  ]),
  /** Local resources `docket runtime` manages, by id. Nothing else acts on them. */
  runtimes: runtimesConfigSchema.default({}),
  /**
   * The model `docket open`'s chat summarizes search results with: the
   * `claude` CLI unless an Ollama model is set here.
   */
  summarize: summarizeConfigSchema
}).superRefine((config, context) => {
  config.projections.forEach((projection, index) => {
    if (projection.runtime !== undefined && !Object.hasOwn(config.runtimes, projection.runtime)) {
      context.addIssue({
        code: 'custom',
        path: ['projections', index, 'runtime'],
        message: `runtime "${projection.runtime}" is not defined under runtimes`
      })
    }
  })
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
