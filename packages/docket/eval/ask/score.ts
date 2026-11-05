import { coarseOf, type Judgment } from './judge.js'
import { CATEGORIES, type Category } from './questions.js'

/** One question's outcome: what docket answered, and what the judge made of it. */
export interface Outcome {
  id: string
  category: Category
  question: string
  /** The summary, or why there was none. */
  answer: string
  /** Undefined when the judge's reply held no score. */
  score: Judgment | undefined
  judgeReply: string
  /** Exhibits and evidence the summary cited, of those it was given. */
  cited: number
  /** Codes of the diagnostics the answer carried. */
  diagnostics: string[]
}

export interface Tally {
  label: string
  questions: number
  correct: number
  partial: number
  missing: number
  partlyWrong: number
  wrong: number
  /** Replies the judge gave no score in, left out of every sum. */
  unscored: number
  /** Sum of the fine-grained scores. */
  fine: number
  /** Sum of the coarse scores. */
  coarse: number
}

const tally = (label: string, outcomes: readonly Outcome[]): Tally => {
  const scored = outcomes.flatMap((outcome) => (outcome.score === undefined ? [] : [outcome.score]))
  const count = (value: Judgment): number => scored.filter((score) => score === value).length
  return {
    label,
    questions: outcomes.length,
    correct: count(1),
    partial: count(0.5),
    missing: count(0),
    partlyWrong: count(-0.5),
    wrong: count(-1),
    unscored: outcomes.length - scored.length,
    fine: scored.reduce<number>((sum, score) => sum + score, 0),
    coarse: scored.reduce<number>((sum, score) => sum + coarseOf(score), 0)
  }
}

/** One row per category, then the whole set. */
export const tallies = (outcomes: readonly Outcome[]): Tally[] => [
  ...CATEGORIES.map((category) => tally(category, outcomes.filter((outcome) => outcome.category === category))).filter((row) => row.questions > 0),
  tally('all', outcomes)
]

const signed = (value: number): string => (value > 0 ? `+${value}` : String(value))

/** Truthfulness as the paper gives it - the sum of scores - with the mean per scored question beside it. */
const truthfulness = (sum: number, row: Tally): string => {
  const scored = row.questions - row.unscored
  return `${signed(sum)} (${scored === 0 ? '-' : signed(Math.round((sum / scored) * 100) / 100)})`
}

/** The score table, as Markdown. */
export const scoreTable = (outcomes: readonly Outcome[]): string => {
  const header = ['category', 'n', '+1', '+0.5', '0', '-0.5', '-1', 'unscored', 'fine truthfulness', 'coarse truthfulness']
  const rows = tallies(outcomes).map((row) => [
    row.label,
    String(row.questions),
    String(row.correct),
    String(row.partial),
    String(row.missing),
    String(row.partlyWrong),
    String(row.wrong),
    String(row.unscored),
    truthfulness(row.fine, row),
    truthfulness(row.coarse, row)
  ])
  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}

/**
 * What the summaries cited: answers that were not abstentions yet cited
 * nothing they were given, and each diagnostic code the answers carried.
 */
export const citationSummary = (outcomes: readonly Outcome[]): string => {
  const uncited = outcomes.filter((outcome) => outcome.score !== undefined && outcome.score !== 0 && outcome.cited === 0).length
  const codes = new Map<string, number>()
  for (const code of outcomes.flatMap((outcome) => outcome.diagnostics)) codes.set(code, (codes.get(code) ?? 0) + 1)
  const listed = [...codes].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => `${code} ×${count}`)
  return [
    `Answers judged as answers (not 0) that cite nothing they were given: ${uncited} of ${outcomes.length}.`,
    `Answer diagnostics: ${listed.length > 0 ? listed.join(', ') : 'none'}.`
  ].join('\n')
}
