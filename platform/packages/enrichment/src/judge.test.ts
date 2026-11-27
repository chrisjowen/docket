// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import type { Candidate } from './detect.js'
import { EnrichmentLimitReached, REVIEW_BATCH, parseVerdicts, review, reviewPrompt } from './judge.js'
import { nextRun } from './settings.js'

const candidate = (from: string, target: string, rels: string[]): Candidate => ({
  kind: 'link',
  from,
  target,
  rels,
  certain: false,
  reasoning: `${from} names ${target}.`,
  cited: [{ id: from, path: `${from}.md`, what: 'its description' }],
})

describe('parseVerdicts', () => {
  const batch = [candidate('team.a', 'api.x', ['uses', 'consumes']), candidate('team.b', 'api.y', ['uses'])]

  it('takes an allowed relationship with its reasoning, or a rejection', () => {
    const text = 'Here you go: {"verdicts":[{"n":1,"rel":"consumes","reasoning":"The team calls it."},{"n":2,"rel":null,"reasoning":"Only a mention."}]}'
    expect(parseVerdicts(text, batch)).toEqual([
      { rel: 'consumes', reasoning: 'The team calls it.' },
      { rel: null, reasoning: 'Only a mention.' },
    ])
  })

  it('gives no verdict for a relationship the candidate does not allow, a missing reason, or text that is not JSON', () => {
    expect(parseVerdicts('{"verdicts":[{"n":1,"rel":"owned_by","reasoning":"x"},{"n":2,"rel":"uses"}]}', batch)).toEqual([null, null])
    expect(parseVerdicts('no idea', batch)).toEqual([null, null])
    expect(parseVerdicts('{"verdicts":[{"n":7,"rel":"uses","reasoning":"x"}]}', batch)).toEqual([null, null])
  })
})

describe('review', () => {
  it('asks in batches and stops when the limit refuses the next call', async () => {
    const candidates = Array.from({ length: REVIEW_BATCH + 3 }, (_, i) => candidate(`team.t${i}`, `api.a${i}`, ['uses']))
    let calls = 0
    const prompts: string[] = []
    const seen: number[] = []
    const reviewer = {
      async beforeCall() {
        if (calls >= 1) throw new EnrichmentLimitReached(2, 2)
      },
      model: {
        async chat(messages: { role: string; content: string }[]) {
          calls += 1
          prompts.push(messages[1]?.content ?? '')
          return '{"verdicts":[{"n":1,"rel":"uses","reasoning":"Plainly so."}]}'
        },
      },
    }
    await expect(review(reviewer, candidates, new Map(), async (batch) => void seen.push(batch.length))).rejects.toThrow(EnrichmentLimitReached)
    expect(seen).toEqual([REVIEW_BATCH])
    expect(prompts[0]).toContain('1. from team.t0')
    expect(prompts[0]).toContain('allowed: uses')
  })

  it('asks for no more than the room left, and stops once there is none', async () => {
    const candidates = Array.from({ length: REVIEW_BATCH * 2 }, (_, i) => candidate(`team.t${i}`, `api.a${i}`, ['uses']))
    let room = REVIEW_BATCH + 5
    const seen: number[] = []
    const reviewer = { beforeCall: async () => undefined, model: { chat: async () => '{}' } }
    const { calls } = await review(reviewer, candidates, new Map(), async (batch) => {
      seen.push(batch.length)
      room -= batch.length
    }, () => room)
    expect(seen).toEqual([REVIEW_BATCH, 5])
    expect(calls).toBe(2)
  })

  it('shows each resource with its type, title and the start of its description', () => {
    const [, user] = reviewPrompt([candidate('team.a', 'api.x', ['uses'])], new Map([['api.x', { id: 'api.x', type: 'api', title: 'X', excerpt: 'Serves x.' }]]))
    expect(user?.content).toContain('to api.x (api) "X": Serves x.')
  })
})

describe('nextRun', () => {
  it('is the next 02:00 UTC nightly, and the next Sunday 02:00 UTC weekly', () => {
    expect(nextRun('nightly', new Date('2026-11-05T01:00:00Z')).toISOString()).toBe('2026-11-05T02:00:00.000Z')
    expect(nextRun('nightly', new Date('2026-11-05T02:00:00Z')).toISOString()).toBe('2026-11-06T02:00:00.000Z')
    expect(nextRun('weekly', new Date('2026-11-05T12:00:00Z')).toISOString()).toBe('2026-11-08T02:00:00.000Z')
    expect(nextRun('weekly', new Date('2026-11-08T01:59:00Z')).toISOString()).toBe('2026-11-08T02:00:00.000Z')
  })
})
