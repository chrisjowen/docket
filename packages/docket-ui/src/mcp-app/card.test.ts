import { describe, expect, it } from 'vitest'

import { RESOURCE_SCHEMA } from '../../../docket/src/mcp/surface/results.js'
import { SEARCH_SCHEMA } from '../../../docket/src/mcp/types.js'
import { cardOf, leadOf, linksByRel, notesOf, sourcesOf, type CardLink } from './card.js'

const link = (rel: string, target: string): CardLink => ({ rel, target, confidence: 0.5, basis: 'unevidenced', evidence: [] })

describe('cardOf', () => {
  it("takes docket_get's result and nothing else", () => {
    const card = { schema: RESOURCE_SCHEMA, id: 'service.orders', viewer: null, resource: null, documents: [], history: [], diagnostics: [] }
    expect(cardOf(card)).toBe(card)
    expect(cardOf({ schema: SEARCH_SCHEMA })).toBeNull()
    expect(cardOf(null)).toBeNull()
    expect(cardOf('docket-resource.v1')).toBeNull()
  })
})

describe('notesOf', () => {
  it('drops a first heading that restates the title', () => {
    expect(notesOf('# Orders API\n\nTakes orders.', 'Orders API')).toBe('Takes orders.')
    expect(notesOf('\n# docket open serves /mcp\n\nIt does.', 'docket open serves /mcp, with an app')).toBe('It does.')
  })

  it('keeps any other heading', () => {
    expect(notesOf('# History\n\nIt moved.', 'Orders API')).toBe('# History\n\nIt moved.')
    expect(notesOf('## Orders API\n\nIt moved.', 'Orders API')).toBe('## Orders API\n\nIt moved.')
  })
})

describe('leadOf', () => {
  it('keeps short notes whole', () => {
    expect(leadOf('One paragraph.\n\nAnother.')).toEqual({ lead: 'One paragraph.\n\nAnother.', more: false })
  })

  it('keeps whole paragraphs until the lead is long enough', () => {
    const long = 'x'.repeat(30)
    expect(leadOf(`${long}\n\n${long}\n\nlast`, 50)).toEqual({ lead: `${long}\n\n${long}`, more: true })
  })

  it('never cuts a code block in two', () => {
    const body = `${'x'.repeat(60)}\n\n\`\`\`\nfirst\n\nsecond\n\`\`\`\n\nafter\n\nend`
    const { lead, more } = leadOf(body, 50)
    expect(lead).toBe(`${'x'.repeat(60)}`)
    expect(more).toBe(true)
    expect(leadOf(`intro\n\n\`\`\`\nfirst\n\nsecond\n\`\`\`\n\nafter`, 10).lead).toBe('intro\n\n```\nfirst\n\nsecond\n```')
  })
})

describe('sourcesOf', () => {
  it('counts each kind of source once, most cited first', () => {
    expect(sourcesOf([{ source: 'docs' }, { source: 'code' }, { source: 'code' }, { note: 'no source' }])).toEqual([
      { source: 'code', count: 2 },
      { source: 'docs', count: 1 }
    ])
  })
})

describe('linksByRel', () => {
  it('groups links by relationship in the order they are declared', () => {
    const links = [link('depends_on', 'a'), link('owned_by', 'b'), link('depends_on', 'c')]
    expect(linksByRel(links).map(([rel, each]) => [rel, each.map((item) => item.target)])).toEqual([
      ['depends_on', ['a', 'c']],
      ['owned_by', ['b']]
    ])
  })
})
