import matter from 'gray-matter'
import { type Diagnostic, error } from '../model/diagnostic.js'
import { frontmatterSchema, type MemoryDocument } from '../model/document.js'
import { hashContent } from './hashing.js'

export interface ParseResult {
  /** Absent when the file failed structural validation. */
  document?: MemoryDocument
  diagnostics: Diagnostic[]
}

const MENTION = /\[\[([^\]\n]+)\]\]/g

/**
 * Weak `[[id]]` references in the body (spec §19). These are derived hints only -
 * never semantic relationships. Deduped in order of appearance so output is stable.
 */
export const extractMentions = (body: string): string[] => {
  const seen = new Set<string>()
  for (const match of body.matchAll(MENTION)) {
    const id = match[1]?.trim()
    if (id) seen.add(id)
  }
  return [...seen]
}

/**
 * Ontology-independent parse of one canonical file (spec §23). Structural problems
 * come back as diagnostics rather than exceptions so a single bad file never aborts a scan.
 */
export const parseMemoryFile = (
  raw: string,
  relativePath: string
): ParseResult => {
  let body: string
  let data: unknown
  try {
    const file = matter(raw)
    body = file.content
    data = file.data
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return {
      diagnostics: [
        error('invalid-frontmatter', `Unparseable frontmatter: ${message}`, {
          path: relativePath
        })
      ]
    }
  }

  const parsed = frontmatterSchema.safeParse(data)
  if (!parsed.success) {
    return {
      diagnostics: parsed.error.issues.map((issue) =>
        error(
          'invalid-frontmatter',
          `${issue.path.join('.') || 'frontmatter'}: ${issue.message}`,
          { path: relativePath }
        )
      )
    }
  }

  const fm = parsed.data
  return {
    document: {
      id: fm.id,
      type: fm.type,
      title: fm.title,
      path: relativePath,
      hash: hashContent(raw),
      tags: fm.tags,
      attributes: fm.attributes,
      links: fm.links,
      content: body,
      mentions: extractMentions(body),
      provenance: fm.provenance,
      index: fm.index
    },
    diagnostics: []
  }
}
