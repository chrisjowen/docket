// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { slotColour, summaryOf, supersededOf, supersedesOf, typeSlots, visible, type UiGraph } from './model'

const entity = (id: string, type: string) =>
  ({ id, type, title: id, path: '', paths: [], tags: [], attributes: {}, links: [], mentions: [], content: '', evidence: [], frontmatter: {} }) as UiGraph['entities'][number]
const edge = (source: string, rel: string, target: string, dangling = false) => ({ source, rel, target, dangling })

const graph = {
  project: { name: 'p', root: '/' },
  entities: [entity('service.a', 'service'), entity('service.b', 'service'), entity('team.t', 'team')],
  edges: [edge('service.a', 'depends_on', 'service.b'), edge('service.a', 'owned_by', 'team.t'), edge('service.b', 'uses', 'system.gone', true)],
  types: [],
  relationships: [],
  diagnostics: [],
  index: { synced: true, behind: 0 },
} satisfies UiGraph

describe('the board', () => {
  it('shows every entity, and unresolved targets as ghosts', () => {
    const board = visible(graph, new Set(), new Set(), true)
    expect(board.nodes.map((node) => [node.id, node.ghost])).toEqual([
      ['service.a', false],
      ['service.b', false],
      ['team.t', false],
      ['system.gone', true],
    ])
    expect(board.links).toHaveLength(3)
  })

  it('drops a hidden type with its links, a hidden relationship, and ghosts when asked', () => {
    const board = visible(graph, new Set(['team']), new Set(['depends_on']), false)
    expect(board.nodes.map((node) => node.id)).toEqual(['service.a', 'service.b'])
    expect(board.links).toEqual([])
  })

  it('colours types by how common they are, the same however the board is filtered', () => {
    const slots = typeSlots(graph.entities)
    expect(slots.get('service')).toBe(1)
    expect(slotColour(slots.get('team'))).toBe('var(--series-2)')
    expect(slotColour(undefined)).toBe('var(--graph-other)')
    expect(slotColour(12)).toMatch(/^oklch\(/)
  })
})

describe('an exhibit’s summary', () => {
  it('reads the summary from the frontmatter', () => {
    expect(summaryOf({ frontmatter: { summary: '  Alice Hong sent Chris an email.\n' } })).toBe('Alice Hong sent Chris an email.')
  })

  it('has none without a non-empty text summary', () => {
    expect(summaryOf({ frontmatter: {} })).toBeNull()
    expect(summaryOf({ frontmatter: { summary: '   ' } })).toBeNull()
    expect(summaryOf({ frontmatter: { summary: { text: 'x' } } })).toBeNull()
  })
})

describe('an exhibit gone out of date', () => {
  it('says what replaced it, the record current now, since when and why', () => {
    const frontmatter = {
      superseded_by: 'agent.captin',
      superseded_until: '2026-11-01',
      superseded_reason: 'The Muse bot was renamed from Sophia to Captin.',
      superseded_source: 'consolidation',
      superseded_recorded_by: 'docket-cloud consolidation',
    }
    expect(supersededOf({ frontmatter })).toEqual({
      by: 'agent.captin',
      current: 'agent.captin',
      until: '2026-11-01',
      reason: 'The Muse bot was renamed from Sophia to Captin.',
      source: 'consolidation',
      recordedBy: 'docket-cloud consolidation',
    })
    expect(supersededOf({ frontmatter: { ...frontmatter, superseded_current: 'agent.cap' } })?.current).toBe('agent.cap')
  })

  it('is current without a replacement, and a replacement lists what it supersedes', () => {
    expect(supersededOf({ frontmatter: {} })).toBeNull()
    expect(supersededOf({ frontmatter: { superseded_by: ' ' } })).toBeNull()
    expect(supersedesOf({ frontmatter: { supersedes: ['agent.sophia', 3] } })).toEqual(['agent.sophia'])
    expect(supersedesOf({ frontmatter: {} })).toEqual([])
  })
})
