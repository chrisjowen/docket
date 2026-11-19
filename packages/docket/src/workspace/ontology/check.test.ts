import { describe, expect, it } from 'vitest'

import { makeDocument } from '../../../test/entities.js'
import type { MemoryDocument, Ontology } from '../../model/index.js'
import type { PeopleDirectory } from '../../people/directory.js'
import { classify, compare, needsAcceptance, rescore } from './check.js'
import { diffOntologies } from './diff.js'

const ontology = (score: number, extra: Partial<Ontology> = {}): Ontology => ({
  version: 1,
  resourceTypes: { service: {}, team: {} },
  relationships: { owned_by: { from: ['service'], to: ['team'] } },
  sources: { codebase: { locator: { path: { required: true } } }, person: {} },
  trust: {
    policies: [
      { name: 'Code', when: { source: 'codebase' }, score },
      { name: 'A person', when: { source: 'person' }, score: 0.9 }
    ]
  },
  ...extra
})

const documents: MemoryDocument[] = [
  makeDocument({
    id: 'service.orders',
    evidence: [{ source: 'codebase', path: 'orders/main.go' }],
    links: [{ rel: 'owned_by', target: 'team.payments', evidence: [{ source: 'codebase', path: 'CODEOWNERS' }] }]
  }),
  makeDocument({ id: 'team.payments', evidence: [{ source: 'person' }] })
]

describe('the change check', () => {
  it('classifies a change that only moves confidence as a rescore, listing what moves and across which band', () => {
    const before = { documents, ontology: ontology(0.6) }
    const after = { documents, ontology: ontology(0.85) }
    const result = compare(before, after, new Map())
    expect(result.classification).toBe('rescore')
    expect(result.introduced).toEqual([])
    expect(result.rescored).toEqual([
      { resourceId: 'service.orders', before: 0.6, after: 0.85, bandBefore: 'probable', bandAfter: 'established' },
      {
        resourceId: 'service.orders',
        link: { rel: 'owned_by', target: 'team.payments' },
        before: 0.6,
        after: 0.85,
        bandBefore: 'probable',
        bandAfter: 'established'
      }
    ])
    expect(needsAcceptance(result.classification)).toBe(false)
  })

  it('stays safe when nothing scores differently, however the policies are written', () => {
    const renamed = ontology(0.6)
    renamed.trust?.policies?.reverse()
    expect(compare({ documents, ontology: ontology(0.6) }, { documents, ontology: renamed }, new Map())).toMatchObject({
      classification: 'safe',
      rescored: []
    })
  })

  it('ranks narrowing and breaking above a rescore, which only a clean change gets', () => {
    const rescored = rescore({ documents, ontology: ontology(0.6) }, { documents, ontology: ontology(0.7) })
    expect(classify([], rescored)).toBe('rescore')
    expect(classify([{ severity: 'error', code: 'relationship-to-violation', message: '' }], rescored)).toBe('narrowing')
    expect(classify([{ severity: 'error', code: 'unknown-type', message: '' }], rescored)).toBe('breaking')
    expect(needsAcceptance('narrowing')).toBe(true)
    expect(needsAcceptance('breaking')).toBe(true)
  })

  it('has nothing to rescore without a published head', () => {
    expect(rescore({ documents, ontology: null }, { documents, ontology: ontology(0.7) })).toEqual([])
  })

  it('scores a person source by the people directory, so a role-keyed policy change rescores it instead of staying safe', () => {
    const base: Ontology = {
      version: 1,
      resourceTypes: { team: {} },
      relationships: {},
      sources: { person: { kind: 'identity', attributes: { role: { type: 'string', setBy: 'directory' } } } },
      trust: { policies: [{ name: 'A person said so', when: { source: 'person' }, score: 0.5 }] }
    }
    const withLeadPolicy: Ontology = {
      ...base,
      trust: { policies: [...base.trust!.policies!, { name: 'A lead said so', when: { source: 'person', role: 'lead' }, score: 0.9 }] }
    }
    const docs: MemoryDocument[] = [makeDocument({ id: 'team.payments', evidence: [{ source: 'person', sourceRef: 'dana' }] })]
    const people: PeopleDirectory = { people: { dana: { attributes: { role: 'lead' } } } }

    expect(compare({ documents: docs, ontology: base }, { documents: docs, ontology: withLeadPolicy }, new Map())).toMatchObject({
      classification: 'safe',
      rescored: []
    })

    const withPeople = compare({ documents: docs, ontology: base }, { documents: docs, ontology: withLeadPolicy }, new Map(), people)
    expect(withPeople.classification).toBe('rescore')
    expect(withPeople.rescored).toEqual([{ resourceId: 'team.payments', before: 0.5, after: 0.9, bandBefore: 'probable', bandAfter: 'established' }])
  })

  it('diffs sources, thresholds and policies', () => {
    const after = ontology(0.7, {
      sources: { codebase: { locator: { path: { required: true }, lines: {} } }, github: {} },
      trust: {
        cap: 0.95,
        policies: [
          { name: 'Code', when: { source: 'codebase' }, score: 0.7 },
          { name: 'Protected', when: { source: 'github' }, adjust: 0.05 }
        ]
      }
    })
    expect(diffOntologies(ontology(0.6), after)).toEqual([
      { op: '+', text: 'source `github`' },
      { op: '-', text: 'source `person`' },
      { op: '~', text: 'source `codebase`: locator += `lines`' },
      { op: '~', text: 'trust: cap default → 0.95' },
      { op: '~', text: 'policy `Code`: score 0.6 → 0.7' },
      { op: '+', text: 'policy `Protected`' },
      { op: '-', text: 'policy `A person`' }
    ])
  })
})
