import { confidenceVersusRelevance, K, macroAverage, summarise, type QueryOutcome, type Summary } from './metrics.js'

/** What the report says about the run besides the outcomes. */
export interface RunInfo {
  date: string
  embedder: string
  agent: string
  corpora: {
    name: string
    domain: string
    source: string
    template: string
    entities: number
    links: number
    types: number
    typesWithEntities: number
    queries: { dev: number; test: number; answerable: number; noAnswer: number }
    syncMs: number
    embedMs: number
    /** docket's JSONL lexicalSearch per query, re-reading every document, against the prebuilt index. */
    lexicalMs: { jsonl: number; indexed: number }
  }[]
  strategies: { name: string; description: string }[]
  calibration: { strategy: string; semantic: number; coverage: number; devBalanced: number }[]
  /** Precached answers to the same queries asked again. */
  warmMs: number
  /** Each corpus's "who is <absent name>" query, answered by every strategy. */
  spotlight: { corpus: string; query: string; answers: { strategy: string; titles: string[]; returned: number }[] }[]
}

const f = (value: number, digits = 3): string => (Number.isNaN(value) ? '-' : value.toFixed(digits))
const ms = (value: number): string => (Number.isNaN(value) ? '-' : value < 10 ? value.toFixed(1) : Math.round(value).toString())

