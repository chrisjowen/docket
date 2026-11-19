/**
 * Supersession: facts come from agents and cannot be checked again against a
 * source, so one gone out of date is never deleted. When a newer record
 * contradicts an older one about the same thing, the older is marked
 * superseded - until when it held, the record that replaces it, why, and the
 * evidence - and search answers with the replacement and a note of the
 * change.
 */

import type { OutOfDateRecord } from '../query/wire.js'

/**
 * The record a superseded one points to now: its replacement's replacement,
 * and so on, to the first that is not superseded. A chain that loops ends
 * where it would revisit a record.
 */
export function currentRecord(supersessions: ReadonlyMap<string, { supersededBy: string }>, id: string): string {
  const seen = new Set([id])
  let at = id
  for (;;) {
    const next = supersessions.get(at)?.supersededBy
    if (next === undefined || seen.has(next)) return at
    seen.add(next)
    at = next
  }
}

/** A day, as a change note gives it. */
export const dayOf = (at: Date | string): string => (typeof at === 'string' ? at : at.toISOString()).slice(0, 10)

/** One line saying a record is out of date and what replaces it, for search, ask, get and an inspector. */
export function changeNote(
  old: { id: string; title: string },
  current: { id: string; title: string } | null,
  supersession: { validUntil: Date | string; reason: string }
): string {
  const now = current ? `superseded by "${current.title}" (${current.id})` : 'superseded by a record no longer on file'
  const reason = supersession.reason.trim().replace(/\s+/g, ' ')
  return `Out of date: "${old.title}" (${old.id}) is ${now} since ${dayOf(supersession.validUntil)}.${reason ? ` ${reason.replace(/([^.!?])$/, '$1.')}` : ''}`
}

/** What a change is told from: the record that replaced one, until when it held, and why. */
export type HeldSupersession = { supersededBy: string; validUntil: Date | string; reason: string }

/**
 * The out-of-date records among `ids`, in their order, each with the record
 * current now. `describe` names a record on file, and null for one that is
 * not; a superseded record no longer on file is left out.
 */
export function recordChanges(
  supersessions: ReadonlyMap<string, HeldSupersession>,
  ids: readonly string[],
  describe: (id: string) => { id: string; type: string; title: string } | null
): OutOfDateRecord[] {
  return [...new Set(ids)].flatMap((id) => {
    const own = supersessions.get(id)
    const old = own ? describe(id) : null
    if (!own || !old) return []
    const currentId = currentRecord(supersessions, id)
    const found = currentId !== id && !supersessions.has(currentId) ? describe(currentId) : null
    const current = found ? { id: found.id, type: found.type, title: found.title } : null
    return [{ id, type: old.type, title: old.title, supersededBy: own.supersededBy, current, since: dayOf(own.validUntil), reason: own.reason, note: changeNote(old, current, own) }]
  })
}
