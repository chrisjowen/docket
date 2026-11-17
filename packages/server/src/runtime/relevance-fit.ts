import { cut, featuresOf, type Candidate, type CutModel } from './relevance.js'

/*
 * Fitting `relevance.ts`'s cut model, and scoring a search the way docket's
 * search evaluation scores it (packages/docket/eval/search/metrics.ts): the
 * search relevance evaluation (`search-relevance.int.test.ts`) runs both over
 * the evaluation's corpora projected into the cloud's own Neo4j and mem0.
 */

/** One question of the evaluation, as asked of the cloud's projections. */
export interface EvalQuestion {
  corpus: string
  id: string
  text: string
  kind: 'answerable' | 'no-answer'
  category: string
  split: 'dev' | 'test'
  /** The relevant resources, by id, with a grade: 2 answers the question, 1 is partly relevant. */
  relevant: Record<string, number>
  /** The name gate answered it with nothing (`unknownNames`). */
  gated: boolean
  candidates: Candidate[]
}

/** The cut-off every ranked metric uses: `docket_search`'s default limit. */
export const K = 10

export const ndcgAt = (ids: readonly string[], grades: Readonly<Record<string, number>>, k = K): number => {
  const dcg = (gains: readonly number[]) => gains.slice(0, k).reduce((sum, gain, rank) => sum + (2 ** gain - 1) / Math.log2(rank + 2), 0)
  const ideal = dcg(Object.values(grades).sort((a, b) => b - a))
  return ideal === 0 ? 0 : dcg(ids.map((id) => grades[id] ?? 0)) / ideal
}

export interface Scores {
  /** nDCG@10 over answerable questions. */
  ndcg: number
  /** Share of no-answer questions answered with anything. */
  fpr: number
  /** Of everything returned for answerable questions, the share relevant at any grade. */
  replyPrecision: number
  /** Results per answerable question. */
  returned: number
}

const mean = (values: readonly number[]) => (values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length)

/** One corpus's scores, from each question's answer. */
export function scoresOf(answers: readonly { question: EvalQuestion; ids: readonly string[] }[]): Scores {
  const answerable = answers.filter((answer) => answer.question.kind === 'answerable')
  const returned = answerable.flatMap((answer) => answer.ids.map((id) => (answer.question.relevant[id] ?? 0) > 0))
  return {
    ndcg: mean(answerable.map((answer) => ndcgAt(answer.ids, answer.question.relevant))),
    fpr: mean(answers.filter((answer) => answer.question.kind === 'no-answer').map((answer) => (answer.ids.length > 0 ? 1 : 0))),
    replyPrecision: returned.length === 0 ? Number.NaN : returned.filter(Boolean).length / returned.length,
    returned: mean(answerable.map((answer) => answer.ids.length))
  }
}

/** Each corpus scored on its own, then averaged, so every corpus counts the same whatever its size. */
export function macroScores(answers: readonly { question: EvalQuestion; ids: readonly string[] }[]): Scores & { byCorpus: Record<string, Scores> } {
  const corpora = [...new Set(answers.map((answer) => answer.question.corpus))]
  const byCorpus = Object.fromEntries(corpora.map((corpus) => [corpus, scoresOf(answers.filter((answer) => answer.question.corpus === corpus))]))
  const average = (key: keyof Scores) => mean(Object.values(byCorpus).map((scores) => scores[key]).filter((value) => !Number.isNaN(value)))
  return { ndcg: average('ndcg'), fpr: average('fpr'), replyPrecision: average('replyPrecision'), returned: average('returned'), byCorpus }
}

/** docket's search evaluation's balanced score: ranking the answers well (nDCG@10) and answering nothing when nothing answers (1 - FPR), equally. */
export const balanced = (scores: Scores): number => (scores.ndcg + (1 - scores.fpr)) / 2

/** Solves `a x = b` by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i] as number])
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) if (Math.abs((m[row] as number[])[col] as number) > Math.abs((m[pivot] as number[])[col] as number)) pivot = row
    ;[m[col], m[pivot]] = [m[pivot] as number[], m[col] as number[]]
    const lead = (m[col] as number[])[col] as number
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = ((m[row] as number[])[col] as number) / lead
      for (let k = col; k <= n; k += 1) (m[row] as number[])[k] = ((m[row] as number[])[k] as number) - factor * ((m[col] as number[])[k] as number)
    }
  }
  return m.map((row, i) => (row[n] as number) / (row[i] as number))
}

/**
 * Weighted, L2-regularised logistic regression by iteratively reweighted least
 * squares, over standardised features: the weights and bias of a cut model.
 */
