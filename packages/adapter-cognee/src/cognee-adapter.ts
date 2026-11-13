import {
  appliedWhole,
  applyChanges,
  canonicalPassage,
  CheckpointFile,
  configFingerprint,
  NativeOwnership,
  recallAnswer,
  resolveNativeHits,
  staleDiagnostic,
  type NativeIdentity
} from '@docket/adapter-kit'
import type {
  AdapterAnswer,
  AdapterDescription,
  AdapterServices,
  AdapterStatus,
  ApplyReceipt,
  AskRequest,
  CanonicalReader,
  CanonicalReference,
  Diagnostic,
  InputKind,
  MemoryAdapter,
  ProjectionBatch
} from '@docket/contracts'

import { CogneeClient, CogneeHttpError } from './cognee-client.js'
import { CogneeStore, defaultDataset, retryableCogneeError, searchResults } from './cognee-store.js'
import type { CogneeConfig } from './config.js'

/** The cognee release this adapter was written and tested against. */
export const PINNED_COGNEE = '1.6.8'

export interface CogneeAdapterOptions {
  version: string
  /** Replaces the global fetch - tests answer through it. */
  fetch?: typeof fetch
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))


/** What a cited answer says, without the evidence list cognee appends with `include_references`. */
export interface CitedAnswer {
  text: string
  dataIds: string[]
  chunkIds: string[]
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

/**
 * Splits a completion answer from the references cognee 1.6.8 appends -
 * "Evidence:" and one line per chunk, `(data_id: …, chunk_id: …)`.
 */
export const parseCitedAnswer = (text: string): CitedAnswer => {
  const at = text.search(/\n\s*Evidence:\s*\n/)
  const references = at < 0 ? '' : text.slice(at)
  const ids = (key: string) => [...new Set([...references.matchAll(new RegExp(`${key}:\\s*(${UUID})`, 'g'))].map((match) => (match[1] as string).toLowerCase()))]
  return { text: (at < 0 ? text : text.slice(0, at)).trim(), dataIds: ids('data_id'), chunkIds: ids('chunk_id') }
}

/** The canonical reference of an input still held at the revision cognee filed, or undefined when the files have moved on. */
const currentReference = async (canonical: CanonicalReader, identity: NativeIdentity): Promise<CanonicalReference | undefined> => {
  const record = await canonical.get(identity.kind, identity.id)
  if (record === undefined) return identity.kind === 'entity' ? undefined : identity
  return record.revision === identity.revision ? canonicalPassage(record).ref : undefined
}

/**
 * The cognee adapter: canonical inputs added verbatim to one cognee dataset
 * and cognified into its knowledge graph, and questions answered with
 * cognee's own chunk search - and, when asked, its cited completion - through
 * its REST API. docket never starts the server or runs Python.
 */
export const createCogneeAdapter = (config: CogneeConfig, services: AdapterServices, options: CogneeAdapterOptions): MemoryAdapter => {
  const inputs: readonly InputKind[] = config.inputs
  const dataset = config.dataset ?? defaultDataset(services.projectRoot, services.scope)
  const client = new CogneeClient({
    url: config.url,
    apiKey: () => services.secrets.getEnv(config.apiKeyEnv),
    timeoutMs: config.timeoutMs,
    ...(options.fetch ? { fetch: options.fetch } : {})
  })
  const store = new CogneeStore(client, dataset, services.scope, services.canonical)
  // cognee finds chunks by their embeddings: an entity opted out of vector indexing is not filed.
  const ownership = new NativeOwnership(store, (record) => record.kind !== 'entity' || record.index.vector)
  const checkpoints = new CheckpointFile(services.stateRoot, configFingerprint({ engine: 'cognee', url: config.url, dataset, inputs }))
  const where = `dataset "${dataset}" at ${config.url}`

  const requireScope = (scope: string): void => {
    if (scope !== services.scope) throw new Error(`cognee adapter serves scope "${services.scope}", not "${scope}"`)
  }

  const description: AdapterDescription = {
    name: 'cognee',
    version: options.version,
    inputs: [...inputs],
    resultKinds: config.completion ? ['passages', 'entities', 'facts'] : ['passages', 'entities'],
    // Re-added from the canonical files: the same items, but re-chunked, re-embedded and re-extracted by cognee's models.
    rebuild: 'reconstructible'
  }

  const status = async (signal?: AbortSignal): Promise<AdapterStatus> => {
    let engineVersion: string | undefined
    try {
      const health = await client.health({ signal })
      engineVersion = typeof health.version === 'string' ? health.version : undefined
      if (health.status !== undefined && health.status !== 'ready' && health.health !== 'healthy') {
        return { state: 'unavailable', message: `cognee at ${config.url} is ${health.health ?? health.status}`, ...(engineVersion ? { engineVersion } : {}) }
      }
    } catch (error) {
      return { state: 'unavailable', message: messageOf(error) }
    }
    const checkpoint = await checkpoints.read(services.scope)
    const base = { ...(engineVersion !== undefined ? { engineVersion } : {}), ...(checkpoint !== undefined ? { checkpoint } : {}) }
    try {
      const items = await store.count({ signal })
      const held = items === undefined ? `${where}: not created yet` : `${where}: ${items} data item${items === 1 ? '' : 's'}`
      if (engineVersion !== undefined && engineVersion.split('.')[0] !== PINNED_COGNEE.split('.')[0]) {
        return { ...base, state: 'degraded', message: `${held}. cognee ${engineVersion} is not the ${PINNED_COGNEE} this adapter was tested against.` }
      }
      return { ...base, state: 'ready', message: held }
    } catch (error) {
      const refused = error instanceof CogneeHttpError && (error.status === 401 || error.status === 403)
      return { ...base, state: refused ? 'unavailable' : 'degraded', message: `${where} could not be read: ${messageOf(error)}` }
    }
  }

  /**
   * Adds and deletes change by change, then cognifies the dataset once, which
   * is what makes the new items searchable. If cognify fails, every upsert in
   * the batch is reported failed, so the next sync retries it: the items are
   * found already added, and cognify runs again over what it has not done.
   */
  const apply = async (batch: ProjectionBatch, signal?: AbortSignal): Promise<ApplyReceipt> => {
    const receipt = await applyChanges(batch, ownership, { scope: services.scope, inputs, retryable: retryableCogneeError }, signal)
    const upserted = new Set(batch.changes.flatMap((change) => (change.operation === 'upsert' ? [change.record.id] : [])))
    if (receipt.applied.some((id) => upserted.has(id))) {
      try {
        await store.cognify({ signal, timeoutMs: config.cognifyTimeoutMs })
      } catch (error) {
        const message = `added, but cognify failed: ${messageOf(error)}`
        const retryable = retryableCogneeError(error)
        receipt.failed.push(...receipt.applied.filter((id) => upserted.has(id)).map((id) => ({ id, retryable, message })))
        receipt.applied = receipt.applied.filter((id) => !upserted.has(id))
      }
    }
    // A failed call may have left the cached mapping behind cognee: read it again next time.
    if (receipt.failed.length > 0) ownership.invalidate()
    if (appliedWhole(batch, receipt)) await checkpoints.write(services.scope, batch.checkpoint)
    return receipt
  }

  /** Deletes the items docket filed in the dataset - never the dataset, which may hold others' data. */
  const reset = async (scope: string, signal?: AbortSignal): Promise<void> => {
    requireScope(scope)
    await checkpoints.clear(scope)
    await ownership.clear(signal)
  }

  /** cognee's cited answer as a derived fact, citing the canonical inputs of the chunks it used. */
  const completionFact = async (request: AskRequest, timeoutMs: number, chunkIdentities: ReadonlyMap<string, NativeIdentity>) => {
    const datasetId = await store.resolveDataset({ signal: request.signal })
    if (datasetId === undefined || config.completion === undefined) return undefined
    const answer = await client.search(
      { search_type: config.completion, dataset_ids: [datasetId], query: request.question, top_k: request.budget.maxResults, include_references: true },
      { signal: request.signal, timeoutMs }
    )
    const [first] = searchResults(answer).filter((text): text is string => typeof text === 'string')
    if (first === undefined) return undefined
    const cited = parseCitedAnswer(first)
    if (cited.text === '') return undefined
    const byData = new Map((await ownership.records(request.signal)).map((record) => [record.nativeId.toLowerCase(), record.identity]))
    const identities = [...cited.chunkIds.map((id) => chunkIdentities.get(id)), ...cited.dataIds.map((id) => byData.get(id))].filter(
      (identity): identity is NativeIdentity => identity !== undefined
    )
    const refs = new Map<string, CanonicalReference>()
    for (const identity of identities) {
      const ref = await currentReference(services.canonical, identity)
      if (ref !== undefined) refs.set(`${ref.kind}\u0000${ref.id}`, ref)
    }
    return { text: cited.text, refs: [...refs.values()], cited: cited.dataIds.length + cited.chunkIds.length }
  }

  const ask = async (request: AskRequest): Promise<AdapterAnswer> => {
    requireScope(request.context.scope)
    const remaining = Date.parse(request.budget.deadline) - Date.now()
    if (!(remaining > 0)) throw new Error('cognee adapter: the question\'s deadline has already passed')
    const timeoutMs = Math.min(remaining, config.timeoutMs)
    const search = await store.search(request.question, request.budget.maxResults, { signal: request.signal, timeoutMs, maxDistance: config.maxDistance })
    const resolved = await resolveNativeHits(search.hits, services.canonical)
    const checkpoint = await checkpoints.read(services.scope)
    const diagnostics: Diagnostic[] = [...staleDiagnostic(resolved.stale)]
    if (search.foreign > 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'cognee-foreign-chunks',
        message:
          `${search.foreign} chunk${search.foreign === 1 ? '' : 's'} cognee returned belonged to another dataset and ${search.foreign === 1 ? 'was' : 'were'} left out. ` +
          'cognee keeps datasets apart only with ENABLE_BACKEND_ACCESS_CONTROL=true, its default.'
      })
    }
    const answer = recallAnswer({
      request,
      hits: resolved.hits,
      interpretation: {
        description: `cognee chunk search of ${where}${config.completion ? `, and its ${config.completion} answer` : ''}`,
        assumptions: [
          'Ranked by similarity: the closest chunks, not every match, and never a count.',
          'Scores are cognee\'s cosine distances - lower is closer - and say nothing about other adapters\' scores.',
          ...(config.completion ? ['The derived fact is cognee\'s answer, written by the model its server is configured with, from the chunks it cites.'] : [])
        ],
        nativeQuery: request.question
      },
      more: search.more,
      diagnostics,
      ...(checkpoint !== undefined ? { checkpoint } : {})
    })
    if (config.completion === undefined) return answer

