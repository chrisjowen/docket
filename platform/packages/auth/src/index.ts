// SPDX-License-Identifier: AGPL-3.0-only
export {
  GITHUB_SCOPES,
  GitHubSignInError,
  authorizeUrl,
  exchangeCode,
  fetchIdentity,
  newAuthorization,
} from './github.js'
export type { GitHubOAuthConfig } from './github.js'
export {
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE,
  SESSION_IDLE_MS,
  createSession,
  hashSecret,
  newSecret,
  readSession,
  revokeSession,
  sessionCookieOptions,
} from './session.js'
export type { Session } from './session.js'
export { CSRF_FIELD, CSRF_HEADER, csrfToken, verifyCsrf } from './csrf.js'
export { SCOPES, SCOPE_LABELS, impliedScopes, isScope, namespaceScopes, parseScopeString, roleScopes } from './scopes.js'
export type { Scope } from './scopes.js'
export { mcpResourceUrl, parseMcpResourceUrl } from './principal.js'
export type { McpResource, Principal } from './principal.js'
export { checkScope, effectiveScopes } from './effective-permission.js'
export { actsFor, principalLabel } from './label.js'
export type { Refusal } from './effective-permission.js'
export {
  ApiTokenError,
  DEFAULT_TOKEN_DAYS,
  MAX_TOKEN_DAYS,
  TOKEN_PREFIX,
  issueApiToken,
  listApiTokens,
  newApiToken,
  parseApiToken,
  tokenHash,
} from './tokens/api-token.js'
export type { ApiTokenRecord, IssueApiTokenInput } from './tokens/api-token.js'
export { LOOKUP_TTL_MS, tokenResolver } from './tokens/lookup.js'
export type { TokenResolver } from './tokens/lookup.js'
export {
  REVOCATION_CHANNEL,
  TokenRevocationError,
  listenForRevocations,
  notifyRevoked,
  revokeApiToken,
  revokeWorkspaceCredentials,
} from './tokens/revocation.js'
export type { RevocationListener } from './tokens/revocation.js'
export {
  ACCESS_TOKEN_TTL_S,
  CLI_CLIENT_ID,
  DEVICE_CODE_GRANT,
  DEVICE_POLL_INTERVAL_S,
  OAUTH_PATHS,
  REFRESH_TOKEN_TTL_S,
  createOAuthServer,
  isProviderPath,
  oauthCookieKeys,
  providerEndpoint,
} from './oauth/provider.js'
export type { OAuthEndpoint, OAuthServer, OAuthServerOptions } from './oauth/provider.js'
export { cimdFetchAllowed, isLocalRedirect, isMetadataClientId, redirectHost } from './oauth/cimd.js'
export { ConsentError, approveConsent, denyConsent, describeConsent, interactionCookieValid } from './oauth/consent.js'
export type { ConsentRequest } from './oauth/consent.js'
export {
  authorizationServerMetadata,
  bearerChallenge,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  resourceOfMetadataPath,
} from './oauth/resource-metadata.js'
export { GrantRevocationError, listGrants, revokeGrant } from './oauth/grants.js'
export type { OAuthGrant } from './oauth/grants.js'
