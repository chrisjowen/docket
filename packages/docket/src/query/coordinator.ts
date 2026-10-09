import {
  ContractError,
  validateAdapterAnswer,
  type AdapterAnswer,
  type AskRequest,
  type MemoryAdapter
} from '@docket/contracts'

/** What the coordinator asks: an adapter instance it can create, answer through and close. */
export interface QuerySlot {
  readonly id: string
  create(): Promise<MemoryAdapter>
}

/** One adapter's answer as it came - validated, not yet checked against the files - or why there is none. */
export type AdapterOutcome =
  | { adapter: string; state: 'answered'; answer: AdapterAnswer; durationMs: number }
  | {
      adapter: string
      state: 'failed'
      error: { code: string; message: string; retryable?: boolean }
      issues?: string[]
      durationMs: number
    }

export interface AskAdaptersOptions {
  slots: readonly QuerySlot[]
  /** The question every adapter is asked; `budget.deadline` is the shared deadline. */
  request: Omit<AskRequest, 'signal'>
  /** Adapters answering at once. The rest wait their turn, within the same deadline. */
  maxConcurrent: number
  /** Cancels the whole question: adapters still answering are abandoned and closed. */
  signal?: AbortSignal | undefined
}

/** The shared deadline passed. */
class DeadlineExceeded extends Error {
  constructor(readonly seconds: number) {
    super(`deadline of ${seconds}s exceeded`)
  }
}

/** An adapter enabled for query whose module has no query port. */
class NoQueryPort extends Error {}

type Settled<T> = { state: 'value'; value: T } | { state: 'error'; error: unknown } | { state: 'stopped'; reason: unknown }

/** Whichever comes first: the work settling, or the signal stopping it. A late settlement is ignored. */
const settleOrStop = <T>(work: Promise<T>, signal: AbortSignal): Promise<Settled<T>> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ state: 'stopped', reason: signal.reason })
      return
    }
    const onAbort = (): void => resolve({ state: 'stopped', reason: signal.reason })
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve({ state: 'value', value })
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        resolve({ state: 'error', error })
      }
    )
  })

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/**
 * Asks every slot the same question (docs/adapter-spec.md §10 steps 1-3):
 * at most `maxConcurrent` at once, all within one shared deadline, each with
 * the question's `AbortSignal`. Every answer is validated at runtime against
 * the contract and the question's scope.
 *
 * One adapter failing - unavailable, throwing, breaking the contract or
 * missing the deadline - is its own structured failure and never erases
 * another's answer. When the deadline passes or the question is cancelled,
 * adapters still answering are closed and their late answers ignored, and
 * adapters not yet started are not asked. Results come back in slot order.
 */
export const askAdapters = async (options: AskAdaptersOptions): Promise<AdapterOutcome[]> => {
  const { slots, request } = options
  const controller = new AbortController()
  const forward = (): void => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) forward()
  else options.signal?.addEventListener('abort', forward, { once: true })

  const deadline = Date.parse(request.budget.deadline)
  const seconds = Math.max(0, Math.round((deadline - Date.now()) / 100) / 10)
  const timer = setTimeout(() => controller.abort(new DeadlineExceeded(seconds)), Math.max(0, deadline - Date.now()))

  const stopped = (adapter: string, reason: unknown, started: boolean, durationMs: number): AdapterOutcome =>
    reason instanceof DeadlineExceeded
      ? {
          adapter,
          state: 'failed',
          error: {
            code: 'timeout',
            message: started
              ? `No answer within the ${reason.seconds}s deadline; a late answer is ignored.`
              : `Not asked: the ${reason.seconds}s deadline passed while other adapters were answering.`,
            retryable: true
          },
          durationMs
        }
      : { adapter, state: 'failed', error: { code: 'cancelled', message: 'The question was cancelled.' }, durationMs }

  const askOne = async (slot: QuerySlot): Promise<AdapterOutcome> => {
    const started = Date.now()
    const elapsed = (): number => Date.now() - started
    if (controller.signal.aborted) return stopped(slot.id, controller.signal.reason, false, 0)

    let adapter: MemoryAdapter | undefined
    let abandoned = false
    let phase: 'create' | 'ask' = 'create'
    const release = (): void => {
      const open = adapter
      adapter = undefined
      void open?.close().catch(() => undefined)
    }

    const work = (async () => {
      const created = await slot.create()
      if (abandoned) {
        void created.close().catch(() => undefined)
        throw new Error('abandoned')
      }
      adapter = created
      if (!created.query) throw new NoQueryPort()
      phase = 'ask'
      return created.query.ask({ ...request, signal: controller.signal })
    })()

    const settled = await settleOrStop(work, controller.signal)
    if (settled.state === 'stopped') {
      // Closing is how an adapter that cannot cancel its own work is made to stop.
      abandoned = true
      release()
      work.catch(() => undefined)
      return stopped(slot.id, settled.reason, true, elapsed())
    }
    release()

    if (settled.state === 'error') {
      const { error } = settled
      if (error instanceof NoQueryPort) {
        return {
          adapter: slot.id,
          state: 'failed',
          error: { code: 'unsupported', message: `${slot.id} does not answer questions: its module has no query port.` },
          durationMs: elapsed()
        }
      }
      if (error instanceof ContractError) {
        return {
          adapter: slot.id,
          state: 'failed',
          error: { code: 'invalid-answer', message: `${slot.id} returned an answer that breaks the adapter contract.` },
          issues: [...error.issues],
          durationMs: elapsed()
        }
      }
      return {
        adapter: slot.id,
        state: 'failed',
        error: phase === 'create' ? { code: 'unavailable', message: messageOf(error), retryable: true } : { code: 'error', message: messageOf(error) },
        durationMs: elapsed()
      }
    }

    try {
      return { adapter: slot.id, state: 'answered', answer: validateAdapterAnswer(settled.value, request), durationMs: elapsed() }
    } catch (cause) {
      if (!(cause instanceof ContractError)) throw cause
      return {
        adapter: slot.id,
        state: 'failed',
        error: { code: 'invalid-answer', message: `${slot.id} returned an answer that breaks the adapter contract.` },
        issues: [...cause.issues],
        durationMs: elapsed()
      }
    }
  }

  const outcomes: AdapterOutcome[] = new Array(slots.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < slots.length) {
      const index = next
      next += 1
      outcomes[index] = await askOne(slots[index] as QuerySlot)
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(Math.max(1, options.maxConcurrent), slots.length) }, worker))
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', forward)
  }
  return outcomes
}
