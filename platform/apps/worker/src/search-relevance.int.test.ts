// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hashContent } from '@chrisjowen/docket/source/hashing'
import { toSearchResult } from '@chrisjowen/docket/query/legacy'
import { putDocument, type MemoryEntity } from '@docket/platform-canonical-store'
import { TEST_STORES } from '@docket/platform-projections/testing'
import { qdrantProvisioner } from '@docket/platform-provisioner'
import { describe, expect, it } from 'vitest'

import { askProjections, MAX_RERANKED, POOL_PER_SOURCE, searchCandidates, type Asked } from './query.js'
import { answersOf, balanced, fitCut, K, macroScores, type EvalQuestion, type Scores } from './relevance-fit.js'
import { CUT_MODEL, RERANKED_FEATURES, RETRIEVAL_CUT_MODEL, RETRIEVAL_FEATURES } from './relevance-model.js'
import { unknownNames, vocabularyOf, type Candidate, type CutModel } from './relevance.js'
import { localReranker, RERANKER_MODEL, type Reranker, type RerankerModel } from './reranker.js'
import { createHarness, HAVE_STACK } from './testing.js'

/**
 * The search relevance evaluation: docket's search evaluation corpora
 * (packages/docket/eval/search, each written out as a docket with its queries
 * and their dev/test split), projected into the cloud's own Neo4j and mem0 -
 * the projectors `docket_search` reads, whose scores the cut model is fitted
 * on - and every question asked through the worker's own search path. It
 * writes each corpus's candidate pools with every re-ranker's scores, fits the
 * cut models on the dev questions, scores them on the test questions against
 * the search as it was, and writes `report.md` and `models.json`. Off by
 * default: it needs the stack, Ollama with nomic-embed-text, and the corpora:
 *
 *   DOCKET_SEARCH_EVAL_CORPORA=<dir> [DOCKET_SEARCH_EVAL_OUT=<dir>] [DOCKET_SEARCH_EVAL_RERANKERS=minilm,bge-base,mxbai-xsmall] \
 *     pnpm --filter @docket/server-worker exec vitest run src/search-relevance.int.test.ts
 *
 * Pools already written to the output directory are reused.
 */
const env = process.env
const CORPORA = env.DOCKET_SEARCH_EVAL_CORPORA
const OUT = env.DOCKET_SEARCH_EVAL_OUT ?? join(tmpdir(), 'docket-search-relevance')
const EMBEDDER = env.DOCKET_SEARCH_EVAL_EMBEDDER ?? 'http://127.0.0.1:11434'
const MODELS = env.DOCKET_SEARCH_EVAL_MODELS ?? join(OUT, 'models')
const RUN = HAVE_STACK && Boolean(CORPORA)
/**
 * Hits pooled from each projection, and candidates kept, deeper than the
 * search asks for: the cut models are fitted at the search's own depth
 * (`POOL_PER_SOURCE`), and deeper pools reported beside them.
 */
const POOLED = 20
const POOLED_CANDIDATES = 30
/** The ranking the cut must keep: docket's search evaluation's `precached` search (its RESULTS.md), test nDCG@10. */
const PRECACHED_NDCG = 0.632

/** The re-rankers compared: the one in use, and two larger ones for what quality costs. */
const COMPARED: Record<string, RerankerModel> = {
  minilm: RERANKER_MODEL,
  'bge-base': {
    name: 'BAAI/bge-reranker-base@int8',
    repo: 'Xenova/bge-reranker-base',
    revision: '280bcc27a84e0b898c251e06fddb25171bd9b101',
    onnx: 'onnx/model_quantized.onnx',
    sha256: 'dd98f3e67837d23210a6b7550c08cced4f61845b940ac45be3565840a10f3244',
  },
  'mxbai-xsmall': {
    name: 'mixedbread-ai/mxbai-rerank-xsmall-v1@int8',
    repo: 'mixedbread-ai/mxbai-rerank-xsmall-v1',
    revision: 'b5c6e9da73abc3711f593f705371cdbe9e0fe422',
    onnx: 'onnx/model_quantized.onnx',
    sha256: '15ef19a6de90be7d52b627f2c784107bd806e64826450f41fb75fa4f0179ab30',
  },
}
const RERANKERS = (env.DOCKET_SEARCH_EVAL_RERANKERS ?? Object.keys(COMPARED).join(',')).split(',').filter((name) => name in COMPARED)

