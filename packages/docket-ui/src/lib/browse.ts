import { evidenceLocation } from './model.js'
import type { UiEdge, UiEntity, UiEvidence, UiGraph } from './types.js'

/*
 * The Browse table and history: canonical exhibits and their observations as
 * rows, and the dated observations and supersessions as history. Everything
 * here reads the canonical graph the page loaded - never an index.
 */

/** The day an ISO date or datetime falls on - a YAML date arrives as midnight UTC - or undefined. */
export const dayOf = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  return /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0]
}

export type Band = 'high' | 'medium' | 'low'

/** The confidence bands the exhibit inspector labels. */
export const bandOf = (confidence: number): Band => (confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low')

export interface ExhibitRow {
  entity: UiEntity
  /** Source kinds behind it: the assessment's, else its evidence's. */
  sources: string[]
  confidence?: number
  basis?: string
  evidenceCount: number
  /** The latest day any of its observations was made. */
  lastObserved?: string
}

/** One observation, of an exhibit or of one of its relationships. */
export interface ObservationRow {
  key: string
  entity: UiEntity
  /** The relationship it supports; absent when it is about the exhibit itself. */
  link?: { rel: string; target: string }
  evidence: UiEvidence
  source?: string
  location: string
  observedAt?: string
  /** When what it records happened, only when the record says so. */
  eventAt?: string
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const latest = (days: (string | undefined)[]): string | undefined =>
  days.filter((day): day is string => day !== undefined).sort().at(-1)

export const exhibitRows = (graph: UiGraph): ExhibitRow[] =>
  graph.entities.map((entity) => {
    const evidenceSources = entity.evidence.map((item) => text(item.source)).filter((item): item is string => item !== undefined)
    return {
      entity,
      sources: entity.assessment?.sources.length ? entity.assessment.sources : [...new Set(evidenceSources)].sort(),
      ...(entity.assessment ? { confidence: entity.assessment.confidence, basis: entity.assessment.basis } : {}),
      evidenceCount: entity.assessment?.evidenceCount ?? entity.evidence.length,
      ...withDay('lastObserved', latest(entity.evidence.map((item) => dayOf(item.observedAt))))
    }
  })

const withDay = <K extends string>(key: K, day: string | undefined): Partial<Record<K, string>> =>
  (day === undefined ? {} : { [key]: day }) as Partial<Record<K, string>>

export const observationRows = (graph: UiGraph): ObservationRow[] =>
  graph.entities.flatMap((entity) => {
    const row = (evidence: UiEvidence, key: string, link?: ObservationRow['link']): ObservationRow => ({
      key,
      entity,
      ...(link ? { link } : {}),
      evidence,
      ...(text(evidence.source) ? { source: text(evidence.source) } : {}),
      location: evidenceLocation(evidence),
      ...withDay('observedAt', text(evidence.observedAt)),
      ...withDay('eventAt', text(evidence.eventAt))
    })
    return [
      ...entity.evidence.map((evidence, index) => row(evidence, `${entity.id}#${index}`)),
      ...entity.links.flatMap((link, linkIndex) =>
        (link.evidence ?? []).map((evidence, index) =>
          row(evidence, `${entity.id}>${linkIndex}#${index}`, { rel: link.rel, target: link.target })
        )
      )
    ]
  })

export type AssessmentFilter = 'any' | Band | 'unevidenced'

export interface TableFilter {
  /** Empty: every type. */
  types: ReadonlySet<string>
  /** Empty: every source kind. */
  sources: ReadonlySet<string>
  /** Inclusive `YYYY-MM-DD` bounds on the day observed. */
  from?: string
  to?: string
  assessment: AssessmentFilter
  text: string
}

export const EMPTY_FILTER: TableFilter = { types: new Set(), sources: new Set(), assessment: 'any', text: '' }

const inRange = (day: string | undefined, filter: TableFilter): boolean => {
  if (!filter.from && !filter.to) return true
  if (day === undefined) return false
  return (!filter.from || day >= filter.from) && (!filter.to || day <= filter.to)
}

const assessed = (confidence: number | undefined, basis: string | undefined, filter: AssessmentFilter): boolean => {
  if (filter === 'any') return true
  if (filter === 'unevidenced') return basis === 'unevidenced'
  return confidence !== undefined && bandOf(confidence) === filter
}

const matches = (haystack: (string | undefined)[], needle: string): boolean => {
  const words = needle.toLowerCase().split(/\s+/).filter(Boolean)
  const joined = haystack.filter(Boolean).join(' ').toLowerCase()
  return words.every((word) => joined.includes(word))
}

export const filterExhibits = (rows: readonly ExhibitRow[], filter: TableFilter): ExhibitRow[] =>
  rows.filter(
    (row) =>
      (filter.types.size === 0 || filter.types.has(row.entity.type)) &&
      (filter.sources.size === 0 || row.sources.some((source) => filter.sources.has(source))) &&
      // An exhibit is in a date range when any of its observations is.
      (!filter.from && !filter.to
        ? true
        : row.entity.evidence.some((item) => inRange(dayOf(item.observedAt), filter))) &&
      assessed(row.confidence, row.basis, filter.assessment) &&
      matches([row.entity.id, row.entity.title, row.entity.path, ...row.entity.tags], filter.text)
  )

export const filterObservations = (rows: readonly ObservationRow[], filter: TableFilter): ObservationRow[] =>
  rows.filter(
    (row) =>
      (filter.types.size === 0 || filter.types.has(row.entity.type)) &&
      (filter.sources.size === 0 || (row.source !== undefined && filter.sources.has(row.source))) &&
      inRange(dayOf(row.observedAt), filter) &&
      assessed(row.entity.assessment?.confidence, row.entity.assessment?.basis, filter.assessment) &&
      matches([row.entity.id, row.entity.title, row.location, row.link?.rel, row.link?.target, text(row.evidence.note)], filter.text)
  )

// --- History ------------------------------------------------------------------

export interface HistoryEntry {
  key: string
  /** The day it is filed under. */
  day: string
  /** The full value recorded, which may carry a time. */
  at: string
  /** `observed`: when the evidence was seen. `event`: when what it records happened. Never inferred. */
  semantics: 'observed' | 'event'
  row: ObservationRow
}

/**
 * Every dated observation, newest first. An observation that records both an
 * event time and an observed time appears twice, once under each label: they
 * are different facts.
 */
export const historyOf = (graph: UiGraph): HistoryEntry[] =>
  observationRows(graph)
    .flatMap((row) =>
      (['eventAt', 'observedAt'] as const).flatMap((field): HistoryEntry[] => {
        const at = row[field]
        const day = dayOf(at)
        if (at === undefined || day === undefined) return []
        const semantics = field === 'eventAt' ? 'event' : 'observed'
        return [{ key: `${row.key}:${semantics}`, day, at, semantics, row }]
      })
    )
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key < b.key ? -1 : 1))

/** A record and what it replaced, newest first: `[current, superseded, superseded-before-that, …]`. */
export type SupersessionChain = string[]

/** Chains of `supersedes` relationships, each from a record nothing supersedes back to the oldest it replaced. */
export const supersessions = (edges: readonly UiEdge[]): SupersessionChain[] => {
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
