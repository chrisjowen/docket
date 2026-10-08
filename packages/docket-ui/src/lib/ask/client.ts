import { ContractError, validateAdapterDescription, validateAdapterStatus, type ConversationTurn } from '@docket/contracts'

import type { UiAnswer, UiChatAnswer } from '$lib/types.js'
import { fromLegacyAnswer, fromLegacyChat, LEGACY_LIMIT } from './legacy.js'
import { showOutcome, type AskOutcome } from './outcome.js'
import type { AdapterInstance, AdaptersResponse, AskBody } from './wire.js'

/*
 * The typed client for the coordinator's API. `POST /api/ask` is tried first;
 * a server without it (404 or 405) is answered through the legacy endpoints
 * instead, and remembered, so later questions go straight there.
 */

export interface AskOptions {
  question: string
  /** Adapter instance ids; omitted, the configured defaults. */
  adapters?: string[]
  synthesis: boolean
  conversation?: ConversationTurn[]
  signal?: AbortSignal
  requestId?: string
}

/** What `GET /api/adapters` gave: instances, a server that has no such API yet, or a failure. */
export type AdaptersState =
  | { state: 'ready'; response: AdaptersResponse }
  | { state: 'unavailable'; message: string }
  | { state: 'failed'; message: string }

export interface AskClient {
  ask(options: AskOptions): Promise<AskOutcome>
  adapters(signal?: AbortSignal): Promise<AdaptersState>
}

/** The server has no such route: a status that means "not built yet", not "broken". */
const missing = (status: number): boolean => status === 404 || status === 405 || status === 501

const errorOf = async (response: Response): Promise<Error> => {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string') return new Error(body.error)
  } catch {
    // Not JSON: say what the status was instead.
  }
  return new Error(`${response.status} ${response.statusText}`.trim())
}

const requestIdOf = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `ask-${Date.now()}-${Math.random()}`

/** Keeps a status or description only when it passes the contract; otherwise says why it was dropped. */
const checkInstance = (instance: AdapterInstance): AdapterInstance => {
  const checked: AdapterInstance = { id: instance.id, module: instance.module, roles: instance.roles }
  const problems: string[] = []
  const keep = <T>(value: unknown, validate: (value: unknown) => T, what: string): T | undefined => {
    if (value === undefined) return undefined
    try {
      return validate(value)
    } catch (cause) {
      problems.push(cause instanceof ContractError ? `${what}: ${cause.issues.join('; ') || cause.summary}` : `${what} is invalid`)
      return undefined
    }
  }
  const description = keep(instance.description, validateAdapterDescription, 'description')
  const status = keep(instance.status, validateAdapterStatus, 'status')
  if (description) checked.description = description
  if (status) checked.status = status
  if (instance.freshness) checked.freshness = instance.freshness
  if (typeof instance.runtime === 'string') checked.runtime = instance.runtime
  const statusError = [instance.statusError, ...problems].filter((item): item is string => typeof item === 'string')
  if (statusError.length > 0) checked.statusError = statusError.join(' ')
  return checked
}

export const readAdapters = (body: unknown): AdaptersResponse => {
  const value = body as Partial<AdaptersResponse>
  if (!value || !Array.isArray(value.adapters)) throw new Error('The server answered, but not with a list of adapters.')
  const adapters = value.adapters
    .filter((item): item is AdapterInstance => typeof item === 'object' && item !== null && typeof item.id === 'string')
    .map((item) => checkInstance({ ...item, module: String(item.module ?? ''), roles: Array.isArray(item.roles) ? item.roles : [] }))
  return {
    adapters,
    query: {
      defaultAdapters: Array.isArray(value.query?.defaultAdapters) ? value.query.defaultAdapters : adapters.map((item) => item.id),
      synthesis: value.query?.synthesis ?? true
    },
    diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics : []
  }
}

export const createAskClient = (fetcher: typeof fetch = (...args) => fetch(...args)): AskClient => {
  /** Whether the server has `POST /api/ask`; unknown until the first question. */
  let coordinator: boolean | undefined

  const legacy = async (options: AskOptions, requestId: string): Promise<AskOutcome> => {
    const path = options.synthesis ? '/api/chat' : '/api/ask'
    const query = new URLSearchParams({ q: options.question, limit: String(LEGACY_LIMIT) })
    const response = await fetcher(`${path}?${query}`, { signal: options.signal ?? null })
    if (!response.ok) throw await errorOf(response)
    const body = (await response.json()) as UiAnswer | UiChatAnswer
    return options.synthesis
      ? showOutcome(fromLegacyChat(body as UiChatAnswer, requestId), 'legacy-chat')
      : showOutcome(fromLegacyAnswer(body as UiAnswer, requestId), 'legacy-ask')
  }

  return {
    async ask(options) {
      const requestId = options.requestId ?? requestIdOf()
      if (coordinator === false) return legacy(options, requestId)
      const body: AskBody = {
        requestId,
        question: options.question,
        synthesis: options.synthesis,
        ...(options.adapters ? { adapters: options.adapters } : {}),
        ...(options.conversation ? { conversation: options.conversation } : {})
      }
      const response = await fetcher('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.signal ?? null
      })
      if (missing(response.status)) {
        coordinator = false
        return legacy(options, requestId)
      }
      coordinator = true
      if (!response.ok) throw await errorOf(response)
      return showOutcome(await response.json(), 'coordinator')
    },

    async adapters(signal) {
      let response: Response
      try {
        response = await fetcher('/api/adapters', { signal: signal ?? null })
      } catch (cause) {
        if (signal?.aborted) throw cause
        return { state: 'failed', message: cause instanceof Error ? cause.message : String(cause) }
      }
      if (missing(response.status)) {
        return { state: 'unavailable', message: 'This docket does not report adapter status yet.' }
      }
      if (!response.ok) return { state: 'failed', message: (await errorOf(response)).message }
      try {
        return { state: 'ready', response: readAdapters(await response.json()) }
      } catch (cause) {
        return { state: 'failed', message: cause instanceof Error ? cause.message : String(cause) }
      }
    }
  }
}
