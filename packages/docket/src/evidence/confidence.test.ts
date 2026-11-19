import { describe, expect, it } from 'vitest'

import type { ConditionValue, MemoryEvidence, Ontology, TrustPolicy } from '../model/index.js'
import {
  assess,
  bandOf,
  builtinOntology,
  conditionHolds,
  confidenceModel,
  explain,
  observationConfidence,
  scoreObservation,
  type SourceRegistry
} from './confidence.js'

const seen = (...sources: string[]): MemoryEvidence[] =>
  sources.map((source, index) => ({ source, path: `file-${index}` }))

const pod = { kind: 'resource', type: 'pod' } as const
const dependsOn = { kind: 'relationship', rel: 'depends_on' } as const

describe('confidence', () => {
  const model = confidenceModel(builtinOntology())

  it('weighs a source by what it says about the type: a manifest dependency is solid, a pod in code is not', () => {
    expect(observationConfidence(model, dependsOn, 'manifest')).toBe(0.95)
    expect(observationConfidence(model, pod, 'code')).toBe(0.3)
    expect(observationConfidence(model, { kind: 'resource', type: 'secret' }, 'code')).toBe(0.3)
    expect(observationConfidence(model, { kind: 'resource', type: 'library' }, 'manifest')).toBe(0.95)
    // No rule for this source on this type: the source's own confidence.
    expect(observationConfidence(model, pod, 'docs')).toBe(0.6)
    expect(observationConfidence(model, { kind: 'resource', type: 'service' }, 'code')).toBe(0.6)
  })

  it('does not let observations of one source kind corroborate each other', () => {
    expect(assess(model, pod, seen('code', 'code', 'code'))).toEqual({
      confidence: 0.3,
      basis: 'evidence',
      evidenceCount: 3,
      sources: ['code']
    })
  })

  it('combines independent sources, so a pod seen in code and running is well corroborated', () => {
    // 1 - (1 - 0.3)(1 - 0.9)
    expect(assess(model, pod, seen('runtime', 'code'))).toEqual({
      confidence: 0.93,
      basis: 'evidence',
      evidenceCount: 2,
      sources: ['code', 'runtime']
    })
    expect(assess(model, dependsOn, seen('code', 'manifest')).confidence).toBe(0.98)
  })

  it('takes a stated confidence only when there is no evidence, and a default otherwise', () => {
    expect(assess(model, pod, [], 0.8)).toEqual({ confidence: 0.8, basis: 'stated', evidenceCount: 0, sources: [] })
    expect(assess(model, pod, [])).toEqual({ confidence: 0.5, basis: 'unevidenced', evidenceCount: 0, sources: [] })
    expect(assess(model, pod, seen('code'), 0.8).confidence).toBe(0.3)
  })

  describe('with a repository ontology', () => {
    const own = (extra: Partial<Ontology> = {}): Ontology => ({
      version: 1,
      resourceTypes: { pod: {}, widget: {}, secret: { confidence: { code: 0.5 } } },
      relationships: { depends_on: { from: '*', to: '*' } },
      ...extra
    })

    it('uses its own rules, and the built-in rule for a type that sets none', () => {
      const repo = confidenceModel(own())
      expect(observationConfidence(repo, { kind: 'resource', type: 'secret' }, 'code')).toBe(0.5)
      expect(observationConfidence(repo, pod, 'code')).toBe(0.3)
      expect(observationConfidence(repo, dependsOn, 'manifest')).toBe(0.95)
      // A type docket has no rule for falls back to the source.
      expect(observationConfidence(repo, { kind: 'resource', type: 'widget' }, 'code')).toBe(0.6)
    })

    it('replaces the built-in source kinds and default when it declares its own', () => {
      const repo = confidenceModel(
        own({ evidence: { unevidenced: 0.2, sources: { ticket: { confidence: 0.4, requires: ['urls'] } } } })
      )
      expect(Object.keys(repo.sources)).toEqual(['ticket'])
      expect(assess(repo, pod, []).confidence).toBe(0.2)
      expect(observationConfidence(repo, { kind: 'resource', type: 'widget' }, 'ticket')).toBe(0.4)
      // An unregistered source - which validation rejects - is worth only the default.
      expect(observationConfidence(repo, { kind: 'resource', type: 'widget' }, 'code')).toBe(0.2)
    })

    it('keeps the built-in sources for an ontology written before evidence existed', () => {
      const repo = confidenceModel(own())
      expect(Object.keys(repo.sources).sort()).toEqual(
        ['api', 'code', 'config', 'conversation', 'docs', 'human', 'infrastructure', 'manifest', 'person', 'runtime']
      )
      expect(repo.unevidenced).toBe(0.5)
    })
  })
})

