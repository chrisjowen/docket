// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The graph tab's other views of the same canonical graph (docket-ui's
 * `browse.ts`, extended): every fact with its confidence and sources, a
 * timeline of what the documents date and what the activity log records, and
 * each document's evidence trail. Everything here reads the graph the page
 * loaded from the canonical documents - never an index.
 */
import { DEFAULT_BANDS, bandOf as trustBand, type Band as TrustBand, type Bands } from '$lib/trust/bands'

import { evidenceLocation, type UiEdge, type UiEntity, type UiEvidence, type UiGraph } from './model'

/** The day an ISO date or datetime falls on - a YAML date arrives as midnight UTC - or undefined. */
export const dayOf = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  return /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0]
}

/** A value that is a date, `2025-03-01` or `2025-03-01T10:00:00Z`, and nothing else. */
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)

/** The confidence filter's names for the bands, as the address keeps them. */
export type Band = 'high' | 'medium' | 'low'
const FILTER_BAND: Record<TrustBand, Band> = { established: 'high', probable: 'medium', unverified: 'low' }

/** A confidence's band, in the filter's names: by the workspace's own bands, docket's defaults else. */
export const bandOf = (confidence: number, bands: Bands = DEFAULT_BANDS): Band => FILTER_BAND[trustBand(confidence, bands)]

/** The bands a graph was scored with: its ontology's, which the cloud's graph carries. */
export const bandsOf = (graph: object): Bands => (graph as { trust?: { bands?: Bands } }).trust?.bands ?? DEFAULT_BANDS

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const latest = (days: (string | undefined)[]): string | undefined =>
  days.filter((day): day is string => day !== undefined).sort().at(-1)

// --- Facts --------------------------------------------------------------------

/** One fact: an exhibit, or one relationship an exhibit states. */
export interface FactRow {
  key: string
  kind: 'exhibit' | 'link'
  /** The exhibit, or the one the relationship is from. */
  entity: UiEntity
  link?: { rel: string; target: string }
  /** Source kinds behind it: the assessment's, else its evidence's. */
  sources: string[]
  confidence?: number
  basis?: string
  /** Its band, by the workspace's bands: absent with nothing assessed. */
  band?: Band
  evidenceCount: number
  /** The latest day any of its evidence was observed. */
  lastObserved?: string
  /** Low confidence, or nothing but the ontology's default behind it. */
  weak: boolean
  /** Established by the workspace's bands, from evidence rather than the ontology's default. */
  strong: boolean
  /** Exactly one source kind behind it: nothing corroborates it. */
  single: boolean
}

const factOf = (
  key: string,
  kind: FactRow['kind'],
  entity: UiEntity,
  evidence: readonly UiEvidence[],
  assessment: UiEntity['assessment'],
  link: FactRow['link'] | undefined,
  bands: Bands,
): FactRow => {
  const sources = assessment?.sources.length
    ? [...assessment.sources]
    : [...new Set(evidence.map((item) => text(item.source)).filter((item): item is string => item !== undefined))].sort()
  const lastObserved = latest(evidence.map((item) => dayOf(item.observedAt)))
  return {
    key,
    kind,
    entity,
    ...(link ? { link } : {}),
    sources,
    ...(assessment ? { confidence: assessment.confidence, basis: assessment.basis, band: bandOf(assessment.confidence, bands) } : {}),
    evidenceCount: assessment?.evidenceCount ?? evidence.length,
    ...(lastObserved ? { lastObserved } : {}),
    weak: assessment ? assessment.basis === 'unevidenced' || bandOf(assessment.confidence, bands) === 'low' : evidence.length === 0,
    strong: assessment !== undefined && assessment.basis !== 'unevidenced' && bandOf(assessment.confidence, bands) === 'high',
    single: sources.length === 1,
  }
}

/** Every exhibit and every relationship, each as a fact with what stands behind it. */
export const factRows = (graph: UiGraph): FactRow[] => {
  const bands = bandsOf(graph)
  return graph.entities.flatMap((entity) => [
    factOf(entity.id, 'exhibit', entity, entity.evidence, entity.assessment, undefined, bands),
    ...entity.links.map((link, index) =>
      factOf(`${entity.id}>${index}`, 'link', entity, link.evidence ?? [], link.assessment, { rel: link.rel, target: link.target }, bands),
    ),
  ])
}

export type ConfidenceFilter = 'any' | Band | 'unevidenced'
export type FactFlag = 'all' | 'strong' | 'weak'
export type FactKind = 'all' | 'exhibit' | 'link'

