// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { ago, cost, duration, queryLabel, timeline, triggersText } from './how-it-works'

describe('how it works', () => {
  it('labels who wrote a query honestly', () => {
    expect(queryLabel({ by: 'model', model: 'anthropic/claude-haiku-5.5' })).toBe('Model-written, by anthropic/claude-haiku-5.5')
    expect(queryLabel({ by: 'template' })).toBe('Template: a fixed query, no model wrote it')
    expect(queryLabel({ by: 'template', fallback: 'The Cypher query failed' })).toBe('Template, after the model’s query did not answer')
  })

  it('reads times and costs as a person would', () => {
    expect(duration(420)).toBe('420 ms')
    expect(duration(1_500)).toBe('1.5 s')
    expect(duration(3 * 60_000)).toBe('3 min')
    expect(ago(null, 0)).toBe('never')
    expect(ago(new Date(1_000).toISOString(), 3_000)).toBe('just now')
    expect(ago(new Date(0).toISOString(), 120_000)).toBe('2 min ago')
    expect(cost(0)).toBe('$0')
    expect(cost(0.0042)).toBe('$0.0042')
    expect(cost(0.5)).toBe('$0.50')
  })

  it('says what woke a pass', () => {
    expect(triggersText([])).toBe('what woke it could not be read')
    expect(triggersText(['documents', 'recheck'])).toBe('documents changed, re-check requested')
  })

  it('merges passes and document changes newest first', () => {
    const merged = timeline([{ at: '2026-11-05T10:00:02Z', id: 'p' }], [{ at: '2026-11-05T10:00:01Z', id: 'd' }, { at: '2026-11-05T10:00:03Z', id: 'e' }])
    expect(merged.map((entry) => [entry.kind, entry.at])).toEqual([
      ['documents', '2026-11-05T10:00:03Z'],
      ['sync', '2026-11-05T10:00:02Z'],
      ['documents', '2026-11-05T10:00:01Z'],
    ])
  })
})
