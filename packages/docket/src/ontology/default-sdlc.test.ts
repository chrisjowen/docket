import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { DEFAULT_ONTOLOGY_PATH } from '../config/defaults.js'
import { DEFAULT_TYPE_ICONS, isIconName } from './icons.js'
import { ontologySchema } from '../model/ontology.js'
import { parseMemoryFile } from '../source/parser.js'
import { validateDocuments } from './validator.js'
import { confidenceModel, observationConfidence } from '../evidence/confidence.js'
import { parseOntology } from './loader.js'

const load = async () =>
  ontologySchema.parse(parse(await readFile(DEFAULT_ONTOLOGY_PATH, 'utf8')))

/** The spec section 10 and 11 baseline. Files written against it must stay valid. */
const ORIGINAL_TYPES = [
  'agent',
  'constraint',
  'datasource',
  'decision',
  'environment',
  'library',
  'repository',
  'service',
  'system',
  'team'
]

const ORIGINAL_RELATIONSHIPS: Record<string, { from: string[] | '*'; to: string[] | '*' }> = {
  owned_by: { from: ['service', 'repository', 'agent', 'datasource'], to: ['team'] },
  depends_on: { from: ['service', 'agent'], to: ['service', 'datasource', 'system'] },
  uses: { from: '*', to: '*' },
  supersedes: { from: ['decision'], to: ['decision'] },
  deployed_to: { from: ['service', 'agent'], to: ['environment'] }
}

describe('default-sdlc.yaml', () => {
  it('defines a broad SDLC baseline of resource types', async () => {
    const ontology = await load()
    expect(Object.keys(ontology.resourceTypes).sort()).toEqual(
      [
        ...ORIGINAL_TYPES,
        // delivery
        'api',
        'pipeline',
        'artifact',
        'release',
        'feature_flag',
        'test_suite',
        // runtime and infrastructure
        'container',
        'pod',
        'cluster',
        'infrastructure',
        'event_stream',
        'endpoint',
        'secret',
        'model',
        // operations
        'incident',
        'postmortem',
        'runbook',
        'alert',
        'slo',
        'dashboard',
        // security, risk and compliance
        'vulnerability',
        'risk',
        'policy',
        'compliance_requirement',
        'permit',
        // knowledge
        'architecture_record',
        'document',
        // planning
        'project',
        'feature',
        'requirement',
        'work_item',
        'organization'
      ].sort()
    )
  })

  it('gives every resource type extraction guidance', async () => {
    const ontology = await load()
    for (const [name, definition] of Object.entries(ontology.resourceTypes)) {
      expect(definition.description, name).toBeTruthy()
      expect(definition.extraction?.instructions, name).toBeTruthy()
    }
  })

  it('gives every resource type a bundled icon, the same one docket falls back to', async () => {
    const ontology = await load()
    for (const [name, definition] of Object.entries(ontology.resourceTypes)) {
      expect(definition.icon && isIconName(definition.icon), name).toBe(true)
      expect(definition.icon, name).toBe(DEFAULT_TYPE_ICONS[name])
    }
    expect(Object.keys(DEFAULT_TYPE_ICONS).sort()).toEqual(Object.keys(ontology.resourceTypes).sort())
  })

  it('points every "do not confuse with" at a registered type', async () => {
    const ontology = await load()
    const known = new Set(Object.keys(ontology.resourceTypes))
    for (const [name, definition] of Object.entries(ontology.resourceTypes)) {
      for (const other of definition.extraction?.doNotConfuseWith ?? []) {
        expect(known, `${name} -> ${other}`).toContain(other)
      }
    }
  })

  it('keeps the original relationships first, and only relates registered types', async () => {
    const ontology = await load()
    expect(Object.keys(ontology.relationships).slice(0, 5)).toEqual(Object.keys(ORIGINAL_RELATIONSHIPS))

    const known = new Set(Object.keys(ontology.resourceTypes))
    for (const [name, rel] of Object.entries(ontology.relationships)) {
      for (const side of [rel.from, rel.to]) {
        if (side === '*') continue
        for (const type of side) expect(known, `${name} -> ${type}`).toContain(type)
      }
    }
  })

  it('still allows everything the original relationships allowed', async () => {
    const ontology = await load()
    for (const [name, original] of Object.entries(ORIGINAL_RELATIONSHIPS)) {
      const current = ontology.relationships[name]
      for (const side of ['from', 'to'] as const) {
        if (original[side] === '*') {
          expect(current?.[side], `${name}.${side}`).toBe('*')
          continue
        }
        for (const type of original[side]) expect(current?.[side], `${name}.${side}`).toContain(type)
      }
    }
  })

  it('accepts the unquoted dates its string-typed date attributes invite', async () => {
    const ontology = await load()
    const { document } = parseMemoryFile(
      '---\nid: release.v2\ntype: release\ntitle: v2\nattributes:\n  status: released\n  date: 2026-10-05\n---\n',
      'r.md'
    )
    expect(document).toBeDefined()
    if (!document) return
    expect(validateDocuments([document], ontology)).toEqual([])
  })

  it('declares where evidence comes from, and what each source needs to point at', async () => {
    const ontology = await load()
    const sources = ontology.sources ?? {}
    expect(Object.keys(sources).sort()).toEqual(
      ['api', 'code', 'config', 'conversation', 'docs', 'human', 'infrastructure', 'manifest', 'runtime']
    )
    expect(sources.code?.locator).toEqual({ path: { required: true } })
    expect(sources.api?.locator).toEqual({ endpoint: { required: true } })
    expect(sources.runtime?.requiresAny).toEqual(['urls', 'endpoint', 'symbol'])
    expect(ontology.trust?.unevidenced).toBe(0.5)
    expect(ontology.evidence).toBeUndefined()
  })

  it('only writes policies for registered sources and for the types and relationships it defines', async () => {
    const ontology = await load()
    const sources = new Set(Object.keys(ontology.sources ?? {}))
    const subjects = new Set([...Object.keys(ontology.resourceTypes), ...Object.keys(ontology.relationships)])
    for (const policy of ontology.trust?.policies ?? []) {
      expect(sources, policy.name).toContain(policy.when.source)
      if (policy.when.about !== undefined) expect(subjects, policy.name).toContain(policy.when.about)
    }
  })

  it('trusts a manifest dependency and doubts runtime things read from code', async () => {
    const model = confidenceModel(await load())
    expect(observationConfidence(model, { kind: 'relationship', rel: 'depends_on' }, 'manifest')).toBeGreaterThanOrEqual(0.9)
    for (const type of ['pod', 'secret', 'cluster', 'container', 'infrastructure']) {
      expect(observationConfidence(model, { kind: 'resource', type }, 'code'), type).toBeLessThan(0.5)
      expect(observationConfidence(model, { kind: 'resource', type }, 'runtime'), type).toBeGreaterThanOrEqual(0.85)
    }
  })

  it('loads without a diagnostic', async () => {
    expect(parseOntology(await readFile(DEFAULT_ONTOLOGY_PATH, 'utf8'), DEFAULT_ONTOLOGY_PATH).diagnostics).toEqual([])
  })
})
