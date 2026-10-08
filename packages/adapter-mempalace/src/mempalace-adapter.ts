import { isAbsolute, join, relative, resolve } from 'node:path'

import {
  appliedWhole,
  applyChanges,
  CheckpointFile,
  configFingerprint,
  NativeOwnership,
  recallAnswer,
  resolveNativeHits,
  staleDiagnostic
} from '@docket/adapter-kit'
import type {
  AdapterAnswer,
  AdapterDescription,
  AdapterServices,
  AdapterStatus,
  AskRequest,
  Diagnostic,
  InputKind,
  MemoryAdapter,
  ProjectionBatch
} from '@docket/contracts'

import type { MempalaceConfig } from './config.js'
import { McpStdioClient, McpUnavailableError, type ToolClient } from './mcp-client.js'
import { defaultWing, failureOf, missingModel, nothingFiled, PalaceStore, retryablePalaceError } from './palace-store.js'

export const MEMPALACE_INPUTS: readonly InputKind[] = ['entity', 'observation', 'document']

/** The MemPalace release this adapter was written and tested against. */
export const PINNED_MEMPALACE = '3.10.0'

export interface MempalaceAdapterOptions {
  version: string
  /** Replaces starting the MCP server - tests answer through it. */
  connect?: () => Promise<ToolClient & { serverInfo?: { version?: string } }>
  /** Where chromadb's model cache is looked for; tests point it elsewhere. */
  home?: string
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const commandPath = (command: string, projectRoot: string): string =>
  command.includes('/') && !isAbsolute(command) ? resolve(projectRoot, command) : command

/**
 * The server's environment: its own config directory, the configured
 * embedding model, no forwarding to a shared hub, the Hugging Face cache read
 * offline and chromadb's telemetry off.
 */
export const serverEnvironment = (config: MempalaceConfig, configDir: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({
  ...base,
  MEMPALACE_CONFIG_DIR: configDir,
  MEMPALACE_EMBEDDING_MODEL: config.embeddingModel,
  MEMPALACE_HUB_FORWARD: '0',
  HF_HUB_OFFLINE: '1',
  ANONYMIZED_TELEMETRY: 'False'
})

/**
 * The MemPalace adapter: canonical inputs filed verbatim as drawers in one
 * wing, recalled with MemPalace's own hybrid (vector and BM25) search. The
 * MCP server starts on first use - never to install or download anything - and
 * stops when the adapter closes.
 */
export const createMempalaceAdapter = (
  config: MempalaceConfig,
  services: AdapterServices,
  options: MempalaceAdapterOptions
): MemoryAdapter => {
  const palace = config.palace === undefined ? join(services.stateRoot, 'palace') : resolve(services.projectRoot, config.palace)
  const configDir = config.configDir === undefined ? join(services.stateRoot, 'mempalace') : resolve(services.projectRoot, config.configDir)
  const wing = config.wing ?? defaultWing(services.projectRoot, services.scope)
  const shownPalace = relative(services.projectRoot, palace) || palace

  let connection: Promise<ToolClient & { serverInfo?: { version?: string } }> | undefined
  const client = (): Promise<ToolClient & { serverInfo?: { version?: string } }> => {
    const missing = missingModel(config.embeddingModel, options.home)
    if (missing !== undefined) return Promise.reject(new McpUnavailableError(missing))
    connection ??= (
      options.connect ??
      (() =>
        McpStdioClient.start({
          command: commandPath(config.command, services.projectRoot),
          args: [...config.args, '--palace', palace],
          env: serverEnvironment(config, configDir),
          cwd: services.projectRoot,
          startupTimeoutMs: config.startupTimeoutMs,
          timeoutMs: config.timeoutMs
        }).catch((error: unknown) => {
          throw error instanceof McpUnavailableError
            ? new McpUnavailableError(
                `${error.message} Install MemPalace yourself - \`pip install mempalace==${PINNED_MEMPALACE}\` - or set command and args; docket never installs it.`,
                { cause: error }
              )
            : error
        }))
    )().catch((error: unknown) => {
      connection = undefined
      throw error
    })
    return connection
  }

  const store = new PalaceStore(client, wing, config.maxDistance)
  // MemPalace finds drawers by their embeddings: an entity opted out of vector indexing is not filed.
  const ownership = new NativeOwnership(store, (record) => record.kind !== 'entity' || record.index.vector)
  const checkpoints = new CheckpointFile(
    services.stateRoot,
    configFingerprint({ engine: 'mempalace', palace, wing, embeddingModel: config.embeddingModel })
  )

  const requireScope = (scope: string): void => {
    if (scope !== services.scope) throw new Error(`MemPalace adapter serves scope "${services.scope}", not "${scope}"`)
  }

  const description: AdapterDescription = {
    name: 'mempalace',
    version: options.version,
    inputs: [...MEMPALACE_INPUTS],
    resultKinds: ['passages', 'entities'],
    // Refiled from the canonical files: the same drawers, re-embedded by whatever model the palace uses.
    rebuild: 'reconstructible'
  }

  const status = async (signal?: AbortSignal): Promise<AdapterStatus> => {
    let palaceClient: ToolClient & { serverInfo?: { version?: string } }
    try {
      palaceClient = await client()
    } catch (error) {
      return { state: 'unavailable', message: messageOf(error) }
    }
    const engineVersion = palaceClient.serverInfo?.version
    const checkpoint = await checkpoints.read(services.scope)
    const base = { ...(engineVersion !== undefined ? { engineVersion } : {}), ...(checkpoint !== undefined ? { checkpoint } : {}) }
    try {
      const listed = await palaceClient.call('mempalace_list_wings', {}, { signal })
      const failure = failureOf(listed)
      if (failure !== undefined && !nothingFiled(failure)) throw new Error(failure)
      const drawers = (listed as { wings?: Record<string, number> }).wings?.[wing] ?? 0
      const where = `${shownPalace}, wing "${wing}": ${drawers} drawer${drawers === 1 ? '' : 's'}`
      if (engineVersion !== undefined && engineVersion.split('.')[0] !== PINNED_MEMPALACE.split('.')[0]) {
        return { ...base, state: 'degraded', message: `${where}. MemPalace ${engineVersion} is not the ${PINNED_MEMPALACE} this adapter was tested against.` }
      }
      return { ...base, state: 'ready', message: where }
    } catch (error) {
      return { ...base, state: 'degraded', message: `${shownPalace} could not be read: ${messageOf(error)}` }
    }
  }

  const apply = async (batch: ProjectionBatch, signal?: AbortSignal) => {
    const receipt = await applyChanges(
      batch,
      ownership,
      { scope: services.scope, inputs: MEMPALACE_INPUTS, retryable: retryablePalaceError },
      signal
    )
    // A failed call may have left the cached mapping behind the palace: read it again next time.
    if (receipt.failed.length > 0) ownership.invalidate()
    if (appliedWhole(batch, receipt)) await checkpoints.write(services.scope, batch.checkpoint)
    return receipt
  }

  const reset = async (scope: string, signal?: AbortSignal): Promise<void> => {
    requireScope(scope)
    await checkpoints.clear(scope)
    await ownership.clear(signal)
  }

  const ask = async (request: AskRequest): Promise<AdapterAnswer> => {
    requireScope(request.context.scope)
    const remaining = Date.parse(request.budget.deadline) - Date.now()
    if (!(remaining > 0)) throw new Error('MemPalace adapter: the question\'s deadline has already passed')
    const search = await store.search(request.question, request.budget.maxResults, {
      signal: request.signal,
      timeoutMs: Math.min(remaining, config.timeoutMs)
    })
    const resolved = await resolveNativeHits(search.hits, services.canonical)
    const checkpoint = await checkpoints.read(services.scope)
    const notes: Diagnostic[] = search.notes.map((message) => ({ severity: 'info', code: 'mempalace-search', message }))
    return recallAnswer({
      request,
      hits: resolved.hits,
      interpretation: {
        description: `MemPalace search of wing "${wing}" in ${shownPalace}: vector similarity reranked with BM25`,
        assumptions: [
          'Ranked by similarity: the closest drawers, not every match, and never a count.',
          'Similarity scores are MemPalace\'s own and say nothing about other adapters\' scores.'
        ],
        nativeQuery: request.question
      },
      more: search.more,
      diagnostics: [...staleDiagnostic(resolved.stale), ...notes],
      ...(checkpoint !== undefined ? { checkpoint } : {})
    })
  }

  return {
    describe: () => description,
    status,
    projection: { apply, reset },
    query: { ask },
    close: async () => {
      const open = connection
      connection = undefined
      if (open) await (await open.catch(() => undefined))?.close()
    }
  }
}
