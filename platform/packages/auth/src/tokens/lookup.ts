// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from '@docket/platform-tenancy'

import type { McpResource, Principal } from '../principal.js'
import { isScope, parseScopeString, type Scope } from '../scopes.js'
import { TOKEN_PREFIX, parseApiToken, tokenHash } from './api-token.js'

/** A cached lookup is trusted for at most this long without a revocation notice (§8.5). */
export const LOOKUP_TTL_MS = 5_000
/** `last_used_at` is written at most this often per token. */
const TOUCH_EVERY_MS = 60_000
const MAX_CACHED = 5_000

/** What a bearer resolved to, before it is matched against the resource it is used on. */
interface Bound {
  userId: string
  orgId: string
  workspaceId: string
  /** The OAuth audience: the one MCP URL the access token is for. API tokens are bound by ids. */
  audience: string | null
  scopes: Scope[]
  via: 'oauth' | 'token'
  clientId?: string
  tokenId: string
  actor: Principal['actor']
  expiresAt: Date
}

export interface TokenResolver {
  /**
   * The principal behind `Authorization: Bearer <raw>` on `resource`, or null:
   * unknown, mistyped, expired, revoked, or bound to another workspace (an
   * access token's audience is one workspace's MCP URL only).
   */
  resolveBearer(raw: string, resource: McpResource): Promise<Principal | null>
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

async function lookupApiToken(tx: Tx, raw: string, now: Date): Promise<Bound | null> {
  const parsed = parseApiToken(raw)
  // A mistyped token never reaches the database (§8.3).
  if (!parsed.ok) return null
  const { rows } = await tx.query<{
    id: string
    prefix: string
    org_id: string
    workspace_id: string
    owner_id: string
    scopes: string[]
    expires_at: Date
    last_used_at: Date | null
  }>(
    `SELECT id, prefix, org_id, workspace_id, owner_id, scopes, expires_at, last_used_at FROM platform.api_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
    [tokenHash(raw), now],
  )
  const row = rows[0]
  if (!row) return null
  if (!row.last_used_at || now.getTime() - row.last_used_at.getTime() >= TOUCH_EVERY_MS) {
    await tx.query('UPDATE platform.api_tokens SET last_used_at = $2 WHERE id = $1', [row.id, now])
  }
  return {
    userId: row.owner_id,
    orgId: row.org_id,
    workspaceId: row.workspace_id,
    audience: null,
    scopes: row.scopes.filter(isScope),
    via: 'token',
    tokenId: row.id,
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
  extra?: { org_id?: unknown; workspace_id?: unknown }
}

/** An OAuth access token, as the authorization server's adapter stored it (`platform.oauth_store`). */
async function lookupAccessToken(tx: Tx, raw: string, now: Date): Promise<Bound | null> {
  if (raw.length < 32 || raw.length > 128 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null
  const { rows } = await tx.query<{ payload: AccessTokenPayload }>(
    `SELECT t.payload FROM platform.oauth_store t
      WHERE t.model = 'AccessToken' AND t.id_hash = $1 AND (t.expires_at IS NULL OR t.expires_at > $2)
        AND EXISTS (SELECT 1 FROM platform.oauth_store g WHERE g.model = 'Grant' AND g.grant_id = t.grant_id
                      AND (g.expires_at IS NULL OR g.expires_at > $2))`,
    [tokenHash(raw), now],
  )
  const payload = rows[0]?.payload
  if (!payload) return null
  const { accountId, clientId, aud, scope, grantId, exp, extra } = payload
  if (typeof accountId !== 'string' || typeof clientId !== 'string' || typeof aud !== 'string' || typeof grantId !== 'string') return null
  if (typeof extra?.org_id !== 'string' || typeof extra.workspace_id !== 'string' || typeof exp !== 'number') return null
  const expiresAt = new Date(exp * 1000)
  if (expiresAt <= now) return null
  return {
    userId: accountId,
    orgId: extra.org_id,
    workspaceId: extra.workspace_id,
    audience: aud,
    scopes: parseScopeString(typeof scope === 'string' ? scope : ''),
    via: 'oauth',
    clientId,
    tokenId: grantId,
    actor: `oauth:${clientId}/user:${accountId}`,
    expiresAt,
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
    // A mistyped API token is turned away before any database call (§8.3).
    if (raw.startsWith(TOKEN_PREFIX) && !parseApiToken(raw).ok) return null
    const at = now()
    const key = tokenHash(raw)
    const hit = cache.get(key)
    if (hit && hit.until > at.getTime()) return hit.bound
    cache.delete(key)
    const bound = await options.platform((tx) =>
      raw.startsWith(TOKEN_PREFIX) ? lookupApiToken(tx, raw, at) : lookupAccessToken(tx, raw, at),
    )
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
      if (bound.orgId !== resource.orgId || bound.workspaceId !== resource.workspaceId) return null
      if (bound.audience !== null && bound.audience !== resource.url) return null
      return {
        userId: bound.userId,
        orgId: bound.orgId,
        workspaceId: bound.workspaceId,
        scopes: [...bound.scopes],
        via: bound.via,
        ...(bound.clientId ? { clientId: bound.clientId } : {}),
        tokenId: bound.tokenId,
        actor: bound.actor,
        expiresAt: bound.expiresAt,
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
