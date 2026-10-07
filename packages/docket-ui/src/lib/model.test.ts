import { describe, expect, it } from 'vitest'

import { blocks, evidenceLocation, inline, neighbourhood, parseQuery, quickSearch, typeSlots } from './model.js'
import type { UiEntity, UiGraph } from './types.js'

const entity = (id: string, overrides: Partial<UiEntity> = {}): UiEntity => ({
  id,
  type: id.split('.')[0] ?? 'thing',
  title: id,
  path: `.docket/${id}.md`,
  paths: [`.docket/${id}.md`],
  tags: [],
  attributes: {},
  links: [],
  mentions: [],
  content: '',
  evidence: [],
  frontmatter: {},
  ...overrides
})

const GRAPH: UiGraph = {
  project: { name: 'acme', root: '/acme' },
  entities: [
    entity('service.orders', { title: 'Orders API', tags: ['core'], content: 'Writes every order to the ledger.' }),
    entity('service.checkout', { title: 'Checkout', attributes: { language: 'typescript' } }),
    entity('team.payments', { title: 'Payments' }),
    entity('datasource.ledger', { title: 'Ledger' })
  ],
  edges: [
    { source: 'service.orders', rel: 'owned_by', target: 'team.payments', dangling: false },
    { source: 'service.orders', rel: 'depends_on', target: 'datasource.ledger', dangling: false },
    { source: 'service.checkout', rel: 'depends_on', target: 'service.orders', dangling: false }
  ],
  types: [],
  relationships: [],
  diagnostics: [],
  index: { synced: true, behind: 0 }
}

const ids = (text: string): string[] =>
  quickSearch(GRAPH, text).map((result) =>
    result.kind === 'entity' ? result.entity.id : `${result.edge.source} ${result.edge.rel} ${result.edge.target}`
  )

describe('quickSearch', () => {
  it('finds entities as you type, title and id matches first', () => {
    expect(ids('ord')[0]).toBe('service.orders')
    expect(ids('payments')[0]).toBe('team.payments')
    expect(ids('typescript')).toEqual(['service.checkout'])
  })

  it('needs every word to match somewhere', () => {
    expect(ids('orders ledger')[0]).toBe('service.orders')
    expect(ids('orders nonsense')).toEqual([])
  })

  it('says when a match came from the body, with the words around it', () => {
    const [hit] = quickSearch(GRAPH, 'every')
    expect(hit).toMatchObject({ kind: 'entity', field: 'body' })
    expect(hit?.kind === 'entity' && hit.snippet).toContain('Writes every order')
  })

  it('builds the body snippet from the word that matched the body best', () => {
    const graph: UiGraph = {
      ...GRAPH,
      entities: [entity('service.orders', { attributes: { language: 'typescript' }, content: 'Bookkeeping runs nightly.' })],
      edges: []
    }
    const [hit] = quickSearch(graph, 'script bookkeeping')
    expect(hit).toMatchObject({ kind: 'entity', field: 'body' })
    expect(hit?.kind === 'entity' && hit.snippet).toContain('Bookkeeping runs nightly')
  })

  it('finds relationships by name and by the entities they join', () => {
    expect(ids('depends')).toEqual([
      'service.checkout depends_on service.orders',
      'service.orders depends_on datasource.ledger'
    ])
    expect(ids('rel:owned')).toEqual(['service.orders owned_by team.payments'])
    expect(ids('rel:depends ledger')).toEqual(['service.orders depends_on datasource.ledger'])
  })

  it('narrows by type and tag without free words', () => {
    expect(ids('type:service').sort()).toEqual(['service.checkout', 'service.orders'])
    expect(ids('tag:core')).toEqual(['service.orders'])
    expect(ids('type:team payments')).toEqual(['team.payments', 'service.orders owned_by team.payments'])
  })

  it('returns nothing for an empty query', () => {
    expect(ids('   ')).toEqual([])
    expect(parseQuery('type: rel:x Foo')).toEqual({ type: [], rel: ['x'], tag: [], words: ['foo'] })
  })
})

describe('typeSlots', () => {
  it('colours the commonest types first, and never cycles past the palette', () => {
    const many = Array.from({ length: 10 }, (_, index) => entity(`t${index}.x`, { type: `t${index}` }))
    const slots = typeSlots([...many, entity('t9.y', { type: 't9' })])
    expect(slots.get('t9')).toBe(1)
    expect(slots.get('t0')).toBe(2)
    expect([...slots.values()].filter((slot) => slot === null)).toHaveLength(2)
  })
})

describe('neighbourhood', () => {
  it('is the entity and everything one link away', () => {
    expect([...neighbourhood(GRAPH.edges, 'service.orders')].sort()).toEqual([
      'datasource.ledger',
      'service.checkout',
      'service.orders',
      'team.payments'
    ])
  })
})

describe('evidenceLocation', () => {
  it('says where an observation points in one line', () => {
    expect(evidenceLocation({ source: 'code', path: 'src/a.ts', lines: '12-40', symbol: 'handler' })).toBe('src/a.ts:12-40 · handler')
    expect(evidenceLocation({ source: 'api', method: 'GET', endpoint: '/v1/orders' })).toBe('GET /v1/orders')
  })

})

describe('blocks', () => {
  it('reads headings, wrapped paragraphs, lists and code as data', () => {
    const parsed = blocks('# Orders\n\nOwns the order\nlifecycle. See [[team.a]].\n\n- one `x`\n- two\n  continued\n\n```\n<b>raw</b>\n```\n')
    expect(parsed).toEqual([
      { kind: 'heading', level: 1, text: [{ kind: 'text', text: 'Orders' }] },
      {
        kind: 'paragraph',
        text: [
          { kind: 'text', text: 'Owns the order lifecycle. See ' },
          { kind: 'mention', id: 'team.a' },
          { kind: 'text', text: '.' }
        ]
      },
      {
        kind: 'list',
        items: [
          [{ kind: 'text', text: 'one ' }, { kind: 'code', text: 'x' }],
          [{ kind: 'text', text: 'two continued' }]
        ]
      },
      { kind: 'code', text: '<b>raw</b>' }
    ])
  })

  it('links URLs, with or without a label', () => {
    expect(inline('see [docs](https://x.dev/a) or https://y.dev/b.')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'docs', href: 'https://x.dev/a' },
      { kind: 'text', text: ' or ' },
      { kind: 'link', text: 'https://y.dev/b', href: 'https://y.dev/b' },
      { kind: 'text', text: '.' }
    ])
  })
})
