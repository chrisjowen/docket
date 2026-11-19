import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join, posix as posixPath, relative, resolve, sep } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { filesystemSource } from '../../canonical/source.js'
import type { ResolvedConfig } from '../../config/config.js'
import type { MemoryDocument, Ontology } from '../../model/index.js'
import { parseOntology } from '../../ontology/loader.js'
import { loadPeople, type PeopleDirectory } from '../../people/directory.js'
import { hashContent } from '../../source/hashing.js'
import { parseMemoryFile } from '../../source/parser.js'
import { cloudDocumentPath } from '../../workspace/documents.js'
import type { Classification, Disposition, WorkspaceSnapshot } from '../../workspace/ontology/check.js'
import type { Migration } from '../../workspace/ontology/migrations.js'
import type { StampedEvidence } from '../../workspace/write/inputs.js'

/*
 * A project's docket as the store the local MCP tools read and write: its
 * canonical documents are the files under the docket's root, written in
 * place, and what a server keeps in tables beside them - supersessions, the
 * ontology's published versions and its drafts - are files there too, so
 * they are committed with the rest and git keeps their history.
 */

/** One canonical document of the project: its text and, when it parses, the document it declares. */
export interface LocalDocument {
  /** Relative to the project root, posix-separated. */
  path: string
  raw?: string
  /** Why it could not be read, when it could not. */
  error?: string
  hash?: string
  document: MemoryDocument | null
}

/** The project's ontology file as it is now. */
export interface LocalOntology {
  text: string
  /** `hashContent` of the text. */
  revision: string
  ontology: Ontology | null
  /** When the file last changed. */
  changedAt: Date
}

export interface LocalWorkspace {
  resolved: ResolvedConfig
  /** The docket's root, relative to the project root: `.docket` unless `source.root` says otherwise. */
  root: string
  /** Every canonical document, in path order. */
  documents: LocalDocument[]
  /** Null when there is no ontology file to read. */
  ontology: LocalOntology | null
  /** The people directory: the project's `people.yaml`, or one the server running the tools holds. */
  people: PeopleDirectory
}

const posix = (path: string): string => path.split(sep).join('/')

/** A path relative to the project root, as an absolute one. */
export const absolute = (resolved: ResolvedConfig, path: string): string => resolve(resolved.projectRoot, path)

/** The project's ontology file, relative to its root. */
export const ontologyFile = (resolved: ResolvedConfig): string => posix(relative(resolved.projectRoot, resolved.ontologyPath))

/** Reads the project's docket: every document under its source, parsed, and its ontology. */
export async function readWorkspace(resolved: ResolvedConfig, options: { people?: PeopleDirectory | undefined } = {}): Promise<LocalWorkspace> {
  const documents: LocalDocument[] = []
  for await (const entry of filesystemSource(resolved).documents()) {
    if ('error' in entry) documents.push({ path: entry.path, error: entry.error, document: null })
    else documents.push({ path: entry.path, raw: entry.raw, hash: entry.hash, document: parseMemoryFile(entry.raw, entry.path).document ?? null })
  }
  documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  let ontology: LocalOntology | null = null
  try {
    const text = await readFile(resolved.ontologyPath, 'utf8')
    const { mtime } = await stat(resolved.ontologyPath)
    ontology = { text, revision: hashContent(text), ontology: parseOntology(text, ontologyFile(resolved)).ontology, changedAt: mtime }
  } catch {
    ontology = null
  }
  const people = options.people ?? (await loadPeople(resolved)).directory
  return { ...storeOf(resolved), documents, ontology, people }
}

/** The documents that declare `id`, in path order. */
export const declaring = (workspace: LocalWorkspace, id: string): (LocalDocument & { document: MemoryDocument })[] =>
  workspace.documents.filter((entry): entry is LocalDocument & { document: MemoryDocument } => entry.document?.id === id)

/** A resource's type and title as its first declaring document gives them, or null when no document declares it. */
export function describeResource(workspace: LocalWorkspace, id: string): { id: string; type: string; title: string; path: string } | null {
  const first = declaring(workspace, id)[0]
  return first ? { id, type: first.document.type, title: first.document.title, path: first.path } : null
}

/**
 * Where a resource's own document goes: beside the project's other documents
 * of its type; else in the folder `docket init` makes for the type, such as
 * `<root>/resources/services/` or `<root>/decisions/`; else at
 * `<root>/resources/<type>/<slug>.md`, as a server would put it in a repo.
 */