export interface FactFilter {
  q: string
  kind: FactKind
  /** Empty: every type. */
  type: string
  /** Empty: every source kind. */
  source: string
  confidence: ConfidenceFilter
  flag: FactFlag
  /** Only facts with exactly one source kind behind them. */
  single: boolean
  /** Empty: every record. Else only the facts about this record: its own, its relations' and those pointing at it. */
  about: string
}

/** A fact about a record: the record itself, one of its relations, or a relation pointing at it. */
export const isAbout = (row: Pick<FactRow, 'entity' | 'link'>, id: string): boolean => row.entity.id === id || row.link?.target === id

const confident = (row: Pick<FactRow, 'band' | 'basis'>, filter: ConfidenceFilter): boolean => {
  if (filter === 'any') return true
  if (filter === 'unevidenced') return row.basis === 'unevidenced'
  return row.band !== undefined && row.basis !== 'unevidenced' && row.band === filter
}

/** Every word of `needle` somewhere in `haystack`, ignoring case. */
export const matches = (haystack: (string | undefined)[], needle: string): boolean => {
  const words = needle.toLowerCase().split(/\s+/).filter(Boolean)
  const joined = haystack.filter(Boolean).join(' ').toLowerCase()
  return words.every((word) => joined.includes(word))
}

export const filterFacts = (rows: readonly FactRow[], filter: FactFilter): FactRow[] =>
  rows.filter(
    (row) =>
      (filter.kind === 'all' || row.kind === filter.kind) &&
      (!filter.type || row.entity.type === filter.type) &&
      (!filter.source || row.sources.includes(filter.source)) &&
      confident(row, filter.confidence) &&
      (filter.flag === 'all' || row[filter.flag]) &&
      (!filter.single || row.single) &&
      (!filter.about || isAbout(row, filter.about)) &&
      matches([row.entity.id, row.entity.title, row.entity.path, row.link?.rel, row.link?.target, ...row.entity.tags], filter.q),
  )

// --- Timeline -----------------------------------------------------------------

/** A change the activity log recorded, as the graph tab reads it. */
export interface ActivityEntry {
  id: string
  /** ISO time it was recorded. */
  at: string
  channel: string
  action: string
  actorLabel: string
  outcome: string
  resourceId: string | null
  documents: { path: string; change: string; revision?: number }[]
  evidenceCount: number
  requestId: string
}

/**
 * What a timeline entry is. `decision` and `event`: a date a document records
 * for a decision or for anything else - a dated attribute, or the `eventAt` of
 * its evidence. `observed`: when evidence was seen (`observedAt`). `change`:
 * a write the activity log recorded.
 */
export type TimelineKind = 'decision' | 'event' | 'observed' | 'change'

export interface TimelineEntry {
  key: string
  kind: TimelineKind
  /** The day it is filed under. */
  day: string
  /** The full value recorded, which may carry a time. */
  at: string
  /** What dated it: an attribute's name, `eventAt`, `observedAt`, or the action. */
  field: string
  /** The exhibit it is about, when it is about one. */
  entity?: UiEntity
  link?: { rel: string; target: string }
  evidence?: UiEvidence
  change?: ActivityEntry
}

/** Frontmatter fields that are docket's own, never one of the document's dates. */
const OWN_FIELDS = new Set(['id', 'type', 'title', 'attributes', 'links', 'tags', 'evidence', 'provenance', 'aliases'])

const isDecision = (entity: UiEntity) => entity.type === 'decision'

/** Every date an exhibit's document records: its dated attributes and its other dated frontmatter fields. */
const recordedDates = (entity: UiEntity): [string, string][] => {
  const dated = new Map<string, string>()
  for (const [name, value] of Object.entries(entity.attributes)) if (isDate(value)) dated.set(name, value)
  for (const [name, value] of Object.entries(entity.frontmatter)) if (!OWN_FIELDS.has(name) && !dated.has(name) && isDate(value)) dated.set(name, value)
  return [...dated]
}

/**
 * Everything dated, newest first: what the documents date, when their
 * evidence says things happened and were seen, and what the activity log
 * records. A piece of evidence with both times appears under each: they are
 * different facts. Nothing is dated by when a file was written.
 */
