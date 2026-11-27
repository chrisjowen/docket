// SPDX-License-Identifier: AGPL-3.0-only
import type { CloudGraph } from '@docket/platform-canonical-store'
import { describe, expect, it } from 'vitest'

import { contradictionCandidates, contradictionPrompt, heldUntil, readJudgement, statesRename, statesReplacement } from './contradict.js'

type Entity = CloudGraph['entities'][number]

const entity = (id: string, title: string, content: string, observedAt: string, overrides: Partial<Entity> = {}): Entity =>
  ({
    id,
    type: id.split('.')[0] ?? '',
    title,
    path: `.docket/resources/${id}.md`,
    paths: [`.docket/resources/${id}.md`],
    tags: [],
    attributes: {},
    links: [],
    mentions: [],
    content,
    evidence: [{ source: 'conversation', observedAt }],
    frontmatter: {},
    ...overrides,
  }) as Entity

const sophia = entity('agent.sophia', 'Sophia', "Sophia is Chris's Muse bot.", '2026-09-01')
const captin = entity('agent.captin', 'Captin', "Captin is Chris's Muse bot. It was renamed from Sophia in November.", '2026-11-01')

describe('a record that says outright it replaces another', () => {
  it.each([
    'It was renamed from Sophia.',
    'Formerly known as Sophia, the bot now answers as Captin.',
    'Captin replaces the old Sophia.',
    'The bot was called "Sophia" until November.',
    'Previously agent.sophia.',
    'It was once called Sophia.',
  ])('reads %j as replacing Sophia', (said) => {
    expect(statesReplacement({ content: said, attributes: {} }, sophia)).toBe(said)
  })

  it.each([
    'Captin works alongside Sophia.',
    "Sophia's auth proposal was replaced last week.",
    'It was renamed from Sophiana.',
    'Captin replaces nothing.',
    'Captin launches once Sophia signs off.',
    "Captin replaced Sophia's laptop.",
  ])('does not read %j as replacing Sophia', (said) => {
    expect(statesReplacement({ content: said, attributes: {} }, sophia)).toBeNull()
  })

  it('reads text attributes as well as notes', () => {
    expect(statesReplacement({ content: '', attributes: { aka: 'formerly Sophia' } }, sophia)).toBe('formerly Sophia')
  })

  it.each(['It was renamed from Sophia.', 'Formerly known as Sophia, the bot now answers as Captin.', 'It was once called Sophia.'])('reads %j as Sophia renamed', (said) => {
    expect(statesRename({ content: said, attributes: {} }, sophia)).toBe(said)
  })

  it.each(['Captin replaces the old Sophia.', 'Captin took over from Sophia as the Muse bot.', 'Captin succeeds Sophia.', 'Captin answers in place of Sophia.'])(
    'does not read %j as Sophia renamed',
    (said) => {
      expect(statesRename({ content: said, attributes: {} }, sophia)).toBeNull()
    },
  )
})

describe('the pairs consolidation checks', () => {
  const all = () => true
  const none = () => []

  it('pairs Captin, which names Sophia as its former name, with Sophia, as a rename, older first', () => {
    const [pair, ...rest] = contradictionCandidates([sophia, captin], none, all)
    expect(rest).toEqual([])
    expect(pair).toEqual(expect.objectContaining({ older: sophia, newer: captin, ground: 'renamed', statement: 'It was renamed from Sophia in November.' }))
  })

  it('pairs a record that only says it took over from or replaced another as a replacement, not a rename', () => {
    const bob = entity('person.bob', 'Bob', 'Bob is an engineer.', '2026-09-01')
    const alice = entity('person.alice', 'Alice', 'Alice took over from Bob as on-call lead.', '2026-10-01')
    expect(contradictionCandidates([bob, alice], none, all)).toEqual([
      expect.objectContaining({ older: bob, newer: alice, ground: 'replaced', statement: 'Alice took over from Bob as on-call lead.' }),
    ])
    const legacy = entity('service.legacy-checkout', 'Legacy Checkout', 'The old checkout.', '2026-09-01')
    const billing = entity('service.billing', 'Billing', 'Last year Orders replaced Legacy Checkout.', '2026-10-01')
    expect(contradictionCandidates([legacy, billing], none, all)).toEqual([expect.objectContaining({ older: legacy, newer: billing, ground: 'replaced' })])
  })

  it('never pairs records of different types, ones the caller leaves out, or two that each claim to replace the other', () => {
    const person = entity('person.sophia', 'Sophia', 'Sophia is a person.', '2026-09-01')
    expect(contradictionCandidates([person, captin], none, all)).toEqual([])
    expect(contradictionCandidates([sophia, captin], none, (record) => record.id !== 'agent.sophia')).toEqual([])
    const claims = entity('agent.sophia', 'Sophia', 'Sophia replaces Captin.', '2026-09-01')
    expect(contradictionCandidates([claims, captin], none, all)).toEqual([])
  })

  it('pairs records the embedder finds alike, the one first seen later as the newer, and only when both are dated differently', () => {
    const old = entity('agent.helper', 'Helper', 'The Muse bot.', '2026-08-01')
    const alike = (record: Entity) => (record.id === old.id ? [sophia] : [])
    expect(contradictionCandidates([old, sophia], alike, all)).toEqual([expect.objectContaining({ older: old, newer: sophia, ground: 'similar' })])
    const undated = { ...old, evidence: [] }
    expect(contradictionCandidates([undated, sophia], (record) => (record.id === old.id ? [sophia] : []), all)).toEqual([])
  })
})

describe('the AI judgement', () => {
  it('shows both records with when each was first recorded', () => {
    const prompt = contradictionPrompt({ older: sophia, newer: captin, ground: 'renamed' })
    const text = prompt.map((message) => message.content).join('\n')
    expect(text).toContain('OLDER: agent.sophia (agent) "Sophia", first recorded 2026-09-01')
    expect(text).toContain('NEWER: agent.captin (agent) "Captin", first recorded 2026-11-01')
  })

  it('takes only a clear verdict with a reason; anything else is unsure', () => {
    expect(readJudgement('Sure: {"verdict": "supersedes", "reason": "Renamed from Sophia to Captin."}')).toEqual({ verdict: 'supersedes', reason: 'Renamed from Sophia to Captin.' })
    expect(readJudgement('{"verdict": "supersedes"}')).toEqual({ verdict: 'unsure', reason: '' })
    expect(readJudgement('{"verdict": "distinct", "reason": "Two bots."}')).toEqual({ verdict: 'distinct', reason: 'Two bots.' })
    expect(readJudgement('{"verdict": "maybe"}').verdict).toBe('unsure')
    expect(readJudgement('no json here').verdict).toBe('unsure')
  })

  it('holds the older record until the newer was first seen', () => {
    const now = new Date('2026-11-13T00:00:00Z')
    expect(heldUntil({ older: sophia, newer: captin }, now).toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(heldUntil({ older: captin, newer: sophia }, now)).toBe(now)
  })
})
