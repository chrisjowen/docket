import type { ChatPrompt } from '@docket/adapter-kit'

import type { Question } from './questions.js'

/**
 * The fine-grained CRAG-inspired judge of Wedge et al., "Reducing
 * Hallucinations in Complex Question Answering using Simple Graph-based RAG"
 * (arXiv:2606.05901v2, Appendix C.2.2), word for word. `{user_input}`,
 * `{combined_answer}` and `{reference}` are filled in by `judgePrompt`.
 */
export const FINE_GRAINED_JUDGE = `You are given a Question, a Model Prediction with Explanation for the
prediction and an unordered list of Ground Truth answers. Judge whether the prediction
matches any all or none of the answers from the list of Ground Truth answers.
Use the question and explanation to judge whether reference and predicted answers match,
rather than just string matching.
Sometimes different words might have been used to express the same answer, for example,
depending on the phrasing of the question False and No might be used interchangably
or True and Yes.
You can also allow 1% tolerance on numerical answers.
Do not rely on your own knowledge to judge the model prediction, use the Ground Truth
answers provided.
Follow these instructions step by step to make a judgment:
1. If the model returns 'unknown' or says that it couldn't answer the question or it
doesn't have enough information to answer the question, then you must return 0.
2. If the model makes a prediction, rather than saying it doesn't know, but the
prediction does not match any
of the provided answers from the Ground Truth Answer list then the prediction is wrong
and you must return -1.
3. If the model prediction matches all provided answers from the Ground Truth Answer list
then the prediction is fully correct and you must return +1.
4. If the model prediction matches a subset of the provided answers from the Ground
Truth Answer list but some correct answers are missing, then the prediction is
partially correct. Only if the prediction does not include any additional incorrect
answers, then you must return +0.5.
5. If the model prediction includes some correct answers from the Ground Truth Answer list
but also includes any incorrect answers (answers not in the Ground Truth Answer
list), then model is incorrect, and you must return -0.5.
The question is {user_input}, the model prediction and explanation are {combined_answer},
and the Ground Truth answers are {reference}.
Return only one of the following values based on the instructions above:
-1, -0.5, 0, +0.5 or +1`

/**
 * What a not-recorded question's Ground Truth list says. The docket holds no
 * answer, so the only acceptable response is saying so: the judge's rule 1
 * scores that 0 and rule 2 scores any answer -1.
 */
export const NOT_RECORDED_REFERENCE = '[] (none: the casebook does not record this, so no answer can match)'

export type Judgment = -1 | -0.5 | 0 | 0.5 | 1

/**
 * The paper fed the judge its agent's structured answer and explanation as
 * one string. A docket summary is a single text, so it is the answer, and
 * the explanation is empty.
 */
export const judgePrompt = (question: Question, answer: string): ChatPrompt => ({
  system: 'You grade answers. Reply with the score only.',
  user: FINE_GRAINED_JUDGE.replace('{user_input}', question.question)
    .replace('{combined_answer}', `Answer: ${answer}\nExplanation: `)
    .replace('{reference}', question.answers.length > 0 ? JSON.stringify(question.answers) : NOT_RECORDED_REFERENCE)
})

const SCORE = /(?<![\d.])([+-]?(?:0\.5|1(?:\.0+)?|0(?:\.0+)?))(?![\d%]|\.\d)/g

/**
 * The score in a judge's reply: the last of -1, -0.5, 0, +0.5 and +1 it
 * gives, since a judge that explains itself ends on its verdict. Undefined
 * when it gives none.
 */
export const parseJudgment = (reply: string): Judgment | undefined => {
  const last = [...reply.matchAll(SCORE)].at(-1)?.[1]
  if (last === undefined) return undefined
  const value = Number(last)
  return value === 0 ? 0 : (value as Judgment)
}

/**
 * A judgment as scored for its question. Nothing can be right about an answer
 * to a not-recorded question, so a judge that rewards one - reading "it is not
 * recorded" as matching the empty list - is held to 0, the score for saying so.
 */
export const scoreFor = (question: Question, judgment: Judgment): Judgment =>
  question.category === 'not-recorded' && judgment > 0 ? 0 : judgment

/** The coarse metric (Appendix C.2.1) from a fine judgment: fully correct 1, refused 0, anything partly or wholly wrong -1. */
export const coarseOf = (fine: Judgment): -1 | 0 | 1 => (fine === 1 ? 1 : fine === 0 ? 0 : -1)

const FAMILIES: [RegExp, string][] = [
  [/^claude/, 'anthropic'],
  [/^(llama|codellama)/, 'meta-llama'],
  [/^(qwen|qwq)/, 'qwen'],
  [/^(mistral|mixtral|codestral|ministral)/, 'mistral'],
  [/^(gemma|gemini)/, 'google'],
  [/^phi/, 'microsoft'],
  [/^deepseek/, 'deepseek'],
  [/^(gpt|o\d)/, 'openai']
]

/**
 * The model family a model name belongs to, read from its name: the judge
 * must not share the answerer's, or it grades its own kind's answers kindly.
 * An unknown name is its own family.
 */
export const familyOf = (model: string): string => {
  const name = model.toLowerCase().replace(/^.*\//, '')
  return FAMILIES.find(([pattern]) => pattern.test(name))?.[1] ?? name.replace(/[:\d.].*$/, '')
}
