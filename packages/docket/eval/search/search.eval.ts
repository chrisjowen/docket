import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { lexicalSearch, type DocumentRecord } from '@docket/adapter-jsonl'
import type { Chat } from '@docket/adapter-kit'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { claudeChat } from '../../src/llm/claude-chat.js'
import { splitOf, writeDocket, type Corpus } from './corpus.js'
import { loadAcme } from './datasets/acme.js'
import { dataDir, MissingData, type QueryBudget } from './datasets/common.js'
import { loadCrm } from './datasets/crm.js'
import { loadLocomo } from './datasets/locomo.js'
import { loadPeople } from './datasets/people.js'
import { loadScifact } from './datasets/scifact.js'
import { loadWands } from './datasets/wands.js'
import { contextualText, embedAll, Engine, mem0Text, ollamaEmbedder, type Embedder, type VectorIndex } from './engine.js'
import { percentile, summarise, macroAverage, type QueryOutcome, type Summary } from './metrics.js'
import { report, type RunInfo } from './report.js'
import {
  agenticStrategy,
  concatenated,
  confidenceStrategy,
  currentStrategy,
  floored,
  floorRrfStrategy,
  floorStrategy,
  fused,
  precachedAnswer,
  precachedStrategy,
  retrieve,
  retrievePrecached,
  SOURCE_LIMIT,
  type FloorParams,
  type Retrieval,
  type Strategy
} from './strategies.js'

/*
 * The search evaluation (README.md): every corpus written out as a docket and
 * synced, every strategy asked its test queries, and the results written to
 * report.md and outcomes.json. It needs Ollama for embeddings (and for the
 * agentic strategy, a chat model), so it never runs with the tests; without
 * Ollama it is skipped, saying why.
 */

const env = process.env
const OLLAMA_URL = env.DOCKET_EVAL_OLLAMA_URL ?? 'http://localhost:11434'
const EMBEDDER = env.DOCKET_EVAL_EMBEDDER ?? 'nomic-embed-text'
const AGENT = env.DOCKET_EVAL_AGENT ?? 'ollama:qwen2.5:7b'
const OUT = env.DOCKET_EVAL_OUT ?? join(tmpdir(), `docket-search-eval-${Date.now()}`)
const WORK = env.DOCKET_EVAL_WORK ?? join(OUT, 'dockets')
const BUDGET: QueryBudget = { answerable: Number(env.DOCKET_EVAL_QUERIES ?? 60), noAnswer: Number(env.DOCKET_EVAL_NO_ANSWER ?? 20) }
const ONLY_CORPORA = env.DOCKET_EVAL_CORPORA?.split(',').map((name) => name.trim()).filter(Boolean)
const ONLY_STRATEGIES = env.DOCKET_EVAL_STRATEGIES?.split(',').map((name) => name.trim()).filter(Boolean)
/** At most this many test queries per corpus for the agentic strategy, which is slow. */
const AGENTIC_MAX = Number(env.DOCKET_EVAL_AGENTIC_MAX ?? Number.POSITIVE_INFINITY)

const LOADERS: { name: string; load: () => Promise<Corpus> }[] = [
  { name: 'people', load: loadPeople },
  { name: 'acme', load: loadAcme },
  { name: 'crm', load: () => loadCrm(BUDGET) },
  { name: 'locomo', load: () => loadLocomo(BUDGET) },
  { name: 'scifact', load: () => loadScifact(BUDGET) },
  { name: 'wands', load: () => loadWands(BUDGET) }
]

/** An Ollama chat model asked for JSON, at temperature 0. */
const ollamaJsonChat =
  (model: string): Chat =>
  async (prompt) => {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0, num_ctx: 8192 },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ]
      })
    })
    if (!response.ok) throw new Error(`Ollama ${model} failed: ${response.status} ${await response.text()}`)
    return ((await response.json()) as { message?: { content?: string } }).message?.content ?? ''
  }

const agentChat = (): Chat => {
  const [provider, ...rest] = AGENT.split(':')
  const model = rest.join(':')
  if (provider === 'ollama' && model) return ollamaJsonChat(model)
  if (provider === 'claude') return claudeChat({ ...(model ? { model } : {}), timeoutMs: 180_000 })
  throw new Error(`DOCKET_EVAL_AGENT must be ollama:<model> or claude[:<model>], got "${AGENT}"`)
}