const table = (header: string[], rows: string[][]): string =>
  [`| ${header.join(' | ')} |`, `| ${header.map((_, index) => (index === 0 ? '---' : '---:')).join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n')

const summaryRow = (name: string, summary: Summary): string[] => [
  name,
  f(summary.ndcg),
  f(summary.precision),
  f(summary.recall),
  f(summary.mrr),
  f(summary.success, 2),
  f(summary.falsePositiveRate, 2),
  f(summary.noAnswerReturned, 1),
  f(summary.replyPrecision, 2),
  f(summary.balanced),
  ms(summary.p50Ms),
  ms(summary.p95Ms),
  f(summary.llmCalls, 1),
  f(summary.confidence, 2)
]

const SUMMARY_HEADER = [
  'strategy',
  `nDCG@${K}`,
  `P@${K}`,
  `R@${K}`,
  'MRR',
  `hit@${K}`,
  'no-answer FPR',
  'returned on no-answer',
  'reply precision',
  'balanced',
  'p50 ms',
  'p95 ms',
  'LLM calls',
  'mean confidence (not relevance)'
]

export const report = (info: RunInfo, outcomes: readonly QueryOutcome[]): string => {
  const strategies = info.strategies.map((strategy) => strategy.name)
  const corpora = info.corpora.map((corpus) => corpus.name)
  const of = (strategy: string, corpus?: string) => outcomes.filter((outcome) => outcome.strategy === strategy && (!corpus || outcome.corpus === corpus))
  const perCorpus = (strategy: string) => corpora.filter((corpus) => of(strategy, corpus).length > 0).map((corpus) => summarise(of(strategy, corpus)))
  const overall = new Map(strategies.map((strategy) => [strategy, macroAverage(perCorpus(strategy))]))

  const lines: string[] = []
  lines.push(
    '# Search evaluation results',
    '',
    `Run ${info.date}. Embedder ${info.embedder}; agentic model ${info.agent}. ` +
      'Every number is on the held-out test half of the queries; the relevance floors were tuned on the other half. ' +
      'See [README.md](README.md) for the datasets, the strategies and what each metric means.',
    '',
    '## Corpora',
    '',
    table(
      ['corpus', 'domain', 'template', 'entities', 'links', 'types (with entities)', 'test queries (no-answer)', 'sync ms', 'embed ms'],
      info.corpora.map((corpus) => [
        corpus.name,
        corpus.domain,
        corpus.template,
        String(corpus.entities),
        String(corpus.links),
        `${corpus.types} (${corpus.typesWithEntities})`,
        `${corpus.queries.test} (${outcomes.filter((outcome) => outcome.corpus === corpus.name && outcome.strategy === strategies[0] && outcome.query.kind === 'no-answer').length})`,
        ms(corpus.syncMs),
        ms(corpus.embedMs)
      ])
    ),
    '',
    'Sources:',
    '',
    ...info.corpora.map((corpus) => `- **${corpus.name}**: ${corpus.source}`),
    '',
    '## Overall',
    '',
    `Macro-averaged over the corpora, so each counts the same. Relevance metrics are over answerable queries; FPR is the share of no-answer queries that returned anything. "balanced" is (nDCG@${K} + (1 - FPR)) / 2, the objective the floors were tuned on.`,
    '',
    table(SUMMARY_HEADER, strategies.map((strategy) => summaryRow(strategy, overall.get(strategy) as Summary))),
    '',
    '## By corpus',
    ''
  )
  for (const corpus of corpora) {
    lines.push(`### ${corpus}`, '', table(SUMMARY_HEADER, strategies.filter((strategy) => of(strategy, corpus).length > 0).map((strategy) => summaryRow(strategy, summarise(of(strategy, corpus))))), '')
  }

  const categories = [...new Set(outcomes.map((outcome) => `${outcome.query.kind}/${outcome.query.category}`))].sort()
  lines.push(
    '## By query category',
    '',
    'nDCG@10 for answerable categories, and the share answered with nothing (higher is better) for no-answer ones, pooled over the corpora.',
    '',
    table(
      ['category', 'n', ...strategies],
      categories.map((category) => {
        const [kind, name] = category.split('/') as [string, string]
        const cells = strategies.map((strategy) => {
          const rows = of(strategy).filter((outcome) => outcome.query.kind === kind && outcome.query.category === name)
          if (rows.length === 0) return '-'
          const summary = summarise(rows)
          return kind === 'answerable' ? f(summary.ndcg, 2) : f(1 - summary.falsePositiveRate, 2)
        })
        return [category, String(of(strategies[0] as string).filter((outcome) => `${outcome.query.kind}/${outcome.query.category}` === category).length), ...cells]
      })
    ),
    ''
  )

  lines.push('## "Who is <absent name>"', '', 'Each corpus\'s "who is" query for a name it never mentions, answered by every strategy: how many entities came back, and the first three.', '')
  for (const spot of info.spotlight) {
    const corpus = info.corpora.find((item) => item.name === spot.corpus)
    lines.push(
      `**${spot.corpus}** - "${spot.query}". A docket_search reply today also lists all ${corpus?.types} ontology types, ${(corpus?.types ?? 0) - (corpus?.typesWithEntities ?? 0)} of them with no entities in this docket.`,
      '',
      ...spot.answers.map((answer) => `- ${answer.strategy}: ${answer.returned === 0 ? 'nothing' : `${answer.returned} - ${answer.titles.map((title) => `"${title}"`).join(', ')}${answer.returned > answer.titles.length ? ', ...' : ''}`}`),
      ''
    )
  }

  const current = confidenceVersusRelevance(of('current'))
  const filtered = new Map(of('current+confidence').map((outcome) => [`${outcome.corpus}/${outcome.query.id}`, new Set(outcome.ids)]))
  let relevantKept = 0
  let relevantAll = 0
  let irrelevantKept = 0
  let irrelevantAll = 0
  for (const outcome of of('current').filter((item) => item.query.kind === 'answerable')) {
    const kept = filtered.get(`${outcome.corpus}/${outcome.query.id}`)
    if (!kept) continue
    for (const id of outcome.ids) {
      const relevant = (outcome.query.relevant[id] ?? 0) > 0
      if (relevant) relevantAll += 1
      else irrelevantAll += 1
      if (kept.has(id) && relevant) relevantKept += 1
      if (kept.has(id) && !relevant) irrelevantKept += 1
    }
  }
  const confidenceFpr = macroAverage(perCorpus('current+confidence')).falsePositiveRate
  lines.push(
    '## Node confidence is not relevance',
    '',
    `Over everything \`current\` returned for answerable queries (${current.n} entities), relevant ones average confidence ${f(current.relevant, 3)} and irrelevant ones ${f(current.irrelevant, 3)}; ` +
      `the point-biserial correlation between confidence and relevance is ${f(current.correlation, 3)}. ` +
      'Confidence says how well an entity\'s evidence supports it, whatever was asked.',
    '',
    ...(relevantAll + irrelevantAll > 0
      ? [
          `Dropping entities below the low-confidence line (\`current+confidence\`) keeps ${f(relevantKept / Math.max(1, relevantAll), 2)} of the relevant entities \`current\` returned and ` +
            `${f(irrelevantKept / Math.max(1, irrelevantAll), 2)} of the irrelevant ones, and still answers ${f(confidenceFpr, 2)} of no-answer queries with something.`,
          ''
        ]
      : []),
    '## Speed',
    '',
    `- Precached answers to repeated queries: p50 ${ms(info.warmMs)} ms.`,
    `- docket's JSONL lexicalSearch re-tokenises every document on each query: ${info.corpora.map((corpus) => `${corpus.name} ${ms(corpus.lexicalMs.jsonl)} ms`).join(', ')} (p50), against ${info.corpora.map((corpus) => `${ms(corpus.lexicalMs.indexed)} ms`).join(', ')} with the prebuilt index every strategy here uses.`,
    '- Latency is per query on one machine, embedding the query included; agentic adds two local model calls.',
    '',
    '## Calibrated floors',
    '',
    table(
      ['strategy', 'cosine floor', 'coverage floor', 'dev balanced'],
      info.calibration.map((row) => [row.strategy, f(row.semantic, 2), f(row.coverage, 2), f(row.devBalanced)])
    ),
    '',
    '## Strategies',
    '',
    ...info.strategies.map((strategy) => `- **${strategy.name}**: ${strategy.description}`),
    ''
  )
  return lines.join('\n')
}
