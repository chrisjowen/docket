// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { sourcesOf, standingOf } from './standing'

const assessed = (confidence: number, sources: string[], evidenceCount = sources.length) => ({ confidence, basis: 'evidence' as const, evidenceCount, sources })

describe('a record’s standing', () => {
  it('is corroborated on several kinds of source, and sole source on one', () => {
    expect(standingOf({ assessment: assessed(0.9, ['code', 'human']), evidence: [], frontmatter: {} }).label).toBe('Corroborated')
    expect(standingOf({ assessment: assessed(0.9, ['code']), evidence: [], frontmatter: {} }).label).toBe('Sole source')
  })

  it('is uncorroborated under half weight or with no exhibits', () => {
    expect(standingOf({ assessment: assessed(0.4, ['code', 'human']), evidence: [], frontmatter: {} }).key).toBe('uncorroborated')
    expect(standingOf({ assessment: assessed(0.9, [], 0), evidence: [], frontmatter: {} }).key).toBe('uncorroborated')
    expect(standingOf({ evidence: [], frontmatter: {} }).key).toBe('uncorroborated')
  })

  it('is overruled once something supersedes it, whatever its weight', () => {
    expect(standingOf({ assessment: assessed(0.95, ['code', 'human']), evidence: [], frontmatter: { superseded_by: 'decision.new' } }).key).toBe('overruled')
  })

  it('is not on record when no document files it', () => {
    expect(standingOf(undefined)).toEqual({ key: 'unfiled', label: 'Not on record', tone: 'red' })
  })

  it('reads its sources from the evidence when nothing assessed it', () => {
    expect(sourcesOf({ evidence: [{ source: 'human' }, { source: 'code' }, { source: 'code' }, {}] })).toEqual(['code', 'human'])
  })
})
