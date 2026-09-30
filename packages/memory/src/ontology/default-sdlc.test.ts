import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { DEFAULT_ONTOLOGY_PATH } from '../config/defaults.js'
import { ontologySchema } from '../model/ontology.js'

const load = async () =>
  ontologySchema.parse(parse(await readFile(DEFAULT_ONTOLOGY_PATH, 'utf8')))

describe('default-sdlc.yaml', () => {
  it('defines the spec section 11 resource types', async () => {
    const ontology = await load()
    expect(Object.keys(ontology.resourceTypes).sort()).toEqual(
      [
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

  it('defines the spec section 10 relationships over known types', async () => {
    const ontology = await load()
    expect(Object.keys(ontology.relationships)).toEqual([
      'owned_by',
      'depends_on',
      'uses',
      'supersedes',
      'deployed_to'
    ])

    const known = new Set(Object.keys(ontology.resourceTypes))
    for (const [name, rel] of Object.entries(ontology.relationships)) {
      for (const side of [rel.from, rel.to]) {
        if (side === '*') continue
        for (const type of side) expect(known, `${name} -> ${type}`).toContain(type)
      }
    }
  })
})
