import { parseMemoryFile, type Diagnostic, type MemoryDocument } from './docket.js'

/**
 * The rules a canonical document is held to, whatever store holds it: a
 * relative Markdown path, a size, and frontmatter docket parses. Validation
 * against the ontology is the write path's.
 */

/** One canonical document's raw text, in UTF-8 bytes. */
export const DOCUMENT_BYTES = 64 * 1024

export class DocumentError extends Error {
  override name = 'DocumentError'
  constructor(
    readonly code: 'invalid' | 'too-large' | 'limit' | 'not-found',
    message: string,
    readonly diagnostics: Diagnostic[] = []
  ) {
    super(message)
  }
}

/** A posix path relative to the workspace root, without `.` or `..` segments, naming a Markdown file. */
export function pathProblem(path: string): string | null {
  if (path.length === 0 || path.length > 512) return 'A document path is 1-512 characters.'
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) return 'Use a relative path with forward slashes.'
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'A document path has no empty, "." or ".." segments.'
  }
  if (!path.endsWith('.md')) return 'A document is a Markdown file: its path ends in .md.'
  return null
}

/**
 * Where a document written through the server lives: the path it would have
 * in a repo, `.docket/resources/<type>/<slug>.md`, the slug being its id
 * without the type prefix.
 */
export function cloudDocumentPath(document: { id: string; type: string }): string {
  const safe = (text: string) => text.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+|-+$/g, '') || 'resource'
  const slug = document.id.startsWith(`${document.type}.`) ? document.id.slice(document.type.length + 1) : document.id
  return `.docket/resources/${safe(document.type)}/${safe(slug)}.md`
}

/** Checks a document the way the store will hold it, without writing: its path, size and structure. */
export function checkDocument(path: string, raw: string): MemoryDocument {
  const problem = pathProblem(path)
  if (problem) throw new DocumentError('invalid', `${path}: ${problem}`)
  if (Buffer.byteLength(raw, 'utf8') > DOCUMENT_BYTES) {
    throw new DocumentError('too-large', `${path}: a document holds at most ${DOCUMENT_BYTES / 1024} KB.`)
  }
  const parsed = parseMemoryFile(raw, path)
  if (!parsed.document) {
    const errors = parsed.diagnostics.filter((d) => d.severity === 'error')
    throw new DocumentError('invalid', `${path}: ${errors.map((d) => d.message).join(' ') || 'not a docket document'}`, parsed.diagnostics)
  }
  return parsed.document
}

/**
 * Why a checkout id `docket cloud push` sent cannot key a push: it is
 * `checkoutScope(projectRoot)`, printable, at most 200 characters.
 */
export function checkoutProblem(checkout: unknown): string | null {
  if (typeof checkout !== 'string' || checkout.length === 0 || checkout.length > 200) return 'checkout is a string of 1-200 characters.'
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(checkout)) return 'checkout has no whitespace or control characters.'
  return null
}
