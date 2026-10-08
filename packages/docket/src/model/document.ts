import { z } from 'zod'

/**
 * Where a piece of evidence points. A source kind's ontology entry says which
 * of these it needs (`requires` / `requiresAny`), so `code` evidence names a
 * file while `api` evidence names an endpoint.
 */
export const EVIDENCE_LOCATION_FIELDS = [
  'repository',
  'path',
  'lines',
  'symbol',
  'key',
  'method',
  'endpoint',
  'urls',
  'commit'
] as const

export type EvidenceLocationField = (typeof EVIDENCE_LOCATION_FIELDS)[number]

/**
 * One observation of a resource or relationship: where it was seen, when and
 * by whom. Evidence is append-only - a new sighting adds an entry, it never
 * rewrites an earlier one - and confidence is computed from it, never stated.
 */
export interface MemoryEvidence {
  /** Source kind, registered under `evidence.sources` in the ontology - e.g. `code`, `manifest`, `api`. */
  source: string
  /** The repository the location is in, when it is not this one - a name or URL. */
  repository?: string
  /** Repo-relative file path. */
  path?: string
  /** Line or line range within `path`: `12` or `12-40`. */
  lines?: string
  /** Function, class, resource or manifest entry at the location. */
  symbol?: string
  /** Config or manifest key, e.g. `services.orders.replicas`. */
  key?: string
  /** HTTP or RPC method, e.g. `GET`. */
  method?: string
  /** API route or endpoint, e.g. `/v1/orders/{id}` or a full URL. */
  endpoint?: string
  /** Links that point at what was seen - a permalink, API docs, a dashboard. */
  urls?: string[]
  /** Revision the location was read at. */
  commit?: string
  /** `YYYY-MM-DD`, or a full ISO timestamp. */
  observedAt?: string
  /** Who observed it - `claude`, a person's name. */
  observedBy?: string
  /** The session the observation was made in. */
  session?: string
  /** What was seen there, in a sentence. */
  note?: string
}

/** Explicit, asserted graph relationship declared in frontmatter. */
export interface MemoryLink {
  rel: string
  target: string
  attributes?: Record<string, unknown>
  /** Observations of this relationship. Without any, it takes the file's stated confidence or the default. */
  evidence?: MemoryEvidence[]
}

/** Who wrote a memory. Superseded by `evidence` for judging how much to trust it. */
export interface MemoryProvenance {
  /** Legacy free-text classification of the source. Kept for older files; not used to judge confidence. */
  authority?: string
  /** A stated confidence, standing in for evidence where the resource or a link records none. */
  confidence?: number
  capturedBy?: string
}

/** Per-projection indexing hints. Defaults to all true when omitted. */
export interface MemoryIndexFlags {
  graph: boolean
  fts: boolean
  vector: boolean
}

/**
 * The normalized representation every canonical file is parsed into. One per
 * file: several files may describe the same id, and aggregation merges them
 * into the `MemoryEntity` projections receive.
 */
export interface MemoryDocument {
  id: string
  type: string
  title: string

  /** Repo-relative path of the source file. Identity does NOT depend on it. */
  path: string
  /** `sha256:<hex>` over the raw file contents. */
  hash: string

  tags: string[]

  attributes: Record<string, unknown>

  links: MemoryLink[]

  /** Markdown body, frontmatter stripped. */
  content: string

  /** The 1-based line of the source file `content` starts on, so a span of the body is a span of the file. */
  bodyLine: number

  /** Weak `[[id]]` references found in the body. Never semantic relationships. */
  mentions: string[]

  /** Observations of the resource itself. */
  evidence: MemoryEvidence[]

  provenance?: MemoryProvenance

  index: MemoryIndexFlags
}

/**
 * How far a resource or relationship can be trusted, computed from its
 * evidence and the ontology's confidence rules.
 */
