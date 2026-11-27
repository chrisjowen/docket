// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the Ask page's agent answer and the page share: how the answer names a
 * record, and which records it cites. The answer is OpenUI Lang; a record is
 * named by its id, as `docket/id` when the question went to several dockets.
 * Pure, so the server and the page agree.
 */
import type { AnswerSource } from './model'

/** A record's key across dockets: ids are unique within a docket only. */
export const sourceKey = (source: Pick<AnswerSource, 'workspace' | 'id'>): string => `${source.workspace}/${source.id}`

/**
 * The record `ref` names among `sources`: `docket/id` exactly, else the first
 * record with that id. Null for a record the tools never returned.
 */
export function resolveRef(ref: string, sources: readonly AnswerSource[]): AnswerSource | null {
  const slash = ref.indexOf('/')
  if (slash > 0) {
    const workspace = ref.slice(0, slash)
    const id = ref.slice(slash + 1)
    const exact = sources.find((source) => source.workspace === workspace && source.id === id)
    if (exact) return exact
  }
  return sources.find((source) => source.id === ref) ?? null
}

/** `[ref]` citations in prose: anything in square brackets with no spaces, as the memo's footnotes read them. */
const CITATION = /\[([^[\]\s]+)\]/g

export type AnswerSegment = { text: string } | { cite: AnswerSource; ref: string }

/** Prose split into its words and its citations of the records `find` knows; a bracket naming none stays prose. */
export function answerSegments(text: string, find: (ref: string) => AnswerSource | null): AnswerSegment[] {
  const segments: AnswerSegment[] = []
  let rest = ''
  let last = 0
  for (const match of text.matchAll(CITATION)) {
    const ref = match[1] ?? ''
    const cite = find(ref)
    if (!cite) continue
    rest += text.slice(last, match.index)
    if (rest) segments.push({ text: rest })
    rest = ''
    segments.push({ cite, ref })
    last = (match.index ?? 0) + match[0].length
  }
  rest += text.slice(last)
  if (rest) segments.push({ text: rest })
  return segments
}

/** The props that name a record (a card, a list item, a table row) and the props that hold prose citing them; a heading cites nothing. */
const REF_PROPS = new Set(['id'])
const PROSE_PROPS = new Set(['text', 'note', 'cells'])
const UNCITED = new Set(['Heading'])

type Node = { type?: unknown; typeName?: unknown; props?: unknown }

/**
 * Every record reference in a parsed answer, in reading order: the `id` a
 * card, item or row names and the `[ref]` citations in its prose.
 */
export function referencesIn(root: unknown): string[] {
  const refs: string[] = []
  const visit = (value: unknown, prose: boolean) => {
    if (typeof value === 'string') {
      if (prose) for (const match of value.matchAll(CITATION)) refs.push(match[1] ?? '')
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, prose)
      return
    }
    if (typeof value !== 'object' || value === null) return
    const node = value as Node
    if (node.type !== 'element' || typeof node.props !== 'object' || node.props === null) return
    const cites = !UNCITED.has(String(node.typeName))
    for (const [name, prop] of Object.entries(node.props as Record<string, unknown>)) {
      if (REF_PROPS.has(name) && typeof prop === 'string') refs.push(prop)
      else visit(prop, cites && PROSE_PROPS.has(name))
    }
  }
  visit(root, false)
  return refs
}

/** The records an answer cites, each once, in the order first cited; and the references that name no record the tools returned. */
export function citedSources(refs: readonly string[], sources: readonly AnswerSource[]): { cited: AnswerSource[]; unknown: string[] } {
  const cited: AnswerSource[] = []
  const unknown: string[] = []
  for (const ref of refs) {
    const source = resolveRef(ref, sources)
    if (!source) {
      if (!unknown.includes(ref)) unknown.push(ref)
    } else if (!cited.includes(source)) cited.push(source)
  }
  return { cited, unknown }
}
