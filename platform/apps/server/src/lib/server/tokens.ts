// SPDX-License-Identifier: AGPL-3.0-only
import { listApiTokens, type ApiTokenRecord } from '@docket/platform-auth'
import type { Tx } from '@docket/platform-tenancy'

/**
 * A workspace's API tokens as the MCP page and the CLI's `GET .../tokens`
 * list them: everyone's for a member who manages tokens (`tokens.manage`),
 * else the member's own. Never the token text.
 */
export interface TokenView {
  id: string
  prefix: string
  owner: string
  mine: boolean
  scopes: ApiTokenRecord['scopes']
  description: string | null
  createdAt: string
  expiresAt: string
  lastUsedAt: string | null
  status: 'live' | 'revoked' | 'expired'
}

export function tokenView(token: ApiTokenRecord, userId: string, now = Date.now()): TokenView {
  return {
    id: token.id,
    prefix: token.prefix,
    owner: token.ownerKind === 'service' ? `${token.ownerLogin} (service account)` : `@${token.ownerLogin}`,
    mine: token.ownerId === userId,
    scopes: token.scopes,
    description: token.description,
    createdAt: token.createdAt.toISOString(),
    expiresAt: token.expiresAt.toISOString(),
    lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
    status: token.revokedAt ? 'revoked' : token.expiresAt.getTime() <= now ? 'expired' : 'live',
  }
}

export async function workspaceTokens(tx: Tx, input: { orgId: string; workspaceId: string; userId: string; manage: boolean }): Promise<ApiTokenRecord[]> {
  return listApiTokens(tx, { orgId: input.orgId, workspaceId: input.workspaceId, ...(input.manage ? {} : { ownerId: input.userId }) })
}
