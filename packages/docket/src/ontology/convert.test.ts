import { describe, expect, it } from 'vitest'

import { builtinOntology, confidenceModel, observationConfidence, type Subject } from '../evidence/confidence.js'
import { convertLegacyTrust, withTrustSettings } from '../evidence/legacy.js'
import type { Ontology } from '../model/index.js'
import { convertOntologyText } from './convert.js'
import { parseOntology } from './loader.js'

const LEGACY = `# A small legacy ontology.
version: 1

# How evidence is weighed here.
evidence:
  unevidenced: 0.3
  sources:
    ledger:
      description: The general ledger.
      confidence: 0.8
      requires:
        - key
    rumour:
      confidence: 0.2
      requiresAny: [urls, path]

resourceTypes:
  invoice:
    description: >
      A bill sent to a customer.
    attributes:
      total: { type: number }
    confidence:
      ledger: 0.95

  customer:
    description: Someone who buys.

relationships:
  billed_to:
    from: [invoice]
    to: [customer]
    confidence:
      rumour: 0.1
`

/** Every source, for every type and relationship: what one observation of it is worth. */
const prices = (ontology: Ontology): Record<string, number> => {
  const model = confidenceModel(ontology)
  const out: Record<string, number> = {}
  const subjects: Subject[] = [
    ...Object.keys(ontology.resourceTypes).map((type): Subject => ({ kind: 'resource', type })),
    ...Object.keys(ontology.relationships).map((rel): Subject => ({ kind: 'relationship', rel }))
  ]
  for (const subject of subjects) {
    for (const source of [...Object.keys(model.sources), 'unregistered']) {
      out[`${JSON.stringify(subject)} ${source}`] = observationConfidence(model, subject, source)
    }
  }
  return out
}

const load = (raw: string): Ontology => {
  const loaded = parseOntology(raw, 'entities.yaml')
  if (!loaded.ontology) throw new Error(JSON.stringify(loaded.diagnostics))
  return loaded.ontology
}

describe('convertLegacyTrust', () => {
  it('reads each legacy source as a source type and a base policy, and each rule as a policy about its type', () => {
    const converted = convertLegacyTrust(
      {
        version: 1,
        resourceTypes: { invoice: { confidence: { ledger: 0.95 } } },
        relationships: {},
        evidence: { unevidenced: 0.3, sources: { ledger: { confidence: 0.8, requires: ['key'] }, rumour: { confidence: 0.2, requiresAny: ['urls', 'path'] } } }
      },
      builtinOntology()
    )
    expect(converted.sources).toEqual({
      ledger: { locator: { key: { required: true } } },
      rumour: { locator: { urls: {}, path: {} }, requiresAny: ['urls', 'path'] }
    })
    expect(converted.trust).toEqual({
      unevidenced: 0.3,
      fallback: 0.3,
      cap: 1,
      policies: [
        { name: 'ledger evidence', when: { source: 'ledger' }, score: 0.8 },
        { name: 'rumour evidence', when: { source: 'rumour' }, score: 0.2 },
        { name: 'ledger evidence of invoice', when: { about: 'invoice', source: 'ledger' }, score: 0.95 }
      ]
    })
  })

  it('writes out docket\'s built-in sources, and the built-in rules a type of the same name inherited', () => {
    const converted = convertLegacyTrust({ version: 1, resourceTypes: { pod: {}, widget: {} }, relationships: {} }, builtinOntology())
    expect(Object.keys(converted.sources).sort()).toEqual(
      ['api', 'code', 'config', 'conversation', 'docs', 'human', 'infrastructure', 'manifest', 'person', 'runtime']
    )
    expect(converted.trust.policies?.filter((policy) => policy.when.about !== undefined).map((policy) => policy.when)).toEqual(
      expect.arrayContaining([{ about: 'pod', source: 'code' }, { about: 'pod', source: 'runtime' }])
    )
    expect(converted.trust.policies?.some((policy) => policy.when.about === 'widget')).toBe(false)
  })

  it('leaves an ontology in the current form alone, but for legacy settings beside it, which are dropped', () => {
    const current: Ontology = {
      version: 1,
      resourceTypes: { invoice: { confidence: { ledger: 0.95 } } },
      relationships: {},
      sources: { ledger: {} },
      trust: { policies: [{ name: 'Ledger', when: { source: 'ledger' }, score: 0.7 }] },
      evidence: { sources: { other: { confidence: 0.1 } } }
    }
    const normalized = withTrustSettings(current, builtinOntology())
    expect(normalized.sources).toEqual({ ledger: {} })
    expect(normalized.trust?.policies).toHaveLength(1)
    expect(normalized.evidence).toBeUndefined()
    expect(normalized.resourceTypes.invoice).toEqual({})
  })
})

describe('convertOntologyText', () => {
  it('rewrites the evidence block and every confidence rule as sources and policies that score the same', () => {
    const converted = convertOntologyText(LEGACY)
    expect(converted.changed).toBe(true)
    expect(converted.yaml).not.toMatch(/^evidence:|^ {4}confidence:/m)
    expect(parseOntology(converted.yaml, 'entities.yaml').diagnostics).toEqual([])
    expect(prices(load(converted.yaml))).toEqual(prices(load(LEGACY)))
    expect(load(converted.yaml).trust).toMatchObject({ unevidenced: 0.3, fallback: 0.3, cap: 1 })
  })

  it('keeps every other line of the file as it was', () => {
    const converted = convertOntologyText(LEGACY).yaml
    for (const line of [
      '# A small legacy ontology.',
      '# How evidence is weighed here.',
      '  invoice:',
      '    description: >',
      '      A bill sent to a customer.',
      '      total: { type: number }',
      '    description: Someone who buys.',
      '    from: [invoice]'
    ]) {
      expect(converted).toContain(line)
    }
    // The rule's lines go, and no blank line is left doubled where they were.
    expect(converted).toContain('      total: { type: number }\n\n  customer:')
    expect(converted).toContain('    to: [customer]\n')
    expect(converted).not.toMatch(/\n\n\n/)
  })

  it('writes docket\'s built-in sources out for an ontology that never named any', () => {
    const bare = 'version: 1\nresourceTypes:\n  pod: {}\nrelationships: {}\n'
    const converted = convertOntologyText(bare)
    expect(converted.yaml.startsWith('version: 1\n\n# Sources and confidence policies')).toBe(true)
    expect(prices(load(converted.yaml))).toEqual(prices(load(bare)))
    expect(Object.keys(load(converted.yaml).sources ?? {})).toContain('runtime')
  })

  it('changes nothing in an ontology already in the current form, and is idempotent', () => {
    const once = convertOntologyText(LEGACY).yaml
    expect(convertOntologyText(once)).toEqual({ yaml: once, changed: false })
  })

  it('drops legacy settings left beside sources: and trust:, which are not read', () => {
    const mixed = 'version: 1\nsources:\n  ledger: {}\ntrust:\n  policies: []\nevidence:\n  unevidenced: 0.2\nresourceTypes:\n  invoice:\n    confidence:\n      ledger: 0.9\nrelationships: {}\n'
    expect(parseOntology(mixed, 'entities.yaml').diagnostics.map((d) => d.code)).toEqual(['legacy-evidence-ignored'])
    const converted = convertOntologyText(mixed)
    expect(converted.changed).toBe(true)
    expect(converted.yaml).toBe('version: 1\nsources:\n  ledger: {}\ntrust:\n  policies: []\nresourceTypes:\n  invoice: {}\nrelationships: {}\n')
    expect(parseOntology(converted.yaml, 'entities.yaml').diagnostics).toEqual([])
  })
})
