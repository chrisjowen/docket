// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Direct search's mixed results: besides the records it finds, the notes,
 * memory matches, exhibits and docket entries the query's words find. Notes
 * are the docket's facts written as prose, memory matches are the records
 * mem0 recalled, exhibits are the evidence numbered as filed, and docket
 * entries are the docket sheet's. All of it reads the canonical graph and the
 * activity log the page already has; only the memory matches come from the
 * index. Pure, so the page, the command menu and the server share it.
 */
import { docketSheet, exhibitsOf, factRows, SHEET_KINDS, timelineOf, type ActivityEntry, type TimelineKind } from '$lib/graph/browse'
import { summaryOf, type UiEntity, type UiGraph } from '$lib/graph/model'
import { docketText } from '$lib/graph/sheet'

import type { AskWorkspace } from './model'

/** The kinds of result, in the order they are listed, and what each reads as. */
export const RESULT_KINDS = [
  ['notes', 'Notes'],
  ['memory', 'Memory'],
  ['records', 'Records'],
  ['exhibits', 'Exhibits'],
  ['entries', 'Docket entries'],
] as const

export type ResultKind = (typeof RESULT_KINDS)[number][0]

/** The most results of each kind listed per docket. */
export const PER_KIND = 50

/** The most of a result's text sent with it: enough around the first match for the page's snippet. */
export const SENT_TEXT = 320

/** A fact written as a note: a record's own prose, or what a link's evidence says. */
export interface NoteHit {
  workspace: AskWorkspace
  /** `F-007`: the fact's place on the docket's facts list. */
  no: string
  /** The record it is about. */
  entity: string
  title: string
  text: string
  weight: number | null
}

/** A record mem0 recalled for the query, with how well it matched. */
export interface MemoryHit {
  workspace: AskWorkspace
  id: string
  title: string
  type: string
  /** What the record says, as the memory holds it. */
  text: string
  /** How relevant, 0 to 1, when the index says. */
  score: number | null
}

/** A piece of evidence, numbered as the docket's exhibits are. */
export interface ExhibitHit {
  workspace: AskWorkspace
  no: number
  entity: string
  entityTitle: string
  entityType: string
  /** The evidence's note, else where it points. */
  text: string
  location: string
  source: string | null
  /** The document that holds it, which the Exhibits view opens on. */
  path: string
}

/** One entry of the docket sheet. */
export interface EntryHit {
  workspace: AskWorkspace
  no: number
  kind: TimelineKind
  day: string
  text: string
  entity: string | null
  entityTitle: string | null
}

export interface ResultGroups {
  notes: NoteHit[]
  memory: MemoryHit[]
  exhibits: ExhibitHit[]
  entries: EntryHit[]
}

export const emptyGroups = (): ResultGroups => ({ notes: [], memory: [], exhibits: [], entries: [] })

/** Several dockets' lists as one, taking each one's next in turn, so no docket's results crowd out another's best. */
export function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const merged: T[] = []
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let index = 0; index < longest; index++) for (const list of lists) if (index < list.length) merged.push(list[index]!)
  return merged
}

/** Words too common to search on. */
const STOP = new Set(
  'a an and are as at be by can did do does for from has have how i in is it its me my of on or our so that the their them there this to was we were what when where which who whom why will with you'.split(' '),
)

/** The words a query searches on: lower case, without the commonest; all of them when nothing else is left. */
export function termsOf(query: string): string[] {
  const words = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))]
  const kept = words.filter((word) => word.length > 1 && !STOP.has(word))
  return kept.length ? kept : words
}

/**
 * The items whose text holds the query's words, best first: at least half of
 * the words (any one of two), ranked by how many, then in the order given.
 */
export function ranked<T>(items: readonly T[], textOf: (item: T) => string, terms: readonly string[], most = PER_KIND): T[] {
  if (terms.length === 0) return []
  const needed = Math.max(1, Math.ceil(terms.length / 2))
  const scored = items.flatMap((item, index) => {
    const text = textOf(item).toLowerCase()
    const score = terms.filter((term) => text.includes(term)).length
    return score >= needed ? [{ item, score, index }] : []
  })
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, most)
    .map(({ item }) => item)
}

/** A document's Markdown as plain prose: no headings' hashes, emphasis, code fences or link targets. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, id: string, __, label: string | undefined) => label ?? id)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A record's prose: its summary, else its body without a heading that repeats its title. */
export function proseOf(entity: Pick<UiEntity, 'title' | 'content' | 'frontmatter'>): string {
  const summary = summaryOf(entity)
  if (summary) return summary
  const body = entity.content.replace(/^\s*#+\s*(.*)\n/, (line, heading: string) => (heading.trim() === entity.title ? '' : line))
  return plainText(body)
}

/** Up to `length` characters of `text` around the first of the query's words, with an ellipsis where it is cut. */
export function snippet(text: string, terms: readonly string[], length = 180): string {
  if (text.length <= length) return text
  const lower = text.toLowerCase()
  const found = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0)
  const first = found.length ? Math.min(...found) : 0
  // Some words before the first match, from a word's start.
  const lead = Math.floor(length / 3)
  const start = first > lead ? text.lastIndexOf(' ', first - lead) + 1 : 0
  const more = start + length < text.length
  const cut = text.slice(start, start + length)
  const shown = more && cut.lastIndexOf(' ') > lead ? cut.slice(0, cut.lastIndexOf(' ')) : cut
  return `${start > 0 ? '…' : ''}${shown}${more ? '…' : ''}`
}

