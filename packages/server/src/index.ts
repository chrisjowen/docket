export { checkScope, effectiveScopes, type Refusal } from './auth/effective.js'
export { ROLES, isRole, type Role } from './auth/roles.js'
export { SCOPES, SCOPE_LABELS, impliedScopes, isScope, parseScopeString, roleScopes, type Scope } from './auth/scopes.js'
export type {
  AuditEventInput,
  AuditOutcome,
  AuditSink,
  Authenticator,
  Authorizer,
  DocumentCodec,
  DocumentRef,
  Limiter,
  McpMessage,
  McpResource,
  ModelGate,
  Principal,
  QueryBackend,
  ScopeSource,
  SealedBody,
  StoreContext,
  StoreRunner,
  StoreScope,
  Tx
} from './ports.js'
