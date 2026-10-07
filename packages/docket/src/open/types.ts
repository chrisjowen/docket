/**
 * What `docket open` serves to its web UI, as JSON. Self-contained - no
 * imports - so the UI package can share these types without compiling the
 * rest of docket.
 *
 * Provenance travels as an open record and the parsed frontmatter as a whole,
 * so fields added to the file format show up in the UI without a change here.
 */

/** How far a resource or relationship can be trusted, as docket computed it from the evidence. */
export interface UiAssessment {
  /** 0 to 1. */
  confidence: number
  /** `evidence`: computed from observations. `stated`: the file's own figure. `unevidenced`: the ontology's default. */
  basis: 'evidence' | 'stated' | 'unevidenced'
  /** Distinct observations behind it. */
  evidenceCount: number
  /** Independent source kinds that corroborate it. */
  sources: string[]
}

/** One observation: where it was seen - file, lines, endpoint, URLs - when, and by whom. */
export type UiEvidence = Record<string, unknown>

export interface UiLink {
  rel: string
  target: string
  attributes?: Record<string, unknown>
  evidence?: UiEvidence[]
  assessment?: UiAssessment
}

export interface UiEntity {
  id: string
  type: string
  title: string
  /** Repo-relative path of the canonical file - the first, when several declare the id. */
  path: string
  /** Every file that declares this id, merged into this entity. */
  paths: string[]
  tags: string[]
  attributes: Record<string, unknown>
  links: UiLink[]
  /** Weak `[[id]]` references found in the body. */
  mentions: string[]
  /** Markdown body, frontmatter stripped. */
  content: string
  /** Who wrote it, when the file says. */
  provenance?: Record<string, unknown>
  /** Every observation of it, from all its files. */
  evidence: UiEvidence[]
  /** Its confidence, computed from the evidence. Absent when no ontology could be loaded. */
  assessment?: UiAssessment
  /** The first file's frontmatter exactly as parsed, including fields docket does not model. */
  frontmatter: Record<string, unknown>
}

export interface UiEdge {
  source: string
  rel: string
  target: string
  attributes?: Record<string, unknown>
  evidence?: UiEvidence[]
  assessment?: UiAssessment
  /** No file defines the target yet. */
  dangling: boolean
}

export interface UiDefinition {
  name: string
  description?: string
}

export interface UiTypeDefinition extends UiDefinition {
  /** The Lucide icon to draw it with: its own, else docket's built-in one for the name, else a generic one. */
  icon: string
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
  /** Entities added, changed or removed since the last sync. */
  behind: number
}

/** `GET /api/graph`: every entity and relationship, read from the canonical files. */
export interface UiGraph {
  project: { name: string; root: string }
  entities: UiEntity[]
  edges: UiEdge[]
  /** Resource types and relationships the ontology registers, for labels and descriptions. */
  types: UiTypeDefinition[]
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

/** A model's account of what an answer found, citing the exhibits it rests on. */
export interface UiSummary {
  /** Prose, citing exhibits by id in square brackets: `[service.orders]`. */
  text: string
  /** Exhibits the text cites, in the order it first cites them. Only ids that were found. */
  cited: string[]
  /** The model that wrote it. */
  model: string
  /** Served from `.docket/.cache/` because neither the question nor its exhibits changed. */
  cached: boolean
  /** When the model wrote it. */
  createdAt: string
}

/** `GET /api/chat?q=`: an answer, summarized when a model is configured. */
export interface UiChatAnswer {
  query: string
  /** What `docket search` found - what the summary was built from. */
  answer: UiAnswer
  summary: UiSummary | null
  /** Why there is no summary. */
  notice?: {
    /** `unconfigured`: no model to summarize with. `empty`: nothing found to summarize. `failed`: the model failed. */
    reason: 'unconfigured' | 'empty' | 'failed'
    message: string
  }
}
