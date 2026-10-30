import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { init } from '../commands/init.js'
import { search } from '../commands/search.js'
import { sync } from '../commands/sync.js'
import { MAX_NODES, searchGraph, searchText } from './search.js'

const FAKE_SUBGRAPH = fileURLToPath(new URL('../../test/fixtures/adapters/fake-subgraph.mjs', import.meta.url))

const resource = (id: string, type: string, title: string, links: [string, string][] = []): string =>
  `---\nid: ${id}\ntype: ${type}\ntitle: ${title}\n` +
  (links.length > 0 ? `links:\n${links.map(([rel, target]) => `  - rel: ${rel}\n    target: ${target}`).join('\n')}\n` : '') +
  `---\n\n${title}.\n`

let root: string

const write = async (path: string, contents: string): Promise<void> => {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

/** Query adapters answering with the given configs, beside a projection that does not answer. */
const configure = async (adapters: Record<string, unknown>): Promise<void> => {
  const entries = Object.entries(adapters)
    .map(([id, config]) => `  - id: ${id}\n    module: ./tools/fake-subgraph.mjs\n    roles: [query]\n    config: ${JSON.stringify(config)}\n`)
    .join('')
  await write(
    join(root, '.docket.yaml'),
    `version: 2\nadapters:\n  - id: local\n    module: "@docket/adapter-jsonl"\n    roles: [projection]\n    config: { output: .docket/.index }\n${entries}query:\n  synthesis: false\n`
  )
}

// The scout report's scratch case: the adapter walked orders -> ledger -> ledger-db.
const TRAVERSAL = {
  note: 'fake native 2-hop DEPENDS_ON traversal',
  matches: ['service.orders'],
  graph: {
    nodes: [
      { id: 'o', label: 'Orders API', ref: { kind: 'entity', id: 'service.orders' } },
      { id: 'l', label: 'Ledger', ref: { kind: 'entity', id: 'service.ledger' } },
      { id: 'd', label: 'Ledger DB', ref: { kind: 'entity', id: 'datasource.ledger-db' } }
    ],
    edges: [
      { source: 'o', target: 'l', rel: 'depends_on', confidence: 0.9, evidenceIds: ['e1'] },
      { source: 'l', target: 'd', rel: 'depends_on', evidenceIds: ['e1'] }
    ],
    paths: [['o', 'l', 'd']]
  },
  evidence: [{ id: 'e1', text: 'Orders posts to the ledger, which writes to ledger-db.', refs: ['service.orders'] }]
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-search-'))
  await init({ cwd: root })
  await mkdir(join(root, 'tools'), { recursive: true })
  await copyFile(FAKE_SUBGRAPH, join(root, 'tools', 'fake-subgraph.mjs'))
  await write(
    join(root, '.docket/resources/services/orders.md'),
    resource('service.orders', 'service', 'Orders API', [
      ['owned_by', 'team.payments'],
      ['depends_on', 'service.ledger']
    ])
  )
  await write(join(root, '.docket/resources/services/ledger.md'), resource('service.ledger', 'service', 'Ledger', [['depends_on', 'datasource.ledger-db']]))
  await write(join(root, '.docket/resources/teams/payments.md'), resource('team.payments', 'team', 'Payments'))
  await write(join(root, '.docket/resources/datasources/ledger-db.md'), resource('datasource.ledger-db', 'datasource', 'Ledger DB'))
  await configure({ graphy: TRAVERSAL })
  await sync({ cwd: root })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('search', () => {
  it("carries each projection's subgraph in canonical terms, with the evidence its edges cite", async () => {
    const result = await search('orders', { cwd: root })
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.graph).toEqual({
      nodes: [
        { id: 'service.orders', label: 'Orders API', type: 'service', canonical: true },
        { id: 'service.ledger', label: 'Ledger', type: 'service', canonical: true },
        { id: 'datasource.ledger-db', label: 'Ledger DB', type: 'datasource', canonical: true }
      ],
      edges: [
        { source: 'service.orders', rel: 'depends_on', target: 'service.ledger', confidence: 0.9, why: ['Orders posts to the ledger, which writes to ledger-db.'] },
        { source: 'service.ledger', rel: 'depends_on', target: 'datasource.ledger-db', why: ['Orders posts to the ledger, which writes to ledger-db.'] }
      ],
      paths: [['service.orders', 'service.ledger', 'datasource.ledger-db']]
    })
  })

  it('carries no graph for a projection that returned none', async () => {
    await configure({ graphy: { matches: ['service.orders'] } })
    const result = await search('orders', { cwd: root })
    expect(result.sources[0]).not.toHaveProperty('graph')
  })
})

describe('searchGraph', () => {
  it("draws the adapter's 2-hop path at full strength and an unrelated canonical neighbour as context", async () => {
    const found = await searchGraph({ cwd: root, query: 'orders' })
    expect(found.matches.map((match) => match.id)).toEqual(['service.orders'])

    const nodes = new Map(found.nodes.map((node) => [node.id, node]))
    expect([...nodes.keys()]).toEqual(['service.orders', 'service.ledger', 'datasource.ledger-db', 'team.payments'])
    expect(nodes.get('service.orders')).toMatchObject({ match: true, via: 'adapter' })
    // The adapter's traversal reached ledger-db: it stays on the board.
    expect(nodes.get('datasource.ledger-db')).toMatchObject({ match: false, ghost: false, via: 'adapter', title: 'Ledger DB', path: '.docket/resources/datasources/ledger-db.md' })
    expect(nodes.get('service.ledger')).toMatchObject({ match: false, via: 'adapter' })
    // The adapter never returned payments: it is canonical context, one link away.
    expect(nodes.get('team.payments')).toMatchObject({ match: false, via: 'canonical' })

    expect(found.links).toEqual([
      {
        source: 'service.orders',
        rel: 'depends_on',
        target: 'service.ledger',
        via: 'adapter',
        foundBy: ['graphy'],
        confidence: 0.9,
        why: ['Orders posts to the ledger, which writes to ledger-db.']
      },
      {
        source: 'service.ledger',
        rel: 'depends_on',
        target: 'datasource.ledger-db',
        via: 'adapter',
        foundBy: ['graphy'],
        why: ['Orders posts to the ledger, which writes to ledger-db.']
      },
      { source: 'service.orders', rel: 'owned_by', target: 'team.payments', via: 'canonical' }
    ])
    expect(found.paths).toEqual([{ nodes: ['service.orders', 'service.ledger', 'datasource.ledger-db'], foundBy: ['graphy'] }])
    expect(found.sources).toEqual([{ name: 'graphy', hits: 1, note: 'fake native 2-hop DEPENDS_ON traversal' }])

    const text = searchText(found)
    expect(text).toContain('links: depends_on -> service.ledger (graphy, confidence 0.9); owned_by -> team.payments')
    expect(text).toContain('Also returned by the projections: service.ledger "Ledger", datasource.ledger-db "Ledger DB".')
    expect(text).toContain('- service.orders -depends_on-> service.ledger -depends_on-> datasource.ledger-db (graphy)')
    expect(text).toContain('- service.ledger -depends_on-> datasource.ledger-db (graphy)\n  why: Orders posts to the ledger, which writes to ledger-db.')
    expect(text).toContain('One link away: team.payments "Payments".')
  })

  it('keeps the canonical board, as before, for adapters that return no subgraph', async () => {
    await configure({ graphy: { matches: ['service.orders'] } })
    const found = await searchGraph({ cwd: root, query: 'orders' })
    expect(found.nodes.map((node) => [node.id, node.via])).toEqual([
      ['service.orders', 'adapter'],
      ['team.payments', 'canonical'],
      ['service.ledger', 'canonical']
    ])
    expect(found.links).toEqual([
      { source: 'service.orders', rel: 'owned_by', target: 'team.payments', via: 'canonical' },
      { source: 'service.orders', rel: 'depends_on', target: 'service.ledger', via: 'canonical' }
    ])
    expect(found.paths).toEqual([])
    expect(searchText(found)).not.toContain('Paths the projections returned')
  })

  it('draws a returned relationship the files do not declare, and a returned node no file defines as a ghost', async () => {
    await configure({
      graphy: {
        matches: ['team.payments'],
        graph: {
          nodes: [
            { id: 'p', label: 'Payments', ref: { kind: 'entity', id: 'team.payments' } },
            { id: 'q', label: 'Settlement queue', type: 'queue' },
            // No ref: an id that happens to be a canonical entity's is not claimed for it.
            { id: 'service.ledger', label: 'a ledger' }
          ],
          edges: [
            { source: 'p', target: 'q', rel: 'operates' },
            { source: 'q', target: 'service.ledger', rel: 'feeds' }
          ]
        }
      }
    })
    const found = await searchGraph({ cwd: root, query: 'payments' })
    const nodes = new Map(found.nodes.map((node) => [node.id, node]))
    expect(nodes.get('q')).toEqual({ id: 'q', type: 'queue', title: 'Settlement queue', match: false, ghost: true, via: 'adapter' })
    expect(nodes.get('graphy:service.ledger')).toMatchObject({ title: 'a ledger', ghost: true, via: 'adapter' })
    expect(nodes.get('service.orders')).toMatchObject({ via: 'canonical' })
    expect(found.links).toEqual([
      { source: 'team.payments', rel: 'operates', target: 'q', via: 'adapter', foundBy: ['graphy'] },
      { source: 'q', rel: 'feeds', target: 'graphy:service.ledger', via: 'adapter', foundBy: ['graphy'] },
      { source: 'service.orders', rel: 'owned_by', target: 'team.payments', via: 'canonical' }
    ])
  })

  it('merges a relationship two projections returned, keeping who found it, the highest confidence and every why', async () => {
    const second = {
      matches: ['service.orders'],
      graph: {
        nodes: [
          { id: 'a', label: 'Orders', ref: { kind: 'entity', id: 'service.orders' } },
          { id: 'b', label: 'Ledger', ref: { kind: 'entity', id: 'service.ledger' } }
        ],
        edges: [{ source: 'a', target: 'b', rel: 'depends_on', confidence: 0.95, evidenceIds: ['x'] }],
        paths: [['a', 'b']]
      },
      evidence: [{ id: 'x', text: 'Seen at runtime.' }]
    }
    await configure({ graphy: TRAVERSAL, other: second })
    const found = await searchGraph({ cwd: root, query: 'orders' })
    expect(found.links[0]).toEqual({
      source: 'service.orders',
      rel: 'depends_on',
      target: 'service.ledger',
      via: 'adapter',
      foundBy: ['graphy', 'other'],
      confidence: 0.95,
      why: ['Orders posts to the ledger, which writes to ledger-db.', 'Seen at runtime.']
    })
    expect(found.matches[0]?.foundBy).toEqual(['graphy', 'other'])
    expect(found.paths).toEqual([
      { nodes: ['service.orders', 'service.ledger', 'datasource.ledger-db'], foundBy: ['graphy'] },
      { nodes: ['service.orders', 'service.ledger'], foundBy: ['other'] }
    ])
  })

  it('fills the board with returned nodes before canonical neighbours', async () => {
    const links = Array.from({ length: MAX_NODES + 5 }, (_, index) => `  - rel: uses\n    target: lib.l${index}`).join('\n')
    await write(join(root, '.docket/resources/services/hub.md'), `---\nid: service.hub\ntype: service\ntitle: Hub\nlinks:\n${links}\n---\n\nThe hub.\n`)
    await configure({
      graphy: {
        matches: ['service.hub'],
        graph: {
          nodes: [
            { id: 'h', label: 'Hub', ref: { kind: 'entity', id: 'service.hub' } },
            { id: 'd', label: 'Ledger DB', ref: { kind: 'entity', id: 'datasource.ledger-db' } }
          ],
          edges: [{ source: 'h', target: 'd', rel: 'reads' }]
        }
      }
    })
    await sync({ cwd: root })
    const found = await searchGraph({ cwd: root, query: 'hub' })
    expect(found.nodes).toHaveLength(MAX_NODES)
    expect(found.nodes.slice(0, 2).map((node) => [node.id, node.via])).toEqual([
      ['service.hub', 'adapter'],
      ['datasource.ledger-db', 'adapter']
    ])
    expect(found.omitted).toBe(MAX_NODES + 5 - (MAX_NODES - 2))
  })
})
