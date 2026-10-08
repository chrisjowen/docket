import type {
  AdapterAnswer,
  AdapterDescription,
  AdapterRole,
  AdapterStatus,
  ConversationTurn,
  Diagnostic
} from '@docket/contracts'

/*
 * The coordinator's API (docs/adapter-spec.md §10, §14) as this UI reads it:
 * `POST /api/ask` and `GET /api/adapters`. Everything an adapter returns is a
 * `@docket/contracts` record; these envelopes are what the coordinator wraps
 * them in. The server does not serve them yet - until it does, the client
 * answers through the legacy `GET /api/ask` and `GET /api/chat`, translated
 * into this shape (see `legacy.ts`).
 */

/** `POST /api/ask` body. */
export interface AskBody {
  /** Identifies the request for cancellation and diagnostics. */
  requestId: string
  question: string
  /** Adapter instance ids to ask; omitted, the configured `query.defaultAdapters`. */
  adapters?: string[]
  conversation?: ConversationTurn[]
  /** Whether to synthesise a summary; omitted, the configured `query.synthesis`. */
  synthesis?: boolean
}

/** One adapter instance's part of an answer: what it said, or why it said nothing. */
export type AdapterResult =
  | { adapter: string; state: 'answered'; answer: AdapterAnswer; durationMs?: number }
  | {
      adapter: string
      state: 'failed'
      error: {
        /** e.g. `timeout`, `unavailable`, `invalid-answer`. */
        code: string
        /** Safe to show: never a secret. */
        message: string
        retryable?: boolean
      }
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
  /** Prose citing exhibits as `[entity.id]`. */
  text: string
  /** Evidence ids the text rests on, as namespaced in this response. */
  citedEvidence: string[]
  /** Canonical entity ids the text cites. */
  citedEntities: string[]
  model: string
  cached?: boolean
  createdAt?: string
}

/**
 * `POST /api/ask` response. Block and evidence ids are namespaced by adapter
 * instance, so they are unique across the whole response.
 */
export interface CoordinatedAnswer {
  requestId: string
  question: string
  /** One per adapter asked, in the order they were asked. */
  results: AdapterResult[]
  synthesis: Synthesis | null
  notice?: SynthesisNotice
  /**
   * Canonical relationship paths joining what the adapters found, read from
   * the files by docket rather than any adapter.
   */
  connections?: { nodes: string[]; steps: { rel: string; forward: boolean }[] }[]
  diagnostics: Diagnostic[]
}

/** How far an adapter's index lags the canonical files. The coordinator works it out; adapters only report checkpoints. */
export interface AdapterFreshness {
  state: 'current' | 'behind' | 'unknown'
  /** Canonical changes not yet projected, when known. */
  behind?: number
  /** The checkpoint the canonical files are at. */
  canonicalCheckpoint?: string
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

/** `GET /api/adapters`. */
export interface AdaptersResponse {
  adapters: AdapterInstance[]
  query: { defaultAdapters: string[]; synthesis: boolean }
  diagnostics: Diagnostic[]
}
