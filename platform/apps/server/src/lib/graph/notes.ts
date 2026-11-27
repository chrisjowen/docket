// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The docket's facts written as short notes, as the Facts view reads them: a
 * headline, a paragraph or two of prose with the records it names and the
 * exhibits it cites inline, a standing stamp and who filed it. Nothing is
 * generated: a record's note is its own summary or first paragraph, then what
 * its exhibits say; a relation's note says what it records about the link,
 * then what its exhibits say. Numbered as search numbers them (`F-007`).
 */

import { factRows, filterFacts, matches, type FactFilter, type FactRow } from './browse'
import { summaryOf, type UiEvidence, type UiGraph } from './model'
import { standingOf, type RecordStanding } from './standing'

/** A piece of a note's prose: words, a record it names, or an exhibit it cites by key. */
export type NotePart = { text: string } | { record: string; text: string } | { exhibit: string }

export interface FactNote {
  /** `F-007`: the fact's place on the docket's facts list. */
  no: string
  row: FactRow
  headline: string
  paragraphs: NotePart[][]
  /** The exhibits it rests on, by key, in the order held. */
  exhibits: string[]
  standing: RecordStanding
  /** Who filed its latest exhibit, else who captured the record. */
  filedBy?: string
}

/** A lede longer than this is cut at the last sentence that fits. */
export const LEDE_LENGTH = 480

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/** Markdown's links and paired emphasis taken out, so a paragraph reads as prose; `user_id` and `2 * 3` stay as written. */
const unmark = (markdown: string): string =>
  markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(?<![\w*_~])(\*\*|__|\*|_|~~)(?=\S)(.+?)(?<=\S)\1(?![\w*_~])/g, '$2')
    .replace(/\s+/g, ' ')

/** The record's first paragraph of prose: its summary, else the body's first that is not a heading, list or code. */
export function ledeOf(entity: { title: string; content: string; frontmatter: Record<string, unknown> }): string {
  const summary = summaryOf(entity)
  const paragraph =
    summary ??
    entity.content
      .replace(/```[\s\S]*?```/g, '')
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .find((block) => block && !/^(#{1,6}\s|[-*+]\s|\d+\.\s|>|\|)/.test(block)) ??
    ''
  const flat = paragraph.replace(/\s*\n\s*/g, ' ').trim()
  if (flat.length <= LEDE_LENGTH) return flat
  const cut = flat.slice(0, LEDE_LENGTH)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return end > LEDE_LENGTH / 3 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

/** Prose with `[[id]]`, `[[id|label]]` and a backticked id of a record on file made into links to it. */
export function proseParts(paragraph: string, titles: ReadonlyMap<string, string>): NotePart[] {
  const parts: NotePart[] = []
  const words = (raw: string) => {
    const said = unmark(raw)
    if (said) parts.push({ text: said })
  }
  let last = 0
  for (const found of paragraph.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|`([^`]+)`/g)) {
    words(paragraph.slice(last, found.index))
    last = found.index + found[0].length
    const [, wiki, label, code] = found
    const id = (wiki ?? code ?? '').trim()
    const title = titles.get(id)
    if (title !== undefined) parts.push({ record: id, text: label?.trim() || title })
    else parts.push({ text: label?.trim() || id })
  }
  words(paragraph.slice(last))
  return parts
}

/** A relation's name as words: `depends_on` reads "depends on". */
export const relWords = (rel: string): string => rel.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll(/[_-]+/g, ' ').toLowerCase()

const scalar = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : typeof value === 'boolean' ? (value ? 'yes' : 'no') : undefined

/** What the exhibits say, each followed by its chip; those that say nothing are listed as on file. */
function exhibitParts(evidence: readonly UiEvidence[], keyOf: (index: number) => string): NotePart[] {
  const parts: NotePart[] = []
  const quiet: string[] = []
  evidence.forEach((item, index) => {
    const note = text(item.note)
    if (!note) {
      quiet.push(keyOf(index))
      return
    }
    const ends = /[.!?…]$/.test(note)
    parts.push({ text: `${parts.length ? ' ' : ''}${ends ? note.slice(0, -1) : note} ` }, { exhibit: keyOf(index) }, { text: ends ? note.slice(-1) : '.' })
  })
  if (quiet.length) {
    parts.push({ text: `${parts.length ? ' ' : ''}${parts.length ? 'Also on file' : 'On file'}: ` })
    quiet.forEach((key, index) => parts.push(...(index ? [{ text: ' ' }] : []), { exhibit: key }))
    parts.push({ text: '.' })
  }
  return parts
}

const latestBy = (evidence: readonly UiEvidence[]): string | undefined =>
  [...evidence]
    .filter((item) => text(item.observedBy))
    .sort((a, b) => ((text(a.observedAt) ?? '') < (text(b.observedAt) ?? '') ? 1 : -1))
    .map((item) => text(item.observedBy))[0]

/** Where a relation stands: as its record would, from its own weight, exhibits and sources. */
function linkStanding(row: FactRow, filed: boolean): RecordStanding {
  if (!filed) return { key: 'unfiled', label: 'Not on record', tone: 'red' }
  if (row.evidenceCount === 0 || row.weak) return { key: 'uncorroborated', label: 'Uncorroborated', tone: 'red' }
  return row.sources.length > 1 ? { key: 'corroborated', label: 'Corroborated', tone: 'ok' } : { key: 'sole', label: 'Sole source', tone: 'warn' }
}

/** Every fact in the docket as a note, in the facts list's order. */
export function factNotes(graph: UiGraph): FactNote[] {
  const titles = new Map(graph.entities.map((entity) => [entity.id, entity.title]))
  return factRows(graph).map((row, index): FactNote => {
    const no = `F-${String(index + 1).padStart(3, '0')}`
    const { entity } = row
    const captured = text(entity.provenance?.capturedBy)
    if (!row.link) {
      const lede = ledeOf(entity)
      const said = exhibitParts(entity.evidence, (at) => `${row.key}#${at}`)
      const filedBy = latestBy(entity.evidence) ?? captured
      return {
        no,
        row,
        headline: entity.title,
        paragraphs: [
          ...(lede ? [proseParts(lede, titles)] : []),
          said.length ? said : [{ text: 'No exhibit on file: it rests on the document alone.' }],
        ],
        exhibits: entity.evidence.map((_, at) => `${row.key}#${at}`),
        standing: standingOf(entity),
        ...(filedBy ? { filedBy } : {}),
      }
    }
    const { rel, target } = row.link
    const link = entity.links[Number(row.key.slice(row.key.lastIndexOf('>') + 1))]
    const evidence = link?.evidence ?? []
    const filed = titles.has(target)
    const details = Object.entries(link?.attributes ?? {}).flatMap(([name, value]) => {
      const said = scalar(value)
      return said === undefined ? [] : [`${relWords(name)} ${said}`]
    })
    const said = exhibitParts(evidence, (at) => `${row.key}#${at}`)
    const filedBy = latestBy(evidence) ?? captured
    return {
      no,
      row,
      headline: `${entity.title} ${relWords(rel)} ${titles.get(target) ?? target}`,
      paragraphs: [
        // The headline says what it links; the note adds what the relation records, and a target no document files.
        ...(details.length || !filed
          ? [
              [
                ...(details.length ? [{ text: `Recorded with ${details.join(', ')}.` }] : []),
                ...(filed ? [] : [{ text: `${details.length ? ' ' : ''}No document files ` }, { record: target, text: target }, { text: ' yet.' }]),
              ],
            ]
          : []),
        said.length ? said : [{ text: `No exhibit on file: it rests on ${entity.title}'s document alone.` }],
      ],
      exhibits: evidence.map((_, at) => `${row.key}#${at}`),
      standing: linkStanding(row, filed),
      ...(filedBy ? { filedBy } : {}),
    }
  })
}

