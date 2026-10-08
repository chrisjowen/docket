import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { canonicalPassage, checkoutScope, type NativeHit, type NativeIdentity, type NativeRecord, type NativeStore } from '@docket/adapter-kit'
import type { CanonicalInput, InputKind } from '@docket/contracts'

import { isPalaceName } from './config.js'
import { McpError, type CallOptions, type ToolClient } from './mcp-client.js'

/** A tool answered with a failure. `retryable` says whether calling it again could succeed. */
export class PalaceToolError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'PalaceToolError'
  }
}

/**
 * How MemPalace 3.10.0 answers a read of a palace nothing has been filed in
 * yet - `list_drawers` and `search` fail rather than come back empty.
 */
const NOTHING_FILED = /^(No palace found|Chroma database missing)/i

/** Whether a tool's failure only means the palace is still empty. */
export const nothingFiled = (failure: string | undefined): boolean => failure !== undefined && NOTHING_FILED.test(failure)

const KINDS: readonly InputKind[] = ['entity', 'observation', 'document']

/**
 * Native identity, kept in a drawer's `source_file` - the one free-text field
 * MemPalace stores and returns: `docket:<wing>:<kind>:<id>:<revision>`, each
 * part percent-encoded. It holds no `/`, because MemPalace cuts `source_file`
 * to its basename in some responses; this way the basename is all of it.
 */
export const sourceFile = (wing: string, identity: NativeIdentity): string =>
  ['docket', wing, identity.kind, identity.id, identity.revision].map(encodeURIComponent).join(':')

/** The identity a drawer's `source_file` encodes, or undefined for a drawer docket did not file in `wing`. */
export const parseSourceFile = (wing: string, value: unknown): NativeIdentity | undefined => {
  if (typeof value !== 'string') return undefined
  const parts = value.split(':')
  if (parts.length !== 5) return undefined
  try {
    const [marker, owner, kind, id, revision] = parts.map(decodeURIComponent) as [string, string, string, string, string]
    if (marker !== 'docket' || owner !== wing || !(KINDS as readonly string[]).includes(kind) || !id || !revision) return undefined
    return { kind: kind as InputKind, id, revision }
  } catch {
    return undefined
  }
}

/**
 * The first line of every drawer docket files. MemPalace names a drawer by a
 * hash of its wing, room and content, and treats an identical drawer as one
 * already filed - so two inputs with the same text, or two revisions of one,
 * would otherwise share a drawer. It is removed again from every hit.
 */
export const drawerHeader = (identity: NativeIdentity): string =>
  `docket ${identity.kind} ${identity.id} (revision ${identity.revision})\n\n`

/** A hit's text without the header, which only the first chunk of a drawer carries. */
export const stripDrawerHeader = (text: string, identity: NativeIdentity): string => {
  const header = drawerHeader(identity)
  return text.startsWith(header) ? text.slice(header.length) : text
}

