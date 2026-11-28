// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from '@docket/platform-tenancy'

import type { AccountPrincipal, McpResource, Principal } from '../principal.js'
import { credentialScopes, parseScopeString, type Scope } from '../scopes.js'
import { isApiTokenText, parseApiToken, tokenHash } from './api-token.js'

/** A cached lookup is trusted for at most this long without a revocation notice (§8.5). */
export const LOOKUP_TTL_MS = 5_000
/** `last_used_at` is written at most this often per token or connection. */
const TOUCH_EVERY_MS = 60_000
const MAX_CACHED = 5_000

/** What a bearer resolved to, before it is matched against the resource it is used on. */
interface Bound {
  userId: string
  orgId: string
  /** The dockets it reaches, by workspace id; null: every docket its owner reaches. */
  dockets: string[] | null
  /**
   * The one MCP URL an OAuth access token from a grant made before named
   * connections is for (its audience). A connection or an API token is
   * bound by its dockets instead.
   */
  audience: string | null
  scopes: Scope[]
  readOnly: boolean
  via: 'oauth' | 'token'
  clientId?: string
  tokenId: string
  credentialName: string | null
  actor: Principal['actor']
  expiresAt: Date
}

export interface TokenResolver {
  /**
   * The principal behind `Authorization: Bearer <raw>` on `resource`, or null:
   * unknown, mistyped, expired, revoked, or not for that docket (a token or
   * connection reaches only the dockets it names, in its own org).
   */
  resolveBearer(raw: string, resource: McpResource): Promise<Principal | null>
  /**
   * The caller behind `Authorization: Bearer <raw>` before any docket is
   * chosen: at an account's MCP address and on `/api/v1`. Null when unknown,
   * mistyped, expired or revoked; its account is the caller's to check.
   */
  resolveCredential(raw: string): Promise<AccountPrincipal | null>
  /**
   * Whether `raw` is a live credential for some workspace, whichever: a
   * caller whose token is valid but names another workspace is told the
   * workspace was not found, never that the token is bad.
   */
  isLive(raw: string): Promise<boolean>
  /** Drops every cached lookup: what a revocation notice does. */
  forget(): void
}

type Platform = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>

const stale = (lastUsed: Date | null, now: Date) => !lastUsed || now.getTime() - lastUsed.getTime() >= TOUCH_EVERY_MS

async function lookupApiToken(tx: Tx, raw: string, now: Date): Promise<Bound | null> {
  const parsed = parseApiToken(raw)
  // A mistyped token never reaches the database (§8.3).
  if (!parsed.ok) return null
  const { rows } = await tx.query<{
    id: string
    prefix: string
    org_id: string
    dockets: string[] | null
    owner_id: string
    read_only: boolean
    legacy_scopes: string[] | null
    description: string | null
    expires_at: Date
    last_used_at: Date | null
  }>(
    `SELECT id, prefix, org_id, dockets, owner_id, read_only, legacy_scopes, description, expires_at, last_used_at
       FROM platform.api_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2
        -- A token of a suspended or deleted account reaches nothing (the operator console).
        AND org_id IN (SELECT id FROM platform.orgs WHERE status = 'active')`,
    [tokenHash(raw), now],
  )
  const row = rows[0]
  if (!row) return null
  if (stale(row.last_used_at, now)) await tx.query('UPDATE platform.api_tokens SET last_used_at = $2 WHERE id = $1', [row.id, now])
  return {
    userId: row.owner_id,
    orgId: row.org_id,
    dockets: row.dockets,
    audience: null,
    scopes: credentialScopes({ readOnly: row.read_only, legacy: row.legacy_scopes }),
    readOnly: row.read_only,
    via: 'token',
    tokenId: row.id,
    credentialName: row.description,
    actor: `token:${row.prefix}`,
    expiresAt: row.expires_at,
  }
}

type AccessTokenPayload = {
  accountId?: unknown
  clientId?: unknown
  aud?: unknown
  scope?: unknown
  grantId?: unknown
  exp?: unknown
  /** `workspace_id` is absent for a token whose resource is an account's MCP URL. */
  extra?: { org_id?: unknown; workspace_id?: unknown }
}

/**
 * An OAuth access token, as the authorization server's adapter stored it
 * (`platform.oauth_store`), with the named connection its grant is: what the
 * connection says decides what it reaches (tenancy v2 §3.4). A grant with no
 * connection keeps what it had: its one docket's URL and its token's scopes.
 */