/** Why the evaluation cannot run here, or null. */
const unavailable = async (): Promise<string | null> => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
    const { models } = (await response.json()) as { models: { name: string }[] }
    const names = new Set(models.flatMap((model) => [model.name, model.name.replace(/:latest$/, '')]))
    if (!names.has(EMBEDDER)) return `the embedding model ${EMBEDDER} is not pulled: run ollama pull ${EMBEDDER}`
    const [provider, ...rest] = AGENT.split(':')
    if (provider === 'ollama' && !names.has(rest.join(':')) && (!ONLY_STRATEGIES || ONLY_STRATEGIES.includes('agentic'))) {
      return `the agentic model ${rest.join(':')} is not pulled: run ollama pull ${rest.join(':')}, or set DOCKET_EVAL_STRATEGIES without agentic`
    }
    return null
  } catch {
    return `Ollama is not reachable at ${OLLAMA_URL}`
  }
}

const log = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

interface Prepared {
  corpus: Corpus
  engine: Engine
  mem0: VectorIndex
  contextual: VectorIndex
  info: RunInfo['corpora'][number]
}

const prepare = async (corpus: Corpus, embedder: Embedder): Promise<Prepared> => {
  const dir = join(WORK, corpus.name)
  const { syncMs } = await writeDocket(corpus, dir)
  const ontology = parse(await readFile(join(dir, '.docket', 'entities.yaml'), 'utf8')) as { resourceTypes: Record<string, unknown> }
  const types = Object.keys(ontology.resourceTypes)
  const engine = await Engine.open(dir, types)
  const started = performance.now()
  const cacheDir = join(dataDir(), 'embeddings')
  const progress = (label: string) => (done: number, total: number) => {
    if (done === total || done % 640 === 0) log(`  ${corpus.name}: embedded ${done}/${total} ${label}`)
  }
  const mem0 = await embedAll(embedder, new Map(engine.entities.map((entity) => [entity.id, mem0Text(engine, entity)])), cacheDir, progress('mem0 texts'))
  const contextual = await embedAll(embedder, new Map(engine.entities.map((entity) => [entity.id, contextualText(engine, entity)])), cacheDir, progress('contextual texts'))
  const embedMs = performance.now() - started

  const test = corpus.queries.filter((query) => splitOf(corpus.name, query) === 'test')
  const documents = engine.entities.map((entity) => ({ ...entity, path: '', paths: [] }) as DocumentRecord)
  const timed = (fn: (query: string) => unknown) =>
    percentile(
      test.slice(0, 10).map((query) => {
        const at = performance.now()
        fn(query.text)
        return performance.now() - at
      }),
      50
    )
  return {
    corpus,
    engine,
    mem0,
    contextual,
    info: {
      name: corpus.name,
      domain: corpus.domain,
      source: corpus.source,
      template: corpus.template,
      entities: engine.entities.length,
      links: engine.edges.length,
      types: types.length,
      typesWithEntities: new Set(engine.entities.map((entity) => entity.type)).size,
      queries: {
        dev: corpus.queries.length - test.length,
        test: test.length,
        answerable: corpus.queries.filter((query) => query.kind === 'answerable').length,
        noAnswer: corpus.queries.filter((query) => query.kind === 'no-answer').length
      },
      syncMs,
      embedMs,
      lexicalMs: { jsonl: timed((query) => lexicalSearch(documents, query, SOURCE_LIMIT)), indexed: timed((query) => engine.bm25.search(query, SOURCE_LIMIT)) }
    }
  }
}

const SEMANTIC_GRID = Array.from({ length: 61 }, (_, index) => Math.round((0.3 + index * 0.01) * 100) / 100)
const COVERAGE_GRID = Array.from({ length: 11 }, (_, index) => index / 10)

/** One dev query, retrieved once for every floor the calibration tries. */
interface DevRow {
  corpus: string
  engine: Engine
  query: Corpus['queries'][number]
  /** Each source's top 10, as docket_search asks. */
  single: Retrieval
  /** Each source's top 20, for fusion. */
  wide: Retrieval
  precached: Retrieval
}

/** A floor and how it scored on the dev queries, each corpus counting the same. */
interface Calibrated {
  floor: FloorParams
  dev: Summary
}

