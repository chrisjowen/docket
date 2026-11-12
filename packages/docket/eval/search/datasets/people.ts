import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'

import type { Corpus, CorpusEntity, EvalQuery } from '../corpus.js'

/** The committed people-and-organisations fixture: always available, nothing to download. */
export const PEOPLE_FIXTURE = fileURLToPath(new URL('../fixtures/people-org.yaml', import.meta.url))

export const loadPeople = async (): Promise<Corpus> => {
  const { entities, queries } = parse(await readFile(PEOPLE_FIXTURE, 'utf8')) as { entities: CorpusEntity[]; queries: EvalQuery[] }
  return {
    name: 'people',
    domain: 'people and organisations',
    source: 'Hand-written fixture in this repository (eval/search/fixtures/people-org.yaml)',
    template: 'people-org',
    entities,
    queries
  }
}