/** A note's prose as plain words, for matching and labels. */
export const noteText = (note: Pick<FactNote, 'paragraphs'>): string =>
  note.paragraphs.map((paragraph) => paragraph.map((part) => ('text' in part ? part.text : '')).join('')).join(' ')

/** The notes the facts filters keep; the words also find what a note says. */
export function filterNotes(notes: readonly FactNote[], filter: FactFilter): FactNote[] {
  const kept = new Set(filterFacts(notes.map((note) => note.row), { ...filter, q: '' }).map((row) => row.key))
  return notes.filter(({ row, ...note }) => {
    if (!kept.has(row.key)) return false
    return matches([note.no, row.entity.id, row.entity.title, row.entity.path, row.link?.rel, row.link?.target, ...row.entity.tags, note.headline, noteText(note)], filter.q)
  })
}

/** The rail's colour, as the weight bar's: how much weight stands behind the fact; the ontology's default alone is low. */
export const railOf = (row: Pick<FactRow, 'band' | 'basis'>): 'high' | 'mid' | 'low' | 'none' => {
  if (row.band === undefined) return 'none'
  return row.basis === 'unevidenced' ? 'low' : row.band === 'medium' ? 'mid' : row.band
}

export type NoteSort = 'docket' | 'strong' | 'weak' | 'exhibits' | 'latest'

/** The notes in another order; docket order is the facts list's. */
export function sortNotes(notes: readonly FactNote[], sort: NoteSort): FactNote[] {
  const weight = (note: FactNote) => note.row.confidence ?? -1
  const by: Record<NoteSort, (a: FactNote, b: FactNote) => number> = {
    docket: () => 0,
    strong: (a, b) => weight(b) - weight(a),
    weak: (a, b) => (a.row.confidence ?? 2) - (b.row.confidence ?? 2),
    exhibits: (a, b) => b.row.evidenceCount - a.row.evidenceCount,
    latest: (a, b) => ((b.row.lastObserved ?? '') < (a.row.lastObserved ?? '') ? -1 : (b.row.lastObserved ?? '') > (a.row.lastObserved ?? '') ? 1 : 0),
  }
  return [...notes].sort(by[sort])
}
