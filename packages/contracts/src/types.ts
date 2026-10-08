/**
 * The contracts between docket and a memory adapter (docs/adapter-spec.md
 * §7-9). An adapter module's default export is an `AdapterDefinition`; docket
 * validates the envelope, lets the adapter validate its own configuration, and
 * validates everything the adapter returns at runtime as well as through these
 * types.
 *
 * Every record here is plain JSON: no Date, BigInt, function or SDK object.
 * Validators accept unknown optional fields so adapters can carry extensions,
 * but an extension never stands in for a required field.
 */

/** The one contract major this package describes. */
export const ADAPTER_API_VERSION = 1

/** What an adapter can be handed to project. */
export type InputKind = 'entity' | 'observation' | 'document'

/** What an adapter's answers can contain - one per `ResultBlock` kind. */
export type ResultKind = 'entities' | 'passages' | 'facts' | 'graph' | 'metric' | 'table' | 'timeline'

/** The independent capabilities an adapter instance can be enabled for. */
export type AdapterRole = 'projection' | 'query'

export interface AdapterDefinition<C = unknown> {
  apiVersion: 1
  name: string
  /** Returns the adapter's own config, or throws an error saying what is wrong. Must not drop unfamiliar fields silently. */
  validateConfig(input: unknown): C
  create(config: C, services: AdapterServices): Promise<MemoryAdapter>
}

export interface MemoryAdapter {
  describe(): AdapterDescription
  status(signal?: AbortSignal): Promise<AdapterStatus>
  projection?: ProjectionPort
  query?: QueryPort
  close(): Promise<void>
}

export interface AdapterDescription {
  name: string
  version: string
  inputs: InputKind[]
  resultKinds: ResultKind[]
  rebuild: 'deterministic' | 'reconstructible' | 'unsupported'
}

export interface ProjectionPort {
  apply(batch: ProjectionBatch, signal?: AbortSignal): Promise<ApplyReceipt>
  flush?(signal?: AbortSignal): Promise<void>
  /** Drops everything this adapter holds for `scope`, and nothing outside it. */
  reset(scope: string, signal?: AbortSignal): Promise<void>
}

