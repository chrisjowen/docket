/*
 * Structured writes: `docket_remember` and the other write tools, and a web
 * app's capture forms, all write through the same path. A write is rendered
 * as a docket Markdown document, validated against the published ontology
 * head inside the transaction it commits in, and stored with its evidence
 * stamped with who wrote it. The validator is docket's own; on top of it,
 * every write carries evidence. These are its inputs and its answer.
 */

import type { Diagnostic } from '../docket.js'

/** One piece of evidence as a client gives it. `session` is the server's to set. */
export interface EvidenceInput {
  source: string
  repository?: string
  path?: string
  lines?: string
  symbol?: string
  key?: string
  method?: string
  endpoint?: string
  urls?: string[]
  commit?: string
  /** `YYYY-MM-DD` or an ISO timestamp; now when not given. */
  observedAt?: string
  /** Kept as `reportedBy`: the authenticated writer is the observer. */
  observedBy?: string
  note?: string
}

/** Evidence as stored: stamped with the writer, the request and the time. */
export interface StampedEvidence extends Omit<EvidenceInput, 'observedBy'> {
  observedAt: string
  observedBy: string
  session: string
  reportedBy?: string
}

export interface LinkInput {
  rel: string
  target: string
  attributes?: Record<string, unknown>
  evidence: EvidenceInput[]
}

/** `docket_remember`'s input: one resource with its links. */
export interface RememberInput {
  id: string
  type: string
  title: string
  attributes?: Record<string, unknown>
  body?: string
  links?: LinkInput[]
  evidence: EvidenceInput[]
}

export interface AddEvidenceInput {
  id: string
  /** Add to this link of the resource rather than to the resource itself. */
  link?: { rel: string; target: string }
  evidence: EvidenceInput[]
}

export interface AppendNotesInput {
  id: string
  additionalNotes: string
  evidence: EvidenceInput[]
}

/** How a change reached the workspace, as its activity log records it. */
export type Channel = 'repo' | 'mcp' | 'ui' | 'cli' | 'ontology' | 'enrichment'

/**
 * Who writes, as the write records it: the audit actor, the label evidence
 * names them by (`claude-code via alice (oauth)`, `ci-bot (token tok_8f…)`),
 * the channel, and the request id that becomes each entry's `session` and
 * links the activity record to the audit event. An MCP `Principal` becomes
 * one of these; so does a signed-in member using a web app.
 */
export interface Writer {
  /** The workspace the credential or page is bound to: writes go nowhere else. */
  workspaceId: string
  actor: string
  label: string
  channel: Exclude<Channel, 'repo' | 'ontology'>
  requestId: string
}

export interface WriteOptions {
  /** Validate and report, write nothing. */
  dryRun?: boolean
  /** The clock, for tests. */
  now?: () => Date
}

export interface WriteResult {
  /** The cloud document written; absent when the write was refused, a dry run, or changed nothing. */
  documentId?: string
  path?: string
  revision?: number
  /** True when the resource had no document before this write. */
  created: boolean
  /** False for a dry run, a refusal, or a write that added nothing new (writes are idempotent). */
  changed: boolean
  /** Errors refuse the write; warnings come back with it. */
  diagnostics: Diagnostic[]
  /** The evidence entries this write added. */
  evidenceAdded: number
  ingestId?: string
}

/** Server-side write limits. */
export const WRITE_LIMITS = {
  evidencePerCall: 50,
  linksPerResource: 100,
  reasonLength: 500
} as const
