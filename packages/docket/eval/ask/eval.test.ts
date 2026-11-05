import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { takeSnapshot } from '../../src/query/snapshot.js'
import { coarseOf, familyOf, FINE_GRAINED_JUDGE, judgePrompt, NOT_RECORDED_REFERENCE, parseJudgment, scoreFor } from './judge.js'
import { CATEGORIES, loadQuestions, type Question } from './questions.js'
import { citationSummary, scoreTable, tallies, unscoredReplies, unscoredReport, type Outcome } from './score.js'

/*
 * What the ask evaluation is made of, checked without a model: the question
 * set against the example it asks about, the judge's prompt and how its
 * replies are read, and the score table. The evaluation itself is
 * `pnpm eval:ask`.
 */

const EXAMPLE = fileURLToPath(new URL('../../../../examples/acme-platform', import.meta.url))

describe('the question set', () => {
  it('is 40-60 questions of every category, about a quarter not recorded', async () => {
    const questions = await loadQuestions()
    expect(questions.length).toBeGreaterThanOrEqual(40)
    expect(questions.length).toBeLessThanOrEqual(60)
    for (const category of CATEGORIES) expect(questions.some((question) => question.category === category)).toBe(true)
    const share = questions.filter((question) => question.category === 'not-recorded').length / questions.length
    expect(share).toBeGreaterThanOrEqual(0.2)
    expect(share).toBeLessThanOrEqual(0.3)
  })

  it('rests every recorded answer on records the example holds', async () => {
    const snapshot = await takeSnapshot(EXAMPLE)
    for (const question of await loadQuestions()) {
      expect(question.basis.length > 0, question.id).toBe(question.category !== 'not-recorded')
      for (const id of question.basis) expect(snapshot.entity(id), `${question.id} cites ${id}`).toBeDefined()
    }
  })
})

const lookup: Question = { id: 'L01', category: 'lookup', question: 'Who owns Orders?', answers: ['Platform Engineering'], basis: [] }
const unrecorded: Question = { id: 'N01', category: 'not-recorded', question: 'Who is on call?', answers: [], basis: [] }

describe('the judge', () => {
  it('asks the paper\'s fine-grained question of each answer, with its ground truth', () => {
    const prompt = judgePrompt(lookup, 'Platform Engineering [team.platform-engineering].')
    expect(prompt.user).toContain('The question is Who owns Orders?, the model prediction and explanation are Answer: Platform Engineering')
    expect(prompt.user).toContain('the Ground Truth answers are ["Platform Engineering"].')
    expect(prompt.user).toContain('-1, -0.5, 0, +0.5 or +1')
    expect(FINE_GRAINED_JUDGE).not.toMatch(/\{(?!user_input|combined_answer|reference)/)
    expect(judgePrompt(unrecorded, 'Nobody is recorded.').user).toContain(`the Ground Truth answers are ${NOT_RECORDED_REFERENCE}.`)
  })

  it('reads the verdict a reply ends on', () => {
    expect(parseJudgment('+1')).toBe(1)
    expect(parseJudgment('-0.5')).toBe(-0.5)
    expect(parseJudgment('0')).toBe(0)
    expect(parseJudgment('+0.5')).toBe(0.5)
    expect(parseJudgment('Rule 2 applies, so the score is -1.')).toBe(-1)
    expect(parseJudgment('Allowing 1% tolerance, step 1 says 0')).toBe(0)
    expect(parseJudgment('I cannot judge this.')).toBeUndefined()
  })

  it('never rewards an answer to a question the docket does not record', () => {
    expect(scoreFor(unrecorded, 1)).toBe(0)
    expect(scoreFor(unrecorded, -1)).toBe(-1)
    expect(scoreFor(lookup, 0.5)).toBe(0.5)
  })

  it('scores coarsely as the paper\'s coarse metric does: only a full answer counts', () => {
    expect([1, 0.5, 0, -0.5, -1].map((score) => coarseOf(score as 1))).toEqual([1, -1, 0, -1, -1])
  })

  it('tells model families apart by name', () => {
    expect(familyOf('llama3.1')).toBe('meta-llama')
    expect(familyOf('meta-llama/llama-4-maverick')).toBe('meta-llama')
    expect(familyOf('qwen2.5:7b')).toBe('qwen')
    expect(familyOf('claude-sonnet-5')).toBe('anthropic')
    expect(familyOf('granite3:8b')).toBe('granite')
  })
})

describe('the score table', () => {
  const outcome = (id: string, category: Question['category'], score: Outcome['score'], cited = 1): Outcome => ({
    id,
    category,
    question: id,
    answer: '',
    score,
    judgeReply: score === undefined ? "I'm ready to help!\nWhat should I grade?" : String(score),
    cited,
    diagnostics: []
  })
  const outcomes = [
    outcome('L01', 'lookup', 1),
    outcome('L02', 'lookup', 0.5),
    outcome('L03', 'lookup', -1, 0),
    outcome('N01', 'not-recorded', 0, 0),
    outcome('N02', 'not-recorded', undefined)
  ]

  it('sums each category and the whole set, fine and coarse, leaving unscored replies out', () => {
    const [lookups, unrecordedRow, all] = tallies(outcomes)
    expect(lookups).toMatchObject({ label: 'lookup', questions: 3, correct: 1, partial: 1, wrong: 1, fine: 0.5, coarse: -1 })
    expect(unrecordedRow).toMatchObject({ label: 'not-recorded', questions: 2, missing: 1, unscored: 1, fine: 0 })
    expect(all).toMatchObject({ label: 'all', questions: 5, fine: 0.5, coarse: -1, unscored: 1 })
  })

  it('prints as Markdown, with truthfulness as a sum and a mean', () => {
    const table = scoreTable(outcomes)
    expect(table).toContain('| category | n | +1 | +0.5 | 0 | -0.5 | -1 | unscored | fine truthfulness | coarse truthfulness |')
    expect(table).toContain('| lookup | 3 | 1 | 1 | 0 | 0 | 1 | 0 | +0.5 (+0.17) | -1 (-0.33) |')
    expect(table).toContain('| all | 5 | 1 | 1 | 1 | 0 | 1 | 1 | +0.5 (+0.13) | -1 (-0.25) |')
    expect(citationSummary(outcomes)).toContain('cite nothing they were given: 1 of 5.')
  })

  it('lists each unscored question with the judge\'s raw reply, and nothing when every reply held a score', () => {
    expect(unscoredReplies(outcomes)).toEqual([{ id: 'N02', judgeReply: "I'm ready to help!\nWhat should I grade?" }])
    expect(unscoredReport(outcomes)).toBe(
      "Unscored, because the judge failed or gave no score when asked twice (left out of every sum): 1 of 5.\n- N02: I'm ready to help! What should I grade?"
    )
    expect(unscoredReport(outcomes.filter((each) => each.score !== undefined))).toBe('')
  })
})
