import { resolve } from 'node:path'

import { ollamaModelSchema } from '@docket/adapter-kit'
import type { AdapterRole } from '@docket/contracts'
import { z } from 'zod'

import { runtimeIdSchema, runtimeReferenceSchema, runtimesConfigSchema } from '../runtime/config.js'

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

/** The sections v1 and v2 share, defaulted alike in both. */
const sharedSections = {
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
  /** Derived bookkeeping - each adapter instance's sync manifest - owned by sync, not by any adapter. */
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
  /** Local resources `docket runtime` manages, by id. Nothing else acts on them. */
  runtimes: runtimesConfigSchema.default({}),
  /**
   * The model `docket open`'s chat summarizes search results with: the
   * `claude` CLI unless an Ollama model is set here.
   */
  summarize: summarizeConfigSchema
}

/** Version 1: the engines are a fixed list of `projections`, each picked by its `type`. */
export const v1ConfigSchema = z.object({
  version: z.literal(1),
  ...sharedSections,
  projections: z.array(projectionEntrySchema).default([
    { type: 'jsonl', output: '.docket/.index' }
  ])
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

export type V1Config = z.infer<typeof v1ConfigSchema>

export const ADAPTER_ROLES = ['projection', 'query'] as const satisfies readonly AdapterRole[]

/** Instance ids name state directories, so they stay path-safe. */
export const ADAPTER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._#-]*$/

export const adapterIdSchema = z
  .string()
  .regex(ADAPTER_ID_PATTERN, 'an adapter id starts with a letter or digit and uses only letters, digits, ".", "_", "#" and "-"')

/**
 * One adapter instance (docs/adapter-spec.md §5). Core reads only this
 * envelope - strictly, so a misspelt field fails rather than being ignored.
 * `config` belongs to the adapter, which validates it when the docket opens.
 * Secrets never go in it: an adapter takes the name of an environment
 * variable (`passwordEnv`, `tokenEnv`, ...) and reads the value itself.
 */
export const adapterInstanceSchema = z.strictObject({
  /** Unique instance identity, distinct from the module: one package can serve several instances. */
  id: adapterIdSchema,
  /** An npm package installed in the project, or a .js/.mjs path relative to `.docket.yaml`. */
  module: z.string().min(1),
  /** The roles it runs in; a role left out never runs. Both unless listed. */
  roles: z
    .array(z.enum(ADAPTER_ROLES))
    .refine((roles) => new Set(roles).size === roles.length, 'a role is listed more than once')
    .default([...ADAPTER_ROLES]),
  /** The adapter's own configuration, handed to its `validateConfig` untouched. */
  config: z.unknown().optional().transform((config): unknown => config ?? {}),
  /** The runtime group whose resources it connects to. The adapter never sees it. */
  runtime: runtimeIdSchema.optional()
})

export type AdapterInstanceConfig = z.infer<typeof adapterInstanceSchema>

/**
 * How questions are put to the adapters. The shared query coordinator
 * (docs/adapter-spec.md §10) reads all of it; `docket search` reads
 * `defaultAdapters`.
 */
export const queryConfigSchema = z
  .strictObject({
    /** The instances a question goes to unless it names its own. Unset: every instance with the query role. */
    defaultAdapters: z.array(adapterIdSchema).optional(),
    /** The shared deadline every adapter answers within. */
    timeoutMs: z.number().int().positive().default(30_000),
    maxConcurrentAdapters: z.number().int().positive().default(4),
    /** Whether an answer is written over the adapters' results. */
    synthesis: z.boolean().default(true)
  })
  .prefault({})

export type QueryConfig = z.infer<typeof queryConfigSchema>

/** What a v2 file without `adapters` gets: the lightweight local adapter, as v1 did. */
export const DEFAULT_ADAPTERS = [
  { id: 'local', module: V1_PROJECTION_MODULES.jsonl, config: { output: '.docket/.index' } }
]

/**
 * Version 2 (docs/adapter-spec.md §5): adapter instances, each naming its
 * module, roles and configuration, and a query section. Strict at the top
 * level, so a misspelt section - or v1's `projections` - fails. Every loaded
 * config has this shape; a v1 file is converted to it as it loads.
 */
export const v2ConfigSchema = z.strictObject({
  version: z.literal(2),
  ...sharedSections,
  adapters: z.array(adapterInstanceSchema).prefault(DEFAULT_ADAPTERS),
  query: queryConfigSchema
}).superRefine((config, context) => {
  const roles = new Map<string, readonly AdapterRole[]>()
  config.adapters.forEach((adapter, index) => {
    if (roles.has(adapter.id)) {
      context.addIssue({
        code: 'custom',
        path: ['adapters', index, 'id'],
        message: `adapter id "${adapter.id}" is used more than once; instance ids must be unique`
      })
    }
    roles.set(adapter.id, adapter.roles)
    if (adapter.runtime !== undefined && !Object.hasOwn(config.runtimes, adapter.runtime)) {
      context.addIssue({
        code: 'custom',
        path: ['adapters', index, 'runtime'],
        message: `runtime "${adapter.runtime}" is not defined under runtimes`
      })
    }
  })
  config.query.defaultAdapters?.forEach((id, index) => {
    const path = ['query', 'defaultAdapters', index]
    const enabled = roles.get(id)
    if (enabled === undefined) {
      context.addIssue({ code: 'custom', path, message: `adapter "${id}" is not defined under adapters` })
    } else if (!enabled.includes('query')) {
      context.addIssue({ code: 'custom', path, message: `adapter "${id}" does not have the query role` })
    }
  })
})

/** A loaded configuration: version 2, whichever version the file is. */
export type MemoryConfig = z.infer<typeof v2ConfigSchema>

/**
 * The instance id of each v1 projection: its type. Two projections of one
 * type would share a name; number the repeats so their answers stay apart,
 * as `docket search` always has.
 */
export const projectionInstanceIds = (projections: readonly { type: string }[]): string[] => {
  const seen = new Map<string, number>()
  return projections.map(({ type }) => {
    const count = (seen.get(type) ?? 0) + 1
    seen.set(type, count)
    return count === 1 ? type : `${type}#${count}`
  })
}

/**
 * The v2 adapter instance a v1 projection is: its type picks the module and
 * names the instance, its `runtime` moves up to the instance, and every other
 * field - each mem0 mode, Neo4j setting and scope - is its config, untouched.
 * Both roles, as v1 always ran.
 */
export const adapterFromProjection = (
  { type, runtime, ...config }: V1Config['projections'][number],
  id: string
): z.input<typeof adapterInstanceSchema> => ({
  id,
  module: V1_PROJECTION_MODULES[type],
  roles: [...ADAPTER_ROLES],
  ...(runtime === undefined ? {} : { runtime }),
  config
})

/** A v1 configuration as the v2 configuration it means, losing nothing. */
export const fromV1Config = ({ version: _version, projections, ...shared }: V1Config): MemoryConfig => {
  const ids = projectionInstanceIds(projections)
  return v2ConfigSchema.parse({
    ...shared,
    version: 2,
    adapters: projections.map((projection, index) => adapterFromProjection(projection, ids[index]!))
  })
}

/** How errors name the adapter instance at `index` of a raw config, when it has an id to name. */
const instanceLabel = (raw: unknown, index: unknown): string | undefined => {
  if (typeof index !== 'number' || typeof raw !== 'object' || raw === null) return undefined
  const adapters = (raw as { adapters?: unknown }).adapters
  const entry: unknown = Array.isArray(adapters) ? adapters[index] : undefined
  const id = typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined
  return typeof id === 'string' && id !== '' ? `adapter "${id}"` : undefined
}

/**
 * `.docket.yaml` of either version, as a version 2 configuration. An error
 * about an adapter instance names the instance.
 */
export const memoryConfigSchema = z.unknown().transform((raw, context): MemoryConfig => {
  const version = typeof raw === 'object' && raw !== null ? (raw as { version?: unknown }).version : undefined
  if (version !== 1 && version !== 2) {
    context.addIssue({ code: 'custom', path: ['version'], message: 'version must be 1 or 2' })
    return z.NEVER
  }
  const parsed = version === 1 ? v1ConfigSchema.safeParse(raw) : v2ConfigSchema.safeParse(raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const label = issue.path[0] === 'adapters' ? instanceLabel(raw, issue.path[1]) : undefined
      context.addIssue({ ...issue, message: label === undefined ? issue.message : `${label}: ${issue.message}` })
    }
    return z.NEVER
  }
  return parsed.data.version === 1 ? fromV1Config(parsed.data) : parsed.data
})

/** Config plus the absolute paths every other module resolves against. */
export interface ResolvedConfig {
  config: MemoryConfig
  projectRoot: string
  memoryRoot: string
  ontologyPath: string
}

export const CONFIG_FILENAME = '.docket.yaml'

/** Absolute directory holding the sync manifests (spec §31) and each adapter instance's state root. */
export const stateRootOf = (resolved: ResolvedConfig): string =>
  resolve(resolved.projectRoot, resolved.config.state.dir)
