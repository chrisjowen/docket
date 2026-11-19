import { readFile } from 'node:fs/promises'

import type { ResolvedConfig } from '../config/config.js'
import { type Diagnostic, error } from '../model/diagnostic.js'
import type { MemoryDocument } from '../model/document.js'
import { parseOntology, unreadableOntology, type LoadedOntology } from '../ontology/loader.js'
import { hashContent } from '../source/hashing.js'
import { parseMemoryFile } from '../source/parser.js'
import { sourceFiles } from '../source/scanner.js'
import { EMPTY_DIRECTORY, parsePeople, peoplePath, readPeopleText, type LoadedPeople, type PeopleDirectory } from '../people/directory.js'

/** A source's people directory, parsed; a file that does not load is a diagnostic and no one. */
const readPeople = async (source: CanonicalSource): Promise<LoadedPeople> => {
  const path = peoplePath(source.resolved)
  try {
    const read = await source.people?.()
    if (!read) return { directory: EMPTY_DIRECTORY, diagnostics: [] }
    return 'text' in read ? parsePeople(read.text, path) : { directory: read, diagnostics: [] }
  } catch (cause) {
    return { directory: EMPTY_DIRECTORY, diagnostics: [error('people-unreadable', `Could not read ${path}: ${(cause as Error).message}`, { path })] }
  }
}

/** One canonical document as its source holds it: its path, its raw text, and `hashContent` of that text. */
export interface CanonicalDocument {
  /** Relative to the project root and posix-separated, as recorded on the document. */
  path: string
  raw: string
  /** `sha256:<hex>` of `raw` (`hashContent`), so a reader can tell what changed without parsing. */
  hash: string
}

/** A document the source has but could not read. */
export interface UnreadableDocument {
  path: string
  error: string
}

/**
 * Where canonical documents and the ontology come from: the project's files
 * today, a database in Docket Cloud. Core reads the canonical record only
 * through it, so it never cares where the documents live.
 */
export interface CanonicalSource {
  /**
   * The configuration the documents are read under: their paths are relative
   * to its project root, its ontology path names the ontology in diagnostics,
   * and its adapters project and answer for them.
   */
  readonly resolved: ResolvedConfig
  /** The ontology's text and its revision. Rejects with the reason when there is none to read. */
  ontology(): Promise<{ text: string; revision: string }>
  /** Every canonical document, in any order. */
  documents(): AsyncIterable<CanonicalDocument | UnreadableDocument>
  /**
   * The people directory policies score person sources by: the text of a
   * project's `people.yaml`, or one a server already holds. Null or absent:
   * no one is in it.
   */
  people?(): Promise<{ text: string } | PeopleDirectory | null>
}

/**
 * The project's own files: every file `source` includes under the memory
 * root, and the ontology at `ontologyPath`, read afresh on each call.
 */
export const filesystemSource = (resolved: ResolvedConfig): CanonicalSource => ({
  resolved,
  async ontology() {
    const text = await readFile(resolved.ontologyPath, 'utf8')
    return { text, revision: hashContent(text) }
  },
  async people() {
    const text = await readPeopleText(resolved)
    return text === null ? null : { text }
  },
  async *documents() {
    for (const { absolute, path } of await sourceFiles(resolved)) {
      let raw: string
      try {
        raw = await readFile(absolute, 'utf8')
      } catch (cause) {
        yield { path, error: cause instanceof Error ? cause.message : String(cause) }
        continue
      }
      yield { path, raw, hash: hashContent(raw) }
    }
  }
})

export interface CanonicalRead {
  /** Every document that parsed, in path order. */
  documents: MemoryDocument[]
  /** What parsing and reading the documents found. */
  diagnostics: Diagnostic[]
  /** Each document's raw text, by path. */
  files: ReadonlyMap<string, string>
  ontology: LoadedOntology
  /** The people directory, empty when the source has none or it does not load. */
  people: PeopleDirectory
}

/**
 * Reads a source once: its documents parsed, in path order whatever order
 * the source gave them in, so the same documents always read alike (spec
 * §72), and its ontology loaded. Never throws for a document or an ontology
 * it cannot read: each is a diagnostic, as the scanner and loader report it.
 */
export const readCanonical = async (source: CanonicalSource): Promise<CanonicalRead> => {
  const ontologyPath = source.resolved.ontologyPath
  const ontology = source.ontology().then(
    ({ text }) => parseOntology(text, ontologyPath),
    (cause: unknown) => unreadableOntology(cause, ontologyPath)
  )

  const read: (CanonicalDocument | UnreadableDocument)[] = []
  for await (const document of source.documents()) read.push(document)
  read.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const documents: MemoryDocument[] = []
  const diagnostics: Diagnostic[] = []
  const files = new Map<string, string>()
  for (const document of read) {
    if (!('raw' in document)) {
      diagnostics.push(error('unreadable-file', document.error, { path: document.path }))
      continue
    }
    files.set(document.path, document.raw)
    const result = parseMemoryFile(document.raw, document.path)
    diagnostics.push(...result.diagnostics)
    if (result.document) documents.push(result.document)
  }
  const people = await readPeople(source)
  diagnostics.push(...people.diagnostics)
  return { documents, diagnostics, files, ontology: await ontology, people: people.directory }
}
