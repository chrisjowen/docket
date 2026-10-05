import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { DEFAULT_ONTOLOGY_PATH } from '../config/defaults.js'
import { ontologySchema } from '../model/ontology.js'
import { parseMemoryFile } from '../source/parser.js'
import { validateDocuments } from './validator.js'

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
    const sources = ontology.evidence?.sources ?? {}
    expect(Object.keys(sources).sort()).toEqual(
      ['api', 'code', 'config', 'conversation', 'docs', 'human', 'infrastructure', 'manifest', 'runtime']
    )
    expect(sources.code?.requires).toEqual(['path'])
    expect(sources.api?.requires).toEqual(['endpoint'])
    expect(ontology.evidence?.unevidenced).toBe(0.5)
  })

  it('only writes confidence rules for registered sources', async () => {
    const ontology = await load()
    const sources = new Set(Object.keys(ontology.evidence?.sources ?? {}))
    const definitions = { ...ontology.resourceTypes, ...ontology.relationships }
    for (const [name, definition] of Object.entries(definitions)) {
      for (const source of Object.keys(definition.confidence ?? {})) {
        expect(sources, `${name} -> ${source}`).toContain(source)
      }
    }
  })

  it('trusts a manifest dependency and doubts runtime things read from code', async () => {
    const ontology = await load()
    expect(ontology.relationships.depends_on?.confidence?.manifest).toBeGreaterThanOrEqual(0.9)
    for (const type of ['pod', 'secret', 'cluster', 'container', 'infrastructure']) {
      expect(ontology.resourceTypes[type]?.confidence?.code, type).toBeLessThan(0.5)
      expect(ontology.resourceTypes[type]?.confidence?.runtime, type).toBeGreaterThanOrEqual(0.85)
    }
  })
})
