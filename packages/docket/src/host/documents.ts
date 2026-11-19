import { stat } from 'node:fs/promises'

import type { ResolvedConfig } from '../config/config.js'
import { absolute, readRecords, readWorkspace, removeFile, writeLock, writeRecords, writeText, type LocalWorkspace, type Store } from '../mcp/local/files.js'
import type { Diagnostic, MemoryDocument } from '../model/index.js'
import { validateDocuments } from '../ontology/validator.js'
import { parseOntology } from '../ontology/loader.js'
import { hashContent } from '../source/hashing.js'
import { parseMemoryFile } from '../source/parser.js'
import { DocumentError, checkDocument, checkoutProblem } from '../workspace/documents.js'
import { hasErrors } from '../workspace/write/evidence.js'

/*
 * The documents API `docket cloud push|pull|status` call, over a project's
 * own files, as `docket serve` answers it without a database: the project's
 * documents are the workspace's, and a checkout's push writes its files into
 * the project at their paths, the project keeping which checkout each came
 * from in `<root>/pushed.yaml`. Every other document is the server's own
 * (`cloud`, as Docket Cloud calls what is written there), which
 * `docket cloud pull --resources` brings down.
 */

/** A document as the documents API lists it. */
export interface ProjectDocument {
  path: string
  hash: string
  origin: 'cli' | 'cloud'
  originRef?: string
  updatedAt?: string
  raw?: string
}

export interface PushInput {
  /** docket's `checkoutScope(projectRoot)` of the checkout pushing. */
  checkout: string
  upsert: { path: string; raw: string }[]
  /** Paths of this checkout's documents to remove. */
  remove: string[]
}

export interface PushDiagnostic {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

export interface PushResult {
  /** False when an error refused the push: then nothing was written. */
  ok: boolean
  dryRun: boolean
  created: string[]
  updated: string[]
  unchanged: string[]
  removed: string[]
  diagnostics: PushDiagnostic[]
}

/** Which checkout pushed a document of the project, as `<root>/pushed.yaml` records it. */
export interface PushedRecord {
  path: string
  checkout: string
  pushedBy: string
  pushedAt: string
}

export const PUSHED_FILE = 'pushed.yaml'
const PUSHED_HEADER = `
The documents checkouts pushed into this docket with \`docket cloud push\`
through \`docket serve\`, and which checkout each came from. A checkout's next
push updates or removes only its own; every other document is the server's.`

const readPushed = (store: Store): Promise<PushedRecord[]> => readRecords(store, PUSHED_FILE, 'documents')

const writePushed = (store: Store, records: readonly PushedRecord[]): Promise<void> =>
  writeRecords(store, PUSHED_FILE, PUSHED_HEADER, 'documents', [...records].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)))

