import { describe, expect, it } from 'vitest'

import type { MemoryEvidence, Ontology } from '../model/index.js'
import { assess, builtinOntology, confidenceModel, observationConfidence } from './confidence.js'

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
        ['api', 'code', 'config', 'conversation', 'docs', 'human', 'infrastructure', 'manifest', 'runtime']
      )
      expect(repo.unevidenced).toBe(0.5)
    })
  })
})
