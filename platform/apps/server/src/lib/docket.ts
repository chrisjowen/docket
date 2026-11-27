// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A docket (a workspace) as the casebook shows it: its docket number, whether
 * it is active, and its filings over the last twelve months. All of it is
 * worked out from what the workspace already records; nothing is stored.
 */
import { BAND_WEIGHT, DEFAULT_BANDS, bandOf, type Bands } from '$lib/trust/bands'

/** No filing for this long and a docket reads as dormant. */
export const DORMANT_AFTER_DAYS = 30

/** Months the casebook's filings sparkline covers. */
export const FILING_MONTHS = 12

/**
 * Each docket's number, `PLA-26-0001`: three letters of its address, the year
 * it was opened and its place in the casebook by when it was opened. The
 * oldest docket is 0001; a docket keeps its number while older ones stay.
 */
export function docketNumbers(workspaces: readonly { slug: string; createdAt: Date | string }[]): Map<string, string> {
  const opened = [...workspaces].sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.slug.localeCompare(b.slug))
  return new Map(opened.map((workspace, index) => [workspace.slug, docketNumber(workspace.slug, workspace.createdAt, index + 1)]))
}

export function docketNumber(slug: string, createdAt: Date | string, sequence: number): string {
  const letters = slug.replace(/[^a-z0-9]/gi, '').toUpperCase()
  const prefix = (letters || 'DKT').slice(0, 3).padEnd(3, 'X')
  const year = String(new Date(createdAt).getUTCFullYear() % 100).padStart(2, '0')
  return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`
}

export type Standing = 'active' | 'dormant'

/** Active with a filing in the last 30 days, else dormant. */
export function standingOf(lastFiling: Date | string | null, now: Date = new Date()): Standing {
  if (!lastFiling) return 'dormant'
  return now.getTime() - time(lastFiling) <= DORMANT_AFTER_DAYS * 86_400_000 ? 'active' : 'dormant'
}

/** Filings per calendar month (UTC), oldest first, the current month last. */
export function filingsByMonth(filings: readonly (Date | string)[], now: Date = new Date(), months = FILING_MONTHS): number[] {
  const counts = Array.from({ length: months }, () => 0)
  const end = now.getUTCFullYear() * 12 + now.getUTCMonth()
  for (const filing of filings) {
    const at = new Date(filing)
    const index = months - 1 - (end - (at.getUTCFullYear() * 12 + at.getUTCMonth()))
    if (index >= 0 && index < months) counts[index] = (counts[index] ?? 0) + 1
  }
  return counts
}

/** An SVG path for a sparkline of `values` in a `width` by `height` box: the line, and the area under it. */
export function sparkline(values: readonly number[], width = 96, height = 24): { line: string; area: string } {
  if (values.length === 0) return { line: '', area: '' }
  const max = Math.max(...values, 1)
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const points = values.map((value, index) => [round(index * step), round(height - 2 - (value / max) * (height - 4))] as const)
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ')
  return { line, area: `${line} L${round((values.length - 1) * step)} ${height} L0 ${height} Z` }
}

const time = (at: Date | string) => new Date(at).getTime()
const round = (value: number) => Math.round(value * 10) / 10

/** The short codes record types wear on their badges; any other type takes the first three letters of its name. */
const TYPE_CODES: Record<string, string> = {
  service: 'SVC',
  api: 'API',
  datastore: 'DS',
  'data-store': 'DS',
  database: 'DB',
  queue: 'Q',
  team: 'TM',
  person: 'PER',
  decision: 'DEC',
  incident: 'INC',
  runbook: 'RB',
  system: 'SYS',
  library: 'LIB',
  repository: 'REPO',
  repo: 'REPO',
  document: 'DOC',
  environment: 'ENV',
}

export function typeCode(type: string): string {
  const known = TYPE_CODES[type.toLowerCase()]
  if (known) return known
  return type.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || '?'
}

/** How far a record's evidence carries it, as its weight bar shows: its band, by the workspace's bands or docket's defaults. */
export const weightClass = (confidence: number, bands: Bands = DEFAULT_BANDS): 'low' | 'mid' | 'high' => BAND_WEIGHT[bandOf(confidence, bands)]
