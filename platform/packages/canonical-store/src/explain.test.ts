// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { parseOntology, type MemoryEntity } from './docket.js'
import { explainEntity, explainProposal, summarise } from './explain.js'
import { NO_TRUST, trustModel } from './trust.js'

const ONTOLOGY = `version: 1
resourceTypes:
  service:
    description: A service.
  decision:
    description: A decision.
relationships: {}
sources:
  person:
    kind: identity
    attributes:
      role: { type: string, setBy: directory }
  document:
    kind: content
    identifiedBy: [url]
    attributes:
      status: { type: string, setBy: registry }
      topic: { type: string, setBy: reporter }
    locator:
      url: { required: true }
trust:
  accept: { default: 0.75, decision: 0.8 }
  policies:
    - name: A person said so
      when: { source: person }
      score: 0.5
    - name: A lead said so
      when: { source: person, role: lead }
      score: 0.85
    - name: A document
      when: { source: document }
      score: 0.4
    - name: Agreed at a review
      when: { source: person, about: decision }
      adjust: 0.05
`

const ontology = parseOntology(ONTOLOGY).ontology!
const model = trustModel(ontology, { ...NO_TRUST, people: { people: { alice: { attributes: { role: 'lead' } }, bob: { attributes: {} } } } })

type Evidence = MemoryEntity['evidence'][number]
// As a write stamps an agent's evidence that cites nothing: the person it acts for is the source.
const said = (principal: string, note: string): Evidence =>
  ({ source: 'person', note, principal, observedBy: `${principal} (token tok_1)`, observedAt: '2026-11-20' }) as Evidence
const doc = (url: string, claims: Record<string, string> = {}): Evidence =>
  ({ source: 'document', locator: { url }, ...(Object.keys(claims).length ? { attributes: claims } : {}) }) as Evidence
const record = (type: string, evidence: Evidence[]) => ({ type, evidence, provenance: {} }) as unknown as Pick<MemoryEntity, 'type' | 'evidence' | 'provenance'>

describe('explainEntity', () => {
  it('groups observations by source instance, strongest first, and counts each instance once', () => {
    const explained = explainEntity(model, record('service', [doc('notion://a'), said('alice', 'I own this.'), said('alice', 'It calls billing.')]))
    expect(explained.confidence).toBeCloseTo(1 - 0.15 * 0.6, 5)
    expect(explained.band).toBe('established')
    expect(explained.groups.map((group) => [group.source, group.instance, group.best])).toEqual([
      ['person', 'alice', 0.85],
      ['document', 'notion://a', 0.4],
    ])
    const [alice] = explained.groups
    // What the directory says of alice is attested; only one of her two observations counts.
    expect(alice!.attributes).toEqual([{ name: 'role', value: 'lead', how: 'attested' }])
    expect(alice!.observations.map((each) => each.counts)).toEqual([true, false])
    expect(alice!.observations[0]).toMatchObject({
      note: 'I own this.',
      self: true,
      score: 0.85,
      base: { policy: 'A lead said so', value: 0.85 },
      beaten: [{ policy: 'A person said so', value: 0.5 }],
      observedBy: 'alice (token tok_1)',
      principal: 'alice',
    })
  })

  it('shows a claim only the registry may make as ignored, and keeps the locator', () => {
    const explained = explainEntity(model, record('service', [doc('notion://b', { status: 'verified' })]))
    expect(explained.groups[0]!.attributes).toEqual([{ name: 'status', value: 'verified', how: 'ignored' }])
    expect(explained.groups[0]!.observations[0]).toMatchObject({ locator: { url: 'notion://b' }, self: false, score: 0.4 })
    expect(explained.band).toBe('unverified')
  })

  it('names the adjustments that moved a score, and the basis when there is no evidence', () => {
    const explained = explainEntity(model, record('decision', [said('bob', 'Agreed.')]))
    expect(explained.groups[0]!.observations[0]).toMatchObject({ base: { policy: 'A person said so', value: 0.5 }, adjustments: [{ policy: 'Agreed at a review', value: 0.05, adjust: true }] })
    expect(explained.confidence).toBeCloseTo(0.55, 5)
    expect(explainEntity(model, record('service', [])).basis).toBe('unevidenced')
  })

  it('merges a claim a later observation of the same source makes that the first did not', () => {
    const explained = explainEntity(model, record('service', [doc('notion://e'), doc('notion://e', { topic: 'billing' })]))
    expect(explained.groups[0]!.attributes).toEqual([{ name: 'topic', value: 'billing', how: 'claimed' }])
  })

  it('groups the evidence that names no source together, as docket counts it: once, at its strongest', () => {
    const explained = explainEntity(model, record('service', [{ note: 'From the README.' } as Evidence, { note: 'From the wiki.' } as Evidence]))
    expect(explained.groups.map((group) => [group.source, group.instance, group.observations.map((each) => each.counts)])).toEqual([['', null, [true, false]]])
    expect(explained.groups[0]!.observations[0]).toMatchObject({ note: 'From the README.', self: false })
    expect(explained.confidence).toBeCloseTo(explained.groups[0]!.best, 5)
  })
})

describe('summarise', () => {
  it('gives the hover card a line per source: its best score and the rules that priced the observation that counts', () => {
    const summary = summarise(explainEntity(model, record('decision', [said('bob', 'Agreed.'), doc('notion://c')])))
    expect(summary.band).toBe('probable')
    expect(summary.sources).toEqual([
      { source: 'person', instance: 'bob', score: 0.55, self: true, rules: [{ policy: 'A person said so', value: 0.5 }, { policy: 'Agreed at a review', value: 0.05, adjust: true }] },
      { source: 'document', instance: 'notion://c', score: 0.4, self: false, rules: [{ policy: 'A document', value: 0.4 }] },
    ])
  })
})

describe('explainProposal', () => {
  it('explains a supersede proposal’s own evidence about the record it would replace', () => {
    const explained = explainProposal(model, 'decision', [doc('notion://d')])
    expect(explained.confidence).toBeCloseTo(0.4, 5)
    expect(explained.groups.map((group) => group.instance)).toEqual(['notion://d'])
  })
})
