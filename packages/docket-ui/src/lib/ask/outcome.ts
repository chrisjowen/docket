import {
  ContractError,
  validateAdapterAnswer,
  type AdapterAnswer,
  type ResultBlock,
  type ResultKind,
  type RetrievedEvidence
} from '@docket/contracts'

import type { AdapterResult, CoordinatedAnswer, Synthesis, SynthesisNotice } from './wire.js'

/*
 * What the Ask workspace draws: a coordinated answer with every adapter's part
 * validated against the contracts on its own, so one adapter breaking the
 * contract fails only that adapter.
 */

export const RESULT_KINDS: readonly ResultKind[] = ['entities', 'passages', 'facts', 'graph', 'metric', 'table', 'timeline']

/** A block of a kind this UI has no renderer for - a newer contract's. Shown as structured data, never run. */
export interface UnknownBlock {
  id: string
  kind: string
  title?: string
  evidenceIds: string[]
  /** Everything it carried, for the structured fallback. */
  raw: Record<string, unknown>
}

export type ShownBlock = { known: true; block: ResultBlock } | { known: false; block: UnknownBlock }

export interface AnsweredResult {
  adapter: string
  state: 'answered'
  answer: AdapterAnswer
  /** Every block in the order the adapter gave them, known kinds and unknown alike. */
  blocks: ShownBlock[]
  evidence: Map<string, RetrievedEvidence>
  durationMs?: number
}

export interface FailedResult {
  adapter: string
  state: 'failed'
  error: { code: string; message: string; retryable?: boolean }
  /** How the answer broke the contract, when that is why it failed. */
  issues?: readonly string[]
  durationMs?: number
}

export type ShownResult = AnsweredResult | FailedResult

/** Which API answered: the coordinator, or the legacy search and chat endpoints translated. */
export type AnswerSource = 'coordinator' | 'legacy-ask' | 'legacy-chat'

export interface AskOutcome {
  requestId: string
  question: string
  results: ShownResult[]
  synthesis: Synthesis | null
  notice?: SynthesisNotice
  connections: NonNullable<CoordinatedAnswer['connections']>
  diagnostics: CoordinatedAnswer['diagnostics']
  via: AnswerSource
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isKnownKind = (kind: unknown): kind is ResultKind =>
  typeof kind === 'string' && (RESULT_KINDS as readonly string[]).includes(kind)

const unknownBlock = (value: unknown, index: number): UnknownBlock => {
  const raw = isObject(value) ? value : { value }
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : `block-${index}`,
    kind: typeof raw.kind === 'string' ? raw.kind : 'unknown',
    ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
    evidenceIds: Array.isArray(raw.evidenceIds) ? raw.evidenceIds.filter((id): id is string => typeof id === 'string') : [],
    raw
  }
}

/**
 * Validates one adapter's answer. Blocks of unknown kinds are set aside for the
 * structured fallback - the contract's union cannot know them - and the rest
 * must pass the contract validators in full.
 */
export const showAnswer = (adapter: string, value: unknown, durationMs?: number): ShownResult => {
  const timing = durationMs === undefined ? {} : { durationMs }
  const blocks = isObject(value) && Array.isArray(value.blocks) ? (value.blocks as unknown[]) : null
  /** Where each block the validator sees sat in the adapter's own list. */
  const positions: number[] = []
  const unknown = new Map<number, UnknownBlock>()
  blocks?.forEach((block, index) => {
    if (isObject(block) && isKnownKind(block.kind)) positions.push(index)
    else unknown.set(index, unknownBlock(block, index))
  })

  let answer: AdapterAnswer
  try {
    const known = blocks ? positions.map((index) => blocks[index]) : undefined
    answer = validateAdapterAnswer(blocks ? { ...(value as object), blocks: known } : value)
  } catch (cause) {
    if (!(cause instanceof ContractError)) throw cause
    // Point each issue at the block the adapter sent, not its place among the known ones.
    const issues = cause.issues.map((issue) =>
      issue.replace(/^blocks\.(\d+)/, (whole, at: string) => `blocks.${positions[Number(at)] ?? at}`)
    )
    return {
      adapter,
      state: 'failed',
      error: { code: 'invalid-answer', message: `${adapter} returned an answer that breaks the adapter contract.` },
      issues,
      ...timing
    }
  }

  const shown: ShownBlock[] = []
  let next = 0
  for (let index = 0; index < (blocks?.length ?? 0); index += 1) {
    const set = unknown.get(index)
    if (set) shown.push({ known: false, block: set })
    else {
      const block = answer.blocks[next]
      next += 1
      if (block) shown.push({ known: true, block })
    }
  }
  return {
    adapter,
    state: 'answered',
    answer,
    blocks: shown,
    evidence: new Map(answer.evidence.map((item) => [item.id, item])),
    ...timing
  }
}

