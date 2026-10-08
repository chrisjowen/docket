import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { stableStringify } from '@docket/adapter-kit'

import { hashContent } from '../source/hashing.js'
import type { UiPath } from './types.js'

/** Bumped whenever the entry or its key changes shape, so older answers are never misread. */
const CACHE_VERSION = 2

/** An exhibit a summary was built from, as it was then. */
export interface CachedExhibit {
  id: string
  /** The entity's `sha256:` hash: it changes whenever any of its files does. */
  hash: string
}

export interface CachedSummary {
  /** Hash of everything the summary was written from: see `summaryKey`. */
  key: string
  question: string
  model: string
  /** The adapter instances whose answers it was written from. */
  adapters?: string[]
  exhibits: CachedExhibit[]
  text: string
  /** The exhibits the summary cites, in the order it first cites them. */
  cited: string[]
  /** The evidence it cites, as namespaced in the answer it was written from. */
  citedEvidence?: string[]
  createdAt: string
}

/** What a summary is written from, besides the question and the model. */
export interface SummaryInputs {
  /** How the question was read: scope, time zone, the day it was asked in that zone, the conversation before it. */
  context?: unknown
  /**
   * Each adapter asked: its configuration fingerprint, the checkpoint it
   * answered at and a hash of its answer - or how it failed.
   */
  adapters?: readonly unknown[]
  exhibits: readonly CachedExhibit[]
  /** The canonical records the evidence points at, at the revisions the files hold them. */
  sources?: readonly unknown[]
  paths: readonly UiPath[]
}

/** Case and spacing do not make a different question. */
export const normalizeQuestion = (question: string): string =>
  question.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * What a summary depends on (docs/adapter-spec.md §10): the question and how
 * it was read, each adapter's configuration, checkpoint and answer, the source
 * revisions of the exhibits and evidence, the paths connecting them, the model
 * and its instructions. A change to any gives a different key, and so a miss.
 */
export const summaryKey = (question: string, model: { model: string; instructions: string }, inputs: SummaryInputs): string =>
  hashContent(
    stableStringify({
      version: CACHE_VERSION,
      question: normalizeQuestion(question),
      context: inputs.context ?? null,
      model: model.model,
      instructions: model.instructions,
      adapters: inputs.adapters ?? [],
      exhibits: [...inputs.exhibits].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      sources: inputs.sources ?? [],
      paths: inputs.paths
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
