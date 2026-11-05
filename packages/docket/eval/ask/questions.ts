import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

export const CATEGORIES = ['lookup', 'multi-hop', 'count', 'not-recorded'] as const

export type Category = (typeof CATEGORIES)[number]

const questionSchema = z
  .strictObject({
    id: z.string().regex(/^[A-Z]\d{2}$/),
    category: z.enum(CATEGORIES),
    question: z.string().min(1),
    answers: z.array(z.string().min(1)),
    basis: z.array(z.string().min(1))
  })
  .refine((question) => (question.category === 'not-recorded') === (question.answers.length === 0), {
    message: 'a not-recorded question has no answers, and every other question has at least one'
  })

export type Question = z.infer<typeof questionSchema>

export const QUESTIONS_FILE = fileURLToPath(new URL('./questions.yaml', import.meta.url))

/** The evaluation set, checked: every id once. */
export const loadQuestions = async (file = QUESTIONS_FILE): Promise<Question[]> => {
  const questions = z.strictObject({ questions: z.array(questionSchema) }).parse(parseYaml(await readFile(file, 'utf8'))).questions
  const seen = new Set<string>()
  for (const { id } of questions) {
    if (seen.has(id)) throw new Error(`${file}: question ${id} appears twice`)
    seen.add(id)
  }
  return questions
}
