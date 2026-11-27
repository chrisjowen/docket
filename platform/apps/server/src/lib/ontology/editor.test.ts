// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import {
  addRelation,
  addType,
  detachRelation,
  edit,
  joinCondition,
  parse,
  relationsFrom,
  relationsTo,
  removeType,
  renameType,
  sentence,
  setConstraint,
  setPolicies,
  setTrust,
  setValue,
  specificity,
  splitCondition,
  type PolicyModel,
} from './editor'

const text = `# kept: the header comment
version: 1
resourceTypes:
  pod:
    description: A running instance. # kept too
  service: {}
relationships:
  runs_in:
    from: [service]
    to: [pod, service]
`

describe('the editor’s YAML edits', () => {
  it('rename a type in place and in the relationship ends that name it, keeping comments', () => {
    expect(edit(text, (doc) => renameType(doc, 'pod', 'container'))).toBe(
      text.replace('  pod:\n', '  container:\n').replace('to: [pod, service]', 'to: [container, service]'),
    )
  })

  it('remove a type from the relationship ends too', () => {
    const out = parse(edit(text, (doc) => removeType(doc, 'pod'))).model
    expect(Object.keys(out?.resourceTypes ?? {})).toEqual(['service'])
    expect(out?.relationships.runs_in?.to).toEqual(['service'])
  })

  it('drop an emptied field and the map it leaves empty', () => {
    const added = edit(text, (doc) => {
      addType(doc, 'slo')
      setValue(doc, ['resourceTypes', 'slo', 'extraction', 'clues'], ['error budget'])
      setConstraint(doc, 'runs_in', 'from', '*')
    })
    expect(parse(added).model?.resourceTypes.slo).toEqual({ extraction: { clues: ['error budget'] } })
    expect(parse(added).model?.relationships.runs_in?.from).toBe('*')
    const cleared = edit(added, (doc) => setValue(doc, ['resourceTypes', 'slo', 'extraction', 'clues'], []))
    expect(parse(cleared).model?.resourceTypes.slo).toEqual({})
  })

  it('report a YAML error instead of a model', () => {
    expect(parse('resourceTypes: [').model).toBeNull()
  })
})

describe('relations edited from the type they start at', () => {
  const model = () => parse(text).model!
  it('adds a target to a relationship of that name, or makes one from the type', () => {
    const added = parse(edit(text, (doc) => addRelation(doc, model(), 'pod', 'runs_in', 'node'))).model
    expect(added?.relationships.runs_in).toEqual({ from: ['service', 'pod'], to: ['pod', 'service', 'node'] })
    const made = parse(edit(text, (doc) => addRelation(doc, model(), 'pod', 'owned_by', '*'))).model
    expect(made?.relationships.owned_by).toEqual({ from: ['pod'], to: '*' })
  })

  it('detaches a type, and removes the relationship once no type is left at its start', () => {
    const detached = parse(edit(text, (doc) => detachRelation(doc, model(), 'service', 'runs_in'))).model
    expect(detached?.relationships.runs_in).toBeUndefined()
  })

  it('lists what starts at a type and what points to it', () => {
    expect(relationsFrom(model(), 'service').map((relation) => relation.name)).toEqual(['runs_in'])
    expect(relationsTo(model(), 'pod')).toEqual([expect.objectContaining({ name: 'runs_in', from: ['service'] })])
    expect(relationsTo(model(), 'service')).toEqual([])
  })
})

describe('policies', () => {
  const policies: PolicyModel[] = [
    { name: 'A lead said so', when: { source: 'person', role: 'lead' }, score: 0.85 },
    { name: 'Only seen in tests', when: { about: 'service', source: 'codebase', '@path': { matches: '**/*_test.*' } }, adjust: -0.1 },
  ]

  it('read as a sentence, and rank by how specific they are', () => {
    expect(sentence(policies[0]!)).toBe('When the source is a person with role = lead, about anything: score 0.85')
    expect(sentence(policies[1]!)).toBe('When the source is a codebase with at path matches **/*_test.*, about service: subtract 0.10')
    expect(policies.map(specificity)).toEqual([1, 2])
  })

  it('are written one to a line, their conditions kept as docket reads them', () => {
    const written = edit('version: 1\nresourceTypes: {}\nrelationships: {}\n', (doc) => setPolicies(doc, policies))
    expect(written).toContain('  policies:\n    - name: A lead said so\n      when: {source: person, role: lead}\n      score: 0.85\n')
    expect(parse(written).model?.trust?.policies).toEqual(policies)
  })

  it('take a condition as typed: a number, a boolean, a list or a glob', () => {
    expect(joinCondition('=', '3')).toBe(3)
    expect(joinCondition('=', 'true')).toBe(true)
    expect(joinCondition('in', 'lead, engineer')).toEqual({ in: ['lead', 'engineer'] })
    expect(joinCondition('matches', ' **/*.go ')).toEqual({ matches: '**/*.go' })
    expect(splitCondition({ has: 'new-starter' })).toEqual({ op: 'has', value: 'new-starter' })
  })

  it('set a threshold, and drop it again when it is emptied', () => {
    const set = edit('version: 1\nresourceTypes: {}\nrelationships: {}\n', (doc) => setTrust(doc, ['accept', 'decision'], 0.8))
    expect(parse(set).model?.trust).toEqual({ accept: { decision: 0.8 } })
    expect(parse(edit(set, (doc) => setTrust(doc, ['accept', 'decision'], undefined))).model?.trust).toBeUndefined()
  })
})
