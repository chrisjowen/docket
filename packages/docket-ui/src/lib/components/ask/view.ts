import { getContext, setContext } from 'svelte'

import type { Casebook } from '$lib/ask/evidence.js'
import type { AnsweredResult } from '$lib/ask/outcome.js'

/** What every Ask renderer reads: the loaded casebook, and how to label evidence. */
export interface AskView {
  casebook: Casebook
  /** `E3`: the evidence's place in its adapter's answer, so a label reads the same everywhere. */
  label: (result: AnsweredResult, evidenceId: string) => string
}

const KEY = Symbol('ask-view')

export const setAskView = (view: AskView): void => {
  setContext(KEY, view)
}

export const getAskView = (): AskView => getContext<AskView>(KEY)

export const evidenceLabel = (result: AnsweredResult, evidenceId: string): string => {
  const index = result.answer.evidence.findIndex((item) => item.id === evidenceId)
  return index < 0 ? evidenceId : `E${index + 1}`
}