/** `name` made acceptable as a MemPalace wing or room, or undefined when nothing usable is left. */
export const palaceName = (name: string): string | undefined => {
  const cleaned = name
    .replace(/[^\p{L}\p{N}_ .'-]+/gu, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .slice(0, 128)
    .replace(/[^\p{L}\p{N}]+$/gu, '')
  return cleaned.length > 0 && isPalaceName(cleaned) ? cleaned : undefined
}

/** The wing a checkout's scope is filed under unless configured: unique to the checkout, as mem0's scope is. */
export const defaultWing = (projectRoot: string, scope: string): string => {
  const base = checkoutScope(projectRoot)
  return palaceName(scope === 'default' ? base : `${base}-${scope}`) ?? base.replace(/[^A-Za-z0-9-]/g, '-')
}

/** Rooms are topics: an entity is filed under its type, other inputs under their kind. */
export const roomFor = (record: CanonicalInput): string =>
  record.kind === 'entity' ? (palaceName(record.type) ?? 'entities') : record.kind === 'observation' ? 'observations' : 'documents'

/** MemPalace refuses longer drawers. */
const MAX_CONTENT = 100_000

/** `list_drawers` pages at most this many. */
const PAGE = 100

/** The six files chromadb checks before deciding to download all-MiniLM-L6-v2 (chromadb 1.5.x, `onnx_mini_lm_l6_v2.py`). */
const MINILM_FILES = ['config.json', 'model.onnx', 'special_tokens_map.json', 'tokenizer_config.json', 'tokenizer.json', 'vocab.txt']

/** Where chromadb keeps the default model MemPalace embeds with. */
export const minilmDirectory = (home = homedir()): string =>
  join(home, '.cache', 'chroma', 'onnx_models', 'all-MiniLM-L6-v2', 'onnx')

/**
 * Why MemPalace would have to download its embedding model before it could
 * embed anything, or undefined when it would not. Only `minilm` can be checked
 * on disk; `embeddinggemma` goes through the Hugging Face cache, which the
 * server is run offline against, so a missing copy fails instead of downloading.
 */
export const missingModel = (model: string, home = homedir()): string | undefined => {
  if (model !== 'minilm') return undefined
  const directory = minilmDirectory(home)
  if (MINILM_FILES.every((file) => existsSync(join(directory, file)))) return undefined
  return (
    `MemPalace's embedding model (all-MiniLM-L6-v2, ~80 MB) is not in ${directory}, and MemPalace would download it ` +
    'on first use; docket never downloads models implicitly. Fetch it yourself, in the Python environment MemPalace ' +
    'is installed in: python -c "from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2 as M; M()([\'warm up\'])"'
  )
}

interface ToolFailure {
  success?: boolean
  error?: unknown
}

export const failureOf = (result: unknown): string | undefined => {
  const { success, error } = (result ?? {}) as ToolFailure
  if (success === false || (error !== undefined && error !== null)) return typeof error === 'string' ? error : 'failed'
  return undefined
}

interface ListedDrawer {
  drawer_id: string
  metadata?: { source_file?: unknown }
}

interface SearchResult {
  drawer_id: string
  text: string
  source_path?: unknown
  source_file?: unknown
  similarity?: unknown
}

export interface PalaceSearch {
  hits: NativeHit[]
  /** Whether MemPalace may hold more matches than it returned. */
  more: boolean
  /** Notes MemPalace attached: a rewritten query, vector search switched off. */
  notes: string[]
}

/**
 * One wing of a palace, through MemPalace's MCP tools (pinned:
 * mempalace 3.10.0). Each canonical input is one drawer filed verbatim - after
 * a one-line header - in a room for its type, with its identity in
 * `source_file`, so the mapping is read back from the palace itself.
 */
export class PalaceStore implements NativeStore {
  constructor(
    private readonly client: () => Promise<ToolClient>,
    readonly wing: string,
    private readonly maxDistance?: number
  ) {}

  async list(signal?: AbortSignal): Promise<NativeRecord[]> {
    const records: NativeRecord[] = []
    for (let offset = 0; ; offset += PAGE) {
      const answer = await this.read('mempalace_list_drawers', { wing: this.wing, limit: PAGE, offset }, { signal })
      if (answer === undefined) return records
      const page = answer as { drawers?: ListedDrawer[]; total?: number }
      const drawers = page.drawers ?? []
      for (const drawer of drawers) {
        const identity = parseSourceFile(this.wing, drawer.metadata?.source_file)
        if (identity !== undefined) records.push({ nativeId: drawer.drawer_id, identity })
      }
      if (drawers.length < PAGE || (typeof page.total === 'number' && offset + drawers.length >= page.total)) return records
    }
  }

  async write(record: CanonicalInput, signal?: AbortSignal): Promise<NativeRecord> {
    const identity = { kind: record.kind, id: record.id, revision: record.revision }
    const content = `${drawerHeader(identity)}${canonicalPassage(record).text}`
    if ([...content].length > MAX_CONTENT) {
      throw new PalaceToolError(`${record.kind} ${record.id} is longer than the ${MAX_CONTENT} characters MemPalace files in one drawer`, false)
    }
    const filed = (await this.tool(
      'mempalace_add_drawer',
      { wing: this.wing, room: roomFor(record), content, source_file: sourceFile(this.wing, identity), added_by: 'docket' },
      { signal }
    )) as { drawer_id?: unknown }
    if (typeof filed.drawer_id !== 'string') throw new PalaceToolError('MemPalace filed the drawer but did not name it', true)
    return { nativeId: filed.drawer_id, identity }
  }

  async delete(record: NativeRecord, signal?: AbortSignal): Promise<void> {
    const result = await this.client().then((client) =>
      client.call('mempalace_delete_drawer', { drawer_id: record.nativeId }, { signal })
    )
    const failure = failureOf(result)
    // Deleting what is already gone is not a failure: it is not current either way.
    if (failure !== undefined && !/not found/i.test(failure)) throw new PalaceToolError(`MemPalace could not delete ${record.nativeId}: ${failure}`, true)
  }

  async search(question: string, limit: number, options: CallOptions = {}): Promise<PalaceSearch> {
    const asked = Math.min(limit, 100)
    const answer = await this.read(
      'mempalace_search',
      { query: question, wing: this.wing, limit: asked, ...(this.maxDistance !== undefined ? { max_distance: this.maxDistance } : {}) },
      options
    )
    if (answer === undefined) return { hits: [], more: false, notes: [] }
    const result = answer as { results?: SearchResult[]; query_sanitized?: unknown; vector_disabled?: unknown; vector_disabled_reason?: unknown }
    const hits: NativeHit[] = []
    for (const found of result.results ?? []) {
      const identity = parseSourceFile(this.wing, found.source_path ?? found.source_file)
      if (identity === undefined) continue
      hits.push({
        nativeId: found.drawer_id,
        identity,
        text: stripDrawerHeader(found.text, identity),
        ...(typeof found.similarity === 'number' && Number.isFinite(found.similarity) ? { score: found.similarity } : {})
      })
    }
    const notes: string[] = []
    if (result.query_sanitized === true) notes.push('MemPalace shortened the question before searching.')
    if (result.vector_disabled === true) {
      notes.push(`MemPalace searched without vectors${typeof result.vector_disabled_reason === 'string' ? `: ${result.vector_disabled_reason}` : ''}.`)
    }
    return { hits, more: (result.results ?? []).length >= asked || limit > asked, notes }
  }

  /** `tool`, but undefined when the palace has nothing filed in it yet. */
  private async read(name: string, args: Record<string, unknown>, options: CallOptions): Promise<unknown> {
    const result = await (await this.client()).call(name, args, options)
    const failure = failureOf(result)
    if (nothingFiled(failure)) return undefined
    if (failure !== undefined) throw new PalaceToolError(`MemPalace ${name} failed: ${failure}`, true)
    return result
  }

  private async tool(name: string, args: Record<string, unknown>, options: CallOptions): Promise<unknown> {
    const result = await (await this.client()).call(name, args, options)
    const failure = failureOf(result)
    if (failure !== undefined) throw new PalaceToolError(`MemPalace ${name} failed: ${failure}`, true)
    return result
  }
}

/** Whether a failed call is worth retrying: another writer and I/O trouble clear; a refused input does not. */
export const retryablePalaceError = (error: unknown): boolean => {
  if (error instanceof PalaceToolError) return error.retryable
  if (error instanceof McpError) return error.code !== -32602 && error.code !== -32601
  return true
}
