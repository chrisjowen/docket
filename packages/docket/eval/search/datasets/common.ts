import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { CorpusEntity, EvalQuery } from '../corpus.js'

/** Where `download.mjs` put the datasets. */
export const dataDir = (): string =>
  process.env.DOCKET_EVAL_DATA || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'docket-eval')

/** The path of a downloaded file, or why the dataset cannot be loaded. */
export const dataFile = (file: string): string => {
  const path = join(dataDir(), file)
  if (!existsSync(path)) throw new MissingData(`${file} is not in ${dataDir()}: run pnpm -C packages/docket eval:search:download`)
  return path
}

/** A dataset whose files have not been downloaded: the run skips it and says so. */
export class MissingData extends Error {}

/** How many answerable and no-answer queries each dataset contributes. */
export interface QueryBudget {
  answerable: number
  noAnswer: number
}

/**
 * First names for no-answer queries - "who is sophia" and its kin. A name is
 * only used where the corpus never mentions it (`absentNames`).
 */
export const CANDIDATE_ABSENT_NAMES = [
  'Sophia',
  'Priya',
  'Mateo',
  'Ingrid',
  'Tomasz',
  'Aaliyah',
  'Kenji',
  'Bronwyn',
  'Oluwaseun',
  'Fenella',
  'Anneliese',
  'Rashida',
  'Thaddeus',
  'Ximena',
  'Leocadia',
  'Bartholomew'
] as const

/** Every word in the corpus, lower case: what a name must not be to be absent. */
export const vocabulary = (entities: readonly CorpusEntity[]): Set<string> => {
  const words = new Set<string>()
  for (const entity of entities) {
    for (const word of `${entity.id} ${entity.title} ${entity.body} ${(entity.tags ?? []).join(' ')}`.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word) words.add(word)
    }
  }
  return words
}

/** The candidate names no entity mentions, in order. */
export const absentNames = (entities: readonly CorpusEntity[]): string[] => {
  const words = vocabulary(entities)
  return CANDIDATE_ABSENT_NAMES.filter((name) => !words.has(name.toLowerCase()))
}

/** "Who is Sophia?" - the question every corpus must answer with nothing. */
export const whoIsQuery = (name: string): EvalQuery => ({
  id: `who-is-${name.toLowerCase()}`,
  text: `who is ${name.toLowerCase()}`,
  kind: 'no-answer',
  category: 'absent-name',
  relevant: {}
})
