import { glob, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { ResolvedConfig } from '../config/config.js'
import { type Diagnostic, error } from '../model/diagnostic.js'
import type { MemoryDocument } from '../model/document.js'
import { parseMemoryFile } from './parser.js'

export interface ScanResult {
  documents: MemoryDocument[]
  diagnostics: Diagnostic[]
}

const matches = async (
  patterns: readonly string[],
  cwd: string
): Promise<Set<string>> => {
  const found = new Set<string>()
  if (patterns.length === 0) return found
  for await (const match of glob(patterns, { cwd })) found.add(match)
  return found
}

/** Path as recorded on the document: repo-relative and always posix-separated. */
const repoRelative = (projectRoot: string, absolute: string): string =>
  relative(projectRoot, absolute).split(sep).join('/')

/**
 * Walk the source root and parse every included file. Results are sorted by path so
 * repeated scans - and therefore rebuilt projections - are byte-identical (spec §72).
 */
export const scanSource = async (
  resolved: ResolvedConfig
): Promise<ScanResult> => {
  const { source } = resolved.config
  const [included, excluded] = await Promise.all([
    matches(source.include, resolved.memoryRoot),
    matches(source.exclude, resolved.memoryRoot)
  ])

  const files = [...included].filter((f) => !excluded.has(f)).sort()

  const documents: MemoryDocument[] = []
  const diagnostics: Diagnostic[] = []

  for (const file of files) {
    const absolute = join(resolved.memoryRoot, file)
    const path = repoRelative(resolved.projectRoot, absolute)
    let raw: string
    try {
      raw = await readFile(absolute, 'utf8')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      diagnostics.push(error('unreadable-file', message, { path }))
      continue
    }
    const result = parseMemoryFile(raw, path)
    diagnostics.push(...result.diagnostics)
    if (result.document) documents.push(result.document)
  }

  // Identity is the id, not the path, so the same id in two files is unresolvable (spec §66).
  const firstSeen = new Map<string, string>()
  for (const document of documents) {
    const original = firstSeen.get(document.id)
    if (original === undefined) {
      firstSeen.set(document.id, document.path)
      continue
    }
    diagnostics.push(
      error('duplicate-id', `Duplicate id, already defined in ${original}`, {
        path: document.path,
        id: document.id
      })
    )
  }

  return { documents, diagnostics }
}
