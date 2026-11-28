// SPDX-License-Identifier: AGPL-3.0-only
import type { Scope } from './scopes.js'

/**
 * Who is calling an MCP endpoint (§8.2-8.4; tenancy v2 §3.4): a user or
 * system account, the docket the call is for, and what their credential - an
 * API token or a named OAuth connection - narrows them to. `scopes` is that
 * ceiling, in the scopes MCP's tools are checked against: `effectiveScopes`
 * cuts it to the owner's permission on the docket at the moment of each call.
 */
export interface Principal {
  userId: string
  orgId: string
  /** The docket this call is for: one the credential reaches. */
  workspaceId: string
  scopes: Scope[]
  /** The credential reads only. */
  readOnly?: boolean
  /** The dockets the credential reaches, by workspace id; null: every docket its owner reaches. */
  dockets?: string[] | null
  via: 'oauth' | 'token'
  /** The OAuth client, for `via: 'oauth'`. */
  clientId?: string
  /** The API token's id (`tok_...`), or the OAuth grant (the connection) the access token belongs to. */
  tokenId: string
  /** The token's or connection's name, when it has one. */
  credentialName?: string | null
  /**
   * How the caller reads in the audit log (§10): `token:<prefix>`, or
   * `oauth:<clientId>/conn:<grant>/user:<id>` for a named connection
   * (`oauth:<clientId>/user:<id>` for a grant made before them).
   */
  actor: `token:${string}` | `oauth:${string}/user:${string}`
  /** When the credential itself expires: the API token, or the 15-minute access token. */
  expiresAt: Date
}

/**
 * A caller at an account's MCP address (`/mcp/{org}`; tenancy v2 §4), or at
 * `/api/v1`: who, and what their credential narrows them to, before a docket
 * is chosen. Each call to a docket's tools is then a `Principal` for it.
 */
export type AccountPrincipal = Omit<Principal, 'workspaceId'> & {
  /**
   * The one MCP URL an OAuth access token from a grant made before named
   * connections is bound to (its audience); null for an API token or a
   * named connection, which are bound by their dockets.
   */
  audience: string | null
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

/** The canonical MCP URL of an account (tenancy v2 §4): one address for all its dockets, with a `docket` argument. */
export function accountMcpUrl(origin: string, orgSlug: string): string {
  return new URL(`/mcp/${encodeURIComponent(orgSlug)}`, origin).toString()
}

/**
 * The org and workspace slugs of a canonical MCP URL on this origin, or null
 * when it is not one: a docket's (`/mcp/{org}/{workspace}`), or, with
 * `account: true`, an account's too (`/mcp/{org}`, workspace null).
 */
export function parseMcpResourceUrl(origin: string, value: string): { orgSlug: string; workspaceSlug: string } | null
export function parseMcpResourceUrl(origin: string, value: string, options: { account: true }): { orgSlug: string; workspaceSlug: string | null } | null
export function parseMcpResourceUrl(origin: string, value: string, options: { account?: boolean } = {}): { orgSlug: string; workspaceSlug: string | null } | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.origin !== new URL(origin).origin || url.search || url.hash) return null
  const match = /^\/mcp\/([a-z0-9-]{1,40})(?:\/([a-z0-9-]{1,40}))?$/.exec(url.pathname)
  if (!match || (!match[2] && !options.account)) return null
  return { orgSlug: match[1] as string, workspaceSlug: match[2] ?? null }
}
