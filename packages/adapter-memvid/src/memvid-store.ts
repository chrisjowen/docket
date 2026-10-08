import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { link, mkdir, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { canonicalPassage, type NativeHit, type NativeRecord, type NativeStore } from '@docket/adapter-kit'
import type { CanonicalInput } from '@docket/contracts'

import type { CommandResult, CommandRunner } from './runner.js'
import { frameUri, namespacePrefix, parseFrameUri } from './uri.js'

/** A CLI call failed. `retryable` says whether running it again could succeed. */
export class MemvidCommandError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'MemvidCommandError'
  }
}

export interface MemvidStoreOptions {
  /** Absolute path of the `.mv2` file. */
  file: string
  namespace: string
  run: CommandRunner
  timeoutMs: number
  lockTimeoutMs: number
}

export interface MemvidSearch {
  hits: NativeHit[]
  /** Whether memvid may hold more matches than it returned. */
  more: boolean
  /** The lexical query memvid ran. */
  nativeQuery: string
}

/** More than any memory file docket writes; a listing this long cannot be shown complete. */
const TIMELINE_LIMIT = 1_000_000

/** Whole chunks: memvid splits text into ~1,200-character chunks, so a hit's window never cuts one. */
const SNIPPET_CHARS = 4000

/** The lexical operators memvid's query parser reserves, in any case. */
const OPERATORS = new Set(['and', 'or', 'not'])

/** At most this many terms from one question. */
const MAX_TERMS = 32

/**
 * A question as a memvid lexical query. memvid's parser joins bare terms with
 * AND and gives quotes, parentheses and `field:` prefixes meaning, so a
 * question is reduced to its distinct words, OR-ed, letting BM25 rank by how
 * many match. Undefined when nothing searchable is left.
 */
export const lexicalQuery = (question: string): string | undefined => {
  const terms = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((term) => !OPERATORS.has(term))
  return terms.length === 0 ? undefined : terms.slice(0, MAX_TERMS).join(' OR ')
}

/**
 * The passage a hit carries, without what memvid appends to a short frame's
 * search text - its title, URI, track, tags and metadata, after a newline or,
 * for an empty frame, at the very start.
 */
export const stripFrameMetadata = (text: string, title: string, uri: string): string => {
  const marker = `title: ${title}\nuri: ${uri}`
  if (text.startsWith(marker)) return ''
  const at = text.indexOf(`\n${marker}`)
  return at < 0 ? text : text.slice(0, at)
}

const PAGE_SUFFIX = /#page-\d+$/

const NO_LEXICAL_INDEX = /Lexical index is not enabled/

const firstLine = (text: string): string => text.trim().split('\n', 1)[0] ?? ''

/** What a failed call's stderr says about retrying it: a busy lock or I/O may clear; a refused input will not. */
const retryableFailure = (stderr: string): boolean =>
  !/invalid query|capacity|MV001|unexpected argument|invalid value/i.test(stderr)

/** Deleting what is already gone is not a failure: the record is not current either way. */
const isGone = (stderr: string): boolean => /was not found|frame is not active/i.test(stderr)

interface TimelineEntry {
  frame_id: number
  uri?: string | null
  child_frames?: number[]
}

interface ViewedFrame {
  frame: { id: number; status: string; uri?: string | null; parent_id?: number | null; chunk_count?: number | null }
}

interface FindOutput {
  metadata?: { next_cursor?: string | null }
  hits: { frame_id: number; uri: string; title?: string | null; text: string; score?: number }[]
}

interface PutOutput {
  ingested?: number
  capacity_reached?: boolean
  warnings?: unknown[]
}

/**
 * One namespace of one `.mv2` file, driven through the memvid CLI (pinned:
 * memvid-cli 2.0.160). Every frame it writes has a URI that encodes the
 * canonical input and revision it holds (`uri.ts`), so the mapping is read
 * back from memvid's own timeline. Writes never embed, enrich, auto-tag or
 * extract dates: what memvid stores is the passage and nothing a model derived.
 */
export class MemvidStore implements NativeStore {
  /** Chunk frames of each parent frame, by the parent's native id - memvid does not delete them with it. */
  private readonly children = new Map<string, number[]>()

  constructor(private readonly options: MemvidStoreOptions) {}

  get prefix(): string {
    return namespacePrefix(this.options.namespace)
  }

  exists(): boolean {
    return existsSync(this.options.file)
  }

