// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from '@docket/platform-tenancy'

import { parseScopeString, type Scope } from '../scopes.js'
import { notifyRevoked } from '../tokens/revocation.js'

/**
 * The OAuth grants on a workspace's MCP endpoint (§8.2): which client a user
 * let in, with which scopes. Revoking one removes it with every access and
 * refresh token issued under it, and tells every API process (§8.5).
 */
export interface OAuthGrant {
  id: string
  clientId: string
  /** The name the client registered or published; null for one the server has not kept. */
  clientName: string | null
  accountId: string
  scopes: Scope[]
  grantedAt: Date
  expiresAt: Date | null
}

export async function listGrants(tx: Tx, input: { resource: string; accountId?: string }): Promise<OAuthGrant[]> {
  const { rows } = await tx.query<{
    grant_id: string
    client_id: string
    account_id: string
    payload: { resources?: Record<string, string>; iat?: number }
    expires_at: Date | null
    client_name: string | null
  }>(
    `SELECT g.grant_id, g.client_id, g.account_id, g.payload, g.expires_at,
            (SELECT c.payload->>'client_name' FROM platform.oauth_store c WHERE c.model = 'Client' AND c.client_id = g.client_id LIMIT 1) AS client_name
       FROM platform.oauth_store g
      WHERE g.model = 'Grant' AND g.resource = $1 AND (g.expires_at IS NULL OR g.expires_at > now())
        AND ($2::text IS NULL OR g.account_id = $2)
      ORDER BY g.payload->>'iat' DESC LIMIT 200`,
    [input.resource, input.accountId ?? null],
  )
  return rows.map((row) => ({
    id: row.grant_id,
    clientId: row.client_id,
    clientName: row.client_name,
    accountId: row.account_id,
    scopes: parseScopeString(row.payload.resources?.[input.resource] ?? ''),
    grantedAt: new Date((row.payload.iat ?? 0) * 1000),
    expiresAt: row.expires_at,
  }))
}

export class GrantRevocationError extends Error {
  override name = 'GrantRevocationError'
}

/** Revokes a grant on `resource`; `accountId` limits it to that user's own. Returns the grant's client and user. */
export async function revokeGrant(
  tx: Tx,
  input: { grantId: string; resource: string; accountId?: string },
): Promise<{ clientId: string; accountId: string }> {
  const { rows } = await tx.query<{ client_id: string; account_id: string }>(
    `SELECT client_id, account_id FROM platform.oauth_store
      WHERE model = 'Grant' AND grant_id = $1 AND resource = $2 AND ($3::text IS NULL OR account_id = $3)`,
    [input.grantId, input.resource, input.accountId ?? null],
  )
  const grant = rows[0]
  if (!grant) throw new GrantRevocationError('No such grant.')
  await tx.query('DELETE FROM platform.oauth_store WHERE grant_id = $1', [input.grantId])
  await notifyRevoked(tx, 'oauth:grant')
  return { clientId: grant.client_id, accountId: grant.account_id }
}
