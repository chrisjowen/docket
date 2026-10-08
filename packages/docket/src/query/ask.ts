import { randomUUID } from 'node:crypto'

import type { ConversationTurn, Diagnostic, InputKind } from '@docket/contracts'

import { openDocket, type AdapterSlot, type Docket, type OpenDocketOptions } from '../adapters/docket.js'
import { connectingPaths } from '../open/paths.js'
import { askAdapters } from './coordinator.js'
import { freshnessOf, freshnessWarning } from './freshness.js'
import { checkAnswer, foundReferences } from './resolve.js'
import { takeSnapshot, type RequestSnapshot } from './snapshot.js'
import { synthesize } from './synthesis.js'
import type { AdapterResult, CoordinatedAnswer } from './wire.js'

/** Results each adapter is asked for, unless the question says otherwise. */
export const DEFAULT_ASK_RESULTS = 20

/** Evidence text each adapter may return, in bytes. */
export const DEFAULT_EVIDENCE_BYTES = 256 * 1024

/** The most results one question may ask each adapter for. */
export const MAX_ASK_RESULTS = 100

export interface AskInput {
  question: string
  /** Identifies the question for cancellation and diagnostics. One is made when omitted. */
  requestId?: string | undefined
  /** Adapter instance ids to ask; omitted, `query.defaultAdapters`, or every instance with the query role. */
  adapters?: readonly string[] | undefined
  conversation?: readonly ConversationTurn[] | undefined
  /** Write a summary over the results; omitted, `query.synthesis`. */
  synthesis?: boolean | undefined
  /** IANA time zone relative times are read in; omitted, this machine's. */
  timezone?: string | undefined
  /** When the question is asked; omitted, now. */
  now?: Date | undefined
  /** Results asked of each adapter. */
  maxResults?: number | undefined
  maxEvidenceBytes?: number | undefined
  /** The shared deadline, overriding `query.timeoutMs`. */
  timeoutMs?: number | undefined
  /** Overrides `query.maxConcurrentAdapters`. */
  maxConcurrentAdapters?: number | undefined
  /** Cancels the question: adapters still answering are closed, and no summary is written. */
  signal?: AbortSignal | undefined
}

/** A question that cannot be asked as put: an unknown adapter, an empty question, a time zone that does not exist. */
export class AskRequestError extends Error {
  override name = 'AskRequestError'
}

/** The question was cancelled before its answer was complete. */
export class AskCancelledError extends Error {
  override name = 'AskCancelledError'
}

/** An answer, with what it was read against - for whatever builds on it. */
export interface AskOutcome {
  answer: CoordinatedAnswer
  snapshot: RequestSnapshot
  docket: Docket
  /** Per adapter, the ids of results left out because they name no record in scope. */
  rejected: ReadonlyMap<string, readonly string[]>
}

const zoneOf = (timezone: string | undefined): string => {
  const zone = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
  } catch {
    throw new AskRequestError(`"${zone}" is not a time zone: give an IANA name such as "Europe/London" or "UTC".`)
  }
  return zone
}

const positive = (value: number | undefined, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number => {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1) throw new AskRequestError(`${name} must be a positive whole number, got ${value}`)
  return Math.min(value, max)
}

/** The instances to ask: the ones named, checked, or the configured defaults. */
const selectAdapters = (docket: Docket, named: readonly string[] | undefined): AdapterSlot[] => {
  const queryable = docket.adapters.filter((slot) => slot.roles.includes('query'))
  if (named !== undefined) {
    return [...new Set(named)].map((id) => {
      const slot = docket.adapters.find((candidate) => candidate.id === id)
      if (!slot) {
        const known = queryable.map((candidate) => candidate.id).join(', ') || 'none'
        throw new AskRequestError(`No adapter "${id}" is configured. Adapters that answer questions: ${known}.`)
      }
      if (!slot.roles.includes('query')) throw new AskRequestError(`Adapter "${id}" is not enabled for query: add query to its roles.`)
      return slot
    })
  }
  const defaults = docket.resolved.config.query.defaultAdapters
  return defaults === undefined ? queryable : queryable.filter((slot) => defaults.includes(slot.id))
}

/**
 * Puts one question to the adapters through the shared coordinator
 * (docs/adapter-spec.md §10): establishes its scope, time and time zone,
 * selects the instances to ask, asks them with bounded concurrency inside one
 * deadline, checks every answer against the canonical files as they stood when
 * the question was asked, works out how far each instance lags them, and -
 * unless turned off - has a model summarise the results.
 *
 * Every adapter's answer is kept as it came, ids namespaced by instance; a
 * failure is that instance's alone. The canonical references across all of
 * them are listed once each, and the canonical paths joining the entities
 * they found are read from the files.
 */
