import { RESOURCE_SCHEMA } from '../../../docket/src/mcp/surface/results.js'
import type { UiEvidence } from '$lib/types.js'

/*
 * docket_get's result, `docket-resource.v1` (packages/docket/src/mcp/surface/answers.ts),
 * as the app draws it: one resource as its card.
 */

export interface CardLink {
  rel: string
  target: string
  attributes?: Record<string, unknown>
  confidence: number
  basis: string
  evidence: UiEvidence[]
}

export interface CardResource {
  type: string
  title: string
  tags: string[]
  attributes: Record<string, unknown>
  body: string
  summary?: string
  confidence: number
  basis: string
  evidenceCount: number
  evidence: UiEvidence[]
  links: CardLink[]
}

export interface ResourceCard {
  schema: typeof RESOURCE_SCHEMA
  id: string
  /** The resource's page in docket open's casebook, or null where there is none. */
  viewer: string | null
  /** Null when its documents do not validate: `diagnostics` say why. */
  resource: CardResource | null
  superseded?: { by: string; current: string | null; validUntil: string; reason: string }
  supersedes?: { id: string; validUntil: string; reason: string }[]
  documents: { path: string; origin: string; revision?: number }[]
  history: unknown[]
  diagnostics: { severity: string; code: string; message: string }[]
}

/** The resource a tool result carries, when it is docket_get's. */
export const cardOf = (structured: unknown): ResourceCard | null =>
  typeof structured === 'object' && structured !== null && (structured as { schema?: unknown }).schema === RESOURCE_SCHEMA
    ? (structured as ResourceCard)
    : null

/** How many characters of notes the card shows before "Read all notes". */
export const LEAD_LENGTH = 420

/** Notes without a first heading that only restates the title, as a document's `# Title` line does. */
export const notesOf = (body: string, title: string): string => {
  const heading = /^#\s+(.+)\n*/.exec(body.trimStart())
  const said = heading?.[1]?.trim().toLowerCase()
  return heading && said && title.toLowerCase().startsWith(said) ? body.trimStart().slice(heading[0].length) : body
}

/**
 * The opening of a resource's notes: whole paragraphs until about
 * `LEAD_LENGTH` characters, never cutting a code block in two. `more` says
 * whether anything was left out.
 */
export const leadOf = (body: string, length = LEAD_LENGTH): { lead: string; more: boolean } => {
  const paragraphs = body.trim().split(/\n\s*\n/)
  const kept: string[] = []
  for (const paragraph of paragraphs) {
    const fenced = (kept.join('\n\n').match(/^```/gm)?.length ?? 0) % 2 === 1
    if (kept.length > 0 && !fenced && kept.join('\n\n').length >= length) break
    kept.push(paragraph)
  }
  return { lead: kept.join('\n\n'), more: kept.length < paragraphs.length }
}

/** The kinds of source its evidence comes from, each once, most cited first. */
export const sourcesOf = (evidence: readonly UiEvidence[]): { source: string; count: number }[] => {
  const counts = new Map<string, number>()
  for (const item of evidence) {
    if (typeof item.source === 'string') counts.set(item.source, (counts.get(item.source) ?? 0) + 1)
  }
  return [...counts].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || (a.source < b.source ? -1 : 1))
}

/** Its links, grouped by relationship, in the order the resource declares them. */
export const linksByRel = (links: readonly CardLink[]): [string, CardLink[]][] => {
  const groups = new Map<string, CardLink[]>()
  for (const link of links) groups.set(link.rel, [...(groups.get(link.rel) ?? []), link])
  return [...groups]
}

export const percent = (confidence: number): string => `${Math.round(confidence * 100)}%`