async function lookupAccessToken(tx: Tx, raw: string, now: Date): Promise<Bound | null> {
  if (raw.length < 32 || raw.length > 128 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null
  const { rows } = await tx.query<{
    payload: AccessTokenPayload
    connection: string | null
    org_id: string | null
    name: string | null
    read_only: boolean | null
    dockets: string[] | null
    legacy_scopes: string[] | null
    last_used_at: Date | null
  }>(
    `SELECT t.payload, c.grant_id AS connection, c.org_id, c.name, c.read_only, c.dockets, c.legacy_scopes, c.last_used_at
       FROM platform.oauth_store t
       LEFT JOIN platform.oauth_connections c ON c.grant_id = t.grant_id
      WHERE t.model = 'AccessToken' AND t.id_hash = $1 AND (t.expires_at IS NULL OR t.expires_at > $2)
        AND EXISTS (SELECT 1 FROM platform.oauth_store g WHERE g.model = 'Grant' AND g.grant_id = t.grant_id
                      AND (g.expires_at IS NULL OR g.expires_at > $2))`,
    [tokenHash(raw), now],
  )
  const row = rows[0]
  const payload = row?.payload
  if (!row || !payload) return null
  const { accountId, clientId, aud, scope, grantId, exp, extra } = payload
  if (typeof accountId !== 'string' || typeof clientId !== 'string' || typeof aud !== 'string' || typeof grantId !== 'string') return null
  if (typeof extra?.org_id !== 'string' || typeof exp !== 'number') return null
  if (extra.workspace_id !== undefined && typeof extra.workspace_id !== 'string') return null
  const expiresAt = new Date(exp * 1000)
  if (expiresAt <= now) return null
  // A connection to a suspended or deleted account reaches nothing (the operator console).
  const live = await tx.query("SELECT 1 FROM platform.orgs WHERE id = $1 AND status = 'active'", [extra.org_id])
  if (!live.rowCount) return null
  const common = { userId: accountId, orgId: extra.org_id, via: 'oauth' as const, clientId, tokenId: grantId, expiresAt }
  if (row.connection === null) {
    // Every grant for an account's address is a named connection: one without is for a single docket.
    if (typeof extra.workspace_id !== 'string') return null
    const scopes = parseScopeString(typeof scope === 'string' ? scope : '')
    return {
      ...common,
      dockets: [extra.workspace_id],
      audience: aud,
      scopes,
      readOnly: !scopes.some((value) => value !== 'docket:read' && value !== 'ontology:read'),
      credentialName: null,
      actor: `oauth:${clientId}/user:${accountId}`,
    }
  }
  // A connection belongs to one account: a token whose audience is another's reaches nothing.
  if (row.org_id !== extra.org_id) return null
  if (stale(row.last_used_at, now)) await tx.query('UPDATE platform.oauth_connections SET last_used_at = $2 WHERE grant_id = $1', [grantId, now])
  return {
    ...common,
    dockets: row.dockets,
    audience: null,
    scopes: credentialScopes({ readOnly: row.read_only === true, legacy: row.legacy_scopes }),
    readOnly: row.read_only === true,
    credentialName: row.name,
    actor: `oauth:${clientId}/conn:${grantId}/user:${accountId}`,
  }
}

/**
 * Resolves bearer tokens (§8.3, §8.5): API tokens by their SHA-256, OAuth
 * access tokens by theirs in the authorization server's store. Every request
 * looks its token up; lookups are cached in-process for at most `ttlMs`, and
 * `forget` - wired to the revocation listener - drops them all at once.
 */
export function tokenResolver(options: { platform: Platform; ttlMs?: number; now?: () => Date }): TokenResolver {
  const ttlMs = options.ttlMs ?? LOOKUP_TTL_MS
  const now = options.now ?? (() => new Date())
  const cache = new Map<string, { bound: Bound; until: number }>()

  const lookup = async (raw: string): Promise<Bound | null> => {
    const apiToken = isApiTokenText(raw)
    // A mistyped API token is turned away before any database call (§8.3).
    if (apiToken && !parseApiToken(raw).ok) return null
    const at = now()
    const key = tokenHash(raw)
    const hit = cache.get(key)
    if (hit && hit.until > at.getTime()) return hit.bound
    cache.delete(key)
    const bound = await options.platform((tx) => (apiToken ? lookupApiToken(tx, raw, at) : lookupAccessToken(tx, raw, at)))
    if (bound) {
      if (cache.size >= MAX_CACHED) cache.clear()
      cache.set(key, { bound, until: Math.min(at.getTime() + ttlMs, bound.expiresAt.getTime()) })
    }
    return bound
  }

  return {
    async resolveBearer(raw, resource) {
      const bound = await lookup(raw.trim())
      if (!bound || bound.expiresAt <= now()) return null
      if (bound.orgId !== resource.orgId) return null
      if (bound.dockets !== null && !bound.dockets.includes(resource.workspaceId)) return null
      if (bound.audience !== null && bound.audience !== resource.url) return null
      return {
        userId: bound.userId,
        orgId: bound.orgId,
        workspaceId: resource.workspaceId,
        scopes: [...bound.scopes],
        readOnly: bound.readOnly,
        dockets: bound.dockets ? [...bound.dockets] : null,
        via: bound.via,
        ...(bound.clientId ? { clientId: bound.clientId } : {}),
        tokenId: bound.tokenId,
        credentialName: bound.credentialName,
        actor: bound.actor,
        expiresAt: bound.expiresAt,
      }
    },
    async resolveCredential(raw) {
      const bound = await lookup(raw.trim())
      if (!bound || bound.expiresAt <= now()) return null
      return {
        userId: bound.userId,
        orgId: bound.orgId,
        scopes: [...bound.scopes],
        readOnly: bound.readOnly,
        dockets: bound.dockets ? [...bound.dockets] : null,
        via: bound.via,
        ...(bound.clientId ? { clientId: bound.clientId } : {}),
        tokenId: bound.tokenId,
        credentialName: bound.credentialName,
        actor: bound.actor,
        expiresAt: bound.expiresAt,
        audience: bound.audience,
      }
    },
    async isLive(raw) {
      const bound = await lookup(raw.trim())
      return bound !== null && bound.expiresAt > now()
    },
    forget() {
      cache.clear()
    },
  }
}