/** The project's live documents of one origin, in path order: a checkout's (`cli`, with `originRef`), or the server's own (`cloud`). */
export async function listProjectDocuments(
  resolved: ResolvedConfig,
  query: { origin: 'cli' | 'cloud'; originRef?: string | undefined; raw?: boolean | undefined }
): Promise<ProjectDocument[]> {
  const workspace = await readWorkspace(resolved)
  const pushed = new Map((await readPushed(workspace)).map((record) => [record.path, record]))
  const out: ProjectDocument[] = []
  for (const entry of workspace.documents) {
    if (entry.raw === undefined || entry.hash === undefined) continue
    const record = pushed.get(entry.path)
    if (query.origin === 'cli' ? record?.checkout !== query.originRef : record !== undefined) continue
    let updatedAt: string | undefined
    try {
      updatedAt = (await stat(absolute(resolved, entry.path))).mtime.toISOString()
    } catch {
      updatedAt = undefined
    }
    out.push({
      path: entry.path,
      hash: entry.hash,
      origin: query.origin,
      ...(record ? { originRef: record.checkout } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(query.raw ? { raw: entry.raw } : {})
    })
  }
  return out
}

const toPush = (diagnostic: Diagnostic, path: string): PushDiagnostic => ({
  severity: diagnostic.severity,
  code: diagnostic.code,
  message: diagnostic.message,
  path: diagnostic.path ?? path
})

/** Why a path cannot hold a pushed document of this project: outside its docket, or among the docket's own files. */
function placeProblem(workspace: LocalWorkspace, path: string): string | null {
  const inside = workspace.root === '.' ? path : path.startsWith(`${workspace.root}/`) ? path.slice(workspace.root.length + 1) : null
  if (inside === null) return `${path} is outside this docket's root, ${workspace.root}/: push from a checkout whose docket is there too.`
  if (inside.split('/').some((segment) => segment.startsWith('.'))) return `${path} is among the docket's own files, where no document goes.`
  return null
}

/**
 * `docket cloud push` into the project: the checkout's files are validated as
 * one push - each path, size and structure, and the changed documents against
 * the ontology beside the documents their links point at - before anything is
 * written; any error refuses it all. A path another source holds is refused,
 * unless it holds the same text. A dry run validates and reports, writing
 * nothing. Runs under the project's write lock.
 */
export async function pushToProject(
  resolved: ResolvedConfig,
  writer: { label: string },
  input: PushInput,
  options: { dryRun?: boolean; now?: () => Date } = {}
): Promise<PushResult> {
  const problem = checkoutProblem(input.checkout)
  if (problem) throw new Error(problem)
  const dryRun = options.dryRun === true
  return writeLock(resolved, async () => {
    const workspace = await readWorkspace(resolved)
    const diagnostics: PushDiagnostic[] = []
    const refuse = (code: string, message: string, path?: string) => diagnostics.push({ severity: 'error', code, message, ...(path ? { path } : {}) })
    const warn = (code: string, message: string, path: string) => diagnostics.push({ severity: 'warning', code, message, path })

    const ontology = workspace.ontology?.ontology ?? (workspace.ontology ? parseOntology(workspace.ontology.text, 'ontology').ontology : null)
    if (!ontology) refuse('no-ontology', 'This docket has no ontology to check documents against.')

    const removing = new Set(input.remove)
    const files = new Map<string, { raw: string; hash: string; document: MemoryDocument }>()
    const seen = new Set<string>()
    for (const { path, raw } of input.upsert) {
      if (seen.has(path)) {
        refuse('duplicate-path', `${path} is in the push twice.`, path)
        continue
      }
      seen.add(path)
      if (removing.has(path)) {
        refuse('upsert-and-remove', `${path} is both upserted and removed.`, path)
        continue
      }
      try {
        const document = checkDocument(path, raw)
        const place = placeProblem(workspace, path)
        if (place) {
          refuse('invalid-path', place, path)
          continue
        }
        diagnostics.push(...parseMemoryFile(raw, path).diagnostics.map((d) => toPush(d, path)))
        files.set(path, { raw, hash: hashContent(raw), document })
      } catch (caught) {
        if (!(caught instanceof DocumentError)) throw caught
        const errors = caught.diagnostics.filter((d) => d.severity === 'error')
        if (errors.length) diagnostics.push(...errors.map((d) => toPush(d, path)))
        else refuse(caught.code === 'too-large' ? 'document-too-large' : 'invalid-document', caught.message, path)
      }
    }

    const pushed = await readPushed(workspace)
    const ownerOf = new Map(pushed.map((record) => [record.path, record.checkout]))
    const held = new Map(workspace.documents.map((entry) => [entry.path, entry]))
    const created: string[] = []
    const updated: string[] = []
    const unchanged: string[] = []
    for (const [path, file] of files) {
      const current = held.get(path)
      if (!current) created.push(path)
      else if (ownerOf.get(path) === input.checkout) (current.hash === file.hash ? unchanged : updated).push(path)
      else if (current.hash === file.hash) {
        warn('held-elsewhere', `${path} is already in the docket with the same text, so it is left as it is.`, path)
        unchanged.push(path)
      } else {
        const holder = ownerOf.has(path) ? "another checkout's document" : "the server's own document"
        refuse('path-taken', `${path}: the docket already holds ${holder} at that path. Move the file, or change it at its source.`, path)
      }
    }

    const removed = [...removing].filter((path) => ownerOf.get(path) === input.checkout && held.has(path)).sort()
    for (const path of removing) {
      if (!removed.includes(path)) warn('not-pushed', `${path} is not a document this checkout pushed, so there is nothing to remove.`, path)
    }

    // The changed documents against the ontology, beside the documents their links point at.
    const changed = new Set([...created, ...updated])
    if (ontology && changed.size) {
      const incoming = [...files.values()].map((file) => file.document)
      const targets = new Set(incoming.flatMap((document) => document.links.map((link) => link.target)))
      const replaced = new Set([...files.keys(), ...removed])
      const beside = workspace.documents.flatMap((entry) => (entry.document && targets.has(entry.document.id) && !replaced.has(entry.path) ? [entry.document] : []))
      const validated = validateDocuments([...incoming, ...beside], ontology).filter((d) => d.path !== undefined && changed.has(d.path))
      diagnostics.push(...validated.map((d) => toPush(d, d.path as string)))
    }

    if (hasErrors(diagnostics)) return { ok: false, dryRun, created: [], updated: [], unchanged: [], removed: [], diagnostics }
    const result: PushResult = { ok: true, dryRun, created, updated, unchanged, removed, diagnostics }
    if (dryRun) return result

    const now = (options.now ?? (() => new Date()))().toISOString()
    for (const path of removed) await removeFile(absolute(resolved, path))
    for (const path of changed) await writeText(absolute(resolved, path), (files.get(path) as { raw: string }).raw)
    const gone = new Set([...removed, ...changed])
    await writePushed(workspace, [
      ...pushed.filter((record) => !gone.has(record.path)),
      ...[...changed].map((path) => ({ path, checkout: input.checkout, pushedBy: writer.label, pushedAt: now }))
    ])
    return result
  })
}
