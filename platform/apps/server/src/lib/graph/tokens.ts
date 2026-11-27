// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The network's query tokens (trust design §6.4): `confidence:<0.5`,
 * `band:probable`, `is:pending`, `source:person`, `sources:1`, `type:service`.
 * They filter the records here, by what the graph carries of each one's
 * trust; whatever else is typed goes to the docket's search as before.
 */
import { BANDS, type Band } from '$lib/trust/bands'

export type Token =
  | { kind: 'confidence'; op: '<' | '<=' | '>' | '>=' | '='; value: number }
  | { kind: 'band'; band: Band }
  | { kind: 'pending' }
  | { kind: 'source'; source: string }
  | { kind: 'sources'; op: '<' | '<=' | '>' | '>=' | '='; count: number }
  | { kind: 'type'; type: string }

/** The tokens a query is made of, and the free text left over for search. */
export interface ParsedQuery {
  tokens: Token[]
  text: string
}

/** The tokens the box suggests, as the prototype did. */
export const TOKEN_HINTS = ['confidence:<0.5', 'band:probable', 'is:pending', 'source:person', 'sources:1'] as const

/** The quick chips under the box: a label and the query it runs. */
export const QUICK_QUERIES: readonly { label: string; q: string }[] = [
  { label: 'Low confidence', q: 'band:unverified' },
  { label: 'Probable', q: 'band:probable' },
  { label: 'Pending proposals', q: 'is:pending' },
  { label: 'Only one source', q: 'sources:1' },
  { label: 'Said by a person', q: 'source:person' },
]

const COMPARE = /^(<=|>=|<|>|=)?(\d+(?:\.\d+)?)$/
/** Words a reader might use for a band, beside its name. */
const BAND_WORDS: Record<string, Band> = { high: 'established', medium: 'probable', mid: 'probable', low: 'unverified' }

function token(word: string): Token | null {
  const colon = word.indexOf(':')
  if (colon <= 0) return null
  const key = word.slice(0, colon).toLowerCase()
  const value = word.slice(colon + 1)
  if (!value) return null
  if (key === 'confidence' || key === 'sources') {
    const match = COMPARE.exec(value)
    if (!match) return null
    const op = (match[1] ?? '=') as '<' | '<=' | '>' | '>=' | '='
    const number = Number(match[2])
    if (key === 'confidence') return number <= 1 ? { kind: 'confidence', op, value: number } : null
    return Number.isInteger(number) ? { kind: 'sources', op, count: number } : null
  }
  if (key === 'band') {
    const named = value.toLowerCase()
    const band = (BANDS as readonly string[]).includes(named) ? (named as Band) : BAND_WORDS[named]
    return band ? { kind: 'band', band } : null
  }
  if (key === 'is') return value.toLowerCase() === 'pending' ? { kind: 'pending' } : null
  if (key === 'source') return { kind: 'source', source: value }
  if (key === 'type') return { kind: 'type', type: value }
  return null
}

/** Splits a query into its tokens and free text; quotes keep a phrase together. */
export function parseQuery(query: string): ParsedQuery {
  const tokens: Token[] = []
  const words: string[] = []
  for (const raw of query.match(/"[^"]*"|\S+/g) ?? []) {
    const parsed = raw.startsWith('"') ? null : token(raw)
    if (parsed) tokens.push(parsed)
    else words.push(raw)
  }
  return { tokens, text: words.join(' ') }
}

/** What a token reads of a record: the graph's trust summary. */
export interface TokenSubject {
  type: string
  confidence: number | null
  band: Band | null
  pending: boolean
  /** Its sources: the source type and, when known, the instance. */
  sources: readonly { source: string; instance: string | null }[]
}

const compare = (op: '<' | '<=' | '>' | '>=' | '=', left: number, right: number) =>
  op === '<' ? left < right : op === '<=' ? left <= right : op === '>' ? left > right : op === '>=' ? left >= right : Math.abs(left - right) < 1e-9

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Whether a record passes one token. */
export function passesToken(subject: TokenSubject, token: Token): boolean {
  switch (token.kind) {
    case 'confidence':
      return subject.confidence !== null && compare(token.op, subject.confidence, token.value)
    case 'band':
      return subject.band === token.band
    case 'pending':
      return subject.pending
    case 'source':
      return subject.sources.some((each) => same(each.source, token.source) || (each.instance !== null && same(each.instance, token.source)))
    case 'sources':
      return compare(token.op, subject.sources.length, token.count)
    case 'type':
      return same(subject.type, token.type)
  }
}

/** Whether a record passes every token. */
export const passesTokens = (subject: TokenSubject, tokens: readonly Token[]): boolean => tokens.every((each) => passesToken(subject, each))