    try {
      const fact = await completionFact(
        request,
        Math.max(1, Math.min(Date.parse(request.budget.deadline) - Date.now(), config.timeoutMs)),
        new Map(search.hits.map((hit) => [hit.nativeId.toLowerCase(), hit.identity]))
      )
      if (fact !== undefined) {
        const id = 'cognee-answer'
        answer.evidence.push({ id, kind: 'derived-fact', text: fact.text, canonicalRefs: fact.refs, derivation: { engine: 'cognee' } })
        answer.blocks.unshift({ kind: 'facts', id: 'answer', title: 'cognee\'s answer', evidenceIds: [id] })
        if (fact.refs.length === 0) {
          answer.diagnostics.push({
            severity: 'info',
            code: 'cognee-answer-unresolved',
            message: fact.cited === 0 ? 'cognee\'s answer cites no chunks.' : 'cognee\'s answer cites no chunk that maps to a current canonical record.'
          })
        }
      }
    } catch (error) {
      if (request.signal?.aborted) throw error
      answer.diagnostics.push({ severity: 'warning', code: 'cognee-completion-failed', message: `cognee's ${config.completion} answer failed: ${messageOf(error)}` })
    }
    return answer
  }

  return {
    describe: () => description,
    status,
    projection: { apply, reset },
    query: { ask },
    // Plain HTTP: nothing to release.
    close: async () => undefined
  }
}
