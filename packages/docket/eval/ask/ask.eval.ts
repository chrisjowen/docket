import { spawnSync } from 'node:child_process'
import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ollamaChat, type Chat } from '@docket/adapter-kit'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sync } from '../../src/commands/sync.js'
import type { SummarizeConfig } from '../../src/config/config.js'
import { claudeChat } from '../../src/llm/claude-chat.js'
import { askProject } from '../../src/query/ask.js'
import { abstains } from '../../src/query/synthesis.js'
import { familyOf, judgePrompt, parseJudgment, scoreFor, type Judgment } from './judge.js'
import { loadQuestions, type Question } from './questions.js'
import { citationSummary, scoreTable, unscoredReplies, unscoredReport, type Outcome } from './score.js'

/*
 * The ask evaluation (README.md): every question in questions.yaml put to a
 * copy of examples/acme-platform through `askProject` with synthesis on, each
 * summary graded by a judge of another model family, and the score table
 * printed. It needs models, so it never runs with the tests; when the
 * answerer or the judge is missing it is skipped, saying which.
 */

const EXAMPLE = fileURLToPath(new URL('../../../../examples/acme-platform', import.meta.url))

const env = process.env
const ANSWERER = env.DOCKET_EVAL_ANSWERER ?? 'ollama:qwen2.5:7b'
const JUDGE = env.DOCKET_EVAL_JUDGE ?? 'claude:sonnet'
const OLLAMA_URL = env.DOCKET_EVAL_OLLAMA_URL ?? 'http://localhost:11434'
const ONLY = env.DOCKET_EVAL_ONLY?.split(',').map((id) => id.trim()).filter(Boolean)
const OUT = env.DOCKET_EVAL_OUT
const CONCURRENCY = Math.max(1, Number(env.DOCKET_EVAL_CONCURRENCY ?? 4) || 4)

/** A model named as `claude`, `claude:<model>` or `ollama:<model>`: how to configure it, how to ask it, and its family. */
interface Model {
  spec: string
  config: SummarizeConfig
  family: string
  /** Ollama answers one request at a time, so it is asked in turn rather than in parallel. */
  concurrency: number
}

const TIMEOUT_MS = 180_000

const modelOf = (spec: string, variable: string): Model => {
  const [provider, ...rest] = spec.split(':')
  const model = rest.join(':')
  if (provider === 'claude') {
    return { spec, config: { provider: 'claude', ...(model ? { model } : {}), timeoutMs: TIMEOUT_MS }, family: 'anthropic', concurrency: CONCURRENCY }
  }
  if (provider === 'ollama' && model) {
    return { spec, config: { provider: 'ollama', url: OLLAMA_URL, model, timeoutMs: TIMEOUT_MS }, family: familyOf(model), concurrency: 1 }
  }
  throw new Error(`${variable} must be claude, claude:<model> or ollama:<model>, got "${spec}"`)
}

const chatOf = (model: Model): Chat => (model.config.provider === 'claude' ? claudeChat(model.config) : ollamaChat(model.config))