export interface Assessment {
  /** 0 to 1. */
  confidence: number
  /**
   * `evidence`: computed from recorded evidence. `stated`: no evidence, so the
   * file's `provenance.confidence` is used. `unevidenced`: neither, so the
   * ontology's `evidence.unevidenced` default is used.
   */
  basis: 'evidence' | 'stated' | 'unevidenced'
  /** Distinct observations behind it. */
  evidenceCount: number
  /** Independent source kinds that corroborate it, sorted. */
  sources: string[]
}

/** One relationship per (source, rel, target), however many times it was declared. */
export interface EntityLink extends MemoryLink, Assessment {
  evidence: MemoryEvidence[]
}

/**
 * What projections receive: every file that declares an id, merged into one
 * resource with its links deduplicated and its confidence computed.
 */
export interface MemoryEntity extends Omit<MemoryDocument, 'links' | 'bodyLine'>, Assessment {
  /** Every file that declares this id, in path order. `path` is the first. */
  paths: string[]
  /** `sha256:<hex>` over the merged entity, so it changes whenever what is projected does. */
  hash: string
  links: EntityLink[]
}

export const DEFAULT_INDEX_FLAGS: MemoryIndexFlags = {
  graph: true,
  fts: true,
  vector: true
}

// --- Structural (ontology-independent) validation -------------------------

const LINE_RANGE = /^(\d+)(?:-(\d+))?$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

/** `12` and `12-40`; a range must not run backwards. */
const linesSchema = z
  .union([z.number().int().positive(), z.string()])
  .transform(String)
  .refine((value) => {
    const match = LINE_RANGE.exec(value)
    if (!match) return false
    const start = Number(match[1])
    return start > 0 && (match[2] === undefined || Number(match[2]) >= start)
  }, 'lines must be a line number or a range like 12-40')

/**
 * Frontmatter is YAML 1.2, so an unquoted `2026-10-05` arrives as the string it
 * was written as. A `Date` - from a caller that parsed YAML 1.1 - is written
 * back as the date alone when it has no time of day.
 */
const observedAtSchema = z
  .union([z.string(), z.date()])
  .transform((value) => {
    if (typeof value === 'string') return value
    const iso = value.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso
  })
  .refine((value) => ISO_DATE.test(value), 'observedAt must be a date (YYYY-MM-DD) or ISO timestamp')

/** A single URL is accepted for convenience and read as a list of one. */
const urlsSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .pipe(z.array(z.string().url()))

const text = z.string().min(1)

/**
 * Unknown keys are kept here so the parser can name them in a warning; they
 * never reach the normalized model.
 */
export const memoryEvidenceSchema = z
  .object({
    source: text,
    repository: text.optional(),
    path: text.optional(),
    lines: linesSchema.optional(),
    symbol: text.optional(),
    key: text.optional(),
    method: text.optional(),
    endpoint: text.optional(),
    urls: urlsSchema.optional(),
    commit: text.optional(),
    observedAt: observedAtSchema.optional(),
    observedBy: text.optional(),
    session: text.optional(),
    note: text.optional()
  })
  .catchall(z.unknown())

export const MEMORY_EVIDENCE_FIELDS: readonly string[] = Object.keys(memoryEvidenceSchema.shape)

export const memoryLinkSchema = z.object({
  rel: z.string().min(1),
  target: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).optional(),
  evidence: z.array(memoryEvidenceSchema).optional()
})

export const memoryProvenanceSchema = z.object({
  authority: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  capturedBy: z.string().optional()
})

export const memoryIndexFlagsSchema = z.object({
  graph: z.boolean().default(true),
  fts: z.boolean().default(true),
  vector: z.boolean().default(true)
})

/** Shape of the YAML frontmatter block. `id`, `type`, `title` are required. */
export const frontmatterSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  tags: z.array(z.string()).default([]),
  attributes: z.record(z.string(), z.unknown()).default({}),
  links: z.array(memoryLinkSchema).default([]),
  evidence: z.array(memoryEvidenceSchema).default([]),
  provenance: memoryProvenanceSchema.optional(),
  index: memoryIndexFlagsSchema.default(DEFAULT_INDEX_FLAGS)
})

export type Frontmatter = z.infer<typeof frontmatterSchema>
