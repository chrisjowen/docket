import { describe, expect, it, vi } from 'vitest'

import { createDebouncer } from './debounce.js'

const settle = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms))

describe('createDebouncer', () => {
  it('collapses a burst on one key into a single run', async () => {
    const run = vi.fn()
    const debouncer = createDebouncer(20, run)

    for (let i = 0; i < 5; i += 1) debouncer.schedule('a')
    await settle(60)

    expect(run.mock.calls).toEqual([['a']])
  })

  it('keeps separate keys independent', async () => {
    const run = vi.fn()
    const debouncer = createDebouncer(20, run)

    debouncer.schedule('a')
    debouncer.schedule('b')
    await settle(60)

    expect(run.mock.calls.flat().sort()).toEqual(['a', 'b'])
  })

  it('runs again once a key has gone quiet', async () => {
    const run = vi.fn()
    const debouncer = createDebouncer(20, run)

    debouncer.schedule('a')
    await settle(60)
    debouncer.schedule('a')
    await settle(60)

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('cancel drops pending timers', async () => {
    const run = vi.fn()
    const debouncer = createDebouncer(20, run)

    debouncer.schedule('a')
    debouncer.cancel()
    await settle(60)

    expect(run).not.toHaveBeenCalled()
  })
})
