import type { AdapterAnswer, AskRequest, MemoryAdapter } from '@docket/contracts'
import { describe, expect, it, vi } from 'vitest'

import { askAdapters, type QuerySlot } from './coordinator.js'

const SCOPE = 'default'

const answerFor = (request: Pick<AskRequest, 'context'>, label: string): AdapterAnswer => ({
  interpretation: { description: label, assumptions: [] },
  blocks: [{ kind: 'metric', id: 'count', label: 'deployments', value: 3, evidenceIds: [] }],
  evidence: [],
  coverage: { mode: 'exhaustive', truncated: false, scope: request.context.scope },
  diagnostics: []
})

const request = (timeoutMs = 2_000): Omit<AskRequest, 'signal'> => {
  const now = new Date()
  return {
    requestId: 'r-1',
    question: 'How many deployments?',
    context: { scope: SCOPE, now: now.toISOString(), timezone: 'UTC' },
    budget: { maxResults: 10, maxEvidenceBytes: 10_000, deadline: new Date(now.getTime() + timeoutMs).toISOString() }
  }
}

interface FakeOptions {
  /** How long ask takes, in ms. */
  delay?: number
  /** Ignores the abort signal, as an adapter that cannot cancel its work would. */
  stubborn?: boolean
  answer?: (request: AskRequest) => unknown
  failCreate?: string
  failAsk?: string
  noQuery?: boolean
}

/** A fake adapter instance that records how it was driven. */
const fake = (id: string, options: FakeOptions = {}) => {
  const log = { created: 0, closed: 0, asked: 0, active: 0, signals: [] as AbortSignal[] }
  const slot: QuerySlot = {
    id,
    create: async () => {
      if (options.failCreate) throw new Error(options.failCreate)
      log.created += 1
      const adapter: MemoryAdapter = {
        describe: () => ({ name: id, version: '1', inputs: [], resultKinds: ['metric'], rebuild: 'unsupported' }),
        status: async () => ({ state: 'ready', message: 'ok' }),
        close: async () => {
          log.closed += 1
        },
        ...(options.noQuery
          ? {}
          : {
              query: {
                ask: (asked) =>
                  new Promise((resolve, reject) => {
                    log.asked += 1
                    log.active += 1
                    if (asked.signal) log.signals.push(asked.signal)
                    const finish = (): void => {
                      log.active -= 1
                      if (options.failAsk) reject(new Error(options.failAsk))
                      else resolve((options.answer ?? ((r) => answerFor(r, id)))(asked) as AdapterAnswer)
                    }
                    const timer = setTimeout(finish, options.delay ?? 0)
                    if (!options.stubborn) {
                      asked.signal?.addEventListener('abort', () => {
                        clearTimeout(timer)
                        log.active -= 1
                        reject(new DOMException('aborted', 'AbortError'))
                      })
                    }
                  })
              }
            })
      }
      return adapter
    }
  }
  return { slot, log }
}