  async version(signal?: AbortSignal): Promise<string> {
    return (await this.exec(['version'], { signal })).stdout.trim()
  }

  /** Storage use as memvid reports it, e.g. `89.5 KB used / 50.0 MB total (0.2%)`. */
  async usage(signal?: AbortSignal): Promise<string | undefined> {
    if (!this.exists()) return undefined
    const stats = JSON.parse((await this.exec(['stats', this.options.file, '--json'], { signal })).stdout) as {
      summary?: { usage?: unknown }
    }
    return typeof stats.summary?.usage === 'string' ? stats.summary.usage : undefined
  }

  /**
   * Creates the file if it does not exist yet. `memvid create` truncates an
   * existing file, so it only ever creates a fresh temporary file, which is
   * then hard-linked into place - failing, harmlessly, if another process got
   * there first. Never called by a query or status.
   */
  async ensureFile(signal?: AbortSignal): Promise<void> {
    if (this.exists()) return
    const directory = dirname(this.options.file)
    await mkdir(directory, { recursive: true })
    const temporary = join(directory, `.${basename(this.options.file)}.${process.pid}.${randomBytes(4).toString('hex')}.mv2`)
    try {
      await this.exec(['create', temporary], { signal })
      try {
        await link(temporary, this.options.file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    } finally {
      await rm(temporary, { force: true })
    }
  }

  async list(signal?: AbortSignal): Promise<NativeRecord[]> {
    if (!this.exists()) return []
    const entries = JSON.parse(
      (await this.exec(['timeline', this.options.file, '--json', '--limit', String(TIMELINE_LIMIT)], { signal })).stdout
    ) as TimelineEntry[]
    if (entries.length >= TIMELINE_LIMIT) {
      throw new MemvidCommandError(`memvid listed ${entries.length} frames, its limit here; cannot tell whether there are more`, false)
    }
    const records: NativeRecord[] = []
    for (const entry of entries) {
      const identity = typeof entry.uri === 'string' ? parseFrameUri(this.options.namespace, entry.uri) : undefined
      if (identity === undefined) continue
      const nativeId = String(entry.frame_id)
      this.children.set(nativeId, entry.child_frames ?? [])
      records.push({ nativeId, identity })
    }
    return records
  }

  async write(record: CanonicalInput, signal?: AbortSignal): Promise<NativeRecord> {
    await this.ensureFile(signal)
    const passage = canonicalPassage(record)
    const identity = { kind: record.kind, id: record.id, revision: record.revision }
    const uri = frameUri(this.options.namespace, identity)
    const at = passage.eventAt ?? passage.observedAt
    const seconds = at === undefined ? Number.NaN : Math.floor(Date.parse(at) / 1000)
    const args = [
      'put',
      this.options.file,
      '--json',
      '--uri',
      uri,
      '--title',
      firstLine(passage.title) || record.id,
      '--track',
      'docket',
      '--kind',
      record.kind,
      // URIs carry the revision, and a deleted revision may be stored again.
      '--allow-duplicate',
      '--no-embedding',
      '--no-auto-tag',
      '--no-extract-dates',
      '--no-extract-triplets',
      '--no-enrich',
      '--lock-timeout',
      String(this.options.lockTimeoutMs),
      ...(Number.isFinite(seconds) ? ['--timestamp', String(seconds)] : [])
    ]
    const output = JSON.parse((await this.exec(args, { input: passage.text, signal })).stdout) as PutOutput
    if (output.capacity_reached) {
      throw new MemvidCommandError('the memvid file is at its capacity; nothing more can be stored in it', false)
    }
    if (output.ingested !== 1) {
      throw new MemvidCommandError(`memvid did not store ${record.kind} ${record.id}: ${JSON.stringify(output.warnings ?? [])}`, true)
    }

    const stored = await this.view(['--uri', uri], signal)
    if (stored === undefined || stored.status !== 'active') {
      throw new MemvidCommandError(`memvid stored ${uri} but cannot show it as active`, true)
    }
    const nativeId = String(stored.id)
    const chunks: number[] = []
    for (let page = 1; page <= (stored.chunk_count ?? 0); page += 1) {
      const chunk = await this.view(['--uri', `${uri}#page-${page}`], signal)
      if (chunk !== undefined && chunk.parent_id === stored.id) chunks.push(chunk.id)
    }
    this.children.set(nativeId, chunks)
    return { nativeId, identity }
  }

  /** Deletes the frame's chunks, then the frame - in that order, so a frame still listed always leads to its chunks. */
  async delete(record: NativeRecord, signal?: AbortSignal): Promise<void> {
    for (const chunk of this.children.get(record.nativeId) ?? []) await this.deleteFrame(chunk, signal)
    await this.deleteFrame(Number(record.nativeId), signal)
    this.children.delete(record.nativeId)
  }

  async find(question: string, limit: number, signal?: AbortSignal, timeoutMs?: number): Promise<MemvidSearch | undefined> {
    const query = lexicalQuery(question)
    if (query === undefined) return undefined
    if (!this.exists()) return { hits: [], more: false, nativeQuery: query }
    const args = [
      'find',
      this.options.file,
      '--query',
      query,
      '--scope',
      this.prefix,
      '--top-k',
      String(limit),
      '--mode',
      'lex',
      '--no-adaptive',
      '--snippet-chars',
      String(SNIPPET_CHARS),
      '--json'
    ]
    const result = await this.run(args, { signal, timeoutMs })
    if (result.code !== 0) {
      // memvid filters by scope after ranking a window of matches. When the
      // window holds matches but none in scope, it fails with this message,
      // though the index is there - which a search without the scope shows.
      // In-scope matches may still lie beyond that window: say so.
      if (NO_LEXICAL_INDEX.test(result.stderr) && (await this.hasLexicalIndex(query, signal, timeoutMs))) {
        return { hits: [], more: true, nativeQuery: query }
      }
      throw this.failure(args, result)
    }
    const output = JSON.parse(result.stdout) as FindOutput
    const hits: NativeHit[] = []
    for (const hit of output.hits) {
      const identity = parseFrameUri(this.options.namespace, hit.uri.replace(PAGE_SUFFIX, ''))
      if (identity === undefined) continue
      hits.push({
        nativeId: String(hit.frame_id),
        identity,
        text: stripFrameMetadata(hit.text, hit.title ?? '', hit.uri),
        ...(typeof hit.score === 'number' && Number.isFinite(hit.score) ? { score: hit.score } : {})
      })
    }
    return {
      hits,
      more: (output.metadata?.next_cursor ?? null) !== null || output.hits.length >= limit,
      nativeQuery: query
    }
  }

  private async hasLexicalIndex(query: string, signal?: AbortSignal, timeoutMs?: number): Promise<boolean> {
    const probe = ['find', this.options.file, '--query', query, '--top-k', '1', '--mode', 'lex', '--no-adaptive', '--json']
    return (await this.run(probe, { signal, timeoutMs })).code === 0
  }

  private async view(selector: string[], signal?: AbortSignal): Promise<ViewedFrame['frame'] | undefined> {
    const result = await this.run(['view', this.options.file, ...selector, '--json'], { signal })
    if (result.code !== 0) {
      if (isGone(result.stderr)) return undefined
      throw this.failure(['view'], result)
    }
    return (JSON.parse(result.stdout) as ViewedFrame).frame
  }

  private async deleteFrame(frameId: number, signal?: AbortSignal): Promise<void> {
    const result = await this.run(
      [
        'delete',
        this.options.file,
        '--frame-id',
        String(frameId),
        '--yes',
        '--json',
        '--lock-timeout',
        String(this.options.lockTimeoutMs)
      ],
      { signal }
    )
    if (result.code !== 0 && !isGone(result.stderr)) throw this.failure(['delete'], result)
  }

  private async exec(
    args: string[],
    options: { input?: string; signal?: AbortSignal | undefined; timeoutMs?: number | undefined }
  ): Promise<CommandResult> {
    const result = await this.run(args, options)
    if (result.code !== 0) throw this.failure(args, result)
    return result
  }

  private run(
    args: string[],
    options: { input?: string; signal?: AbortSignal | undefined; timeoutMs?: number | undefined }
  ): Promise<CommandResult> {
    return this.options.run(args, {
      ...(options.input !== undefined ? { input: options.input } : {}),
      signal: options.signal,
      timeoutMs: Math.min(options.timeoutMs ?? this.options.timeoutMs, this.options.timeoutMs)
    })
  }

  private failure(args: readonly string[], result: CommandResult): MemvidCommandError {
    const reason = result.stderr.trim().split('\n').filter(Boolean).at(-1) ?? `exit ${String(result.code)}`
    return new MemvidCommandError(`memvid ${args[0] ?? ''} failed: ${reason}`, retryableFailure(result.stderr))
  }
}
