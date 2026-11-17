/*
 * The ports a Docket server plugs its deployment into. The core reads and
 * writes canonical data, checks permissions and serves MCP through these
 * alone; a deployment supplies them. Docket Cloud backs them with its
 * tenancy (one Postgres schema and data key per organisation, its own sign-in
 * and audit chain); a self-hosted, single-tenant server backs them with one
 * store and a static list of tokens. Nothing here names an organisation: a
 * deployment that has them keeps them behind its ports.
 */

import type { Role } from './auth/roles.js'
import type { Scope } from './auth/scopes.js'

/**
 * One SQL transaction, the slice of a Postgres client the core uses. A `pg`
 * client (`pg.ClientBase`) is one; the core never imports a driver outside
 * its Postgres store.
 */
export interface Tx {
  query<R extends Record<string, any> = any>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>
}

/** The revision of a document a sealed body belongs to. */
export interface DocumentRef {
  workspaceId: string
  documentId: string
  revision: number
}

/** A document body as stored: its ciphertext, or its plaintext under a codec that does not encrypt. */
export interface SealedBody {
  ciphertext: Uint8Array
  nonce: Uint8Array
}

/**
 * How document bodies are stored at rest. Docket Cloud seals each one with
 * the organisation's data key; a self-hosted server stores plaintext or seals
 * with one local key. `aad` binds a sealed body to the revision it belongs
 * to, in whatever form a deployment's existing ciphertext was sealed with, so
 * adopting the core never re-encrypts anything.
 */
export interface DocumentCodec {
  seal(plain: Uint8Array, aad: string): Promise<SealedBody>
  open(sealed: SealedBody, aad: string): Promise<Uint8Array>
  aad(ref: DocumentRef): string
}

/** A transaction in one store, with the codec its documents are sealed with. */
export interface StoreContext {
  tx: Tx
  codec: DocumentCodec
}

/** Runs `fn` in one transaction in one store, committing when it resolves and rolling back when it throws. */
export interface StoreRunner {
  run<T>(fn: (ctx: StoreContext) => Promise<T>): Promise<T>
}

/** One store a server's background loops visit: Docket Cloud has one per organisation, a self-hosted server one. */
export interface StoreScope {
  /** Names the store in logs and status. */
  id: string
  store: StoreRunner
}

/** The stores the background loops (reconcile, outbox) visit on each pass. */
export interface ScopeSource {
  scopes(): Promise<readonly StoreScope[]>
}

/**
 * Who is calling: the subject a credential belongs to, the one workspace it
 * is bound to, and the scopes it was granted. The scopes are an upper bound:
 * `effectiveScopes` cuts them to the subject's role at the moment of each
 * call.
 */
export interface Principal {
  /** The user or service account the credential belongs to. */
  subject: string
  workspaceId: string
  scopes: Scope[]
  /** How the caller reads in the audit log, for example `token:<name>`. */
  actor: string
  /** When the credential itself expires; absent when it does not. */
  expiresAt?: Date
}

/** The MCP resource a request is for: its canonical URL (the OAuth audience, RFC 8707) and the workspace it names. */
export interface McpResource {
  url: string
  workspaceId: string
}

/** Resolves a bearer credential for a resource to its principal, or null when it does not grant access to it. */
export interface Authenticator<P extends Principal = Principal, R extends McpResource = McpResource> {
  resolve(bearer: string, resource: R): Promise<P | null>
}

/**
 * What a principal may do now: read on every call, so a role change narrows
 * every credential a member holds from their very next call.
 */
export interface Authorizer<P extends Principal = Principal> {
  /** The principal's role now; null when they no longer have one (they left). */
  role(principal: P): Promise<Role | null>
  /**
   * The roles the workspace's setting lets publish the ontology over MCP
   * (`ontology:write`). Without it, `ontology:write` is never effective.
   */
  ontologyWriters?(workspaceId: string): Promise<readonly Role[]>
}

/** How a call reads in the audit log. */
export type AuditOutcome = 'ok' | 'denied' | 'error' | 'invalid'

/** One audit event: one per request that authenticates. */
export interface AuditEventInput {
  workspaceId?: string | null
  actor: string
  ip?: string | null
  userAgent?: string | null
  /** For example `mcp.tools/call docket_remember`. */
  action: string
  /** The resource ids the call touched. */
  target?: readonly string[]
  /** The call's arguments; a sink that keeps them may digest them, as they hold customer content. */
  args?: unknown
  outcome: AuditOutcome
  latencyMs: number
  requestId: string
}

/**
 * Where audit events go. A write records its event inside the write's own
 * transaction (`ctx`), so the change and its event commit together; `null`
 * for events outside any store transaction, such as a failed sign-in.
 */
export interface AuditSink {
  record(ctx: StoreContext | null, event: AuditEventInput): Promise<void>
}

/** One JSON-RPC message an MCP client sent. */
export interface McpMessage {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}

/** Rate limits, where a deployment has them: the response to send instead of handling the message, or null to go ahead. */
export interface Limiter<P extends Principal = Principal> {
  check(principal: P, message: McpMessage): Promise<Response | null>
}

/** Runs before every model call a tool makes, and throws when the caller may not make one now (a spent AI budget). */
export interface ModelGate<P extends Principal = Principal> {
  beforeModelCall(principal: P): Promise<void>
}

/**
 * Where search and ask are answered: in-process over a store's projections,
 * or a deployment's own query service. Its request and answer shapes are the
 * search pipeline's, which a deployment names until that pipeline is part of
 * the core.
 */
export interface QueryBackend<SearchQuery = unknown, SearchResult = unknown, AskQuery = unknown, AskResult = unknown> {
  search(query: SearchQuery): Promise<SearchResult>
  ask(query: AskQuery): Promise<AskResult>
}
