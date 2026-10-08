import matter from 'gray-matter'
import { parse as parseYaml } from 'yaml'
import { type Diagnostic, error, warning } from '../model/diagnostic.js'
import {
  frontmatterSchema,
  MEMORY_EVIDENCE_FIELDS,
  type MemoryDocument,
  type MemoryEvidence
} from '../model/document.js'
import { hashContent } from './hashing.js'

export interface ParseResult {
  /** Absent when the file failed structural validation. */
  document?: MemoryDocument
  diagnostics: Diagnostic[]
}

/**
 * Frontmatter is read with the same YAML 1.2 engine as the ontology, not
 * gray-matter's default js-yaml (YAML 1.1). Under 1.1 an unquoted
 * `date: 2026-10-05` becomes a `Date`, which fails a `string` attribute and
 * projects as `{}`. Passing any options also turns off gray-matter's global
 * cache, which would otherwise keep every parsed file for the life of the
 * process and hand callers objects shared with that cache.
 */
export const MATTER_OPTIONS = { engines: { yaml: (source: string) => parseYaml(source) as object } }

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

const lineCount = (text: string): number => text.split('\n').length - 1

const KNOWN_EVIDENCE_FIELDS = new Set(MEMORY_EVIDENCE_FIELDS)

/**
 * Keeps the fields evidence defines and warns about the rest - most often a
 * near miss like `url` for `urls` - rather than failing the whole file.
 */
const knownEvidence = (
  entries: readonly Record<string, unknown>[],
  at: string,
  relativePath: string,
  diagnostics: Diagnostic[]
): MemoryEvidence[] =>
  entries.map((entry, index) => {
    const unknown = Object.keys(entry).filter((key) => !KNOWN_EVIDENCE_FIELDS.has(key))
    if (unknown.length > 0) {
      diagnostics.push(
        warning(
          'unknown-evidence-field',
          `${at}[${index}]: ${unknown.map((key) => `"${key}"`).join(', ')} ignored; evidence fields are ${MEMORY_EVIDENCE_FIELDS.join(', ')}.`,
          { path: relativePath }
        )
      )
    }
    return Object.fromEntries(
      Object.entries(entry).filter(([key]) => KNOWN_EVIDENCE_FIELDS.has(key))
    ) as unknown as MemoryEvidence
  })

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
    const file = matter(raw, MATTER_OPTIONS)
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
  const diagnostics: Diagnostic[] = []
  return {
    document: {
      id: fm.id,
      type: fm.type,
      title: fm.title,
      path: relativePath,
      hash: hashContent(raw),
      tags: fm.tags,
      attributes: fm.attributes,
      links: fm.links.map(({ evidence, ...link }, index) =>
        evidence === undefined
          ? link
          : { ...link, evidence: knownEvidence(evidence, `links[${index}].evidence`, relativePath, diagnostics) }
      ),
      content: body,
      // gray-matter's body is what follows the frontmatter, so it ends the raw file.
      bodyLine: lineCount(raw.slice(0, raw.length - body.length)) + 1,
      mentions: extractMentions(body),
      evidence: knownEvidence(fm.evidence, 'evidence', relativePath, diagnostics),
      provenance: fm.provenance,
      index: fm.index
    },
    diagnostics
  }
}
