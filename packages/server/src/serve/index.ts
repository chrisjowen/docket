/**
 * `docket serve`: a self-hosted, single-tenant Docket server that several
 * people and agents connect to over MCP, from wherever they work, writing to
 * one ontology and one set of documents. Docket's whole MCP surface at
 * `/mcp/<workspace>`, static bearer tokens with a role and scopes each, the
 * documents API `docket cloud link|push|pull` use, and docket open's page
 * behind a sign-in. A project's own files are the default store, needing no
 * database; Postgres is an opt-in. `@chrisjowen/docket`'s CLI runs it.
 */
export {
  CONFIG_FILE,
  DEFAULT_HOST,
  DEFAULT_PORT,
  PROJECTION_PRESETS,
  ServeConfigError,
  loadServeConfig,
  slugOf,
  type LoadServeConfigOptions,
  type ProjectionConfig,
  type ServeConfig,
  type TokenRecord,
  type WorkspaceConfig
} from './config.js'
export { TOKEN_PREFIX, createToken, listTokens, newToken, readTokensFile, revokeToken, tokenAuth, type CreateTokenInput, type ServeResource, type TokenPrincipal } from './tokens.js'
export { fileAuditLog, type AuditLine, type ServeBackend, type ServedWorkspace } from './backend.js'
export { filesBackend } from './files.js'
export { ASK_OFF, postgresBackend } from './postgres.js'
export { SERVICE, SESSION_COOKIE, serveHandler, type ServeHandlerOptions } from './http.js'
export { startServe, type RunningServe, type StartServeOptions } from './server.js'
