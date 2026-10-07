import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { readCachedSummary, summaryKey, writeCachedSummary, type CachedSummary } from './summary-cache.js'

const MODEL = { model: 'qwen2.5:7b', instructions: 'Cite exhibits.' }
const ORDERS = { id: 'service.orders', hash: 'sha256:1' }
const PAYMENTS = { id: 'team.payments', hash: 'sha256:2' }

describe('summaryKey', () => {
  const key = summaryKey('What does checkout use?', MODEL, [ORDERS, PAYMENTS])

  it('ignores case, spacing and the order exhibits were found in', () => {
    expect(summaryKey('  what does   CHECKOUT use? ', MODEL, [PAYMENTS, ORDERS])).toBe(key)
  })

  it('changes with the question, an exhibit, the set of exhibits, the model or its instructions', () => {
    const others = [
      summaryKey('What does billing use?', MODEL, [ORDERS, PAYMENTS]),
      summaryKey('What does checkout use?', MODEL, [ORDERS, { ...PAYMENTS, hash: 'sha256:3' }]),
      summaryKey('What does checkout use?', MODEL, [ORDERS]),
      summaryKey('What does checkout use?', { ...MODEL, model: 'llama3' }, [ORDERS, PAYMENTS]),
      summaryKey('What does checkout use?', { ...MODEL, instructions: 'Be terse.' }, [ORDERS, PAYMENTS])
    ]
    expect(new Set([key, ...others]).size).toBe(others.length + 1)
  })
})

describe('the summary cache', () => {
  const entry = (key: string): CachedSummary => ({
    key,
    question: 'What does checkout use?',
    model: 'qwen2.5:7b',
    exhibits: [ORDERS],
    text: 'It uses [service.orders].',
    cited: ['service.orders'],
    createdAt: '2026-10-07T00:00:00.000Z'
  })

  it('returns an entry only for the key it was written under, and treats a damaged one as a miss', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'docket-cache-'))
    try {
      expect(await readCachedSummary(dir, 'What does checkout use?', 'sha256:a')).toBeNull()

      await writeCachedSummary(dir, entry('sha256:a'))
      expect(await readCachedSummary(dir, 'what does checkout use?', 'sha256:a')).toEqual(entry('sha256:a'))
      expect(await readCachedSummary(dir, 'What does checkout use?', 'sha256:b')).toBeNull()

      await writeCachedSummary(dir, entry('sha256:b'))
      expect(await readCachedSummary(dir, 'What does checkout use?', 'sha256:a')).toBeNull()

      const files = await readdir(dir)
      expect(files).toHaveLength(1)
      await writeFile(join(dir, files[0] as string), '{ not json')
      expect(await readCachedSummary(dir, 'What does checkout use?', 'sha256:b')).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
