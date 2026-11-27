// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How the docket sheet words an entry and labels an exhibit: the text after
 * the entry's kind ("RULING — Decided."), and `Ex. P-12` from the docket's
 * number and the exhibit's.
 */
import { ACTION_LABELS } from '$lib/activity'

import type { TimelineEntry } from './browse'
import { evidenceLocation } from './model'

/** An exhibit's label: the docket number's first letter, then the exhibit's number. */
export const exhibitLabel = (docketNo: string, no: number): string => `Ex. ${(docketNo.match(/[a-z]/i)?.[0] ?? 'D').toUpperCase()}-${no}`

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`)

/** What a dated attribute's name says, as words: `decided_at` reads "Decided at". */
const fieldWords = (field: string) => capital(field.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll(/[_-]+/g, ' ').toLowerCase())

/** The entry's docket text, without its kind or the record it is about. */
export function docketText(entry: Pick<TimelineEntry, 'kind' | 'field' | 'evidence' | 'change'>): string {
  if (entry.change) {
    const { action, documents, evidenceCount, resourceId } = entry.change
    const label = capital(ACTION_LABELS[action] ?? action.replaceAll('-', ' '))
    const paths = [...new Set(documents.map((document) => document.path))]
    // A change about one record names it after "Re"; otherwise say what it wrote.
    const object = resourceId ? '' : paths.length === 1 ? paths[0] : paths.length > 1 ? `${paths.length} documents` : ''
    const joined = !object ? label.replace(/ (to|about|of)$/, '') : / (to|about|of)$/.test(label) ? `${label} ${object}` : `${label}: ${object}`
    return sentence(evidenceCount ? `${joined}, ${evidenceCount} ${evidenceCount === 1 ? 'exhibit' : 'exhibits'}` : joined)
  }
  if (entry.evidence) {
    const note = typeof entry.evidence.note === 'string' && entry.evidence.note.trim() ? entry.evidence.note.trim() : ''
    const said = note || evidenceLocation(entry.evidence) || 'Evidence on file'
    if (entry.field === 'eventAt') return sentence(`Happened: ${said}`)
    // A bare location reads as itself; a note as a sentence.
    return note ? sentence(note) : said
  }
  return sentence(fieldWords(entry.field))
}
