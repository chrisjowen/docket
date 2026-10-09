import type {
  AdapterAnswer,
  AdapterDescription,
  AdapterRole,
  AdapterStatus,
  CanonicalReference,
  ConversationTurn,
  Diagnostic,
  InputKind
} from '@docket/contracts'

/*
 * The shared query coordinator's API (docs/adapter-spec.md §10, §14), as
 * `docket ask --json`, `POST /api/ask`, `GET /api/adapters` and
 * `POST /api/evidence` return it. Everything an adapter returns is a
 * `@docket/contracts` record; these are the envelopes the coordinator wraps
 * them in. Type-only, so the web UI shares them without compiling docket.
 */

/** `POST /api/ask` body. */
export interface AskBody {
  /** Identifies the request for cancellation and diagnostics. One is made when omitted. */
  requestId?: string
  question: string
  /** Adapter instance ids to ask; omitted, the configured `query.defaultAdapters`. */
  adapters?: string[]
  conversation?: ConversationTurn[]
  /** Whether to synthesise a summary; omitted, the configured `query.synthesis`. */
  synthesis?: boolean
  /** IANA time zone relative times in the question are read in; omitted, the server's. */
  timezone?: string
}

/**
 * Whether a canonical reference names a record the canonical files hold in
 * the question's scope, as they stood when it was asked: at the revision it
 * names (`resolved`), at another one (`stale` - the adapter answered from an
 * index behind the files), or not at all (`unresolved`).
 */
export type ReferenceStatus = 'resolved' | 'stale' | 'unresolved'

/** How far an adapter's index lags the canonical files. The coordinator works it out; adapters only report checkpoints. */
export interface AdapterFreshness {
  state: 'current' | 'behind' | 'unknown'
  /** Canonical changes not yet projected, when known. */
  behind?: number
  /** The checkpoint the canonical files are at, for the input kinds it takes. */
  canonicalCheckpoint?: string
  /** The checkpoint the instance holds, as sync recorded it or it reported it. */
  checkpoint?: string
}

/** One adapter instance's part of an answer: what it said, or why it said nothing. */
export type AdapterResult =
  | {
      adapter: string
      state: 'answered'
      /** Validated, scope-checked and with block and evidence ids namespaced by the instance. */
      answer: AdapterAnswer
      durationMs?: number
      /** For each evidence id, the status of each of its canonical references, in order. */
      references?: Record<string, ReferenceStatus[]>
      freshness?: AdapterFreshness
    }
  | {
      adapter: string
      state: 'failed'
      error: {
        /** `timeout`, `cancelled`, `unavailable`, `unsupported`, `invalid-answer` or `error`. */
        code: string
        /** Safe to show: never a secret. */
        message: string
        retryable?: boolean
      }
      /** How the answer broke the contract, when that is why it failed. */
      issues?: string[]
      durationMs?: number
    }

/** Why a summary is missing, when synthesis was asked for. */
export interface SynthesisNotice {
  /** `unconfigured`: no model. `empty`: nothing found to summarise. `failed`: the model failed. `disabled`: not asked. */
  reason: 'unconfigured' | 'empty' | 'failed' | 'disabled'
  message: string
}

/** A model's answer written from selected blocks and evidence. Optional: results stand without it. */
export interface Synthesis {
  /** Prose citing exhibits as `[entity.id]` and evidence as `[adapter:evidence-id]`. */
  text: string
  /** Evidence ids the text cites, as namespaced in this response. */
  citedEvidence: string[]
  /** Canonical entity ids the text cites. */
  citedEntities: string[]
  model: string
  cached?: boolean
  createdAt?: string
}

/** One canonical record the adapters' answers point at, once however many point at it. */
export interface FoundReference {
  kind: InputKind
  id: string
  status: ReferenceStatus
  /** The revision the files hold it at, when they hold it. */
  revision?: string
  /** The entity it belongs to: itself, or the one its observation or document derives from. */
  entity?: string
  /** Each adapter that pointed at it, with where. */
  foundBy: { adapter: string; blockIds: string[]; evidenceIds: string[] }[]
}

/** A chain of canonical relationships joining two entities the adapters found. */
export interface Connection {
  nodes: string[]
  steps: { rel: string; forward: boolean }[]
}

/**
 * `POST /api/ask` response and `docket ask --json`. Block and evidence ids
 * are namespaced by adapter instance, so they are unique across the whole
 * response.
 */
export interface CoordinatedAnswer {
  requestId: string
  question: string
  /** How the question was read: its scope, when it was asked, and the time zone relative times are read in. */
  context?: { scope: string; now: string; timezone: string; deadline: string }
  /** One per adapter asked, in the order they were asked. */
  results: AdapterResult[]
  synthesis: Synthesis | null
  notice?: SynthesisNotice
  /** Every canonical record the answers point at, deduplicated, in the order first found. */
  references?: FoundReference[]
  /**
   * Canonical relationship paths joining what the adapters found, read from
   * the files by docket rather than any adapter.
   */
  connections?: Connection[]
  diagnostics: Diagnostic[]
}

/** One configured adapter instance - never its configuration, which can hold secrets. */
export interface AdapterInstance {
  id: string
  /** The module reference it was loaded from: a package name or a project-relative path. */
  module: string
  roles: AdapterRole[]
  description?: AdapterDescription
  status?: AdapterStatus
  /** Why status could not be read. */
  statusError?: string
  freshness?: AdapterFreshness
  /** The runtime group it references, when it has one. */
  runtime?: string
}

/** `GET /api/adapters` and `docket adapters status --json`. */
export interface AdaptersResponse {
  adapters: AdapterInstance[]
  query: { defaultAdapters: string[]; synthesis: boolean }
  diagnostics: Diagnostic[]
}

/** `POST /api/evidence` body: the canonical references one piece of evidence gives. */
export interface EvidenceBody {
  references: CanonicalReference[]
}

/** One canonical reference checked against the files, with what they hold there. */
export interface ResolvedReference {
  reference: CanonicalReference
  status: ReferenceStatus
  /** The record the files hold, when they hold one. */
  record?: {
    kind: InputKind
    id: string
    revision: string
    /** The entity it belongs to. */
    entity: string
    title?: string
    type?: string
    /** The canonical files it is read from, repo-relative. */
    paths: string[]
  }
  /** The text at the reference - the span it names, or the record's own text - cut to a bounded size. */
  excerpt?: {
    path?: string
    startLine?: number
    endLine?: number
    text: string
    truncated: boolean
  }
}

/** `POST /api/evidence` response. */
export interface EvidenceResponse {
  references: ResolvedReference[]
}
