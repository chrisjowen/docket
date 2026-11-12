import { relevantIds, type EvalQuery } from './corpus.js'

/*
 * Relevance, accuracy and speed of one strategy's answers (README.md). Every
 * relevance metric reads only the query's graded relevance; an entity's node
 * confidence is reported in its own column and enters no other.
 */

/** The cut-off every ranked metric uses: docket_search's default limit. */
export const K = 10

/** One query answered by one strategy. */
export interface QueryOutcome {
  corpus: string
  strategy: string
  query: EvalQuery
  /** Returned ids, most relevant first. */
  ids: string[]
  ms: number
  llmCalls: number
  /** The node confidence of each returned id, in order. Never used to score relevance. */
  confidences: number[]
  /** Set when the strategy failed on this query; it then counts as an empty answer. */
  error?: string
}

export const precisionAt = (ids: readonly string[], relevant: ReadonlySet<string>, k = K): number =>
  ids.slice(0, k).filter((id) => relevant.has(id)).length / k

export const recallAt = (ids: readonly string[], relevant: ReadonlySet<string>, k = K): number =>
  relevant.size === 0 ? 0 : ids.slice(0, k).filter((id) => relevant.has(id)).length / relevant.size

/** 1 / rank of the first relevant id within the cut-off, or 0. */
export const reciprocalRank = (ids: readonly string[], relevant: ReadonlySet<string>, k = K): number => {
  const rank = ids.slice(0, k).findIndex((id) => relevant.has(id))
  return rank < 0 ? 0 : 1 / (rank + 1)
}

/** nDCG with graded gains 2^grade - 1 (Järvelin and Kekäläinen, 2002). */
export const ndcgAt = (ids: readonly string[], grades: Readonly<Record<string, number>>, k = K): number => {
  const dcg = (gains: readonly number[]): number => gains.slice(0, k).reduce((sum, gain, rank) => sum + (2 ** gain - 1) / Math.log2(rank + 2), 0)
  const ideal = dcg(Object.values(grades).sort((a, b) => b - a))
  return ideal === 0 ? 0 : dcg(ids.map((id) => grades[id] ?? 0)) / ideal
}

const mean = (values: readonly number[]): number => (values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length)

export const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] as number
}

/** One strategy's scores over a set of outcomes. */
export interface Summary {
  answerable: number
  noAnswer: number
  /** Answerable queries. */
  ndcg: number
  precision: number
  recall: number
  mrr: number
  /** Share with at least one relevant entity in the top 10. */
  success: number
  /** Share answered with nothing although the docket holds the answer. */
  emptyAnswerable: number
  /** No-answer queries: share that returned anything at all. */
  falsePositiveRate: number
  /** No-answer queries: entities returned, on average. */
  noAnswerReturned: number
  /** Of everything returned for answerable queries, the share that is relevant at any grade. */
  replyPrecision: number
  /** Entities returned per query. */
  replySize: number
  /** (nDCG on answerable + share of no-answer queries answered with nothing) / 2. */
  balanced: number
  p50Ms: number
  p95Ms: number
  llmCalls: number
  /** Mean node confidence of what was returned: how well supported, not how relevant. */
  confidence: number
  errors: number
}

export const summarise = (outcomes: readonly QueryOutcome[]): Summary => {
  const answerable = outcomes.filter((outcome) => outcome.query.kind === 'answerable')
  const noAnswer = outcomes.filter((outcome) => outcome.query.kind === 'no-answer')
  const per = (fn: (outcome: QueryOutcome) => number) => mean(answerable.map(fn))
  const returned = answerable.flatMap((outcome) => outcome.ids.map((id) => (outcome.query.relevant[id] ?? 0) > 0))
  const ndcg = per((outcome) => ndcgAt(outcome.ids, outcome.query.relevant))
  const falsePositiveRate = mean(noAnswer.map((outcome) => (outcome.ids.length > 0 ? 1 : 0)))
  return {
    answerable: answerable.length,
    noAnswer: noAnswer.length,
    ndcg,
    precision: per((outcome) => precisionAt(outcome.ids, relevantIds(outcome.query))),
    recall: per((outcome) => recallAt(outcome.ids, relevantIds(outcome.query))),
    mrr: per((outcome) => reciprocalRank(outcome.ids, relevantIds(outcome.query))),
    success: per((outcome) => (reciprocalRank(outcome.ids, relevantIds(outcome.query)) > 0 ? 1 : 0)),
    emptyAnswerable: per((outcome) => (outcome.ids.length === 0 ? 1 : 0)),
    falsePositiveRate,
    noAnswerReturned: mean(noAnswer.map((outcome) => outcome.ids.length)),
    replyPrecision: returned.length === 0 ? Number.NaN : returned.filter(Boolean).length / returned.length,
    replySize: mean(outcomes.map((outcome) => outcome.ids.length)),
    balanced: (ndcg + (1 - falsePositiveRate)) / 2,
    p50Ms: percentile(outcomes.map((outcome) => outcome.ms), 50),
    p95Ms: percentile(outcomes.map((outcome) => outcome.ms), 95),
    llmCalls: mean(outcomes.map((outcome) => outcome.llmCalls)),
    confidence: mean(outcomes.flatMap((outcome) => outcome.confidences)),
    errors: outcomes.filter((outcome) => outcome.error).length
  }
}

/** The mean of each numeric field across summaries: every corpus counts the same, whatever its size. */
export const macroAverage = (summaries: readonly Summary[]): Summary => {
  const keys = Object.keys(summaries[0] ?? {}) as (keyof Summary)[]
  return Object.fromEntries(
    keys.map((key) => {
      const values = summaries.map((summary) => summary[key]).filter((value) => !Number.isNaN(value))
      return [key, key === 'answerable' || key === 'noAnswer' || key === 'errors' ? values.reduce((sum, value) => sum + value, 0) : mean(values)]
    })
  ) as unknown as Summary
}

/**
 * How node confidence relates to relevance among returned entities: the mean
 * confidence of relevant and of irrelevant ones, and their point-biserial
 * correlation. Near zero says confidence cannot stand in for relevance.
 */
export const confidenceVersusRelevance = (outcomes: readonly QueryOutcome[]): { relevant: number; irrelevant: number; correlation: number; n: number } => {
  const pairs = outcomes
    .filter((outcome) => outcome.query.kind === 'answerable')
    .flatMap((outcome) => outcome.ids.map((id, index) => ({ confidence: outcome.confidences[index] as number, relevant: (outcome.query.relevant[id] ?? 0) > 0 ? 1 : 0 })))
  const xs = pairs.map((pair) => pair.confidence)
  const ys = pairs.map((pair) => pair.relevant)
  const mx = mean(xs)
  const my = mean(ys)
  let cov = 0
  let vx = 0
  let vy = 0
  pairs.forEach((_, index) => {
    cov += ((xs[index] as number) - mx) * ((ys[index] as number) - my)
    vx += ((xs[index] as number) - mx) ** 2
    vy += ((ys[index] as number) - my) ** 2
  })
  return {
    relevant: mean(pairs.filter((pair) => pair.relevant).map((pair) => pair.confidence)),
    irrelevant: mean(pairs.filter((pair) => !pair.relevant).map((pair) => pair.confidence)),
    correlation: vx === 0 || vy === 0 ? 0 : cov / Math.sqrt(vx * vy),
    n: pairs.length
  }
}