describe('confidence policies', () => {
  const repository = { kind: 'resource', type: 'repository' } as const
  const service = { kind: 'resource', type: 'service' } as const

  /** The report's example ontology: sources with attributes, and policies over them. */
  const ontology = (policies: TrustPolicy[], extra: Partial<Ontology> = {}): Ontology => ({
    version: 1,
    resourceTypes: { repository: {}, service: {} },
    relationships: {},
    sources: {
      person: {
        kind: 'identity',
        identifiedBy: ['person'],
        attributes: {
          role: { type: 'string', enum: ['lead', 'engineer', 'intern'], setBy: 'directory' },
          flags: { type: 'string[]', setBy: 'directory' }
        },
        locator: { person: { required: true } }
      },
      github: {
        kind: 'system',
        identifiedBy: ['repo'],
        attributes: { branch_protected: { type: 'boolean', setBy: 'connection' } },
        locator: { repo: { required: true } }
      },
      codebase: {
        kind: 'system',
        identifiedBy: ['repository'],
        attributes: { branch: { type: 'string', enum: ['default', 'other'], setBy: 'reporter' } },
        locator: { repository: { required: true }, path: { required: true } }
      },
      document: {
        kind: 'content',
        attributes: { status: { type: 'string', enum: ['verified', 'unverified'], setBy: 'registry' } },
        locator: { url: { required: true } }
      }
    },
    trust: { policies },
    ...extra
  })

  const registry = (known: Record<string, Record<string, ConditionValue | ConditionValue[]>>): SourceRegistry => ({
    attributes: (source, instance) => known[`${source}:${instance}`]
  })

  it('prices an observation by the source it came from: a repository in GitHub over one in a codebase', () => {
    const model = confidenceModel(
      ontology([
        { name: 'Repository found in GitHub', when: { about: 'repository', source: 'github' }, score: 0.9 },
        { name: 'Repository found in a local codebase', when: { about: 'repository', source: 'codebase' }, score: 0.7 }
      ])
    )
    expect(observationConfidence(model, repository, 'github')).toBe(0.9)
    expect(observationConfidence(model, repository, 'codebase')).toBe(0.7)
  })

  it('takes nothing from docket\'s built-in sources once the ontology gives its own', () => {
    const model = confidenceModel(ontology([]))
    expect(Object.keys(model.sources).sort()).toEqual(['codebase', 'document', 'github', 'person'])
    expect(model.policies).toEqual([])
    // No policy prices it: the fallback, under the default thresholds.
    expect(observationConfidence(model, repository, 'github')).toBe(0.4)
    expect([model.unevidenced, model.fallback, model.cap]).toEqual([0.5, 0.4, 0.99])
    expect(model.accept).toEqual({ default: 0.75, decision: 0.8 })
    expect(model.bands).toEqual({ established: 0.8, probable: 0.5 })
  })

  it('lets the most specific base policy win, and a tie go to the lower score', () => {
    const model = confidenceModel(
      ontology([
        { name: 'Anything from GitHub', when: { source: 'github' }, score: 0.6 },
        { name: 'A repository in GitHub', when: { about: 'repository', source: 'github' }, score: 0.9 },
        { name: 'Protected, high', when: { source: 'github', branch_protected: true }, score: 0.95 },
        { name: 'Protected, low', when: { source: 'github', branch_protected: true }, score: 0.85 }
      ]),
      { registry: registry({ 'github:arcadia/payments': { branch_protected: true } }) }
    )
    const scored = scoreObservation(model, repository, { source: 'github', locator: { repo: 'arcadia/payments' } })
    expect(scored.base).toEqual({ policy: 'Protected, low', score: 0.85 })
    expect(scored.beaten.map((match) => match.policy)).toEqual(['A repository in GitHub', 'Protected, high', 'Anything from GitHub'])
    expect(scored.score).toBe(0.85)
    // A repository nothing is known about: naming the type is the most specific.
    expect(scoreObservation(model, repository, { source: 'github', locator: { repo: 'arcadia/other' } }).score).toBe(0.9)
    expect(scoreObservation(model, service, { source: 'github', locator: { repo: 'arcadia/other' } }).score).toBe(0.6)
  })

  it('stacks every matching adjustment on the base score, and holds the result to the cap', () => {
    const model = confidenceModel(
      ontology([
        { name: 'Read on the default branch', when: { source: 'codebase' }, score: 0.8 },
        { name: 'Only seen in tests', when: { source: 'codebase', '@path': { matches: '**/*_test.*' } }, adjust: -0.1 },
        { name: 'Deep in vendor code', when: { source: 'codebase', '@path': { matches: 'vendor/**' } }, adjust: -0.25 },
        { name: 'A lead said so', when: { source: 'person', role: 'lead' }, score: 0.95 },
        { name: 'Trusted reviewer', when: { source: 'person', flags: { has: 'trusted-reviewer' } }, adjust: 0.1 }
      ]),
      { registry: registry({ 'person:dana': { role: 'lead', flags: ['trusted-reviewer'] } }) }
    )
    const test = scoreObservation(model, service, { source: 'codebase', repository: 'payments', path: 'checkout/adyen_test.go' })
    expect(test.adjustments).toEqual([{ policy: 'Only seen in tests', adjust: -0.1 }])
    expect(test.score).toBe(0.7)
    expect(scoreObservation(model, service, { source: 'codebase', repository: 'payments', path: 'vendor/x/adyen_test.go' }).score).toBe(0.45)
    expect(scoreObservation(model, service, { source: 'codebase', repository: 'payments', path: 'checkout/adyen.go' }).score).toBe(0.8)
    // 0.95 + 0.10 is held to the 0.99 cap.
    expect(scoreObservation(model, service, { source: 'person', locator: { person: 'dana' } }).score).toBe(0.99)
  })

  it('counts each source instance once, and distinct instances independently', () => {
    const model = confidenceModel(
      ontology([
        { name: 'A lead said so', when: { source: 'person', role: 'lead' }, score: 0.8 },
        { name: 'Code', when: { source: 'codebase' }, score: 0.6 }
      ]),
      { registry: registry({ 'person:dana': { role: 'lead' }, 'person:sam': { role: 'lead' }, 'person:lee': { role: 'lead' } }) }
    )
    const said = (person: string): MemoryEvidence => ({ source: 'person', locator: { person } })
    // Three different leads add up: 1 - 0.2^3.
    expect(assess(model, service, [said('dana'), said('sam'), said('lee')]).confidence).toBe(0.99)
    expect(assess(model, service, [said('dana'), said('sam')]).confidence).toBe(0.96)
    // The same lead twice is one opinion.
    expect(assess(model, service, [said('dana'), said('dana')]).confidence).toBe(0.8)
    // Two files in one repository are one; another repository is a second opinion.
    const file = (repository: string, path: string): MemoryEvidence => ({ source: 'codebase', repository, path })
    expect(assess(model, service, [file('payments', 'a.go'), file('payments', 'b.go')]).confidence).toBe(0.6)
    expect(assess(model, service, [file('payments', 'a.go'), file('ledger', 'b.go')]).confidence).toBe(0.84)
    // An explicit sourceRef names the instance whatever the locator says.
    expect(
      assess(model, service, [
        { ...file('payments', 'a.go'), sourceRef: 'mono' },
        { ...file('ledger', 'b.go'), sourceRef: 'mono' }
      ]).confidence
    ).toBe(0.6)
  })

  it('groups observations that do not say which instance by source type, as evidence always was', () => {
    const model = confidenceModel(ontology([{ name: 'Documents', when: { source: 'document' }, score: 0.5 }]))
    const docs = [
      { source: 'document', locator: { url: 'https://a.example' } },
      { source: 'document', locator: { url: 'https://b.example' } }
    ]
    // `document` declares no identifiedBy, so both are one instance: the source type.
    expect(explain(model, service, docs).observations.map((observation) => observation.source.instance)).toEqual(['document', 'document'])
    expect(assess(model, service, docs).confidence).toBe(0.5)
  })

  it('trusts attested attributes, and claims only where the source type lets the writer set them', () => {
    const model = confidenceModel(
      ontology([
        { name: 'Verified document', when: { source: 'document', status: 'verified' }, score: 0.9 },
        { name: 'Default branch', when: { source: 'codebase', branch: 'default' }, score: 0.8 }
      ]),
      { registry: registry({ 'document:https://wiki/payments': { status: 'verified' } }) }
    )
    // An unregistered document claiming to be verified is not: the fallback.
    const claimed = scoreObservation(model, service, {
      source: 'document',
      locator: { url: 'https://wiki/other' },
      attributes: { status: 'verified' }
    })
    expect(claimed.score).toBe(0.4)
    expect(claimed.source.ignored).toEqual(['status'])
    // The registry says so: it counts.
    const attested = scoreObservation(model, service, {
      source: 'document',
      sourceRef: 'https://wiki/payments',
      locator: { url: 'https://wiki/payments' }
    })
    expect(attested.score).toBe(0.9)
    expect(attested.source.attested).toEqual(['status'])
    // A codebase's branch is the writer's to claim.
    const branch = scoreObservation(model, service, {
      source: 'codebase',
      repository: 'payments',
      path: 'a.go',
      attributes: { branch: 'default' }
    })
    expect(branch.score).toBe(0.8)
    expect(branch.source.claimed).toEqual(['branch'])
  })

  it('tests attributes with not, in, has, gt, lt and exists', () => {
    expect(conditionHolds('lead', 'lead')).toBe(true)
    expect(conditionHolds('lead', ['engineer', 'lead'])).toBe(true)
    expect(conditionHolds('lead', undefined)).toBe(false)
    expect(conditionHolds({ not: 'intern' }, 'lead')).toBe(true)
    expect(conditionHolds({ not: 'intern' }, undefined)).toBe(true)
    expect(conditionHolds({ in: ['lead', 'engineer'] }, 'engineer')).toBe(true)
    expect(conditionHolds({ in: ['lead'] }, 'intern')).toBe(false)
    expect(conditionHolds({ has: 'new-starter' }, ['new-starter'])).toBe(true)
    expect(conditionHolds({ gt: 30 }, 45)).toBe(true)
    expect(conditionHolds({ gt: 30, lt: 40 }, 45)).toBe(false)
    expect(conditionHolds({ lt: 30 }, '10')).toBe(false)
    expect(conditionHolds({ exists: true }, false)).toBe(true)
    expect(conditionHolds({ exists: false }, undefined)).toBe(true)
    expect(conditionHolds({ matches: 'docs/*.md' }, 'docs/a.md')).toBe(true)
    expect(conditionHolds({ matches: 'docs/*.md' }, 'docs/x/a.md')).toBe(false)
    expect(conditionHolds({ matches: '**/*.md' }, 'a.md')).toBe(true)
  })

  it('explains a combined score observation by observation', () => {
    const model = confidenceModel(
      ontology([
        { name: 'Read on the default branch', when: { source: 'codebase' }, score: 0.8 },
        { name: 'Only seen in tests', when: { source: 'codebase', '@path': { matches: '**/*_test.*' } }, adjust: -0.1 },
        { name: 'Unverified document', when: { source: 'document' }, score: 0.5 },
        { name: 'An intern said so', when: { source: 'person', role: 'intern' }, score: 0.4 },
        { name: 'New starter', when: { source: 'person', flags: { has: 'new-starter' } }, adjust: -0.1 }
      ]),
      { registry: registry({ 'person:tom': { role: 'intern', flags: ['new-starter'] } }) }
    )
    // The report's Adyen example: 1 - (0.20 × 0.50 × 0.70) = 0.93.
    const explanation = explain(model, { kind: 'resource', type: 'service' }, [
      { source: 'codebase', repository: 'payments', path: 'checkout/psp/adyen.go' },
      { source: 'codebase', repository: 'payments', path: 'checkout/psp/adyen_test.go' },
      { source: 'document', locator: { url: 'https://wiki/vendor-review' } },
      { source: 'person', locator: { person: 'tom' }, note: 'stand-up remark' }
    ])
    expect(explanation.confidence).toBe(0.93)
    expect(explanation.sources).toEqual(['codebase', 'document', 'person'])
    expect(explanation.observations.map((observation) => [observation.score, observation.counts])).toEqual([
      [0.8, true],
      [0.7, false],
      [0.5, true],
      [0.3, true]
    ])
    expect(explanation.observations[3]).toMatchObject({
      base: { policy: 'An intern said so', score: 0.4 },
      adjustments: [{ policy: 'New starter', adjust: -0.1 }],
      source: { instance: 'person:tom', attested: ['role', 'flags'] }
    })
    expect(bandOf(model, explanation.confidence)).toBe('established')
    expect(bandOf(model, 0.51)).toBe('probable')
    expect(bandOf(model, 0.3)).toBe('unverified')
  })

  it('keeps assess to the assessment, so projections and their hashes do not change', () => {
    const model = confidenceModel(ontology([{ name: 'Code', when: { source: 'codebase' }, score: 0.6 }]))
    expect(Object.keys(assess(model, service, [{ source: 'codebase', repository: 'r', path: 'p' }])).sort()).toEqual(
      ['basis', 'confidence', 'evidenceCount', 'sources']
    )
  })
})