export const timelineOf = (graph: UiGraph, activity: readonly ActivityEntry[]): TimelineEntry[] => {
  const entries: TimelineEntry[] = []
  for (const entity of graph.entities) {
    const kind = isDecision(entity) ? 'decision' : 'event'
    for (const [field, at] of recordedDates(entity)) {
      entries.push({ key: `${entity.id}:${field}`, kind, day: dayOf(at) ?? at, at, field, entity })
    }
    const observations = [
      ...entity.evidence.map((evidence, index) => ({ evidence, key: `${entity.id}#${index}`, link: undefined })),
      ...entity.links.flatMap((link, linkIndex) =>
        (link.evidence ?? []).map((evidence, index) => ({ evidence, key: `${entity.id}>${linkIndex}#${index}`, link: { rel: link.rel, target: link.target } })),
      ),
    ]
    for (const { evidence, key, link } of observations) {
      for (const field of ['eventAt', 'observedAt'] as const) {
        const at = text(evidence[field])
        const day = dayOf(at)
        if (!at || !day) continue
        entries.push({ key: `${key}:${field}`, kind: field === 'eventAt' ? kind : 'observed', day, at, field, entity, ...(link ? { link } : {}), evidence })
      }
    }
  }
  const byId = new Map(graph.entities.map((entity) => [entity.id, entity]))
  for (const change of activity) {
    const day = dayOf(change.at)
    if (!day) continue
    const entity = change.resourceId ? byId.get(change.resourceId) : undefined
    entries.push({ key: `change:${change.id}`, kind: 'change', day, at: change.at, field: change.action, ...(entity ? { entity } : {}), change })
  }
  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key < b.key ? -1 : 1))
}

/** What a docket entry is filed as on the docket sheet. */
export const SHEET_KINDS: Record<TimelineKind, string> = { decision: 'Ruling', event: 'Event', observed: 'Exhibit filed', change: 'Amendment' }

/** A timeline entry with its number on the docket sheet: #001 is the oldest. */
export type SheetEntry = TimelineEntry & { no: number }

/** The timeline as a numbered docket sheet, newest first, numbered oldest first. */
export const docketSheet = (entries: readonly TimelineEntry[]): SheetEntry[] => entries.map((entry, index) => ({ ...entry, no: entries.length - index }))

/** Entries grouped by day, newest day first, in the order given. */
export const byDay = <T extends { day: string }>(entries: readonly T[]): [string, T[]][] => {
  const grouped = new Map<string, T[]>()
  for (const entry of entries) grouped.set(entry.day, [...(grouped.get(entry.day) ?? []), entry])
  return [...grouped]
}

/** A record and what it replaced, newest first: `[current, superseded, superseded-before-that, …]`. */
export type SupersessionChain = string[]

/** Chains of `supersedes` relationships, each from a record nothing supersedes back to the oldest it replaced. */
export const supersessions = (edges: readonly Pick<UiEdge, 'source' | 'rel' | 'target'>[]): SupersessionChain[] => {
  const replaced = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.rel !== 'supersedes') continue
    replaced.set(edge.source, [...(replaced.get(edge.source) ?? []), edge.target])
  }
  const superseded = new Set([...replaced.values()].flat())
  const chains: SupersessionChain[] = []
  const walk = (chain: string[]): void => {
    const last = chain.at(-1) ?? ''
    const next = (replaced.get(last) ?? []).filter((id) => !chain.includes(id))
    if (next.length === 0) chains.push(chain)
    for (const id of next.sort()) walk([...chain, id])
  }
  for (const head of [...replaced.keys()].filter((id) => !superseded.has(id)).sort()) walk([head])
  return chains
}

// --- Evidence -----------------------------------------------------------------

/** A live document as the store records it: where it came from and who first wrote it. */
export interface DocumentOrigin {
  path: string
  origin: string
  originRef: string | null
  revision: number
  createdBy: string
  createdAt: string
}

/** What the timeline and evidence views read besides the graph: the activity log's newest changes and every live document's origin. */
export interface GraphHistory {
  activity: ActivityEntry[]
  documents: DocumentOrigin[]
}

/** One piece of evidence a document holds, and what it is about. */
export interface TrailItem {
  key: string
  entity: UiEntity
  link?: { rel: string; target: string }
  evidence: UiEvidence
  source?: string
  location: string
}

/** A document's evidence trail: what it defines, the evidence it holds, and the changes that touched it. */
export interface DocumentTrail {
  path: string
  document?: DocumentOrigin
  entities: UiEntity[]
  items: TrailItem[]
  sources: string[]
  changes: ActivityEntry[]
}

