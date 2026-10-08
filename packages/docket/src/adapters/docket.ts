import { join } from 'node:path'

import {
  ContractError,
  validateAdapterAnswer,
  validateAdapterDefinition,
  validateAdapterDescription,
  validateAdapterStatus,
  validateApplyReceipt,
  validateMemoryAdapter,
  type AdapterDefinition,
  type AdapterLogger,
  type AdapterRole,
  type AdapterServices,
  type CanonicalInput,
  type CanonicalReader,
  type MemoryAdapter
} from '@docket/contracts'

import { stableStringify } from '@docket/adapter-kit'

import {
  ADAPTER_ID_PATTERN,
  ADAPTER_ROLES,
  stateRootOf,
  V1_PROJECTION_MODULES,
  type ResolvedConfig
} from '../config/config.js'
import { loadConfig } from '../config/loader.js'
import { validate } from '../commands/validate.js'
import { hashContent } from '../source/hashing.js'
import { toEntityInput } from './compat.js'
import { standardDistribution } from './distribution.js'
import { loadAdapterDefinition } from './loader.js'
import type { AdapterDistribution, TypeScriptRunner } from './resolve-module.js'

/**
 * The Docket scope everything runs in. v1 configuration has no scope of its
 * own: each engine keeps the native scoping its own config sets.
 */
export const DEFAULT_SCOPE = 'default'

const ALL_ROLES: readonly AdapterRole[] = ADAPTER_ROLES

/** The standard adapters' configs name their own type, so they identify their module. */
const STANDARD_MODULES = new Set<string>(Object.values(V1_PROJECTION_MODULES))

/** An adapter loaded from a module: an npm package installed in the project, or a .js/.mjs path relative to `.docket.yaml`. */
export interface AdapterModuleReference {
  id: string
  module: string
  config?: unknown
  /** The roles it runs in. Defaults to every role it implements. */
  roles?: AdapterRole[]
}

/** An adapter definition passed in directly. */
export interface AdapterRegistration {
  id: string
  definition: AdapterDefinition
  config?: unknown
  roles?: AdapterRole[]
}

/**
 * One configured adapter instance, ready to create. Its definition's contract
 * major and its config were checked when the docket was opened.
 */
export interface AdapterSlot {
  /** Unique instance identity, distinct from the definition's name. */
  readonly id: string
  /** The definition's name. */
  readonly name: string
  /** Where the definition came from: a module reference, or `registration`. */
  readonly source: string
  readonly roles: readonly AdapterRole[]
  /**
   * Creates a fresh instance whose ports and answers are validated at runtime
   * and whose disabled roles are absent. The caller closes it.
   */
  create(): Promise<MemoryAdapter>
}

export interface Docket {
  readonly resolved: ResolvedConfig
  readonly adapters: readonly AdapterSlot[]
  /**
   * The `.docket.yaml` adapters enabled for projection, as they read their
   * configs, hashed: changes whenever one is added, removed or reconfigured,
   * so sync's manifest knows when it no longer vouches for what they hold. A
   * v1 file and its v2 migration hash alike, so migrating reprojects nothing.
   */
  readonly projectionsFingerprint: string
}

export interface OpenDocketOptions {
  adapters?: readonly AdapterModuleReference[] | undefined
  registrations?: readonly AdapterRegistration[] | undefined
  /** Imports TypeScript adapter modules. Without one, `.ts` modules are refused. */
  typescript?: TypeScriptRunner | undefined
  /** Read-only canonical access handed to adapters. Defaults to the project's own files. */
  canonical?: CanonicalReader | undefined
  /** The adapter packages this docket ships with. Defaults to the standard distribution's. */
  distribution?: AdapterDistribution | undefined
}

export interface CreateDocketOptions extends OpenDocketOptions {
  /** Where to look for `.docket.yaml`, walking up. Defaults to the working directory. */
  projectRoot?: string | undefined
}

/**
 * Opens the project's docket: the adapter instances its `.docket.yaml`
 * configures (a v1 file's projections converted to them), then any adapters
 * loaded by module reference or registered directly - all driven through the
 * adapter contract (docs/adapter-spec.md §4, §5, §12, §15).
 */
export const createDocket = async (options: CreateDocketOptions = {}): Promise<Docket> =>
  openDocket(await loadConfig(options.projectRoot), options)