const ollamaModels = async (): Promise<string[] | undefined> => {
  try {
    const response = await fetch(`${OLLAMA_URL.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(3_000) })
    if (!response.ok) return undefined
    return ((await response.json()) as { models?: { name: string }[] }).models?.map((model) => model.name) ?? []
  } catch {
    return undefined
  }
}

const hasModel = (models: readonly string[], name: string): boolean => models.some((model) => model === name || model === `${name}:latest`)

/** Why the evaluation cannot run here, or undefined when it can. */
const missing = async (models: readonly Model[]): Promise<string | undefined> => {
  const pulled = models.some((model) => model.config.provider === 'ollama') ? await ollamaModels() : []
  for (const model of models) {
    if (model.config.provider === 'claude') {
      if (spawnSync('claude', ['--version'], { stdio: 'ignore' }).status !== 0) return `the claude CLI is not installed, for ${model.spec}`
    } else if (pulled === undefined) {
      return `no Ollama at ${OLLAMA_URL}, for ${model.spec} (set DOCKET_EVAL_OLLAMA_URL)`
    } else if (!hasModel(pulled, model.config.model)) {
      return `${model.config.model} is not pulled into Ollama, for ${model.spec} (ollama pull ${model.config.model})`
    }
  }
  return undefined
}

const answering = modelOf(ANSWERER, 'DOCKET_EVAL_ANSWERER')
const judging = modelOf(JUDGE, 'DOCKET_EVAL_JUDGE')
if (answering.family === judging.family) {
  throw new Error(`The judge (${JUDGE}) and the answerer (${ANSWERER}) are both ${answering.family} models: pick a judge of another family.`)
}
const skipped = await missing([answering, judging])
if (skipped) console.log(`ask evaluation skipped: ${skipped}`)

/** `work` over `items`, `limit` at a time, results in order. */
const pooled = async <T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await work(items[index] as T)
      }
    })
  )
  return results
}

describe.skipIf(skipped !== undefined)('ask evaluation', () => {
  let scratch: string
  let root: string

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'docket-ask-eval-'))
    root = join(scratch, 'acme-platform')
    await cp(EXAMPLE, root, { recursive: true, filter: (source) => !/[\\/]\.docket[\\/]\.(index|cache)([\\/]|$)/.test(source) })
    await appendFile(join(root, '.docket.yaml'), `\nsummarize: ${JSON.stringify(answering.config)}\n`)
    const synced = await sync({ cwd: root })
    expect(synced.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
  })

  afterAll(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true })
  })

  it('scores every question', { timeout: 3 * 60 * 60_000 }, async () => {
    const all = await loadQuestions()
    const questions = ONLY ? all.filter((question) => ONLY.includes(question.id)) : all
    const judge = chatOf(judging)

    const answers = await pooled(questions, answering.concurrency, async (question: Question) => {
      const { answer } = await askProject(root, { question: question.question, synthesis: true, timezone: 'UTC' })
      console.log(`answered ${question.id}`)
      return {
        text: answer.synthesis?.text ?? `(no summary) ${answer.notice?.message ?? ''}`.trim(),
        // Docket gave no answer because the adapters found nothing: an abstention, not something to judge.
        abstained: answer.synthesis === null && answer.notice?.reason === 'empty',
        // The summary is the instructions' refusal sentence: scored 0, the rubric's score for a refusal, without the judge.
        refused: answer.synthesis ? abstains(answer.synthesis.text) : false,
        cited: (answer.synthesis?.citedEntities.length ?? 0) + (answer.synthesis?.citedEvidence.length ?? 0),
        diagnostics: answer.diagnostics.map((diagnostic) => diagnostic.code)
      }
    })

    const outcomes = await pooled([...questions.entries()], judging.concurrency, async ([index, question]): Promise<Outcome> => {
      const answer = answers[index] as (typeof answers)[number]
      let reply = answer.abstained
        ? '(not judged: the adapters found nothing, so docket gave no answer)'
        : '(not judged: docket answered with the refusal sentence)'
      let judgment: Judgment | undefined = 0
      if (!answer.abstained && !answer.refused) {
        // A reply with no score in it, or a judge that fails, is asked once more before the question is left unscored.
        for (let attempt = 0; attempt < 2 && (attempt === 0 || judgment === undefined); attempt += 1) {
          try {
            reply = (await judge(judgePrompt(question, answer.text))).trim()
            judgment = parseJudgment(reply)
          } catch (cause) {
            reply = `(the judge failed: ${cause instanceof Error ? cause.message : String(cause)})`
            judgment = undefined
          }
        }
      }
      return {
        id: question.id,
        category: question.category,
        question: question.question,
        answer: answer.text,
        score: judgment === undefined ? undefined : scoreFor(question, judgment),
        judgeReply: reply,
        cited: answer.cited,
        diagnostics: answer.diagnostics
      }
    })

    const unscored = unscoredReport(outcomes)
    const report = [
      `Ask evaluation: ${outcomes.length} questions over examples/acme-platform, answered by ${ANSWERER}, judged by ${JUDGE}.`,
      '',
      scoreTable(outcomes),
      '',
      citationSummary(outcomes),
      '',
      ...(unscored ? [unscored, ''] : []),
      ...outcomes.map(
        (outcome) =>
          `${outcome.id} ${outcome.score === undefined ? 'unscored' : outcome.score > 0 ? `+${outcome.score}` : outcome.score}  ${outcome.answer.replace(/\s+/g, ' ').slice(0, 160)}`
      )
    ].join('\n')
    console.log(`\n${report}\n`)
    if (OUT) {
      await mkdir(OUT, { recursive: true })
      await writeFile(join(OUT, 'report.md'), `${report}\n`, 'utf8')
      await writeFile(join(OUT, 'outcomes.json'), `${JSON.stringify({ answerer: ANSWERER, judge: JUDGE, unscored: unscoredReplies(outcomes), outcomes }, null, 2)}\n`, 'utf8')
    }
    expect(outcomes).toHaveLength(questions.length)
  })
})