/** Every floor on the grid, scored on the dev queries. */
const grid = (dev: readonly DevRow[], answer: (row: DevRow, floor: FloorParams) => string[]): Calibrated[] => {
  const corpora = [...new Set(dev.map((row) => row.corpus))]
  return SEMANTIC_GRID.flatMap((semantic) =>
    COVERAGE_GRID.map((coverage) => {
      const floor = { semantic, coverage }
      const outcomes: QueryOutcome[] = dev.map((row) => ({ corpus: row.corpus, strategy: 'x', query: row.query, ids: answer(row, floor), ms: 0, llmCalls: 0, confidences: [] }))
      return { floor, dev: macroAverage(corpora.map((corpus) => summarise(outcomes.filter((outcome) => outcome.corpus === corpus)))) }
    })
  )
}

/** The floor with the best balanced score - nDCG@10 on answerable queries plus the share of no-answer queries answered with nothing, halved. */
const mostBalanced = (scored: readonly Calibrated[]): Calibrated =>
  scored.reduce((best, item) => (item.dev.balanced > best.dev.balanced ? item : best))

/**
 * The floor with the most reply precision that gives up at most 0.02 nDCG@10
 * and no FPR against `base`: balanced alone never looks at how much of a reply
 * is noise.
 */
const mostPrecise = (scored: readonly Calibrated[], base: Calibrated): Calibrated =>
  scored
    .filter((item) => item.dev.ndcg >= base.dev.ndcg - 0.02 && item.dev.falsePositiveRate <= base.dev.falsePositiveRate)
    .reduce((best, item) => (item.dev.replyPrecision > best.dev.replyPrecision || (item.dev.replyPrecision === best.dev.replyPrecision && item.dev.balanced > best.dev.balanced) ? item : best), base)

