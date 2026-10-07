import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { stableStringify } from '../model/stable-json.js'
import { hashContent } from '../source/hashing.js'

/** Bumped whenever the entry changes shape, so older answers are never misread. */
const CACHE_VERSION = 1

/** An exhibit a summary was built from, as it was then. */
export interface CachedExhibit {
  id: string
  /** The entity's `sha256:` hash: it changes whenever any of its files does. */
  hash: string
}

export interface CachedSummary {
  /** Hash of the question, the model and every exhibit the summary was built from. */
  key: string
  question: string
  model: string
  exhibits: CachedExhibit[]
  text: string
  /** The exhibits the summary cites, in the order it first cites them. */
  cited: string[]
  createdAt: string
}

/** Case and spacing do not make a different question. */
export const normalizeQuestion = (question: string): string =>
  question.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * What a summary depends on. Any change to the question, the model, its
 * instructions or one of the exhibits - an edit to any file declaring it, or a
 * different set found - gives a different key, and so a miss.
 */
export const summaryKey = (
  question: string,
  model: { model: string; instructions: string },
  exhibits: readonly CachedExhibit[]
): string =>
  hashContent(
    stableStringify({
      version: CACHE_VERSION,
      question: normalizeQuestion(question),
      model: model.model,
      instructions: model.instructions,
      exhibits: [...exhibits].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    })
  )

/** Where answers are kept: inside the docket, disposable and gitignored like `.index`. */
export const summaryCacheDir = (memoryRoot: string): string => join(memoryRoot, '.cache', 'chat')

/** One file per question, so a stale answer is replaced rather than piling up beside the new one. */
const fileFor = (dir: string, question: string): string =>
  join(dir, `${hashContent(normalizeQuestion(question)).slice('sha256:'.length)}.json`)

/** The answer kept for this question, when it was built from exactly what `key` describes. */
export const readCachedSummary = async (
  dir: string,
  question: string,
  key: string
): Promise<CachedSummary | null> => {
  try {
    const entry = JSON.parse(await readFile(fileFor(dir, question), 'utf8')) as Partial<CachedSummary>
    return entry.key === key && typeof entry.text === 'string' && Array.isArray(entry.cited)
      ? (entry as CachedSummary)
      : null
  } catch {
    // Missing, half-written or hand-mangled: all just a miss.
    return null
  }
}

export const writeCachedSummary = async (dir: string, entry: CachedSummary): Promise<void> => {
  await mkdir(dir, { recursive: true })
  const file = fileFor(dir, entry.question)
  // Written aside and renamed, so a concurrent read never sees half a file.
  const partial = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(partial, `${JSON.stringify(entry, null, 2)}\n`, 'utf8')
  await rename(partial, file)
}