interface PooledQuestion extends Omit<EvalQuestion, 'candidates'> {
  minGrade?: number
  candidates: (Omit<Candidate, 'logit'> & { logits: Record<string, number> })[]
  /** What the search as it was answered: `legacyAnswer`. */
  before: string[]
  /** Milliseconds each re-ranker took over the candidates, here. */
  rerankMs: Record<string, number>
}

/** Cosine similarity of two texts' word counts, as the search board de-duplicates notes. */
function similarity(a: string, b: string): number {
  const counts = (text: string) => {
    const vector = new Map<string, number>()
    for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1)) vector.set(word, (vector.get(word) ?? 0) + 1)
    return vector
  }
  const [left, right] = [counts(a), counts(b)]
  const norm = (vector: Map<string, number>) => Math.sqrt([...vector.values()].reduce((sum, n) => sum + n * n, 0))
  let dot = 0
  for (const [word, n] of left) dot += n * (right.get(word) ?? 0)
  return dot / (norm(left) * norm(right) || 1)
}

/**
 * `docket_search` as it was before the re-ranker: each projection's top 10,
 * relevance from rank alone, resources below confidence 0.3 left out and
 * unevidenced or near-empty ones never matched, near-duplicate notes
 * collapsed, then ranked by relevance × (0.5 + confidence × 0.5) × recency
 * and the best 10 kept. Every document was written just now, so an undated
 * resource is as recent as can be.
 */
function legacyAnswer(asked: Asked, now = Date.now()): string[] {
  const result = toSearchResult(asked.outcome)
  const entities = new Map(asked.read.entities.map((entity) => [entity.id, entity]))
  const documents = new Map(result.documents.map((document) => [document.id, document]))
  const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1)
  const unmatched = (entity: MemoryEntity) => {
    if (entity.basis === 'unevidenced' && entity.evidenceCount === 0) return true
    if (entity.evidenceCount > 0 || Object.keys(entity.attributes).length > 0 || entity.links.some((link) => link.evidenceCount > 0)) return false
    const named = new Set(words(`${entity.id} ${entity.title}`))
    return words(entity.content).filter((word) => !named.has(word)).length < 3
  }
  const found = new Map<string, number>()
  for (const source of result.sources) {
    const hits = source.hits.slice(0, K)
    hits.forEach((hit, index) => {
      const record = entities.get(hit.id) ?? documents.get(hit.id)
      if (!record || !record.title.trim() || (record.confidence !== undefined && record.confidence < 0.3)) return
      const entity = entities.get(hit.id)
      if (entity && unmatched(entity)) return
      found.set(hit.id, Math.max(found.get(hit.id) ?? 0, 1 - index / hits.length))
    })
  }
  const best = [...found.keys()].sort((a, b) => {
    const [left, right] = [entities.get(a), entities.get(b)]
    return (right?.evidenceCount ?? 0) - (left?.evidenceCount ?? 0) || (right?.confidence ?? 0) - (left?.confidence ?? 0) || (right?.content.length ?? 0) - (left?.content.length ?? 0)
  })
  const kept: string[] = []
  for (const id of best) {
    const entity = entities.get(id)
    const twin = entity?.content.trim()
      ? kept.find((other) => {
          const known = entities.get(other)
          return known?.type === entity.type && known.content.trim() !== '' && similarity(entity.content, known.content) > 0.9
        })
      : undefined
    if (twin === undefined) kept.push(id)
    else found.set(twin, Math.max(found.get(twin) as number, found.get(id) as number))
  }
  return kept
    .map((id) => {
      const record = entities.get(id) ?? documents.get(id)
      const observed = (entities.get(id)?.evidence ?? []).flatMap((evidence) => {
        const time = evidence.observedAt ? Date.parse(evidence.observedAt) : Number.NaN
        return Number.isNaN(time) ? [] : [time]
      })
      const seen = observed.length > 0 ? Math.max(...observed) : now
      const recency = 1 / (1 + Math.max(0, now - seen) / 86_400_000 / 365)
      return { id, score: (found.get(id) as number) * (0.5 + (record?.confidence ?? 0) * 0.5) * recency }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, K)
    .map((entry) => entry.id)
}

