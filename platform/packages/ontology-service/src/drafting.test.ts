// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { builtInCatalogue, contentsOf, normaliseTags } from './catalogue.js'
import { DRAFT_TOOL, buildDraft, draftMessages, ontologyName, readPlan, type StartingPoint } from './drafting.js'
import { TEMPLATES } from './templates.js'

const points: StartingPoint[] = TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, types: contentsOf(t.yaml).types, yaml: t.yaml }))
const point = (id: string) => points.find((p) => p.id === id) as StartingPoint

const reply = (args: unknown) => ({ content: '', toolCalls: [{ name: DRAFT_TOOL.name, arguments: JSON.stringify(args) }] })

describe('the catalogue', () => {
  it('says what each built-in template holds', () => {
    const crm = builtInCatalogue().find((entry) => entry.id === 'crm')
    expect(crm?.kind).toBe('built-in')
    expect(crm?.types).toEqual(expect.arrayContaining(['account', 'contact', 'opportunity']))
    expect(crm?.relationships).toBeGreaterThan(0)
    expect(crm?.tags).toContain('sales')
    expect(builtInCatalogue().find((entry) => entry.id === 'blank')?.types).toEqual([])
  })

  it('reads nothing from text that is not an ontology', () => {
    expect(contentsOf(': : :')).toEqual({ types: [], relationships: 0 })
  })

  it('keeps tags short, lowercase and unique', () => {
    expect(normaliseTags(' Sales, CRM ,sales,, Field Service ')).toEqual(['sales', 'crm', 'field-service'])
  })
})

describe('drafting with AI', () => {
  it('asks with the description and every starting template', () => {
    const [system, user] = draftMessages('  We track our vet clinic: pets, owners and appointments.  ', points)
    expect(system?.content).toContain('crm: Customer relationships (CRM).')
    expect(system?.content).toContain('account, contact')
    expect(user?.content).toBe('We track our vet clinic: pets, owners and appointments.')
  })

  it('turns names into ontology names', () => {
    expect(ontologyName('Support Case')).toBe('support_case')
    expect(ontologyName('2nd-Opinion')).toBe('nd-opinion')
    expect(ontologyName('!!!')).toBeNull()
  })

  it('reads the tool call, keeping only what the ontology can hold', () => {
    const plan = readPlan(
      reply({
        template: 'crm',
        summary: 'A vet clinic.',
        types: [
          { name: 'Pet', description: 'An animal we treat.', icon: 'not-an-icon', attributes: [{ name: 'Species', type: 'string', values: ['dog', 'cat'] }, { name: 'title', type: 'string' }] },
          { name: 'account', description: 'An owner.' },
          { name: 'pet', description: 'A duplicate.' },
        ],
        relationships: [
          { name: 'owned_by', description: 'Whose pet.', from: ['Pet'], to: ['account'] },
          { name: 'treats', description: 'Points nowhere.', from: ['vet'], to: ['pet'] },
        ],
      }),
      points,
    )
    expect(plan?.template).toBe('crm')
    expect(plan?.types.map((type) => type.name)).toEqual(['pet', 'account'])
    expect(plan?.types[0]?.attributes).toEqual([{ name: 'species', type: 'string', values: ['dog', 'cat'] }])
    expect(plan?.types[0]).not.toHaveProperty('icon')
    expect(plan?.relationships).toEqual([{ name: 'owned_by', description: 'Whose pet.', from: ['pet'], to: ['account'] }])
  })

  it('falls back to blank for a template it does not know, and to JSON in the text', () => {
    const plan = readPlan({ content: 'Here: {"template":"nope","summary":"x","types":[{"name":"thing","description":"A thing."}],"relationships":[]}', toolCalls: [] }, points)
    expect(plan?.template).toBe('blank')
    expect(plan?.types.map((type) => type.name)).toEqual(['thing'])
  })

  it('reads no plan from a reply without types', () => {
    expect(readPlan({ content: 'I cannot help with that.', toolCalls: [] }, points)).toBeNull()
    expect(readPlan(reply({ template: 'crm', types: [], relationships: [] }), points)).toBeNull()
  })

  it('builds the draft over the starting template, keeping its sources and the types it keeps', () => {
    const plan = readPlan(
      reply({
        template: 'crm',
        summary: 'A vet clinic.',
        types: [
          { name: 'pet', description: 'An animal we treat.', icon: 'star', attributes: [{ name: 'species', type: 'string', values: ['dog', 'cat'] }, { name: 'weight_kg', type: 'number' }], clues: ['pet', 'animal'] },
          { name: 'account', description: 'An owner.', attributes: [{ name: 'phone', type: 'string' }] },
        ],
        relationships: [{ name: 'owned_by', description: 'Whose pet it is.', from: ['pet'], to: ['account'] }],
      }),
      points,
    )
    if (!plan) throw new Error('no plan')
    const yaml = buildDraft(plan, point('crm'))
    const ontology = parse(yaml)
    expect(Object.keys(ontology.resourceTypes)).toEqual(['pet', 'account'])
    expect(ontology.resourceTypes.pet).toMatchObject({ description: 'An animal we treat.', icon: 'star', attributes: { species: { type: 'string', enum: ['dog', 'cat'] }, weight_kg: { type: 'number' } } })
    expect(ontology.resourceTypes.pet.extraction.clues).toEqual(['pet', 'animal'])
    // The template's account keeps its own fields, with the new one added.
    expect(Object.keys(ontology.resourceTypes.account.attributes)).toEqual(expect.arrayContaining(['industry', 'tier', 'phone']))
    expect(ontology.relationships).toEqual({ owned_by: { description: 'Whose pet it is.', from: ['pet'], to: ['account'] } })
    expect(Object.keys(ontology.sources)).toEqual(Object.keys(parse(point('crm').yaml).sources))
    expect(yaml).toContain('# Drafted by AI: A vet clinic.')
  })

  it('drops trust policies about types the draft no longer has', () => {
    const sdlc = point('sdlc')
    const about = (parse(sdlc.yaml).trust.policies as { when: { about?: string } }[]).filter((policy) => policy.when.about)
    expect(about.length).toBeGreaterThan(0)
    const plan = readPlan(reply({ template: 'sdlc', summary: '', types: [{ name: 'service', description: 'A service.' }], relationships: [] }), points)
    if (!plan) throw new Error('no plan')
    const policies = parse(buildDraft(plan, sdlc)).trust.policies as { when: { about?: string } }[]
    expect(policies.every((policy) => !policy.when.about || policy.when.about === 'service')).toBe(true)
  })
})