describe('askAdapters', () => {
  it('asks every adapter and keeps each answer, in the order they were asked', async () => {
    const a = fake('a', { delay: 30 })
    const b = fake('b')
    const outcomes = await askAdapters({ slots: [a.slot, b.slot], request: request(), maxConcurrent: 4 })

    expect(outcomes.map((outcome) => [outcome.adapter, outcome.state])).toEqual([
      ['a', 'answered'],
      ['b', 'answered']
    ])
    expect(outcomes[0]).toMatchObject({ answer: { interpretation: { description: 'a' } }, durationMs: expect.any(Number) })
    expect(a.log.closed).toBe(1)
    expect(b.log.closed).toBe(1)
  })

  it('never has more adapters answering at once than it may', async () => {
    let active = 0
    let peak = 0
    const slots = Array.from({ length: 5 }, (_, index) => {
      const { slot } = fake(`a${index}`, {
        delay: 20,
        answer: (asked) => {
          return answerFor(asked, `a${index}`)
        }
      })
      return {
        id: slot.id,
        create: async () => {
          const adapter = await slot.create()
          const ask = adapter.query!.ask
          return {
            ...adapter,
            query: {
              ask: async (asked: AskRequest) => {
                active += 1
                peak = Math.max(peak, active)
                try {
                  return await ask(asked)
                } finally {
                  active -= 1
                }
              }
            }
          }
        }
      }
    })

    const outcomes = await askAdapters({ slots, request: request(), maxConcurrent: 2 })

    expect(outcomes.every((outcome) => outcome.state === 'answered')).toBe(true)
    expect(peak).toBe(2)
  })

  it('fails only the adapter that misses the shared deadline, closes it and ignores its late answer', async () => {
    const slow = fake('slow', { delay: 2_000, stubborn: true })
    const quick = fake('quick', { delay: 5 })
    const started = Date.now()

    const outcomes = await askAdapters({ slots: [slow.slot, quick.slot], request: request(150), maxConcurrent: 2 })

    expect(Date.now() - started).toBeLessThan(1_500)
    expect(outcomes[0]).toMatchObject({
      adapter: 'slow',
      state: 'failed',
      error: { code: 'timeout', retryable: true, message: expect.stringContaining('late answer is ignored') }
    })
    expect(outcomes[1]).toMatchObject({ adapter: 'quick', state: 'answered' })
    expect(slow.log.closed).toBe(1)
  })

  it('does not start adapters still waiting their turn once the deadline has passed', async () => {
    const first = fake('first', { delay: 2_000 })
    const waiting = fake('waiting')

    const outcomes = await askAdapters({ slots: [first.slot, waiting.slot], request: request(100), maxConcurrent: 1 })

    expect(outcomes[1]).toMatchObject({ state: 'failed', error: { code: 'timeout', message: expect.stringContaining('Not asked') } })
    expect(waiting.log.created).toBe(0)
  })

  it('passes cancellation to every adapter through its signal, and reports each as cancelled', async () => {
    const a = fake('a', { delay: 5_000 })
    const b = fake('b', { delay: 5_000 })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)

    const outcomes = await askAdapters({ slots: [a.slot, b.slot], request: request(), maxConcurrent: 2, signal: controller.signal })

    expect(outcomes.map((outcome) => outcome.state === 'failed' && outcome.error.code)).toEqual(['cancelled', 'cancelled'])
    expect(a.log.signals[0]?.aborted).toBe(true)
    expect(a.log.closed + b.log.closed).toBe(2)
  })

  it('asks nothing when the question is cancelled before it starts', async () => {
    const a = fake('a')
    const outcomes = await askAdapters({ slots: [a.slot], request: request(), maxConcurrent: 1, signal: AbortSignal.abort() })

    expect(outcomes).toEqual([expect.objectContaining({ state: 'failed', error: expect.objectContaining({ code: 'cancelled' }) })])
    expect(a.log.created).toBe(0)
  })

  it('keeps one failure from erasing the others: unavailable, throwing, unsupported', async () => {
    const outcomes = await askAdapters({
      slots: [
        fake('down', { failCreate: 'connect ECONNREFUSED 127.0.0.1:7687' }).slot,
        fake('broken', { failAsk: 'index corrupt' }).slot,
        fake('projection-only', { noQuery: true }).slot,
        fake('fine').slot
      ],
      request: request(),
      maxConcurrent: 2
    })

    expect(outcomes).toEqual([
      expect.objectContaining({ adapter: 'down', state: 'failed', error: { code: 'unavailable', message: 'connect ECONNREFUSED 127.0.0.1:7687', retryable: true } }),
      expect.objectContaining({ adapter: 'broken', state: 'failed', error: { code: 'error', message: 'index corrupt' } }),
      expect.objectContaining({ adapter: 'projection-only', state: 'failed', error: expect.objectContaining({ code: 'unsupported' }) }),
      expect.objectContaining({ adapter: 'fine', state: 'answered' })
    ])
  })

  it('validates every answer at runtime, failing an invalid one with its issues', async () => {
    const outcomes = await askAdapters({
      slots: [
        fake('bad-evidence', {
          answer: (asked) => ({
            ...answerFor(asked, 'x'),
            blocks: [{ kind: 'passages', id: 'p', evidenceIds: ['missing'] }]
          })
        }).slot,
        fake('other-scope', { answer: (asked) => ({ ...answerFor(asked, 'x'), coverage: { mode: 'top-k', truncated: false, scope: 'elsewhere' } }) }).slot,
        fake('not-json', { answer: (asked) => ({ ...answerFor(asked, 'x'), interpretation: { description: new Date(), assumptions: [] } }) }).slot
      ],
      request: request(),
      maxConcurrent: 3
    })

    expect(outcomes.map((outcome) => outcome.state === 'failed' && outcome.error.code)).toEqual(['invalid-answer', 'invalid-answer', 'invalid-answer'])
    expect(outcomes[0]).toMatchObject({ issues: [expect.stringContaining('no evidence has id "missing"')] })
    expect(outcomes[1]).toMatchObject({ issues: [expect.stringContaining('scope "default"')] })
  })

  it('closes an adapter that finishes starting after the deadline', async () => {
    const close = vi.fn(async () => {})
    const late: QuerySlot = {
      id: 'late',
      create: () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                describe: () => ({ name: 'late', version: '1', inputs: [], resultKinds: [], rebuild: 'unsupported' }),
                status: async () => ({ state: 'ready', message: '' }),
                close
              }),
            150
          )
        )
    }

    const outcomes = await askAdapters({ slots: [late], request: request(30), maxConcurrent: 1 })
    expect(outcomes[0]).toMatchObject({ state: 'failed', error: { code: 'timeout' } })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(close).toHaveBeenCalledTimes(1)
  })
})
