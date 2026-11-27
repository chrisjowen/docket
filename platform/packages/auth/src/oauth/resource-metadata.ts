// SPDX-License-Identifier: AGPL-3.0-only
import { SCOPES } from '../scopes.js'
import { DEVICE_CODE_GRANT, OAUTH_PATHS } from './provider.js'

/**
 * The discovery documents MCP clients read before they sign in (§8.2
 * steps 1-3): the Protected Resource Metadata of each workspace's MCP
 * endpoint (RFC 9728), the authorization server's metadata (RFC 8414), and
 * the `WWW-Authenticate` challenge that points a client at the first.
 */

const PRM_PREFIX = '/.well-known/oauth-protected-resource'

/** The PRM document's URL for an MCP URL: the well-known prefix inserted before its path (RFC 9728 §3.1). */
export function protectedResourceMetadataUrl(resourceUrl: string): string {
  const url = new URL(resourceUrl)
  return new URL(`${PRM_PREFIX}${url.pathname}`, url.origin).toString()
}

/** The MCP URL a PRM request is for, or null when the path names no `/mcp/{org}/{workspace}`. */
export function resourceOfMetadataPath(origin: string, pathname: string): string | null {
  if (!pathname.startsWith(`${PRM_PREFIX}/`)) return null
  const path = pathname.slice(PRM_PREFIX.length)
  return /^\/mcp\/[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/.test(path) ? new URL(path, origin).toString() : null
}

export function protectedResourceMetadata(origin: string, resourceUrl: string) {
  return {
    resource: resourceUrl,
    authorization_servers: [new URL(origin).origin],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Docket Cloud workspace',
    resource_documentation: new URL('/', origin).toString(),
  }
}

/** The authorization server's metadata. It matches what `createOAuthServer` serves (a test checks every endpoint). */
export function authorizationServerMetadata(origin: string) {
  const at = (path: string) => new URL(path, origin).toString()
  return {
    issuer: new URL(origin).origin,
    authorization_endpoint: at(OAUTH_PATHS.authorization),
    token_endpoint: at(OAUTH_PATHS.token),
    registration_endpoint: at(OAUTH_PATHS.registration),
    revocation_endpoint: at(OAUTH_PATHS.revocation),
    jwks_uri: at(OAUTH_PATHS.jwks),
    // RFC 8628: `docket cloud login`.
    device_authorization_endpoint: at(OAUTH_PATHS.device_authorization),
    scopes_supported: [...SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token', DEVICE_CODE_GRANT],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    // RFC 8707: a token is for the one resource named.
    resource_indicators_supported: true,
  }
}

/** RFC 6750 §3 / RFC 9728 §5.1: the challenge on a 401 or 403 from an MCP endpoint. */
export function bearerChallenge(
  resourceUrl: string,
  refusal?: { error: 'invalid_token' | 'insufficient_scope' | 'invalid_request'; description?: string; scope?: string },
): string {
  const quote = (value: string) => `"${value.replace(/["\\]/g, '')}"`
  const parts = [`resource_metadata=${quote(protectedResourceMetadataUrl(resourceUrl))}`]
  if (refusal) {
    parts.push(`error=${quote(refusal.error)}`)
    if (refusal.description) parts.push(`error_description=${quote(refusal.description)}`)
  }
  parts.push(`scope=${quote(refusal?.scope ?? 'docket:read')}`)
  return `Bearer ${parts.join(', ')}`
}
