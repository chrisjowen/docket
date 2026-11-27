// SPDX-License-Identifier: AGPL-3.0-only
import { getContext, setContext } from 'svelte'

import type { AnswerSource } from '$lib/ask/model'

/** What the answer's components read: the records the agent found, and how the page draws and links them. */
export interface AnswerContext {
  org: string
  /** The record a reference names, or null for one the tools never returned. */
  resolve(ref: string): AnswerSource | null
  /** A cited record's footnote number. */
  footnote(source: AnswerSource): number
  /** A record type's colour in a docket, as its Record page draws it. */
  colourOf(workspace: string, type: string): string
  /** A docket's name, by slug. */
  docketName(slug: string): string
  /** The question went to several dockets: each record names its own. */
  many: boolean
  /** The record a footnote is pointing at, by key; shared with the footnotes below the answer. */
  lit: { key: string | null }
}

const KEY = Symbol('docket-answer')

export const setAnswerContext = (context: AnswerContext) => setContext(KEY, context)
export const answerContext = () => getContext<AnswerContext>(KEY)
