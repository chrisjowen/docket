// SPDX-License-Identifier: AGPL-3.0-only
import type { ConfidenceFilter, FactFlag, FactKind, TimelineKind } from './browse'

/**
 * The graph tab's state as its address carries it, so any view, filter and
 * selection can be linked to: `?view=facts&flag=weak&single=1&focus=service.orders`,
 * or a note on the facts view: `?view=facts&open=F-007`, or the network's
 * query, maximised: `?q=orders&type=service&tag=payments&full=1`, or coloured
 * by confidence: `?colour=confidence`.
 * Defaults are left out, so the board alone stays at the bare address. The
 * selection is `focus`; an older link's `id` still reads as it.
 */
export const VIEWS = ['graph', 'facts', 'timeline', 'evidence'] as const
export type View = (typeof VIEWS)[number]

export interface BrowseState {
  view: View
  /** The selected exhibit. */
  id: string | null
  q: string
  type: string
  /** The network's query: only records with this tag. */
  tag: string
  source: string
  kind: FactKind
  confidence: ConfidenceFilter
  flag: FactFlag
  /** The facts view: only single-source facts. */
  single: boolean
  /** The facts view: only the facts about this record. */
  about: string
  show: 'all' | TimelineKind
  /** The evidence view's open document. */
  doc: string | null
  /** The evidence view: only documents with no evidence. */
  bare: boolean
  /** The facts view's note to open and bring into view: `F-007`. */
  open: string | null
  /** The network fills the screen. */
  full: boolean
  /** What the network's cards are coloured by: their type, or their confidence band. */
  colour: 'type' | 'confidence'
}

export const DEFAULT_STATE: BrowseState = {
  view: 'graph',
  id: null,
  q: '',
  type: '',
  tag: '',
  source: '',
  kind: 'all',
  confidence: 'any',
  flag: 'all',
  single: false,
  about: '',
  show: 'all',
  doc: null,
  bare: false,
  open: null,
  full: false,
  colour: 'type',
}

const oneOf = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

const MAX = 300
const textOf = (params: URLSearchParams, name: string): string => (params.get(name) ?? '').slice(0, MAX)

export function readState(params: URLSearchParams): BrowseState {
  return {
    view: oneOf(params.get('view'), VIEWS, 'graph'),
    id: textOf(params, 'focus') || textOf(params, 'id') || null,
    q: textOf(params, 'q'),
    type: textOf(params, 'type'),
    tag: textOf(params, 'tag'),
    source: textOf(params, 'source'),
    kind: oneOf(params.get('kind'), ['all', 'exhibit', 'link'] as const, 'all'),
    confidence: oneOf(params.get('confidence'), ['any', 'high', 'medium', 'low', 'unevidenced'] as const, 'any'),
    flag: oneOf(params.get('flag'), ['all', 'strong', 'weak'] as const, 'all'),
    single: params.get('single') === '1',
    about: textOf(params, 'about'),
    show: oneOf(params.get('show'), ['all', 'decision', 'event', 'observed', 'change'] as const, 'all'),
    doc: textOf(params, 'doc') || null,
    bare: params.get('bare') === '1',
    open: /^F-\d{3,}$/.test(params.get('open') ?? '') ? params.get('open') : null,
    full: params.get('full') === '1',
    colour: oneOf(params.get('colour'), ['type', 'confidence'] as const, 'type'),
  }
}

/** The state as search parameters, in a fixed order, without its defaults. */
export function writeState(state: BrowseState): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of Object.keys(DEFAULT_STATE) as (keyof BrowseState)[]) {
    const value = state[key]
    if (value === DEFAULT_STATE[key] || value === null || value === '') continue
    params.set(key === 'id' ? 'focus' : key, value === true ? '1' : String(value))
  }
  return params
}

/** Another view: its filters, open note and full screen start afresh; the selection and the colouring stay. */
export const switchView = (state: BrowseState, view: View): BrowseState => ({ ...DEFAULT_STATE, view, id: state.id, colour: state.colour })