export interface QueryPort {
  ask(request: AskRequest): Promise<AdapterAnswer>
}

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AskRequest {
  requestId: string
  question: string
  context: {
    scope: string
    /** ISO-8601 instant the question was asked at. */
    now: string
    /** IANA time zone the question's relative times are read in. */
    timezone: string
    conversation?: ConversationTurn[]
  }
  budget: {
    maxResults: number
    maxEvidenceBytes: number
    /** ISO-8601 instant after which the answer is no longer wanted. */
    deadline: string
  }
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Services docket supplies to `create`

export interface AdapterLogger {
  debug(message: string, details?: Record<string, unknown>): void
  info(message: string, details?: Record<string, unknown>): void
  warn(message: string, details?: Record<string, unknown>): void
  error(message: string, details?: Record<string, unknown>): void
}

/** Resolves named secrets. Resolved values never belong in manifests, responses, logs or explanations. */
export interface SecretResolver {
  getEnv(name: string): Promise<string | undefined>
}

/** Read-only, scoped access to the canonical records. Query adapters never mutate evidence through it. */
export interface CanonicalReader {
  get(kind: InputKind, id: string): Promise<CanonicalInput | undefined>
  list(kind: InputKind): Promise<CanonicalInput[]>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** A model docket offers an adapter. Optional: an adapter may configure its own model instead. */
export interface ModelClient {
  chat(messages: ChatMessage[], options?: { signal?: AbortSignal }): Promise<string>
}

export interface AdapterServices {
  /** Absolute path to the directory holding `.docket.yaml`. */
  projectRoot: string
  /** Absolute path this adapter instance alone may keep state in. May not exist yet. */
  stateRoot: string
  /** The Docket scope this instance projects and answers for. */
  scope: string
  logger: AdapterLogger
  canonical: CanonicalReader
  secrets: SecretResolver
  models?: Readonly<Record<string, ModelClient>>
}

/** Health of the connection - not freshness: a connected adapter can still hold a stale index. */
export interface AdapterStatus {
  state: 'connected' | 'ready' | 'degraded' | 'unavailable'
  /** Safe to show: never a secret. */
  message: string
  /** The last projection checkpoint the adapter acknowledged durably. */
  checkpoint?: string
  /** Records waiting to be projected, when the adapter knows. */
  pending?: number
  /** The native engine's version, when available. */
  engineVersion?: string
}

// ---------------------------------------------------------------------------
// Projection records (§8)

/** One observation behind a resource or relationship: where, when and by whom it was seen. */
export interface EvidenceRecord {
  /** Source kind, e.g. `code`, `manifest`, `api`. */
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
  observedAt?: string
  observedBy?: string
  session?: string
  note?: string
}

/** How far a resource or relationship can be trusted, computed from its evidence. */
export interface Assessment {
  /** 0 to 1. */
  confidence: number
  basis: 'evidence' | 'stated' | 'unevidenced'
  evidenceCount: number
  sources: string[]
}

export interface EntityRelationship extends Assessment {
  rel: string
  target: string
  attributes?: Record<string, unknown>
  evidence: EvidenceRecord[]
}

interface InputBase {
  /** Stable canonical id. With the adapter instance, scope and kind it is the identity key. */
  id: string
  /** Identifies this version of the record - a change, not a new logical record. */
  revision: string
  scope: string
}

/**
 * A resource as every canonical file that declares its id describes it,
 * merged: attributes, relationships and assessments retained. Its provenance
 * is `paths` (the files) and `evidence` (the observations).
 */
export interface EntityInput extends InputBase, Assessment {
  kind: 'entity'
  type: string
  title: string
  /** The first source file, repo-relative. */
  path: string
  /** Every source file, in path order. */
  paths: string[]
  tags: string[]
  attributes: Record<string, unknown>
  links: EntityRelationship[]
  /** The Markdown body. */
  content: string
  /** Weak `[[id]]` references in the body. */
  mentions: string[]
  evidence: EvidenceRecord[]
  /** Who wrote the files, as they state it. */
  provenance?: { authority?: string; confidence?: number; capturedBy?: string }
  /** Per-engine indexing hints. */
  index: { graph: boolean; fts: boolean; vector: boolean }
}

/** A location within a source at a stated revision. Line ranges refer to that revision. */
export interface SourceLocation {
  path: string
  startLine?: number
  endLine?: number
}

/** The relationship an observation was made of, when it was made of one rather than of a resource. */
export interface ObservedRelationship {
  source: string
  rel: string
  target: string
}

export interface ObservationInput extends InputBase {
  kind: 'observation'
  text: string
  /** The individual sources it was seen in. */
  sources: SourceLocation[]
  entityRefs: string[]
  /** When it was observed, only when the canonical record says - never a file's modification time. */
  observedAt?: string
  /** When the event happened, only when actually known - never a file's modification time. */
  eventAt?: string
  validFrom?: string
  validTo?: string
  /** Its provenance: the canonical files that record it, repo-relative. */
  recordedIn?: string[]
  /** The canonical evidence record it was read from, every field it states. */
  evidence?: EvidenceRecord
  /** Set when it observes a relationship; `entityRefs` then holds both ends. */
  relationship?: ObservedRelationship
}

export interface DocumentInput extends InputBase {
  kind: 'document'
  text: string
  /** Where the text came from, span-addressable: its lines are `startLine` to `endLine` of the source at `revision`. */
  source: SourceLocation
  entityRefs: string[]
}

export type CanonicalInput = EntityInput | ObservationInput | DocumentInput

export type RecordChange =
  | { operation: 'upsert'; record: CanonicalInput }
  | { operation: 'remove'; kind: InputKind; id: string; revision: string }

export interface ProjectionBatch {
  batchId: string
  scope: string
  /** Becomes the adapter's checkpoint once every change is acknowledged durably. */
  checkpoint: string
  changes: RecordChange[]
}

export interface ApplyReceipt {
  batchId: string
  /** Ids of changes applied durably. */
  applied: string[]
  failed: { id: string; retryable: boolean; message: string }[]
}

// ---------------------------------------------------------------------------
// Query response (§9)

export interface CanonicalReference {
  kind: InputKind
  id: string
  /** The revision the reference was read at. A `span` requires one. */
  revision?: string
  span?: SourceLocation
}

export interface Diagnostic {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
}

export interface RetrievedEvidence {
  id: string
  nativeId?: string
  kind: 'passage' | 'observation' | 'derived-fact'
  text: string
  canonicalRefs: CanonicalReference[]
  observedAt?: string
  eventAt?: string
  /** Comparable only within the adapter that produced it. */
  score?: number
  derivation?: { engine: string; model?: string }
}

interface BlockBase {
  id: string
  title?: string
  evidenceIds: string[]
}

export interface EntityBlockItem {
  ref: CanonicalReference
  /** The adapter's native score. */
  score?: number
  /** Why it matched, in the adapter's own words. */
  detail?: string
}

export interface EntitiesBlock extends BlockBase {
  kind: 'entities'
  entities: EntityBlockItem[]
}

/** The evidence it shows is `evidenceIds`. */
export interface PassagesBlock extends BlockBase {
  kind: 'passages'
}

/** The evidence it shows is `evidenceIds`. */
export interface FactsBlock extends BlockBase {
  kind: 'facts'
}

export interface GraphNode {
  id: string
  label: string
  type?: string
  ref?: CanonicalReference
}

export interface GraphEdge {
  source: string
  target: string
  rel: string
  evidenceIds?: string[]
}

export interface GraphBlock extends BlockBase {
  kind: 'graph'
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Ordered node ids, each a path the answer used. */
  paths?: string[][]
}

export interface MetricBlock extends BlockBase {
  kind: 'metric'
  label: string
  value: number
  unit?: string
}

/**
 * A cell's type. `integer` cells are safe JavaScript integers; a count outside
 * that range is a `decimal` cell, a string of digits, so no precision is lost.
 */
export type ColumnType = 'string' | 'number' | 'integer' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'reference'

export type TableCell = string | number | boolean | null | CanonicalReference

export interface TableColumn {
  key: string
  label: string
  type: ColumnType
}

export interface TableRow {
  cells: Record<string, TableCell>
  evidenceIds?: string[]
}

export interface TableBlock extends BlockBase {
  kind: 'table'
  columns: TableColumn[]
  rows: TableRow[]
}

export interface TimelineEvent {
  label: string
  at: string
  /** What `at` means: when it happened, when it was seen, or when it began or stopped holding. */
  semantics: 'event' | 'observed' | 'valid-from' | 'valid-to'
  evidenceIds?: string[]
}

export interface TimelineBlock extends BlockBase {
  kind: 'timeline'
  events: TimelineEvent[]
}

export type ResultBlock =
  | EntitiesBlock
  | PassagesBlock
  | FactsBlock
  | GraphBlock
  | MetricBlock
  | TableBlock
  | TimelineBlock

export interface AdapterAnswer {
  interpretation: {
    description: string
    assumptions: string[]
    timeRange?: { from: string; to: string }
    nativeQuery?: string
  }
  blocks: ResultBlock[]
  evidence: RetrievedEvidence[]
  coverage: {
    /** `exhaustive`: every matching record in the stated engine scope - never a top-k sample. */
    mode: 'exhaustive' | 'top-k' | 'unknown'
    truncated: boolean
    scope: string
    checkpoint?: string
  }
  diagnostics: Diagnostic[]
}