export const askWith = async (snapshot: RequestSnapshot, docket: Docket, input: AskInput): Promise<AskOutcome> => {
  const question = input.question.trim()
  if (question === '') throw new AskRequestError('Ask something: the question is empty.')
  const { query, summarize } = docket.resolved.config
  const timezone = zoneOf(input.timezone)
  const slots = selectAdapters(docket, input.adapters)
  const maxResults = positive(input.maxResults, 'maxResults', DEFAULT_ASK_RESULTS, MAX_ASK_RESULTS)
  const maxEvidenceBytes = positive(input.maxEvidenceBytes, 'maxEvidenceBytes', DEFAULT_EVIDENCE_BYTES)
  const timeoutMs = positive(input.timeoutMs, 'timeoutMs', query.timeoutMs)
  const maxConcurrent = positive(input.maxConcurrentAdapters, 'maxConcurrentAdapters', query.maxConcurrentAdapters)

  const now = input.now ?? new Date()
  const deadline = new Date(now.getTime() + timeoutMs).toISOString()
  const requestId = input.requestId ?? randomUUID()
  const context = { scope: snapshot.scope, now: now.toISOString(), timezone }
  const conversation = input.conversation && input.conversation.length > 0 ? [...input.conversation] : undefined

  // Each instance describes itself as it is created, so its freshness can be judged by the inputs it takes.
  const inputs = new Map<string, readonly InputKind[]>()
  const outcomes = await askAdapters({
    slots: slots.map((slot) => ({
      id: slot.id,
      create: async () => {
        const adapter = await slot.create()
        try {
          inputs.set(slot.id, adapter.describe().inputs)
        } catch {
          // A description that breaks the contract leaves freshness unknown; the answer is judged on its own.
        }
        return adapter
      }
    })),
    request: {
      requestId,
      question,
      context: { ...context, ...(conversation ? { conversation } : {}) },
      budget: { maxResults, maxEvidenceBytes, deadline }
    },
    maxConcurrent,
    signal: input.signal
  })

  const rejected = new Map<string, readonly string[]>()
  const checked: { adapter: string; sightings: ReturnType<typeof checkAnswer>['sightings'] }[] = []
  const results: AdapterResult[] = outcomes.map((outcome) => {
    if (outcome.state === 'failed') return outcome
    const result = checkAnswer(outcome.adapter, outcome.answer, snapshot)
    checked.push({ adapter: outcome.adapter, sightings: result.sightings })
    if (result.rejected.length > 0) rejected.set(outcome.adapter, result.rejected)
    return { adapter: outcome.adapter, state: 'answered', answer: result.answer, durationMs: outcome.durationMs, references: result.references }
  })

  const reported = new Map(
    results.flatMap((result) => (result.state === 'answered' ? [[result.adapter, result.answer.coverage.checkpoint] as const] : []))
  )
  const freshness = await freshnessOf(docket, snapshot, slots, { inputs, reported })
  const diagnostics: Diagnostic[] = []
  if (slots.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'no-query-adapters',
      message: 'No adapter is enabled for query, so nothing was asked. Give an adapter the query role in .docket.yaml.'
    })
  }
  for (const result of results) {
    const fresh = freshness.get(result.adapter)
    if (result.state === 'answered' && fresh) result.freshness = fresh
    const warning = freshnessWarning(result.adapter, fresh)
    if (warning) diagnostics.push({ severity: 'warning', code: 'adapter-behind', message: warning })
  }

  const references = foundReferences(checked, snapshot)
  const found = [
    ...new Set(
      references.flatMap((reference) =>
        reference.status === 'unresolved' ? [] : reference.kind === 'entity' ? [reference.id] : reference.entity ? [reference.entity] : []
      )
    )
  ]
  const edges = snapshot.entities.flatMap((entity) => entity.links.map((link) => ({ source: entity.id, rel: link.rel, target: link.target })))
  const connections = connectingPaths(edges, found)

  const answer: CoordinatedAnswer = {
    requestId,
    question,
    context: { ...context, deadline },
    results,
    synthesis: null,
    references,
    connections,
    diagnostics
  }

  if (!(input.synthesis ?? query.synthesis)) {
    answer.notice = { reason: 'disabled', message: 'No summary was asked for: the results stand on their own.' }
  } else {
    if (input.signal?.aborted) throw new AskCancelledError('The question was cancelled.')
    const outcome = await synthesize(
      { question, context, conversation, results, references, connections, snapshot },
      {
        summarize,
        memoryRoot: snapshot.resolved.memoryRoot,
        adapters: new Map(slots.map((slot) => [slot.id, { fingerprint: slot.fingerprint, checkpoint: freshness.get(slot.id)?.checkpoint }])),
        signal: input.signal
      }
    )
    if (input.signal?.aborted) throw new AskCancelledError('The question was cancelled.')
    answer.synthesis = outcome.synthesis
    if (outcome.notice) answer.notice = outcome.notice
  }

  return { answer, snapshot, docket, rejected }
}

/**
 * `askWith` over the project `.docket.yaml` at or above `cwd` is in: the files
 * are read once, and the adapters read through that same snapshot.
 */
export const askProject = async (cwd: string, input: AskInput, options: OpenDocketOptions = {}): Promise<AskOutcome> => {
  const snapshot = await takeSnapshot(cwd)
  const docket = await openDocket(snapshot.resolved, { ...options, canonical: options.canonical ?? snapshot.reader })
  return askWith(snapshot, docket, input)
}