/** `createDocket` for a config already loaded. */
export const openDocket = async (resolved: ResolvedConfig, options: OpenDocketOptions = {}): Promise<Docket> => {
  const load = (id: string, module: string): Promise<AdapterDefinition> =>
    loadAdapterDefinition(module, {
      id,
      projectRoot: resolved.projectRoot,
      typescript: options.typescript,
      distribution: options.distribution ?? standardDistribution
    })

  const pending: {
    id: string
    source: string
    definition: unknown
    config: unknown
    roles?: readonly AdapterRole[] | undefined
    /** Configured in `.docket.yaml`, by this module. */
    configured?: string
  }[] = []

  // The runtime reference is the docket's, not the adapter's (adapter spec §6).
  for (const { id, module, roles, config } of resolved.config.adapters) {
    pending.push({ id, source: module, definition: await load(id, module), config, roles, configured: module })
  }

  for (const reference of options.adapters ?? []) {
    checkId(reference.id)
    pending.push({
      id: reference.id,
      source: reference.module,
      definition: await load(reference.id, reference.module),
      config: reference.config,
      roles: reference.roles
    })
  }

  for (const registration of options.registrations ?? []) {
    pending.push({ ...registration, config: registration.config, source: 'registration' })
  }

  const ids = new Set<string>()
  const canonical = options.canonical ?? projectCanonicalReader(resolved)
  const fingerprinted: unknown[] = []
  const adapters = pending.map((entry): AdapterSlot => {
    checkId(entry.id)
    if (ids.has(entry.id)) throw new Error(`Adapter id "${entry.id}" is used more than once; instance ids must be unique.`)
    ids.add(entry.id)

    const definition = validateAdapterDefinition(entry.definition, `Adapter "${entry.id}"`)
    let config: unknown
    try {
      config = definition.validateConfig(entry.config)
    } catch (cause) {
      throw new Error(
        `Adapter "${entry.id}" (${definition.name}) rejected its configuration: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause }
      )
    }
    const roles = entry.roles ?? ALL_ROLES
    for (const role of roles) {
      if (!ALL_ROLES.includes(role)) throw new Error(`Adapter "${entry.id}" has unknown role "${String(role)}".`)
    }
    if (entry.configured !== undefined && roles.includes('projection')) {
      fingerprinted.push(STANDARD_MODULES.has(entry.configured) ? config : { id: entry.id, module: entry.configured, config })
    }

    const services: AdapterServices = {
      projectRoot: resolved.projectRoot,
      stateRoot: join(stateRootOf(resolved), 'adapters', entry.id),
      scope: DEFAULT_SCOPE,
      logger: stderrLogger(entry.id),
      canonical,
      secrets: { getEnv: async (name) => process.env[name] }
    }

    return {
      id: entry.id,
      name: definition.name,
      source: entry.source,
      roles: [...roles],
      create: async () => guard(entry.id, roles, validateMemoryAdapter(await definition.create(config, services)))
    }
  })

  return { resolved, adapters, projectionsFingerprint: hashContent(stableStringify(fingerprinted)) }
}

const checkId = (id: string): void => {
  if (typeof id !== 'string' || !ADAPTER_ID_PATTERN.test(id)) {
    throw new Error(`Adapter id "${String(id)}" must start with a letter or digit and use only letters, digits, ".", "_", "#" and "-".`)
  }
}

/** Warnings and errors reach stderr, attributed; debug and info stay quiet. */
const stderrLogger = (id: string): AdapterLogger => {
  const write = (message: string): void => console.error(`docket adapter ${id}: ${message}`)
  return { debug: () => {}, info: () => {}, warn: write, error: write }
}

/** The project's entities, read and merged on first use. v1 canonical files hold entities only. */
const projectCanonicalReader = (resolved: ResolvedConfig): CanonicalReader => {
  let entities: Promise<CanonicalInput[]> | undefined
  const load = (): Promise<CanonicalInput[]> => {
    entities ??= validate({ cwd: resolved.projectRoot }).then(({ entities }) =>
      entities.map((entity) => toEntityInput(entity, DEFAULT_SCOPE))
    )
    return entities
  }
  return {
    get: async (kind, id) => (kind === 'entity' ? (await load()).find((record) => record.id === id) : undefined),
    list: async (kind) => (kind === 'entity' ? load() : [])
  }
}

/** Rethrows a broken contract as this instance's, so the error says which adapter broke it. */
const attributed = <T>(id: string, run: () => T): T => {
  try {
    return run()
  } catch (cause) {
    if (cause instanceof ContractError) {
      throw new ContractError(`Adapter "${id}" broke its contract - ${cause.summary}`, cause.issues)
    }
    throw cause
  }
}

/** Validates everything the adapter returns, and leaves out the ports of roles it is not enabled for. */
const guard = (id: string, roles: readonly AdapterRole[], adapter: MemoryAdapter): MemoryAdapter => {
  const { projection, query } = adapter
  return {
    describe: () => attributed(id, () => validateAdapterDescription(adapter.describe())),
    status: async (signal) => {
      const status = await adapter.status(signal)
      return attributed(id, () => validateAdapterStatus(status))
    },
    ...(projection && roles.includes('projection')
      ? {
          projection: {
            apply: async (batch, signal) => {
              const receipt = await projection.apply(batch, signal)
              return attributed(id, () => validateApplyReceipt(receipt, batch))
            },
            ...(projection.flush ? { flush: (signal?: AbortSignal) => projection.flush!(signal) } : {}),
            reset: (scope, signal) => projection.reset(scope, signal)
          }
        }
      : {}),
    ...(query && roles.includes('query')
      ? {
          query: {
            ask: async (request) => {
              const answer = await query.ask(request)
              return attributed(id, () => validateAdapterAnswer(answer, request))
            }
          }
        }
      : {}),
    close: () => adapter.close()
  }
}