export function documentPathOf(workspace: LocalWorkspace, resource: { id: string; type: string }): string {
  const fallback = cloudDocumentPath(resource)
  const file = posixPath.basename(fallback)
  const under = (path: string): string => (workspace.root === '.' ? path : `${workspace.root}/${path}`)
  const sibling = workspace.documents.find((entry) => entry.document?.type === resource.type)
  if (sibling) return `${posixPath.dirname(sibling.path)}/${file}`
  const plural = resource.type.endsWith('y') ? `${resource.type.slice(0, -1)}ies` : `${resource.type}s`
  for (const folder of [`resources/${plural}`, plural]) {
    if (existsSync(absolute(workspace.resolved, under(folder)))) return under(`${folder}/${file}`)
  }
  return fallback.replace(/^\.docket\//, workspace.root === '.' ? '' : `${workspace.root}/`)
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Where a resource's new document can go: its path, or beside it as
 * `<slug>-2.md` and so on when another file already holds that path.
 */
export async function freeDocumentPath(workspace: LocalWorkspace, resource: { id: string; type: string }): Promise<string | null> {
  const base = documentPathOf(workspace, resource)
  for (const candidate of [base, ...[2, 3, 4, 5].map((n) => base.replace(/\.md$/, `-${n}.md`))]) {
    if (!workspace.documents.some((entry) => entry.path === candidate) && !(await exists(absolute(workspace.resolved, candidate)))) return candidate
  }
  return null
}

/** Writes a file whole or not at all: to a temporary file beside it, then renamed over it. */
export async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, path)
  } catch (cause) {
    await rm(temporary, { force: true })
    throw cause
  }
}

export const removeFile = (path: string): Promise<void> => rm(path, { force: true })

/** The file a store record is kept in, under the docket's root. */
const recordFile = (workspace: Store, name: string): string => (workspace.root === '.' ? name : `${workspace.root}/${name}`)

/** What reading and writing the store's own records needs: where the project and its docket are. */
export type Store = Pick<LocalWorkspace, 'resolved' | 'root'>

/** The store of a project, without reading its documents. */
export const storeOf = (resolved: ResolvedConfig): Store => ({ resolved, root: posix(relative(resolved.projectRoot, resolved.memoryRoot)) || '.' })

export async function readRecords<T>(workspace: Store, name: string, key: string): Promise<T[]> {
  let text: string
  try {
    text = await readFile(absolute(workspace.resolved, recordFile(workspace, name)), 'utf8')
  } catch {
    return []
  }
  const data: unknown = parseYaml(text)
  const list = typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[key] : undefined
  if (!Array.isArray(list)) throw new Error(`${recordFile(workspace, name)} has no ${key} list.`)
  return list as T[]
}

export async function writeRecords(workspace: Store, name: string, header: string, key: string, records: readonly unknown[]): Promise<void> {
  const body = stringifyYaml({ [key]: records }, { lineWidth: 0 })
  await writeText(absolute(workspace.resolved, recordFile(workspace, name)), `${header.trim().replace(/^/gm, '# ')}\n${body}`)
}

/** A supersession as the project keeps it, in `<root>/supersessions.yaml`. */
export interface LocalSupersession {
  id: string
  /** The record gone out of date. */
  resource: string
  /** The record that replaces it. */
  supersededBy: string
  /** Until when the older record held, as an ISO timestamp. */
  validUntil: string
  source: 'agent'
  recordedBy: string
  recordedAt: string
  reason: string
  evidence: StampedEvidence[]
  /** When it was replaced by a later supersession of the same record; absent while it holds. */
  liftedAt?: string
}

export const SUPERSESSIONS_FILE = 'supersessions.yaml'
const SUPERSESSIONS_HEADER = `
Supersessions recorded through docket's MCP server (docket_supersede): each
record gone out of date, the record that replaced it, until when it held, why,
and the evidence. The documents themselves are untouched.`

export const readSupersessions = (workspace: Store): Promise<LocalSupersession[]> => readRecords(workspace, SUPERSESSIONS_FILE, 'supersessions')

export const writeSupersessions = (workspace: LocalWorkspace, records: readonly LocalSupersession[]): Promise<void> =>
  writeRecords(workspace, SUPERSESSIONS_FILE, SUPERSESSIONS_HEADER, 'supersessions', records)

/** The supersessions that hold now, one per superseded record, by its id. */
export async function liveSupersessions(workspace: Store): Promise<Map<string, LocalSupersession>> {
  return new Map((await readSupersessions(workspace)).filter((record) => record.liftedAt === undefined).map((record) => [record.resource, record]))
}

/** A published version of the ontology as the project records it, in `<root>/ontology-history.yaml`. */
export interface LocalVersion {
  version: number
  revision: string
  publishedAt: string
  publishedBy: string
  message: string | null
  classification: Classification
  migration?: Migration[]
  dispositions?: { resourceId: string; disposition: Disposition }[]
}

export const HISTORY_FILE = 'ontology-history.yaml'
const HISTORY_HEADER = `
The ontology versions published through docket's MCP server
(docket_publish_ontology_change). The text of each is in git's history of the
ontology file; restore an earlier one from there.`

export const historyPath = (workspace: Store): string => recordFile(workspace, HISTORY_FILE)

