import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { DEFAULT_ONTOLOGY_PATH } from '../config/defaults.js'
import { ontologySchema } from '../model/ontology.js'

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
})
