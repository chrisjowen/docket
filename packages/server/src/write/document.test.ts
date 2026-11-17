import { describe, expect, it } from 'vitest'

import { parseMemoryFile } from '../docket.js'
import { appendedNotes, composeDocument, renderDocument, sameMeaning, splitDocument, type ResourceChange } from './document.js'
import { stampEvidence } from './evidence.js'
import type { EvidenceInput } from './inputs.js'

const NOW = new Date('2026-11-04T09:30:00.000Z')
const writer = { label: 'ci-bot (token tok_8f3a…)', requestId: 'req-1' }
const stamp = (...entries: EvidenceInput[]) => entries.map((entry) => stampEvidence(entry, writer, NOW))
const PATH = '.docket/resources/service/checkout.md'

const checkout: ResourceChange = {
  id: 'service.checkout',
  type: 'service',
  title: 'Checkout',
  attributes: { tier: 'critical' },
  body: 'Takes payment for a basket.',
  evidence: stamp({ source: 'code', path: 'src/checkout.ts', lines: '1-40', note: 'the checkout handler', observedBy: 'alice' }),
  links: [{ rel: 'depends_on', target: 'service.payments', evidence: stamp({ source: 'code', path: 'src/pay.ts' }) }]
}

describe('composeDocument', () => {
  it('makes a new document from a change: frontmatter, links with their evidence, then the body', () => {
    const composed = composeDocument(null, checkout, 'unused')
    expect(composed?.added).toBe(2)
    expect(composed?.raw).toBe(
      [
        '---',
        'id: service.checkout',
        'type: service',
        'title: Checkout',
        'attributes:',
        '  tier: critical',
        'links:',
        '  - rel: depends_on',
        '    target: service.payments',
        '    evidence:',
        '      - source: code',
        '        path: src/pay.ts',
        `        observedAt: ${NOW.toISOString()}`,
        '        observedBy: ci-bot (token tok_8f3a…)',
        '        session: req-1',
        'evidence:',
        '  - source: code',
        '    path: src/checkout.ts',
        '    lines: 1-40',
        '    note: the checkout handler',
        `    observedAt: ${NOW.toISOString()}`,
        '    observedBy: ci-bot (token tok_8f3a…)',
        '    session: req-1',
        '    reportedBy: alice',
        '---',
        'Takes payment for a basket.',
        ''
      ].join('\n')
    )
    expect(composed?.evidence.map((group) => [group.on, group.entries.length])).toEqual([
      ['service.checkout', 1],
      ['depends_on -> service.payments', 1]
    ])
    expect(parseMemoryFile(composed?.raw ?? '', PATH).document?.title).toBe('Checkout')
  })

  it('gives a new document the fallback title when the change names none, and its provenance', () => {
    const composed = composeDocument(null, { ...checkout, title: undefined, provenance: { authority: 'inferred' } }, 'Checkout service')
    expect(composed?.raw).toContain('title: Checkout service\nprovenance:\n  authority: inferred\n')
  })

  it('adds nothing for evidence a document already holds, from another session or time', () => {
    const first = composeDocument(null, checkout, 'unused')
    const again = composeDocument(first?.raw ?? '', { ...checkout, evidence: checkout.evidence.map((e) => ({ ...e, session: 'req-2', observedAt: '2026-12-01' })) }, 'unused')
    expect(again?.added).toBe(0)
    expect(again?.evidence).toEqual([])
    expect(sameMeaning(first?.raw ?? '', again?.raw ?? '', PATH)).toBe(true)
  })

  it('merges into an existing document, keeping its comments and layout, appending only new evidence', () => {
    const existing = [
      '---',
      '# kept: a comment',
      'id: service.checkout',
      'type: service',
      'title: Checkout',
      'attributes: { tier: standard, language: go }',
      'evidence:',
      '  - source: manifest',
      '    path: go.mod',
      '---',
      'The checkout service.',
      ''
    ].join('\n')
    const change: ResourceChange = {
      id: 'service.checkout',
      type: 'service',
      attributes: { tier: 'critical' },
      evidence: stamp({ source: 'human', note: 'confirmed' }),
      links: [{ rel: 'owned_by', target: 'team.commerce', attributes: { since: 2024 }, evidence: stamp({ source: 'human' }) }]
    }
    const composed = composeDocument(existing, change, 'unused')
    expect(composed?.added).toBe(2)
    expect(composed?.raw).toBe(
      [
        '---',
        '# kept: a comment',
        'id: service.checkout',
        'type: service',
        'title: Checkout',
        // Rendered without flow padding, as every composed document is.
        'attributes: {tier: critical, language: go}',
        'evidence:',
        '  - source: manifest',
        '    path: go.mod',
        '  - source: human',
        '    note: confirmed',
        `    observedAt: ${NOW.toISOString()}`,
        '    observedBy: ci-bot (token tok_8f3a…)',
        '    session: req-1',
        'links:',
        '  - rel: owned_by',
        '    target: team.commerce',
        '    attributes:',
        '      since: 2024',
        '    evidence:',
        '      - source: human',
        `        observedAt: ${NOW.toISOString()}`,
        '        observedBy: ci-bot (token tok_8f3a…)',
        '        session: req-1',
        '---',
        'The checkout service.',
        ''
      ].join('\n')
    )
  })

  it('refuses frontmatter it cannot update', () => {
    expect(composeDocument('no frontmatter here\n', checkout, 'unused')).toBeNull()
    expect(composeDocument('---\n- a list\n---\n', checkout, 'unused')).toBeNull()
  })
})

describe('the document text', () => {
  it('splits into frontmatter and body, and renders back with one trailing newline', () => {
    const parts = splitDocument('---\nid: a.b\n---\n\n\nBody.  \n\n')
    expect(parts?.frontmatter.toJS()).toEqual({ id: 'a.b' })
    expect(parts?.body).toBe('\n\nBody.  \n\n')
    expect(renderDocument(parts!.frontmatter, parts!.body)).toBe('---\nid: a.b\n---\nBody.\n')
    expect(renderDocument({ id: 'a.b' }, '')).toBe('---\nid: a.b\n---\n')
    expect(splitDocument('---\nid: a.b\n')).toBeNull()
  })

  it('says two texts mean the same whatever their layout, but not when the body differs', () => {
    const a = '---\nid: service.x\ntype: service\ntitle: X\nattributes: { tier: critical }\n---\nBody.\n'
    const b = '---\nid: service.x\ntype: service\ntitle: X\nattributes:\n  tier: critical\n---\n\nBody.\n'
    expect(sameMeaning(a, b, '.docket/resources/service/x.md')).toBe(true)
    expect(sameMeaning(a, b.replace('Body.', 'Other.'), '.docket/resources/service/x.md')).toBe(false)
  })

  it('appends notes under a dated heading, after a rule when there is a body already', () => {
    expect(appendedNotes('---\nid: a.b\n---\nWhat it is.\n', '  New notes.  ', NOW)).toBe(
      `What it is.\n\n---\n\n### Notes added ${NOW.toISOString()}\n\nNew notes.`
    )
    expect(appendedNotes(undefined, 'First notes.', NOW)).toBe(`### Notes added ${NOW.toISOString()}\n\nFirst notes.`)
    expect(appendedNotes('---\nid: a.b\n---\n', 'First notes.', NOW)).toBe(`### Notes added ${NOW.toISOString()}\n\nFirst notes.`)
  })
})
