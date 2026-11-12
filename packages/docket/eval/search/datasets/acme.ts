import { fileURLToPath } from 'node:url'

import { loadQuestions } from '../../ask/questions.js'
import type { Corpus, EvalQuery } from '../corpus.js'
import { whoIsQuery } from './common.js'

/*
 * The SDLC example docket, examples/acme-platform, with the ask evaluation's
 * questions (../../ask/questions.yaml): each lookup, multi-hop and count
 * question's `basis` is what a search should find. The ask set's
 * not-recorded questions are left out - most ask after a real service, so
 * finding that service is right even though the answer is not recorded.
 * The no-answer queries below name things the example does not hold at all.
 */

const EXAMPLE = fileURLToPath(new URL('../../../../../examples/acme-platform', import.meta.url))

const ABSENT = [
  'Who owns the Billing service?',
  'What does the Kafka cluster connect to?',
  'Which team owns the mobile app?',
  'What did the payroll outage postmortem decide?',
  'Where is the Snowflake warehouse used?',
  'Who is the product manager for Jenkins pipelines?',
  'What is the Grafana dashboard for fraud alerts?'
]

export const loadAcme = async (): Promise<Corpus> => {
  const questions = await loadQuestions()
  const queries: EvalQuery[] = [
    ...questions
      .filter((question) => question.category !== 'not-recorded')
      .map((question) => ({
        id: question.id,
        text: question.question,
        kind: 'answerable' as const,
        category: question.category,
        relevant: Object.fromEntries(question.basis.map((id) => [id, 2]))
      })),
    whoIsQuery('Sophia'),
    ...ABSENT.map((text, index) => ({ id: `absent-${index + 1}`, text, kind: 'no-answer' as const, category: 'absent', relevant: {} }))
  ]
  return {
    name: 'acme',
    domain: 'SDLC',
    source: 'examples/acme-platform (this repository) with the ask evaluation questions',
    template: 'sdlc',
    directory: EXAMPLE,
    entities: [],
    queries
  }
}