/**
 * Every live document with the evidence its exhibits hold, in path order. An
 * exhibit merged from several documents lists its evidence under the first,
 * the one docket reads it from.
 */
export const evidenceTrails = (graph: UiGraph, documents: readonly DocumentOrigin[], activity: readonly ActivityEntry[]): DocumentTrail[] => {
  const trails = new Map<string, DocumentTrail>()
  const trail = (path: string): DocumentTrail => {
    let found = trails.get(path)
    if (!found) {
      found = { path, entities: [], items: [], sources: [], changes: [] }
      trails.set(path, found)
    }
    return found
  }
  for (const document of documents) trail(document.path).document = document
  for (const entity of graph.entities) {
    for (const path of entity.paths.length ? entity.paths : [entity.path]) trail(path).entities.push(entity)
    const item = (evidence: UiEvidence, key: string, link?: TrailItem['link']): TrailItem => ({
      key,
      entity,
      ...(link ? { link } : {}),
      evidence,
      ...(text(evidence.source) ? { source: text(evidence.source) } : {}),
      location: evidenceLocation(evidence),
    })
    trail(entity.path).items.push(
      ...entity.evidence.map((evidence, index) => item(evidence, `${entity.id}#${index}`)),
      ...entity.links.flatMap((link, linkIndex) =>
        (link.evidence ?? []).map((evidence, index) => item(evidence, `${entity.id}>${linkIndex}#${index}`, { rel: link.rel, target: link.target })),
      ),
    )
  }
  for (const change of activity) {
    for (const path of new Set(change.documents.map((document) => document.path))) trails.get(path)?.changes.push(change)
  }
  for (const found of trails.values()) {
    found.sources = [...new Set(found.items.flatMap((item) => (item.source ? [item.source] : [])))].sort()
  }
  return [...trails.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** A piece of evidence as a numbered exhibit: the docket's exhibits run from 1 in the order they were filed. */
export interface Exhibit extends TrailItem {
  no: number
  /** When it was observed, when it says. */
  at?: string
}

/** Every piece of evidence in the docket, numbered by when it was observed; undated evidence comes last, in path order. */
export const exhibitsOf = (graph: UiGraph): Exhibit[] => {
  const items: Omit<Exhibit, 'no'>[] = []
  const sorted = [...graph.entities].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.id < b.id ? -1 : 1))
  for (const entity of sorted) {
    const add = (evidence: UiEvidence, key: string, link?: TrailItem['link']) => {
      const at = text(evidence.observedAt)
      items.push({
        key,
        entity,
        ...(link ? { link } : {}),
        evidence,
        ...(text(evidence.source) ? { source: text(evidence.source) } : {}),
        location: evidenceLocation(evidence),
        ...(at ? { at } : {}),
      })
    }
    entity.evidence.forEach((evidence, index) => add(evidence, `${entity.id}#${index}`))
    entity.links.forEach((link, linkIndex) => (link.evidence ?? []).forEach((evidence, index) => add(evidence, `${entity.id}>${linkIndex}#${index}`, { rel: link.rel, target: link.target })))
  }
  // A stable sort: same-day evidence keeps its path order.
  const dated = items.filter((item) => item.at).sort((a, b) => ((a.at ?? '') < (b.at ?? '') ? -1 : (a.at ?? '') > (b.at ?? '') ? 1 : 0))
  return [...dated, ...items.filter((item) => !item.at)].map((item, index) => ({ ...item, no: index + 1 }))
}

/** A document's evidence grouped by what it is about - an exhibit, or one of its links - in the order held. */
export const groupByFact = (items: readonly TrailItem[]): TrailItem[][] => {
  const grouped = new Map<string, TrailItem[]>()
  for (const item of items) {
    const key = `${item.entity.id}\u0000${item.link ? `${item.link.rel}\u0000${item.link.target}` : ''}`
    grouped.set(key, [...(grouped.get(key) ?? []), item])
  }
  return [...grouped.values()]
}

export interface TrailFilter {
  q: string
  source: string
  /** Only documents with no evidence at all. */
  bare: boolean
}

export const filterTrails = (trails: readonly DocumentTrail[], filter: TrailFilter): DocumentTrail[] =>
  trails.filter(
    (found) =>
      (!filter.source || found.sources.includes(filter.source)) &&
      (!filter.bare || found.items.length === 0) &&
      matches([found.path, ...found.entities.flatMap((entity) => [entity.id, entity.title]), ...found.items.map((item) => item.location)], filter.q),
  )