async function poolCorpus(name: string, rerankers: Record<string, Reranker>): Promise<PooledQuestion[]> {
  const dir = join(CORPORA as string, name)
  const { queries } = JSON.parse(await readFile(join(dir, 'queries.json'), 'utf8')) as {
    queries: { id: string; text: string; kind: 'answerable' | 'no-answer'; category: string; relevant: Record<string, number>; minGrade?: number; split: 'dev' | 'test' }[]
  }
  const h = await createHarness()
  const ontology = await readFile(join(dir, '.docket', 'entities.yaml'), 'utf8')
  await h.org.withOrg((ctx) =>
    ctx.tx.query(
      `INSERT INTO ontology_versions (workspace_id, number, status, yaml, yaml_hash, source, author, published_at, published_by)
       VALUES ($1, 2, 'published', $2, $3, 'import', $4, now(), $4)`,
      [h.workspaceId, ontology, hashContent(ontology), h.org.userId],
    ),
  )
  const files = (await readdir(join(dir, '.docket'), { recursive: true })).filter((file) => file.endsWith('.md') && !/(^|\/)\.(index|cache)\//.test(file))
  for (let start = 0; start < files.length; start += 500) {
    await h.org.withOrg(async (ctx) => {
      for (const file of files.slice(start, start + 500)) {
        const raw = await readFile(join(dir, '.docket', file), 'utf8')
        await putDocument(ctx, { workspaceId: h.workspaceId, path: `.docket/${file}`, raw, origin: 'cloud', actor: 'system:search-eval' })
      }
    })
  }
  const qdrant = qdrantProvisioner({ url: TEST_STORES.qdrantUrl ?? '', apiKey: TEST_STORES.qdrantApiKey, dimension: 768 })
  const qdrantOrg = `eval${h.org.orgId.slice(0, 8)}`
  await qdrant.provision({ orgId: qdrantOrg })
  try {
    const access = { ...h.access, qdrant: await qdrant.access({ orgId: qdrantOrg }, 12 * 3_600), embedder: { url: EMBEDDER, model: 'nomic-embed-text', dimension: 768 } }
    const started = performance.now()
    const projected = await h.reconciler({ storeAccess: async () => access }).reconcile(h.org.orgId, h.workspaceId, { fresh: true })
    console.log(`${name}: ${files.length} documents projected in ${Math.round((performance.now() - started) / 1000)}s, ${projected.failed} failed`)
    expect(projected.failed).toBe(0)
    const deps = { router: h.org.router, keyring: h.org.keyring, storeAccess: async () => access }
    const pooled: PooledQuestion[] = []
    for (const query of queries) {
      const asked = await askProjections(deps, h.org.orgId, h.workspaceId, query.text, POOLED, null)
      const vocabulary = vocabularyOf(`eval/${name}`, asked.read.entities)
      const candidates = searchCandidates(query.text, asked, vocabulary, {}, POOLED_CANDIDATES)
      const logits: Record<string, number[]> = {}
      const rerankMs: Record<string, number> = {}
      for (const [key, reranker] of Object.entries(rerankers)) {
        const at = performance.now()
        logits[key] = await reranker.score(query.text, candidates.map((candidate) => candidate.text))
        rerankMs[key] = performance.now() - at
      }
      pooled.push({
        corpus: name,
        id: query.id,
        text: query.text,
        kind: query.kind,
        category: query.category,
        split: query.split,
        relevant: query.relevant,
        ...(query.minGrade !== undefined ? { minGrade: query.minGrade } : {}),
        gated: unknownNames(vocabulary, query.text).length > 0,
        candidates: candidates.map(({ text: _text, ...candidate }, index) => ({
          ...candidate,
          logits: Object.fromEntries(Object.entries(logits).map(([key, values]) => [key, values[index] as number])),
        })),
        before: legacyAnswer(asked),
        rerankMs,
      })
    }
    return pooled
  } finally {
    await qdrant.deprovision({ orgId: qdrantOrg }, 'shred').catch(() => undefined)
    await h.close()
  }
}

/** What each projection's top `depth` would have found, as the search would pool it, with `reranker`'s logits. */
const withLogits = (questions: readonly PooledQuestion[], reranker: string | null, depth = POOL_PER_SOURCE): EvalQuestion[] =>
  questions.map((question) => ({
    ...question,
    candidates: question.candidates
      .filter((candidate) => (candidate.semantic?.rank ?? Infinity) < depth || (candidate.lexical?.rank ?? Infinity) < depth)
      .slice(0, depth === POOL_PER_SOURCE ? MAX_RERANKED : POOLED_CANDIDATES)
      .map(({ logits, semantic, lexical, ...candidate }) => ({
        ...candidate,
        // A projection asked for its top `depth` never says where it ranked anything below.
        semantic: semantic && semantic.rank < depth ? semantic : undefined,
        lexical: lexical && lexical.rank < depth ? lexical : undefined,
        ...(reranker ? { logit: logits[reranker] as number } : {}),
      })),
  }))

const row = (label: string, scores: Scores) =>
  `| ${label} | ${scores.ndcg.toFixed(3)} | ${scores.fpr.toFixed(2)} | ${scores.replyPrecision.toFixed(2)} | ${scores.returned.toFixed(1)} | ${balanced(scores).toFixed(3)} |`

describe.skipIf(!RUN)('search relevance evaluation', () => {
  it('pools every corpus through the cloud projections, then fits and scores the cut', { timeout: 12 * 3_600_000 }, async () => {
    await mkdir(join(OUT, 'pools'), { recursive: true })
    const rerankers: Record<string, Reranker> = {}
    for (const key of RERANKERS) rerankers[key] = await localReranker({ model: COMPARED[key] as RerankerModel, cacheDir: MODELS, threads: Number(env.DOCKET_SEARCH_EVAL_THREADS ?? 4) })
    const all: PooledQuestion[] = []
    for (const name of (await readdir(CORPORA as string)).sort()) {
      if (!existsSync(join(CORPORA as string, name, 'queries.json'))) continue
      const file = join(OUT, 'pools', `${name}.json`)
      if (!existsSync(file)) await writeFile(file, JSON.stringify(await poolCorpus(name, rerankers)))
      all.push(...(JSON.parse(await readFile(file, 'utf8')) as PooledQuestion[]))
    }
    const dev = all.filter((question) => question.split === 'dev')
    const test = all.filter((question) => question.split === 'test')
    const lines: string[] = []
    const models: Record<string, CutModel> = {}
    const report = (label: string, scores: Scores) => {
      lines.push(row(label, scores))
      console.log(row(label, scores))
    }

    const before = (questions: readonly PooledQuestion[]) => macroScores(questions.map((question) => ({ question: { ...question, candidates: [] }, ids: question.before })))
    report('before: confidence floor, rank × confidence × recency', before(test))
    // Ranking within 0.01 of the research pilot's baseline, on the dev questions.
    const minNdcg = PRECACHED_NDCG - 0.01
    const retrieval = fitCut({ name: 'retrieval', reranker: null, features: RETRIEVAL_FEATURES, dev: withLogits(dev, null), minNdcg })
    models.retrieval = retrieval.model
    report('gate + learned cut, projections\' scores only', macroScores(answersOf(retrieval.model, withLogits(test, null))))
    for (const key of RERANKERS) {
      const name = (COMPARED[key] as RerankerModel).name
      const order = (question: EvalQuestion) =>
        question.gated ? [] : [...question.candidates].sort((a, b) => (b.logit as number) - (a.logit as number)).slice(0, K).map((candidate) => candidate.id)
      report(`${key}: gate + rerank, no cut`, macroScores(withLogits(test, key).map((question) => ({ question, ids: order(question) }))))
      const fitted = fitCut({ name, reranker: name, features: RERANKED_FEATURES, dev: withLogits(dev, key), minNdcg })
      models[key] = fitted.model
      report(`${key}: gate + rerank + learned cut (answer ${fitted.model.answer}, keep ${fitted.model.threshold}, ratio ${fitted.model.ratio})`, macroScores(answersOf(fitted.model, withLogits(test, key))))
      for (const depth of [15, POOLED]) {
        const deeper = fitCut({ name, reranker: name, features: RERANKED_FEATURES, dev: withLogits(dev, key, depth), minNdcg })
        report(`${key}: as above, each projection's top ${depth}`, macroScores(answersOf(deeper.model, withLogits(test, key, depth))))
      }
      // Over the deeper pool, so an upper bound for the search's own.
      const ms = all.map((question) => question.rerankMs[key] as number).sort((a, b) => a - b)
      lines.push(`|  ${key} re-ranking ${POOLED_CANDIDATES} candidates at most on this machine, ms per question: p50 ${Math.round(ms[Math.floor(ms.length / 2)] as number)}, p95 ${Math.round(ms[Math.floor(ms.length * 0.95)] as number)} | | | | | |`)
    }
    // The models the search runs, as committed in relevance-model.ts: what this run fitted, until they are updated from models.json.
    report('shipped: gate + rerank + relevance-model.ts CUT_MODEL', macroScores(answersOf(CUT_MODEL, withLogits(test, 'minilm'))))
    report('shipped: gate + relevance-model.ts RETRIEVAL_CUT_MODEL', macroScores(answersOf(RETRIEVAL_CUT_MODEL, withLogits(test, null))))
    const candidatesPer = withLogits(all, null).map((question) => question.candidates.length)
    const markdown = [
      '# Search relevance evaluation',
      '',
      `${all.length} questions over ${new Set(all.map((q) => q.corpus)).size} corpora (${dev.length} dev, ${test.length} test). As the search asks, each projection's top ${POOL_PER_SOURCE} and the re-ranker reading at most ${MAX_RERANKED} candidates (mean ${(candidatesPer.reduce((a, b) => a + b, 0) / candidatesPer.length).toFixed(1)}), unless a row says otherwise. Test questions, macro over corpora.`,
      '',
      `Cuts fitted on the dev questions: the most balanced score plus reply precision, (nDCG@10 + 1 - FPR) / 2 + reply precision, among cuts that rank within 0.01 of docket's search evaluation's precached search there (nDCG@10 ${minNdcg.toFixed(3)}, precached's ${PRECACHED_NDCG} less 0.01).`,
      '',
      '| strategy | nDCG@10 | no-answer FPR | reply precision | returned | balanced |',
      '| --- | ---: | ---: | ---: | ---: | ---: |',
      ...lines,
      '',
    ].join('\n')
    await writeFile(join(OUT, 'report.md'), markdown)
    await writeFile(join(OUT, 'models.json'), `${JSON.stringify(models, null, 2)}\n`)
    console.log(markdown)
  })
})