describe('person sources', () => {
  const service = { kind: 'resource', type: 'service' } as const
  const ontology: Ontology = {
    version: 1,
    resourceTypes: { service: {} },
    relationships: {},
    sources: {
      person: {
        kind: 'identity',
        attributes: {
          role: { type: 'string', setBy: 'directory' },
          flags: { type: 'string[]', setBy: 'directory' }
        }
      },
      human: {},
      codebase: { identifiedBy: ['repository'] }
    },
    trust: {
      policies: [
        { name: 'A person said so', when: { source: 'person' }, score: 0.6 },
        { name: 'A lead said so', when: { source: 'person', role: 'lead' }, score: 0.9 },
        { name: 'An intern said so', when: { source: 'person', role: 'intern' }, score: 0.4 },
        { name: 'New starter', when: { source: 'person', flags: { has: 'new-starter' } }, adjust: -0.1 },
        { name: 'Legacy human', when: { source: 'human' }, score: 0.9 }
      ]
    }
  }
  const people = {
    people: {
      dana: { aliases: ['dana@acme.com'], attributes: { role: 'lead' } },
      tom: { attributes: { role: 'intern', flags: ['new-starter'] } }
    }
  }
  const model = confidenceModel(ontology, { people })

  it('takes evidence that names no one as said by the person the writer acts for, scored by their role', () => {
    const scored = scoreObservation(model, service, { source: 'person', principal: 'tom' })
    expect(scored.source).toMatchObject({ instance: 'person:tom', attested: ['role', 'flags'] })
    expect(scored.base?.policy).toBe('An intern said so')
    expect(scored.score).toBe(0.3)
    expect(scoreObservation(model, service, { source: 'person', principal: 'dana@acme.com' }).score).toBe(0.9)
  })

  it('counts a person cited second-hand as the writer\'s person until they give evidence of their own', () => {
    // Tom's agent says Dana said so: it counts as Tom.
    const hearsay = { source: 'person', sourceRef: 'dana', principal: 'tom', note: 'Dana said so in stand-up.' }
    const scored = scoreObservation(model, service, hearsay)
    expect(scored.source).toMatchObject({ instance: 'person:tom', secondHand: 'dana' })
    expect(scored.score).toBe(0.3)
    expect(explain(model, service, [hearsay]).observations[0]?.confirmed).toBe(false)

    // Dana confirms with evidence of her own: it counts as hers.
    const confirmed = explain(model, service, [hearsay, { source: 'person', principal: 'dana' }])
    expect(confirmed.observations.map((observation) => [observation.source.instance, observation.score, observation.confirmed])).toEqual([
      ['person:tom', 0.3, true],
      ['person:dana', 0.9, undefined]
    ])
    expect(confirmed.confidence).toBe(0.93)

    // Naming yourself, by an alias, is first-hand.
    expect(scoreObservation(model, service, { source: 'person', sourceRef: 'dana@acme.com', principal: 'dana' }).source.secondHand).toBeUndefined()
  })

  it('takes a named person at their word only when no one is known to have written it, as evidence before principals did', () => {
    expect(scoreObservation(model, service, { source: 'person', sourceRef: 'dana' }).score).toBe(0.9)
    // Several people add up; the same person, under two names, counts once.
    expect(assess(model, service, [{ source: 'person', principal: 'dana' }, { source: 'person', principal: 'dana@acme.com' }]).confidence).toBe(0.9)
    expect(assess(model, service, [{ source: 'person', principal: 'dana' }, { source: 'person', principal: 'tom' }]).confidence).toBe(0.93)
  })

  it('scores someone the directory does not know by the person policy alone, and leaves other sources alone', () => {
    expect(scoreObservation(model, service, { source: 'person', principal: 'stranger' })).toMatchObject({ score: 0.6, source: { attested: [] } })
    expect(scoreObservation(model, service, { source: 'human', principal: 'tom', observedBy: 'dana' }).score).toBe(0.9)
    expect(scoreObservation(model, service, { source: 'codebase', repository: 'pay', principal: 'tom' }).source.instance).toBe('codebase:pay')
  })
})
