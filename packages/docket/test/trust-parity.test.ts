import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { validate } from '../src/commands/validate.js'
import { ONTOLOGY_TEMPLATES } from '../src/config/defaults.js'
import { assess, confidenceModel, type Subject } from '../src/evidence/confidence.js'
import type { Assessment, MemoryEvidence, Ontology } from '../src/model/index.js'
import { parseOntology } from '../src/ontology/loader.js'

/**
 * Scores docket 0.15.1 gave - before sources and policies - over a fixed
 * corpus: for every resource type and relationship of each ontology, one
 * observation of each source (and of an unregistered one), all of them
 * together, and a repeated source. Also every resource and link of the
 * example workspace, with its projection hash. Recorded once with that
 * release's engine; never regenerate it from this one.
 */
const GOLDEN = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/trust/parity-0.15.1.json'), 'utf8')) as Record<
  string,
  Record<string, unknown>
>

const corpus = (ontology: Ontology): Record<string, unknown> => {
  const model = confidenceModel(ontology)
  const sources = [...Object.keys(model.sources).sort(), 'unregistered']
  const out: Record<string, unknown> = {}
  const subjects: [string, Subject][] = [
    ...[...Object.keys(ontology.resourceTypes).sort(), '__untyped'].map((type): [string, Subject] => [`r:${type}`, { kind: 'resource', type }]),
    ...[...Object.keys(ontology.relationships).sort(), '__unrelated'].map((rel): [string, Subject] => [`l:${rel}`, { kind: 'relationship', rel }])
  ]
  const evidence = (names: string[]): MemoryEvidence[] => names.map((source, i) => ({ source, note: `n${i}` }))
  for (const [key, subject] of subjects) {
    const row: Record<string, unknown> = {}
    for (const source of sources) row[source] = assess(model, subject, evidence([source])).confidence
    row['*all'] = assess(model, subject, evidence(sources))
    row['*twice'] = assess(model, subject, evidence([sources[0] as string, sources[0] as string, sources[1] as string]))
    out[key] = row
  }
  out['*none'] = assess(model, { kind: 'resource', type: '__untyped' }, [])
  out['*stated'] = assess(model, { kind: 'resource', type: '__untyped' }, [], 0.42)
  return out
}

const LEGACY: Record<string, Ontology> = {
  // Says nothing about evidence: docket's built-in sources and rules apply.
  bare: {
    version: 1,
    resourceTypes: { team: {}, widget: {} },
    relationships: { owned_by: { from: '*', to: '*' }, wires: { from: '*', to: '*' } }
  },
  // Its own sources, a rule of its own, and a type that shares a built-in name.
  custom: {
    version: 1,
    resourceTypes: { team: {}, gizmo: { confidence: { ledger: 0.55 } } },
    relationships: { depends_on: { from: '*', to: '*' } },
    evidence: { unevidenced: 0.3, sources: { ledger: { confidence: 0.8 }, rumour: { confidence: 0.2 } } }
  }
}

describe('scores written before sources and policies', () => {
  for (const [name, ontology] of Object.entries(LEGACY)) {
    it(`are unchanged for a legacy ontology: ${name}`, () => {
      expect(corpus(ontology)).toEqual(GOLDEN[name])
    })
  }

  it('are unchanged, hashes included, for the example workspace, whose ontology says nothing about trust', async () => {
    const root = join(import.meta.dirname, '../../../examples/acme-platform')
    expect(readFileSync(join(root, '.docket/entities.yaml'), 'utf8')).not.toMatch(/^(sources|trust|evidence):/m)
    const example = await validate({ cwd: root })
    expect(example.entities.length).toBeGreaterThan(0)
    const now = Object.fromEntries(
      example.entities.map((entity) => [
        entity.id,
        {
          confidence: entity.confidence,
          basis: entity.basis,
          evidenceCount: entity.evidenceCount,
          sources: entity.sources,
          hash: entity.hash,
          links: entity.links.map((link) => [link.rel, link.target, link.confidence, link.basis, link.sources])
        }
      ])
    )
    expect(now).toEqual(GOLDEN['example:acme-platform'])
  })
})

describe('the bundled templates, now in the sources: and trust: form', () => {
  for (const [name, path] of Object.entries(ONTOLOGY_TEMPLATES)) {
    it(`score as they did, but for the 0.99 cap and the 0.40 fallback: ${name}`, () => {
      const loaded = parseOntology(readFileSync(path, 'utf8'), path)
      const ontology = loaded.ontology as Ontology
      const model = confidenceModel(ontology)
      expect([model.cap, model.fallback]).toEqual([0.99, 0.4])

      // What the template's legacy form gave, capped as the template now is
      // and with the new fallback for a source it does not register.
      const was = GOLDEN[`template:${name}`] as Record<string, Record<string, unknown>>
      const expected: Record<string, unknown> = {}
      for (const [key, row] of Object.entries(was)) {
        if (key.startsWith('*')) {
          expected[key] = row
          continue
        }
        const next: Record<string, unknown> = {}
        for (const [source, value] of Object.entries(row)) {
          if (source === 'unregistered') next[source] = model.fallback
          else if (typeof value === 'number') next[source] = Math.min(value, model.cap)
          else next[source] = value
        }
        expected[key] = next
      }
      const now = corpus(ontology) as Record<string, Record<string, unknown>>
      for (const [key, row] of Object.entries(now)) {
        if (key.startsWith('*')) continue
        // Combined rows include the unregistered source, so recompute only
        // what the fallback changes: everything else must match exactly.
        for (const combined of ['*all', '*twice'] as const) {
          const old = (was[key] as Record<string, Assessment>)[combined] as Assessment
          const fresh = row[combined] as Assessment
          expect({ ...fresh, confidence: undefined }, `${key} ${combined}`).toEqual({ ...old, confidence: undefined })
          if (combined === '*twice') expect(fresh.confidence, `${key} ${combined}`).toBe(Math.min(old.confidence, model.cap))
          else expect(fresh.confidence, `${key} ${combined}`).toBeLessThanOrEqual(model.cap)
          delete row[combined]
          delete (expected[key] as Record<string, unknown>)[combined]
        }
      }
      expect(now).toEqual(expected)
    })
  }
})
