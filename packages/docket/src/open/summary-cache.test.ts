import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { readCachedSummary, summaryKey, writeCachedSummary, type CachedSummary, type SummaryInputs } from './summary-cache.js'

const MODEL = { model: 'qwen2.5:7b', instructions: 'Cite exhibits.' }
const ORDERS = { id: 'service.orders', hash: 'sha256:1' }
const PAYMENTS = { id: 'team.payments', hash: 'sha256:2' }
const PATH = { nodes: ['service.orders', 'team.payments'], steps: [{ rel: 'owned_by', forward: true }] }

describe('summaryKey', () => {
  const CONTEXT = { scope: 'default', timezone: 'UTC', day: '2026-10-09' }
  const ADAPTERS = [{ id: 'local', fingerprint: 'sha256:f', checkpoint: 'records:1', answer: 'sha256:a' }]
  const SOURCES = [{ kind: 'document', id: 'a.md', revision: 'sha256:d' }]
  const inputs = (overrides: Partial<SummaryInputs> = {}): SummaryInputs => ({
    context: CONTEXT,
    adapters: ADAPTERS,
    exhibits: [ORDERS, PAYMENTS],
    sources: SOURCES,
    paths: [PATH],
    ...overrides
  })
  const key = summaryKey('What does checkout use?', MODEL, inputs())

  it('ignores case, spacing and the order exhibits were found in', () => {
    expect(summaryKey('  what does   CHECKOUT use? ', MODEL, inputs({ exhibits: [PAYMENTS, ORDERS] }))).toBe(key)
  })

  it('changes with the question, its context, an adapter, an exhibit, a source revision, the model, its instructions or the paths', () => {
    const others = [
      summaryKey('What does billing use?', MODEL, inputs()),
      summaryKey('What does checkout use?', MODEL, inputs({ context: { ...CONTEXT, day: '2026-10-10' } })),
      summaryKey('What does checkout use?', MODEL, inputs({ adapters: [{ ...ADAPTERS[0], checkpoint: 'records:2' }] })),
      summaryKey('What does checkout use?', MODEL, inputs({ adapters: [{ ...ADAPTERS[0], fingerprint: 'sha256:g' }] })),
      summaryKey('What does checkout use?', MODEL, inputs({ adapters: [{ ...ADAPTERS[0], answer: 'sha256:b' }] })),
      summaryKey('What does checkout use?', MODEL, inputs({ exhibits: [ORDERS, { ...PAYMENTS, hash: 'sha256:3' }] })),
      summaryKey('What does checkout use?', MODEL, inputs({ exhibits: [ORDERS] })),
      summaryKey('What does checkout use?', MODEL, inputs({ sources: [{ ...SOURCES[0], revision: 'sha256:e' }] })),
      summaryKey('What does checkout use?', { ...MODEL, model: 'llama3' }, inputs()),
      summaryKey('What does checkout use?', { ...MODEL, instructions: 'Be terse.' }, inputs()),
      summaryKey('What does checkout use?', MODEL, inputs({ paths: [] })),
      summaryKey('What does checkout use?', MODEL, inputs({
        paths: [{ nodes: ['service.orders', 'datasource.ledger', 'team.payments'], steps: [{ rel: 'depends_on', forward: true }, { rel: 'owned_by', forward: false }] }]
      }))
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