export function fitLogistic(rows: readonly { x: readonly number[]; y: 0 | 1; weight: number }[], l2 = 1): { mean: number[]; scale: number[]; weights: number[]; bias: number } {
  const width = rows[0]?.x.length ?? 0
  const total = rows.reduce((sum, row) => sum + row.weight, 0)
  const meanOf = Array.from({ length: width }, (_, j) => rows.reduce((sum, row) => sum + row.weight * (row.x[j] as number), 0) / total)
  const scale = Array.from({ length: width }, (_, j) => {
    const variance = rows.reduce((sum, row) => sum + row.weight * ((row.x[j] as number) - (meanOf[j] as number)) ** 2, 0) / total
    return Math.sqrt(variance) || 1
  })
  const xs = rows.map((row) => [1, ...row.x.map((value, j) => (value - (meanOf[j] as number)) / (scale[j] as number))])
  let beta = new Array<number>(width + 1).fill(0)
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const hessian = Array.from({ length: width + 1 }, (_, i) => Array.from({ length: width + 1 }, (_, j) => (i === j && i > 0 ? l2 : 0)))
    const gradient = beta.map((value, i) => (i > 0 ? -l2 * value : 0))
    rows.forEach((row, index) => {
      const x = xs[index] as number[]
      const p = 1 / (1 + Math.exp(-x.reduce((sum, value, i) => sum + value * (beta[i] as number), 0)))
      const w = row.weight * Math.max(p * (1 - p), 1e-9)
      for (let i = 0; i <= width; i += 1) {
        gradient[i] = (gradient[i] as number) + row.weight * (row.y - p) * (x[i] as number)
        for (let j = 0; j <= width; j += 1) (hessian[i] as number[])[j] = ((hessian[i] as number[])[j] as number) + w * (x[i] as number) * (x[j] as number)
      }
    })
    const step = solve(hessian, gradient)
    beta = beta.map((value, i) => value + (step[i] as number))
    if (Math.max(...step.map(Math.abs)) < 1e-8) break
  }
  return { mean: meanOf, scale, weights: beta.slice(1), bias: beta[0] as number }
}

/** What a cut model answers each question with: nothing when the gate fired. */
export const answersOf = (model: CutModel, questions: readonly EvalQuestion[], limit = K) =>
  questions.map((question) => ({ question, ids: question.gated ? [] : cut(model, question.candidates, limit).map((kept) => kept.id) }))

export const THRESHOLDS = [0.02, 0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9]
export const RATIOS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]

/**
 * A cut model over `features`, fitted on the dev questions, each corpus's
 * candidates weighing the same in all. Where it cuts is the grid point that,
 * ranking at least `minNdcg` on the dev questions (the ranking floor), has
 * the highest balanced score plus reply precision there - ranking the answers
 * well, answering nothing when nothing answers, and returning little noise;
 * with no such point, the best-ranking one.
 */
export function fitCut(options: { name: string; reranker: string | null; features: readonly string[]; dev: readonly EvalQuestion[]; minNdcg: number; l2?: number }): { model: CutModel; dev: Scores } {
  const asked = options.dev.filter((question) => !question.gated && question.candidates.length > 0)
  const perCorpus = new Map<string, number>()
  for (const question of asked) perCorpus.set(question.corpus, (perCorpus.get(question.corpus) ?? 0) + question.candidates.length)
  const rows = asked.flatMap((question) => {
    const weight = 1 / ((perCorpus.get(question.corpus) as number) * perCorpus.size)
    return featuresOf(question.candidates).map((features, index) => ({
      x: options.features.map((name) => features[name] ?? 0),
      y: ((question.relevant[(question.candidates[index] as Candidate).id] ?? 0) > 0 ? 1 : 0) as 0 | 1,
      weight: weight * asked.length
    }))
  })
  const fitted = fitLogistic(rows, options.l2 ?? 1)
  const score = (dev: Scores): [number, number] => (dev.ndcg >= options.minNdcg ? [1, balanced(dev) + dev.replyPrecision] : [0, dev.ndcg])
  let best: { model: CutModel; dev: Scores; score: [number, number] } | null = null
  for (const answer of THRESHOLDS) {
    for (const threshold of THRESHOLDS.filter((value) => value <= answer)) {
      for (const ratio of RATIOS) {
        const model: CutModel = { name: options.name, reranker: options.reranker, features: options.features, ...fitted, answer, threshold, ratio }
        const dev = macroScores(answersOf(model, options.dev))
        const at = score(dev)
        if (!best || at[0] > best.score[0] || (at[0] === best.score[0] && at[1] > best.score[1])) best = { model, dev, score: at }
      }
    }
  }
  return { model: (best as { model: CutModel }).model, dev: (best as { dev: Scores }).dev }
}