/** `text` split where the query's words appear, so each can be marked. */
export function marked(text: string, terms: readonly string[]): { text: string; mark: boolean }[] {
  const words = terms.filter(Boolean)
  if (words.length === 0) return [{ text, mark: false }]
  const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text
    .split(pattern)
    .filter(Boolean)
    .map((part) => ({ text: part, mark: words.includes(part.toLowerCase()) }))
}

const pad = (no: number) => String(no).padStart(3, '0')

/** The documents' records, as the graph views read them. */
type Records = { entities: readonly UiEntity[] }
const graphOf = (records: Records): UiGraph => ({ entities: [...records.entities] }) as UiGraph

/** Every record kept. */
const everyRecord = () => true

/**
 * The facts with prose of their own whose words the query finds: a record's
 * summary or body, a link's evidence notes. Numbered across the whole docket;
 * only facts about the records `keep` keeps are listed.
 */
export function noteHits(workspace: AskWorkspace, graph: Records, terms: readonly string[], keep: (entity: UiEntity) => boolean = everyRecord): NoteHit[] {
  const titles = new Map(graph.entities.map((entity) => [entity.id, entity.title]))
  const notes = factRows(graphOf(graph)).flatMap((row, index): NoteHit[] => {
    const no = `F-${pad(index + 1)}`
    if (!keep(row.entity)) return []
    if (!row.link) {
      const text = proseOf(row.entity)
      return text ? [{ workspace, no, entity: row.entity.id, title: row.entity.title, text, weight: row.confidence ?? null }] : []
    }
    const said = row.entity.links
      .filter((link) => link.rel === row.link?.rel && link.target === row.link.target)
      .flatMap((link) => link.evidence ?? [])
      .flatMap((evidence) => (typeof evidence.note === 'string' && evidence.note.trim() ? [evidence.note.trim()] : []))
    if (said.length === 0) return []
    const title = `${row.entity.title} ${row.link.rel.replaceAll('_', ' ')} ${titles.get(row.link.target) ?? row.link.target}`
    return [{ workspace, no, entity: row.entity.id, title, text: said.join(' '), weight: row.confidence ?? null }]
  })
  return ranked(notes, (note) => `${note.title} ${note.text} ${note.entity}`, terms).map((note) => ({ ...note, text: snippet(note.text, terms, SENT_TEXT) }))
}

/** The index's matches mem0 found, best first, each with what its record says. */
export function memoryHits(
  workspace: AskWorkspace,
  matches: readonly { id: string; foundBy: readonly string[]; score?: number }[],
  entities: ReadonlyMap<string, UiEntity>,
  terms: readonly string[],
): MemoryHit[] {
  return matches.flatMap((match) => {
    const entity = entities.get(match.id)
    if (!entity || !match.foundBy.includes('mem0')) return []
    return [{ workspace, id: entity.id, title: entity.title, type: entity.type, text: snippet(proseOf(entity) || entity.title, terms, SENT_TEXT), score: match.score ?? null }]
  })
}

/** The docket's exhibits whose note, location or record the query finds: numbered across the docket, about the records `keep` keeps. */
export function exhibitHits(workspace: AskWorkspace, graph: Records, terms: readonly string[], keep: (entity: UiEntity) => boolean = everyRecord): ExhibitHit[] {
  const exhibits = exhibitsOf(graphOf(graph)).flatMap((exhibit): ExhibitHit[] => {
    if (!keep(exhibit.entity)) return []
    const note = typeof exhibit.evidence.note === 'string' ? exhibit.evidence.note.trim() : ''
    return [
      {
        workspace,
        no: exhibit.no,
        entity: exhibit.entity.id,
        entityTitle: exhibit.entity.title,
        entityType: exhibit.entity.type,
        text: note || exhibit.location || 'Evidence on file',
        location: note ? exhibit.location : '',
        source: exhibit.source ?? null,
        path: exhibit.entity.path,
      },
    ]
  })
  return ranked(exhibits, (exhibit) => `${exhibit.text} ${exhibit.location} ${exhibit.source ?? ''} ${exhibit.entityTitle} ${exhibit.entity}`, terms)
}

/** The docket sheet's entries whose wording or record the query finds, newest first. */
export function entryHits(workspace: AskWorkspace, graph: Records, activity: readonly ActivityEntry[], terms: readonly string[]): EntryHit[] {
  const entries = docketSheet(timelineOf(graphOf(graph), activity)).map(
    (entry): EntryHit => ({
      workspace,
      no: entry.no,
      kind: entry.kind,
      day: entry.day,
      text: docketText(entry),
      entity: entry.entity?.id ?? null,
      entityTitle: entry.entity?.title ?? null,
    }),
  )
  return ranked(entries, (entry) => `${SHEET_KINDS[entry.kind]} ${entry.text} ${entry.entityTitle ?? ''} ${entry.entity ?? ''}`, terms)
}

/** How many results of each kind, and in all. */
export function countsOf(records: number, groups: ResultGroups): Record<ResultKind | 'all', number> {
  const counts = { notes: groups.notes.length, memory: groups.memory.length, records, exhibits: groups.exhibits.length, entries: groups.entries.length }
  return { ...counts, all: Object.values(counts).reduce((sum, count) => sum + count, 0) }
}
