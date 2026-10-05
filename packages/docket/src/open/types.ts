/**
 * What `docket open` serves to its web UI, as JSON. Self-contained - no
 * imports - so the UI package can share these types without compiling the
 * rest of docket.
 *
 * Provenance travels as an open record and the parsed frontmatter as a whole,
 * so fields added to the file format show up in the UI without a change here.
 */

export interface UiLink {
  rel: string
  target: string
  attributes?: Record<string, unknown>
}

export interface UiEntity {
  id: string
  type: string
  title: string
  /** Repo-relative path of the canonical file. */
  path: string
  tags: string[]
  attributes: Record<string, unknown>
  links: UiLink[]
  /** Weak `[[id]]` references found in the body. */
  mentions: string[]
  /** Markdown body, frontmatter stripped. */
  content: string
  /** Where the knowledge came from and how much to trust it, when the file says. */
  provenance?: Record<string, unknown>
  /** The file's frontmatter exactly as parsed, including fields docket does not model. */
  frontmatter: Record<string, unknown>
}

export interface UiEdge {
  source: string
  rel: string
  target: string
  attributes?: Record<string, unknown>
  /** No file defines the target yet. */
  dangling: boolean
}

export interface UiDefinition {
  name: string
  description?: string
}

export interface UiDiagnostic {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
  id?: string
}

/** How far the search index lags the files. Search answers from the index; the graph reads the files. */
export interface UiIndexStatus {
  /** The index was synced for the configured projections at least once. */
  synced: boolean
  /** Documents added, changed or removed since the last sync. */
  behind: number
}

/** `GET /api/graph`: every entity and relationship, read from the canonical files. */
export interface UiGraph {
  project: { name: string; root: string }
  entities: UiEntity[]
  edges: UiEdge[]
  /** Resource types and relationships the ontology registers, for labels and descriptions. */
  types: UiDefinition[]
  relationships: UiDefinition[]
  diagnostics: UiDiagnostic[]
  index: UiIndexStatus
}

export interface UiSearchHit {
  id: string
  score?: number
  detail?: string
}

export interface UiSearchSource {
  name: string
  hits: UiSearchHit[]
  note?: string
  error?: string
}

/** One step of a path, walked from `nodes[i]` to `nodes[i + 1]`. */
export interface UiPathStep {
  rel: string
  /** The link points from `nodes[i]` to `nodes[i + 1]`; false when it points back. */
  forward: boolean
}

/** A chain of relationships joining two found entities. */
export interface UiPath {
  nodes: string[]
  steps: UiPathStep[]
}

/** `GET /api/ask?q=`: the answer `docket search` gives, plus how the found entities connect. */
export interface UiAnswer {
  query: string
  sources: UiSearchSource[]
  documents: { id: string; type: string; title: string; path: string; foundBy: string[] }[]
  paths: UiPath[]
  diagnostics: UiDiagnostic[]
  index: UiIndexStatus
}
