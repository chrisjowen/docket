import { z } from 'zod'

/** Explicit, asserted graph relationship declared in frontmatter. */
export interface MemoryLink {
  rel: string
  target: string
  attributes?: Record<string, unknown>
}

/** Where a memory came from and how much to trust it. */
export interface MemoryProvenance {
  authority?: string
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
 * The single normalized representation every canonical file is parsed into.
 * Projections consume only this - they never parse Markdown or YAML.
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

  /** Weak `[[id]]` references found in the body. Never semantic relationships. */
  mentions: string[]

  provenance?: MemoryProvenance

  index: MemoryIndexFlags
}

export const DEFAULT_INDEX_FLAGS: MemoryIndexFlags = {
  graph: true,
  fts: true,
  vector: true
}

// --- Structural (ontology-independent) validation -------------------------

export const memoryLinkSchema = z.object({
  rel: z.string().min(1),
  target: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).optional()
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
  provenance: memoryProvenanceSchema.optional(),
  index: memoryIndexFlagsSchema.default(DEFAULT_INDEX_FLAGS)
})

export type Frontmatter = z.infer<typeof frontmatterSchema>