export const readHistory = (workspace: Store): Promise<LocalVersion[]> => readRecords(workspace, HISTORY_FILE, 'versions')

export const writeHistory = (workspace: LocalWorkspace, versions: readonly LocalVersion[]): Promise<void> =>
  writeRecords(workspace, HISTORY_FILE, HISTORY_HEADER, 'versions', versions)

/** The ontology as published now: its version, and when and why it was published. */
export interface LocalHead extends LocalOntology {
  version: number
  publishedAt: Date | string
  message: string | null
}

/**
 * The published head: the ontology file as it is now. Its version is the one
 * the history records for this text; a file changed by hand since the last
 * recorded publish is the version after it, and one never published through
 * MCP is version 1.
 */
export async function headOf(workspace: LocalWorkspace): Promise<LocalHead | null> {
  const { ontology } = workspace
  if (!ontology) return null
  const last = (await readHistory(workspace)).at(-1)
  if (last && last.revision === ontology.revision) return { ...ontology, version: last.version, publishedAt: last.publishedAt, message: last.message }
  return { ...ontology, version: (last?.version ?? 0) + 1, publishedAt: ontology.changedAt, message: null }
}

/** Where proposed drafts are kept, under the docket's root. */
export const draftPath = (workspace: Store, id: string): string => recordFile(workspace, `ontology-drafts/${id}.yaml`)

/** The workspace as a change check reads it: every document that parses, each the project's own, and the head. */
export function snapshotOf(workspace: LocalWorkspace, head: LocalHead | null): WorkspaceSnapshot {
  const parsed = workspace.documents.flatMap((entry) => (entry.document ? [entry.document] : []))
  return {
    documents: parsed,
    origins: new Map(workspace.documents.map((entry) => [entry.path, 'local' as const])),
    head: head ? { number: head.version, ontology: head.ontology } : null,
    people: workspace.people
  }
}

const queues = new Map<string, Promise<unknown>>()

/**
 * Runs `fn` after every write already queued for the project, so two calls
 * never read the same files and write over each other. Only within this
 * process: `writeLock` holds other processes off too.
 */
export function serialized<T>(project: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(project) ?? Promise.resolve()
  const next = previous.then(fn, fn)
  const settled = next.then(
    () => undefined,
    () => undefined
  )
  queues.set(project, settled)
  void settled.then(() => {
    if (queues.get(project) === settled) queues.delete(project)
  })
  return next
}

/** The file a project's writers take turns on: in the docket's disposable `.cache/`. */
export const lockFile = (resolved: ResolvedConfig): string => join(resolved.memoryRoot, '.cache', 'write.lock')

/** How long a writer waits for another process's write before giving up. */
export const LOCK_WAIT_MS = 30_000

/** A lock older than this is a writer that died holding it: no write takes so long. */
export const STALE_LOCK_MS = 120_000

/** Whether the process that wrote a lock on this machine is gone. */
function deadHolder(holder: { pid?: unknown; host?: unknown }): boolean {
  if (typeof holder.pid !== 'number' || holder.host !== hostname()) return false
  try {
    process.kill(holder.pid, 0)
    return false
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

/**
 * Runs `fn` holding the lock file at `path`, made with `O_EXCL` so one
 * process holds it at a time; waits for another holder, and takes over a lock
 * whose holder died (its process is gone, or it is older than any write).
 */
export async function withLockFile<T>(path: string, fn: () => Promise<T>, options: { waitMs?: number } = {}): Promise<T> {
  await mkdir(dirname(path), { recursive: true })
  const deadline = Date.now() + (options.waitMs ?? LOCK_WAIT_MS)
  let delay = 10
  for (;;) {
    try {
      await writeFile(path, JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() }), { flag: 'wx' })
      break
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
    }
    let holder: { pid?: unknown; host?: unknown } = {}
    let age = 0
    try {
      holder = JSON.parse(await readFile(path, 'utf8')) as typeof holder
      age = Date.now() - (await stat(path)).mtimeMs
    } catch {
      // Released, or still being written: try again.
    }
    if (deadHolder(holder) || age > STALE_LOCK_MS) {
      await rm(path, { force: true })
      continue
    }
    if (Date.now() > deadline) throw new Error(`Another writer has held ${path} for longer than ${Math.round((options.waitMs ?? LOCK_WAIT_MS) / 1000)} s; try again.`)
    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, 200)
  }
  try {
    return await fn()
  } finally {
    await rm(path, { force: true })
  }
}

/**
 * Runs a write to the project's files after every other: queued behind this
 * process's writes, then holding the project's lock file against other
 * processes' - `docket open`'s MCP server, `docket serve`, another agent's
 * `docket mcp` - so no two writers read the same files and write over each
 * other.
 */
export const writeLock = <T>(resolved: ResolvedConfig, fn: () => Promise<T>): Promise<T> =>
  serialized(resolved.projectRoot, () => withLockFile(lockFile(resolved), fn))