describe('search evaluation', () => {
  it('compares search strategies across corpora', { timeout: 6 * 60 * 60 * 1000 }, async (context) => {
    const why = await unavailable()
    if (why) {
      log(`search evaluation skipped: ${why}`)
      context.skip()
      return
    }
    await mkdir(OUT, { recursive: true })
    log(`search evaluation: data ${dataDir()}, output ${OUT}`)
    const embedder = ollamaEmbedder(OLLAMA_URL, EMBEDDER)

    const prepared: Prepared[] = []
    for (const loader of LOADERS.filter((loader) => !ONLY_CORPORA || ONLY_CORPORA.includes(loader.name))) {
      try {
        const corpus = await loader.load()
        log(`${corpus.name}: ${corpus.entities.length || 'existing'} entities, ${corpus.queries.length} queries - syncing and embedding`)
        prepared.push(await prepare(corpus, embedder))
      } catch (cause) {
        if (!(cause instanceof MissingData)) throw cause
        log(`${loader.name}: skipped - ${cause.message}`)
      }
    }
    expect(prepared.length).toBeGreaterThan(0)

    log('calibrating the relevance floors on the dev queries')
    const dev: DevRow[] = []
    for (const { corpus, engine, mem0, contextual } of prepared) {
      for (const query of corpus.queries.filter((item) => splitOf(corpus.name, item) === 'dev')) {
        const wide = await retrieve(engine, mem0, embedder, query.text, 2 * SOURCE_LIMIT)
        dev.push({
          corpus: corpus.name,
          engine,
          query,
          single: { semantic: wide.semantic.slice(0, SOURCE_LIMIT), lexical: wide.lexical.slice(0, SOURCE_LIMIT) },
          wide,
          precached: await retrievePrecached(engine, contextual, embedder, query.text)
        })
      }
    }
    const floor = mostBalanced(grid(dev, (row, params) => concatenated(floored(row.single, params))))
    const floorRrf = mostBalanced(
      grid(dev, (row, params) => {
        const kept = floored(row.wide, params)
        return fused([kept.semantic, kept.lexical])
      })
    )
    const precachedGrid = grid(dev, (row, params) => precachedAnswer(row.engine, row.precached, row.query.text, params))
    const precached = mostBalanced(precachedGrid)
    const precachedPrecise = mostPrecise(precachedGrid, precached)
    const calibrated = (strategy: string, objective: RunInfo['calibration'][number]['objective'], { floor: params, dev: scores }: Calibrated): RunInfo['calibration'][number] => ({
      strategy,
      objective,
      ...params,
      devNdcg: scores.ndcg,
      devFpr: scores.falsePositiveRate,
      devReplyPrecision: scores.replyPrecision,
      devBalanced: scores.balanced
    })
    const calibration = [
      calibrated('floor', 'balanced', floor),
      calibrated('floor+rrf', 'balanced', floorRrf),
      calibrated('precached', 'balanced', precached),
      calibrated('precached+precision', 'precision', precachedPrecise)
    ]
    for (const row of calibration) log(`  ${JSON.stringify(row)}`)

    const chat = agentChat()
    const strategiesFor = (item: Prepared): Strategy[] =>
      [
        currentStrategy(item.engine, item.mem0, embedder),
        confidenceStrategy(item.engine, item.mem0, embedder),
        floorStrategy(item.engine, item.mem0, embedder, floor.floor),
        floorRrfStrategy(item.engine, item.mem0, embedder, floorRrf.floor),
        precachedStrategy(item.engine, item.contextual, embedder, precached.floor),
        precachedStrategy(item.engine, item.contextual, embedder, precachedPrecise.floor, 'precached+precision'),
        agenticStrategy(item.engine, item.mem0, embedder, chat, AGENT)
      ].filter((strategy) => !ONLY_STRATEGIES || ONLY_STRATEGIES.includes(strategy.name))

    const outcomes: QueryOutcome[] = []
    const spotlight: RunInfo['spotlight'] = []
    const warm: number[] = []
    let described: Strategy[] = []
    for (const item of prepared) {
      const strategies = strategiesFor(item)
      described = strategies
      const test = item.corpus.queries.filter((query) => splitOf(item.corpus.name, query) === 'test')
      for (const strategy of strategies) {
        const queries = strategy.name === 'agentic' && Number.isFinite(AGENTIC_MAX) ? [...test.filter((query) => query.kind === 'no-answer').slice(0, Math.ceil(AGENTIC_MAX / 4)), ...test.filter((query) => query.kind === 'answerable')].slice(0, AGENTIC_MAX) : test
        log(`${item.corpus.name}: ${strategy.name} on ${queries.length} test queries`)
        for (const query of queries) {
          const started = performance.now()
          let answer: Awaited<ReturnType<Strategy['search']>> = { ids: [], llmCalls: 0 }
          let error: string | undefined
          try {
            answer = await strategy.search(query.text)
          } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
            log(`  ${query.id}: ${error}`)
          }
          outcomes.push({
            corpus: item.corpus.name,
            strategy: strategy.name,
            query,
            ids: answer.ids,
            ms: performance.now() - started,
            llmCalls: answer.llmCalls,
            confidences: answer.ids.map((id) => item.engine.byId.get(id)?.confidence ?? Number.NaN),
            ...(error ? { error } : {})
          })
        }
        if (strategy.name === 'precached') {
          for (const query of queries) {
            const started = performance.now()
            await strategy.search(query.text)
            warm.push(performance.now() - started)
          }
        }
      }

      const absent = item.corpus.queries.find((query) => query.category === 'absent-name')
      if (absent) {
        const answers = []
        for (const strategy of strategiesFor(item)) {
          const answer = await strategy.search(absent.text).catch(() => ({ ids: [] as string[] }))
          answers.push({ strategy: strategy.name, returned: answer.ids.length, titles: answer.ids.slice(0, 3).map((id) => item.engine.byId.get(id)?.title ?? id) })
        }
        spotlight.push({ corpus: item.corpus.name, query: absent.text, answers })
      }
    }

    const info: RunInfo = {
      date: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      embedder: embedder.name,
      agent: AGENT,
      corpora: prepared.map((item) => item.info),
      strategies: described.map((strategy) => ({ name: strategy.name, description: strategy.description })),
      calibration,
      warmMs: percentile(warm, 50),
      spotlight
    }
    const markdown = report(info, outcomes)
    await writeFile(join(OUT, 'report.md'), markdown)
    await writeFile(join(OUT, 'outcomes.json'), `${JSON.stringify({ info, outcomes }, null, 2)}\n`)
    log(`\n${markdown}\nwrote ${join(OUT, 'report.md')} and outcomes.json`)
  })
})
