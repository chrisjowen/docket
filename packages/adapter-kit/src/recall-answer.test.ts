import { validateAdapterAnswer } from '@docket/contracts'
import { sampleAskRequest } from '@docket/contracts/testing'
import { describe, expect, it } from 'vitest'

import { recallAnswer, type RecallHit } from './recall-answer.js'

const hit = (id: string, overrides: Partial<RecallHit> = {}): RecallHit => ({
  nativeId: `frame-${id}`,
  text: `passage about ${id}`,
  ref: { kind: 'entity', id, revision: `rev-${id}` },
  score: 1,
  ...overrides
})

const interpretation = { description: 'lexical search', assumptions: [] }

describe('recallAnswer', () => {
  it('shows every passage as evidence, and the projected entities among them', () => {
    const request = sampleAskRequest()
    const answer = recallAnswer({
      request,
      interpretation,
      hits: [
        hit('service.orders', { score: 3 }),
        hit('obs.1', { ref: { kind: 'observation', id: 'obs.1', revision: 'r1' }, eventAt: '2026-10-01T00:00:00Z' }),
        hit('service.orders', { nativeId: 'frame-chunk-2', score: 2 })
      ]
    })
    expect(validateAdapterAnswer(answer, request)).toEqual(answer)
    expect(answer.evidence.map((item) => [item.id, item.kind, item.nativeId])).toEqual([
      ['passage-1', 'passage', 'frame-service.orders'],
      ['passage-2', 'observation', 'frame-obs.1'],
      ['passage-3', 'passage', 'frame-chunk-2']
    ])
    expect(answer.evidence[1]?.eventAt).toBe('2026-10-01T00:00:00Z')
    expect(answer.blocks).toEqual([
      { kind: 'passages', id: 'passages', evidenceIds: ['passage-1', 'passage-2', 'passage-3'] },
      {
        kind: 'entities',
        id: 'entities',
        evidenceIds: ['passage-1', 'passage-3'],
        entities: [{ ref: { kind: 'entity', id: 'service.orders', revision: 'rev-service.orders' }, score: 3 }]
      }
    ])
    expect(answer.coverage).toEqual({ mode: 'top-k', truncated: false, scope: request.context.scope })
  })

  it('answers with no blocks when nothing matched - never an invented one', () => {
    const request = sampleAskRequest()
    const answer = recallAnswer({ request, interpretation, hits: [] })
    expect(validateAdapterAnswer(answer, request).blocks).toEqual([])
    expect(answer.coverage.truncated).toBe(false)
  })

  it('stops at the result and evidence budgets, and says it was truncated', () => {
    const base = sampleAskRequest()
    const byCount = recallAnswer({
      request: { ...base, budget: { ...base.budget, maxResults: 2 } },
      interpretation,
      hits: [hit('a'), hit('b'), hit('c')]
    })
    expect(byCount.evidence).toHaveLength(2)
    expect(byCount.coverage.truncated).toBe(true)

    const byBytes = recallAnswer({
      request: { ...base, budget: { ...base.budget, maxEvidenceBytes: 20 } },
      interpretation,
      hits: [hit('a'), hit('b')],
      more: false
    })
    expect(byBytes.evidence.map((item) => item.text)).toEqual(['passage about a'])
    expect(byBytes.coverage.truncated).toBe(true)
  })

  it('assumes a full page means the engine holds more, unless told otherwise', () => {
    const base = sampleAskRequest()
    const request = { ...base, budget: { ...base.budget, maxResults: 1 } }
    expect(recallAnswer({ request, interpretation, hits: [hit('a')] }).coverage.truncated).toBe(true)
    expect(recallAnswer({ request, interpretation, hits: [hit('a')], more: false }).coverage.truncated).toBe(false)
  })
})
