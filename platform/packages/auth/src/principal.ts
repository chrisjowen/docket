// SPDX-License-Identifier: AGPL-3.0-only
import type { Scope } from './scopes.js'

/**
 * Who is calling an MCP endpoint (§8.2-8.4): a user or service account, the
 * one workspace their credential is bound to, and the scopes it was granted.
 * The scopes are an upper bound: `effectiveScopes` cuts them to the owner's
 * permission on that workspace at the moment of each call.
 */
export interface Principal {
  userId: string
  orgId: string
  workspaceId: string
  scopes: Scope[]
  via: 'oauth' | 'token'
  /** The OAuth client, for `via: 'oauth'`. */
  clientId?: string
  /** The API token's id (`tok_...`), or the OAuth grant the access token belongs to. */
  tokenId: string
  /** How the caller reads in the audit log (§10): `token:<prefix>` or `oauth:<clientId>/user:<id>`. */
  actor: `token:${string}` | `oauth:${string}/user:${string}`
  /** When the credential itself expires: the API token, or the 15-minute access token. */
  expiresAt: Date
}

/** The MCP resource a request is for: its canonical URL, and the org and workspace it names. */
export interface McpResource {
  /** `https://docket.example.com/mcp/{org}/{workspace}`: the OAuth audience (RFC 8707). */
  url: string
  orgId: string
  workspaceId: string
}

/** The canonical MCP URL of a workspace, which OAuth access tokens are bound to. */
export function mcpResourceUrl(origin: string, orgSlug: string, workspaceSlug: string): string {
  return new URL(`/mcp/${encodeURIComponent(orgSlug)}/${encodeURIComponent(workspaceSlug)}`, origin).toString()
}

/** The org and workspace slugs of a canonical MCP URL on this origin, or null when it is not one. */
export function parseMcpResourceUrl(origin: string, value: string): { orgSlug: string; workspaceSlug: string } | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.origin !== new URL(origin).origin || url.search || url.hash) return null
  const match = /^\/mcp\/([a-z0-9-]{1,40})\/([a-z0-9-]{1,40})$/.exec(url.pathname)
  if (!match) return null
  return { orgSlug: match[1] as string, workspaceSlug: match[2] as string }
}
