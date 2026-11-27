// SPDX-License-Identifier: AGPL-3.0-only
import { parseOntology, type Ontology } from '@docket/platform-canonical-store'
import { readFixture } from '@docket/platform-canonical-store/fixture'
import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { diffOntologies } from './diff.js'

const load = (yaml: string): Ontology => {
  const { ontology } = parseOntology(yaml)
  if (!ontology) throw new Error('fixture does not load')
  return ontology
}

describe('the structural diff', () => {
  it('reads like the history: types, attributes, relationships, sources and policies', async () => {
    const { ontology } = await readFixture()
    const doc = parseDocument(ontology)
    doc.setIn(['resourceTypes', 'slo'], { description: 'An objective.' })
    doc.deleteIn(['resourceTypes', 'pod'])
    doc.deleteIn(['resourceTypes', 'service', 'attributes', 'language'])
    doc.setIn(['resourceTypes', 'service', 'attributes', 'tier', 'enum'], ['critical', 'standard', 'experimental'])
    doc.setIn(['resourceTypes', 'team', 'icon'], 'users-round')
    doc.setIn(['relationships', 'depends_on', 'to'], ['service', 'datasource', 'api'])
    doc.setIn(['relationships', 'owned_by', 'from'], ['service'])
    doc.setIn(['trust', 'policies', 1, 'score'], 0.5)
    expect(diffOntologies(load(ontology), load(doc.toString()))).toEqual([
      { op: '+', text: 'type `slo`' },
      { op: '-', text: 'type `pod`' },
      { op: '-', text: 'attribute `service.language`' },
      { op: '~', text: 'attribute `service.tier`: enum += `experimental`' },
      { op: '~', text: 'type `team`: icon' },
      { op: '~', text: 'relationship `depends_on`: to += `api`' },
      { op: '~', text: 'relationship `owned_by`: from: * → [service]' },
      { op: '~', text: 'policy `code evidence`: score 0.6 → 0.5' },
    ])
  })

  it('lists everything as added against nothing', async () => {
    const { ontology } = await readFixture()
    const changes = diffOntologies(null, load(ontology))
    expect(changes.filter((c) => c.text.startsWith('type')).map((c) => c.text)).toEqual(
      ['service', 'datasource', 'team', 'api', 'pod'].map((t) => `type \`${t}\``),
    )
    expect(changes.every((c) => c.op === '+')).toBe(true)
    expect(changes.at(-1)?.text).toBe('policy `code evidence of exposes`')
  })
})