const showResult = (result: AdapterResult): ShownResult =>
  result.state === 'answered'
    ? showAnswer(result.adapter, result.answer, result.durationMs)
    : {
        adapter: result.adapter,
        state: 'failed',
        error: result.error,
        ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs })
      }

/** Thrown when the response is not a coordinated answer at all. */
export class AnswerShapeError extends Error {
  override name = 'AnswerShapeError'
}

const isResult = (value: unknown): value is AdapterResult =>
  isObject(value) &&
  typeof value.adapter === 'string' &&
  ((value.state === 'answered' && 'answer' in value) ||
    (value.state === 'failed' && isObject(value.error) && typeof value.error.message === 'string'))

/** A coordinated answer, every adapter's part validated independently. */
export const showOutcome = (value: unknown, via: AnswerSource): AskOutcome => {
  if (!isObject(value) || !Array.isArray(value.results) || typeof value.question !== 'string') {
    throw new AnswerShapeError('The server answered, but not with a coordinated answer.')
  }
  const results = value.results.map((result, index): ShownResult =>
    isResult(result)
      ? showResult(result)
      : {
          adapter: isObject(result) && typeof result.adapter === 'string' ? result.adapter : `result ${index + 1}`,
          state: 'failed',
          error: { code: 'invalid-result', message: 'The coordinator returned a result this UI cannot read.' }
        }
  )
  const answer = value as unknown as CoordinatedAnswer
  return {
    requestId: typeof answer.requestId === 'string' ? answer.requestId : '',
    question: answer.question,
    results,
    synthesis: isObject(answer.synthesis) && typeof answer.synthesis.text === 'string' ? answer.synthesis : null,
    ...(isObject(answer.notice) ? { notice: answer.notice } : {}),
    connections: Array.isArray(answer.connections) ? answer.connections : [],
    diagnostics: Array.isArray(answer.diagnostics) ? answer.diagnostics : [],
    via
  }
}

export type EvidenceIndex = Map<string, { adapter: string; evidence: RetrievedEvidence }>

/** Every evidence item across the outcome, by id. Ids are namespaced by the coordinator, so they do not collide. */
export const evidenceIndex = (outcome: AskOutcome): EvidenceIndex => {
  const index: EvidenceIndex = new Map()
  for (const result of outcome.results) {
    if (result.state !== 'answered') continue
    for (const evidence of result.answer.evidence) {
      if (!index.has(evidence.id)) index.set(evidence.id, { adapter: result.adapter, evidence })
    }
  }
  return index
}

/** One adapter's reading of a metric that more than one adapter returned. */
export interface MetricReading {
  adapter: string
  blockId: string
  value: number
  unit?: string
  coverage: AdapterAnswer['coverage']['mode']
}

export interface MetricComparison {
  label: string
  readings: MetricReading[]
  /** Every reading has the same value and unit. */
  agree: boolean
}

/**
 * Metrics with the same label from more than one adapter, side by side - so
 * a disagreement is shown, never blended into one number.
 */
export const compareMetrics = (outcome: AskOutcome): MetricComparison[] => {
  const groups = new Map<string, { label: string; readings: MetricReading[] }>()
  for (const result of outcome.results) {
    if (result.state !== 'answered') continue
    for (const { known, block } of result.blocks) {
      if (!known || block.kind !== 'metric') continue
      const key = block.label.trim().toLowerCase()
      const group = groups.get(key) ?? { label: block.label, readings: [] }
      group.readings.push({
        adapter: result.adapter,
        blockId: block.id,
        value: block.value,
        ...(block.unit === undefined ? {} : { unit: block.unit }),
        coverage: result.answer.coverage.mode
      })
      groups.set(key, group)
    }
  }
  return [...groups.values()]
    .filter((group) => new Set(group.readings.map((reading) => reading.adapter)).size > 1)
    .map((group) => {
      const [first] = group.readings
      return {
        ...group,
        agree: group.readings.every((reading) => reading.value === first?.value && reading.unit === first?.unit)
      }
    })
}
