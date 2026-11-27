// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from '@docket/platform-tenancy'
import type pg from 'pg'

/**
 * Instant revocation (§8.5). Every revocation - a token, an OAuth grant, a
 * membership - notifies `docket_token_revoked` in the transaction that made
 * it, so Postgres delivers it on commit. Each API process listens and drops
 * its cached lookups, so the next call with a revoked credential fails in
 * under a second; the cache's 5-second TTL bounds it when a notification is
 * missed.
 */
export const REVOCATION_CHANNEL = 'docket_token_revoked'

/** Tells every API process to forget cached lookups; delivered when `tx` commits. */
export async function notifyRevoked(tx: Pick<Tx, 'query'>, what: string): Promise<void> {
  await tx.query('SELECT pg_notify($1, $2)', [REVOCATION_CHANNEL, what.slice(0, 200)])
}

export class TokenRevocationError extends Error {
  override name = 'TokenRevocationError'
}

/**
 * Revokes an API token of the org. `ownerId` limits it to that member's own
 * tokens (what a member without `tokens.manage` may revoke), and
 * `workspaceId` to one workspace's (what a credential bound to it may
 * revoke). Returns the token's prefix and owner for the audit event.
 */
export async function revokeApiToken(
  tx: Tx,
  input: { orgId: string; tokenId: string; by: string; ownerId?: string; workspaceId?: string },
): Promise<{ prefix: string; ownerId: string; workspaceId: string }> {
  const { rows } = await tx.query<{ prefix: string; owner_id: string; workspace_id: string }>(
    `UPDATE platform.api_tokens SET revoked_at = now(), revoked_by = $3
      WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL AND ($4::text IS NULL OR owner_id = $4)
        AND ($5::text IS NULL OR workspace_id = $5)
      RETURNING prefix, owner_id, workspace_id`,
    [input.tokenId, input.orgId, input.by, input.ownerId ?? null, input.workspaceId ?? null],
  )
  const row = rows[0]
  if (!row) throw new TokenRevocationError('No such live token.')
  await notifyRevoked(tx, `token:${input.tokenId}`)
  return { prefix: row.prefix, ownerId: row.owner_id, workspaceId: row.workspace_id }
}

/**
 * Revokes every credential for a deleted workspace (§4, §8.5): its API tokens,
 * and the OAuth grants on its MCP endpoint with every access and refresh token
 * issued under them. Both are bound to the workspace's id, so none would work
 * on a new workspace at the same address; this leaves none live either.
 */
export async function revokeWorkspaceCredentials(
  tx: Tx,
  input: { orgId: string; workspaceId: string; resource: string; by: string },
): Promise<{ tokens: number; grants: number }> {
  const tokens = await tx.query(
    `UPDATE platform.api_tokens SET revoked_at = now(), revoked_by = $3
      WHERE org_id = $1 AND workspace_id = $2 AND revoked_at IS NULL`,
    [input.orgId, input.workspaceId, input.by],
  )
  const { rows } = await tx.query<{ grant_id: string }>(
    "SELECT DISTINCT grant_id FROM platform.oauth_store WHERE resource = $1 AND grant_id IS NOT NULL",
    [input.resource],
  )
  const grants = rows.map((row) => row.grant_id)
  await tx.query('DELETE FROM platform.oauth_store WHERE grant_id = ANY($1) OR resource = $2', [grants, input.resource])
  await notifyRevoked(tx, `workspace:${input.workspaceId}`)
  return { tokens: tokens.rowCount ?? 0, grants: grants.length }
}

export interface RevocationListener {
  /** False while the connection is down: lookups then lean on the TTL alone. */
  readonly connected: boolean
  close(): Promise<void>
}

/**
 * Listens on `docket_token_revoked` on a connection of its own, reconnecting
 * with backoff, and calls `onRevoked` for each notification - and once more
 * after every reconnect, for what it may have missed while down.
 */
export function listenForRevocations(options: {
  connect: () => pg.Client
  onRevoked: (what: string) => void
  log?: (message: string) => void
}): RevocationListener {
  let client: pg.Client | null = null
  let connected = false
  let closed = false
  let attempt = 0
  let timer: NodeJS.Timeout | undefined

  const schedule = () => {
    if (closed) return
    const delay = Math.min(30_000, 500 * 2 ** attempt)
    attempt += 1
    timer = setTimeout(() => void start(), delay)
    timer.unref()
  }

  const start = async () => {
    if (closed) return
    const next = options.connect()
    client = next
    // One retry per connection, whichever of a failed connect or a dropped one comes first.
    let retried = false
    const retry = () => {
      if (retried) return
      retried = true
      connected = false
      if (client === next) client = null
      schedule()
    }
    next.on('notification', (message) => {
      if (message.channel === REVOCATION_CHANNEL) options.onRevoked(message.payload ?? '')
    })
    next.on('error', (error) => {
      options.log?.(`revocation listener: ${error.message}`)
    })
    next.on('end', retry)
    try {
      await next.connect()
      await next.query(`LISTEN ${REVOCATION_CHANNEL}`)
      connected = true
      attempt = 0
      options.onRevoked('reconnected')
    } catch (error) {
      options.log?.(`revocation listener: ${error instanceof Error ? error.message : String(error)}`)
      retry()
      await next.end().catch(() => undefined)
    }
  }

  void start()
  return {
    get connected() {
      return connected
    },
    async close() {
      closed = true
      if (timer) clearTimeout(timer)
      const current = client
      client = null
      connected = false
      current?.removeAllListeners('end')
      await current?.end().catch(() => undefined)
    },
  }
}
