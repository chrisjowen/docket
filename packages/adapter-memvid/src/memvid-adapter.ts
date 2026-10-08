import { isAbsolute, join, relative, resolve } from 'node:path'

import {
  appliedWhole,
  applyChanges,
  CheckpointFile,
  configFingerprint,
  NativeOwnership,
  recallAnswer,
  resolveNativeHits,
  staleDiagnostic,
  type NativeHit
} from '@docket/adapter-kit'
import type {
  AdapterAnswer,
  AdapterDescription,
  AdapterServices,
  AdapterStatus,
  AskRequest,
  InputKind,
  MemoryAdapter,
  ProjectionBatch
} from '@docket/contracts'

import type { MemvidConfig } from './config.js'
import { MemvidCommandError, MemvidStore } from './memvid-store.js'
import { MemvidUnavailableError, spawnRunner, type CommandRunner } from './runner.js'

export const MEMVID_INPUTS: readonly InputKind[] = ['entity', 'observation', 'document']

/** The default memory file, in the instance's own state directory. */
export const DEFAULT_FILENAME = 'memory.mv2'

export interface MemvidAdapterOptions {
  version: string
  /** Replaces spawning the CLI - tests replay recorded output through it. */
  run?: CommandRunner
}

/** Where the CLI is: a bare name is looked up on PATH; a relative path resolves against the project. */
const commandPath = (command: string, projectRoot: string): string =>
  command.includes('/') && !isAbsolute(command) ? resolve(projectRoot, command) : command

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Hits from a frame and from its first chunk can carry the same text: show it once. */
const distinct = (hits: readonly NativeHit[]): NativeHit[] => {
  const seen = new Set<string>()
  return hits.filter((hit) => {
    const key = `${hit.identity.kind}\u0000${hit.identity.id}\u0000${hit.identity.revision}\u0000${hit.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * The memvid adapter: canonical inputs as frames of one `.mv2` file, found
 * with memvid's own lexical (BM25) search. One instance serves one Docket
 * scope; every frame it writes, lists, finds or resets is under its
 * namespace's URI prefix.
 */
export const createMemvidAdapter = (
  config: MemvidConfig,
  services: AdapterServices,
  options: MemvidAdapterOptions
): MemoryAdapter => {
  const file = config.file === undefined ? join(services.stateRoot, DEFAULT_FILENAME) : resolve(services.projectRoot, config.file)
  const namespace = config.namespace ?? services.scope
  const store = new MemvidStore({
    file,
    namespace,
    run: options.run ?? spawnRunner(commandPath(config.command, services.projectRoot), services.projectRoot),
    timeoutMs: config.timeoutMs,
    lockTimeoutMs: config.lockTimeoutMs
  })
  // memvid's lexical index is what docket searches: an entity opted out of full text is not stored.
  const ownership = new NativeOwnership(store, (record) => record.kind !== 'entity' || record.index.fts)
  const checkpoints = new CheckpointFile(services.stateRoot, configFingerprint({ engine: 'memvid', file, namespace }))
  const shownFile = relative(services.projectRoot, file) || file

  const requireScope = (scope: string): void => {
    if (scope !== services.scope) {
      throw new Error(`memvid adapter serves scope "${services.scope}", not "${scope}"`)
    }
  }

  const description: AdapterDescription = {
    name: 'memvid',
    version: options.version,
    inputs: [...MEMVID_INPUTS],
    resultKinds: ['passages', 'entities'],
    // Replayed from the canonical files into fresh frames: the same passages, new frame ids and write times.
    rebuild: 'reconstructible'
  }

  const status = async (signal?: AbortSignal): Promise<AdapterStatus> => {
    let engineVersion: string
    try {
      engineVersion = await store.version(signal)
    } catch (error) {
      return { state: 'unavailable', message: messageOf(error) }
    }
    const checkpoint = await checkpoints.read(services.scope)
    const base = { engineVersion, ...(checkpoint !== undefined ? { checkpoint } : {}) }
    if (!store.exists()) {
      return { ...base, state: 'ready', message: `No memory file at ${shownFile} yet; the first projection creates it.` }
    }
    try {
      const usage = await store.usage(signal)
      return { ...base, state: 'ready', message: `${shownFile}, namespace "${namespace}"${usage ? `: ${usage}` : ''}` }
    } catch (error) {
      return { ...base, state: 'degraded', message: `${shownFile} could not be read: ${messageOf(error)}` }
    }
  }

  const apply = async (batch: ProjectionBatch, signal?: AbortSignal) => {
    const receipt = await applyChanges(
      batch,
      ownership,
      {
        scope: services.scope,
        inputs: MEMVID_INPUTS,
        retryable: (error) => !(error instanceof MemvidCommandError) || error.retryable
      },
      signal
    )
    // A failed call may have left the cached mapping behind the file: read it again next time.
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
    if (!(remaining > 0)) throw new Error('memvid adapter: the question\'s deadline has already passed')
    const search = await store.find(request.question, request.budget.maxResults, request.signal, remaining)
    const checkpoint = await checkpoints.read(services.scope)
    const interpretation = {
      description: `memvid lexical (BM25) search of namespace "${namespace}" in ${shownFile}, matching any of the question's words`,
      assumptions: ['Ranked by BM25 relevance: the best matches, not every match, and never a count.'],
      ...(search !== undefined ? { nativeQuery: search.nativeQuery } : {})
    }
    if (search === undefined) {
      return recallAnswer({
        request,
        hits: [],
        interpretation,
        more: false,
        diagnostics: [{ severity: 'info', code: 'no-search-terms', message: 'The question has no words to search for.' }],
        ...(checkpoint !== undefined ? { checkpoint } : {})
      })
    }
    const resolved = await resolveNativeHits(distinct(search.hits), services.canonical)
    return recallAnswer({
      request,
      hits: resolved.hits,
      interpretation,
      more: search.more,
      diagnostics: staleDiagnostic(resolved.stale),
      ...(checkpoint !== undefined ? { checkpoint } : {})
    })
  }

  return {
    describe: () => description,
    status,
    projection: { apply, reset },
    query: { ask },
    // Every CLI call is its own process: there is nothing held open.
    close: async () => {}
  }
}

export { MemvidUnavailableError }
