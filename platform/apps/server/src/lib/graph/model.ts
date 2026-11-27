// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the graph browser needs from docket-ui's `src/lib/model.ts`: type
 * colours, link lookups and evidence formatting, unchanged, so the cloud's
 * board reads like `docket open`.
 */
import type { UiEdge, UiEntity, UiGraph } from '@chrisjowen/docket/open/types'

export type { UiEdge, UiEntity, UiGraph }
export type UiEvidence = Record<string, unknown>

/** Hand-picked categorical slots; types past these get generated colours. */
export const SERIES_SLOTS = 8

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export const countBy = <T>(items: readonly T[], key: (item: T) => string): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return counts
}

/**
 * One slot per type, by how many entities have it - most common first - so a
 * type keeps its colour however the view is filtered.
 */
export const typeSlots = (entities: readonly Pick<UiEntity, 'type'>[]): Map<string, number> => {
  const ordered = [...countBy(entities, (entity) => entity.type).entries()].sort(([a, x], [b, y]) => y - x || compare(a, b))
  return new Map(ordered.map(([type], index) => [type, index + 1]))
}

/** Hue bands the palette leaves free, so a generated colour never passes for a palette one. */
const FREE_HUES: readonly (readonly [number, number])[] = [
  [175, 240],
  [300, 340],
  [95, 130],
]
const FREE_WIDTH = FREE_HUES.reduce((sum, [from, to]) => sum + to - from, 0)
const GOLDEN = 0.618034
const LIGHTNESS_STEPS = [0, 0.1, -0.08] as const

const freeHue = (index: number): number => {
  let offset = ((index * GOLDEN + 0.25) % 1) * FREE_WIDTH
  for (const [from, to] of FREE_HUES) {
    if (offset < to - from) return from + offset
    offset -= to - from
  }
  return FREE_HUES[0]?.[0] ?? 0
}

/** A slot's colour: the palette's first eight, then generated hues that never cycle. */
export const slotColour = (slot: number | undefined): string => {
  if (!slot) return 'var(--graph-other)'
  if (slot <= SERIES_SLOTS) return `var(--series-${slot})`
  const index = slot - SERIES_SLOTS - 1
  const step = LIGHTNESS_STEPS[index % LIGHTNESS_STEPS.length] ?? 0
  const lightness = step === 0 ? 'var(--series-generated-l)' : `calc(var(--series-generated-l) + ${step})`
  return `oklch(${lightness} var(--series-generated-c) ${freeHue(index).toFixed(1)})`
}

export const edgeKey = (edge: Pick<UiEdge, 'source' | 'rel' | 'target'>): string => `${edge.source}\u0000${edge.rel}\u0000${edge.target}`

/** An entity's own links and the links pointing at it. */
export const linksOf = (graph: UiGraph, id: string): { outgoing: UiEdge[]; incoming: UiEdge[] } => ({
  outgoing: graph.edges.filter((edge) => edge.source === id),
  incoming: graph.edges.filter((edge) => edge.target === id),
})

/** The entity and everything one link away, either direction. */
export const neighbourhood = (edges: readonly Pick<UiEdge, 'source' | 'target'>[], id: string): Set<string> => {
  const ids = new Set([id])
  for (const edge of edges) {
    if (edge.source === id) ids.add(edge.target)
    if (edge.target === id) ids.add(edge.source)
  }
  return ids
}

/** Where an observation points, in one line: `src/a.ts:12-40 · handler`, `GET /v1/orders`. */
export const evidenceLocation = (evidence: UiEvidence): string => {
  const text = (key: string): string => (typeof evidence[key] === 'string' ? (evidence[key] as string) : '')
  const file = text('path') ? `${text('path')}${text('lines') ? `:${text('lines')}` : ''}` : ''
  const endpoint = [text('method'), text('endpoint')].filter(Boolean).join(' ')
  return [text('repository'), file, text('symbol'), text('key'), endpoint].filter(Boolean).join(' · ')
}

/** Fields `evidenceLocation`, the URL list and the byline already show. */
export const EVIDENCE_SHOWN = new Set([
  'source',
  'repository',
  'path',
  'lines',
  'symbol',
  'key',
  'method',
  'endpoint',
  'urls',
  'observedAt',
  'observedBy',
  'note',
])

const BASIS_LABEL: Record<string, string> = {
  evidence: 'from evidence',
  stated: 'stated in the file',
  unevidenced: 'default - no evidence',
}

export const basisLabel = (basis: string): string => BASIS_LABEL[basis] ?? basis

/** The exhibit's `summary` from its frontmatter, when it has a non-empty one. */
export const summaryOf = (entity: Pick<UiEntity, 'frontmatter'>): string | null => {
  const summary = entity.frontmatter.summary
  return typeof summary === 'string' && summary.trim() ? summary.trim() : null
}

/** Where an exhibit stands when it has gone out of date: what replaces it now, until when it held, and why. */
export interface Superseded {
  /** The record that replaced it. */
  by: string
  /** The current record: the replacement's replacement, when that was superseded since. */
  current: string
  until: string | null
  reason: string | null
  source: string | null
  recordedBy: string | null
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

/** The exhibit's supersession, from the fields the graph reads it into its frontmatter as; null while it is current. */
export const supersededOf = (entity: Pick<UiEntity, 'frontmatter'>): Superseded | null => {
  const by = text(entity.frontmatter.superseded_by)
  if (!by) return null
  return {
    by,
    current: text(entity.frontmatter.superseded_current) ?? by,
    until: text(entity.frontmatter.superseded_until),
    reason: text(entity.frontmatter.superseded_reason),
    source: text(entity.frontmatter.superseded_source),
    recordedBy: text(entity.frontmatter.superseded_recorded_by),
  }
}

/** The records the exhibit replaced. */
export const supersedesOf = (entity: Pick<UiEntity, 'frontmatter'>): string[] => {
  const older = entity.frontmatter.supersedes
  return Array.isArray(older) ? older.filter((id): id is string => typeof id === 'string') : []
}

/** A link-ish string worth making clickable. */
export const isUrl = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\/\S+$/.test(value)

/** The board's subset: visible types and relationships, with or without unresolved targets. */
export function visible(
  graph: Pick<UiGraph, 'entities' | 'edges'>,
  hiddenTypes: ReadonlySet<string>,
  hiddenRels: ReadonlySet<string>,
  showUnresolved: boolean,
): { nodes: { id: string; title: string; type: string; ghost: boolean }[]; links: { key: string; source: string; target: string; rel: string }[] } {
  const shown = graph.entities.filter((entity) => !hiddenTypes.has(entity.type))
  const ids = new Set(shown.map((entity) => entity.id))
  const known = new Set(graph.entities.map((entity) => entity.id))
  const ghosts = new Set<string>()
  const links = graph.edges.flatMap((edge) => {
    if (hiddenRels.has(edge.rel) || !ids.has(edge.source)) return []
    if (!known.has(edge.target)) {
      if (!showUnresolved) return []
      ghosts.add(edge.target)
    } else if (!ids.has(edge.target)) return []
    return [{ key: edgeKey(edge), source: edge.source, target: edge.target, rel: edge.rel }]
  })
  return {
    nodes: [
      ...shown.map((entity) => ({ id: entity.id, title: entity.title, type: entity.type, ghost: false })),
      ...[...ghosts].map((id) => ({ id, title: id, type: '', ghost: true })),
    ],
    links,
  }
}
