// SPDX-License-Identifier: AGPL-3.0-only
import { accessOf, capsAt, docketPlace, type Tx } from '@docket/platform-tenancy'

import { credentialScopes, fromLegacyScopes, parseScopeString, type Scope } from '../scopes.js'
import { notifyRevoked } from '../tokens/revocation.js'

/**
 * Named connections (tenancy v2 §3.4): every OAuth sign-in by an AI client is
 * one, owned by the user who approved it, named at consent ("Claude Code -
 * work laptop") and narrowed like a token: read-only, and/or to some dockets.
 * It is the authorization server's grant; revoking it removes the grant with
 * every access and refresh token issued under it, and tells every API process
 * (§8.5). A grant made before connections were named, with no row here, shows
 * under its client's name until it is renamed.
 */
export interface OAuthConnection {
  /** The grant's id. */
  id: string
  name: string
  clientId: string
  /** The name the client registered or published; null for one the server has not kept. */
  clientName: string | null
  userId: string
  readOnly: boolean
  /** The dockets it reaches, by workspace id; null: every docket of the account its owner reaches. */
  dockets: string[] | null
  /** The most it can do, in the scopes MCP's tools are checked against. */
  scopes: Scope[]
  /** The MCP URL it signed in for. */
  resource: string
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
  /** Made before connections were named: it keeps its one docket and the scopes it was granted. */
  legacy: boolean
}

export class ConnectionError extends Error {
  override name = 'ConnectionError'
}

/** A connection's name as stored: printable, one line, 1 to 80 characters. */
export function connectionName(value: string | null | undefined, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const plain = (value ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  const name = plain || fallback.trim() || 'MCP client'
  return name.length > 80 ? `${name.slice(0, 79)}…` : name
}

/** Records the connection a just-approved grant is. */
export async function createConnection(
  tx: Tx,
  input: { grantId: string; orgId: string; userId: string; clientId: string; name: string; readOnly: boolean; dockets: readonly string[] | null },
): Promise<void> {
  if (input.dockets && input.dockets.length === 0) throw new ConnectionError('Choose at least one docket, or every docket.')
  const access = await accessOf(tx, input.orgId, input.userId)
  for (const docket of input.dockets ?? []) {
    if (!capsAt(access, docketPlace(docket)).has('read')) throw new ConnectionError('You do not have access to one of those dockets.')
  }
  await tx.query(
    `INSERT INTO platform.oauth_connections (grant_id, org_id, user_id, client_id, name, read_only, dockets)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.grantId, input.orgId, input.userId, input.clientId, connectionName(input.name, input.clientId), input.readOnly, input.dockets ? [...new Set(input.dockets)] : null],
  )
}

type Row = {
  grant_id: string
  client_id: string
  account_id: string
  resource: string
  payload: { resources?: Record<string, string>; iat?: number }
  expires_at: Date | null
  client_name: string | null
  name: string | null
  read_only: boolean | null
  dockets: string[] | null
  legacy_scopes: string[] | null
  created_at: Date | null
  last_used_at: Date | null
}

/**
 * An account's live connections, newest first. `userId` keeps one user's;
 * `workspaceId` those that reach that docket; `resources` names the docket
 * MCP URLs of the account, so a grant made before connections (bound to its
 * one URL) is found too, as `docketOf` resolves it.
 */
export async function listConnections(
  tx: Tx,
  input: { orgId: string; resources: ReadonlyMap<string, string>; userId?: string; workspaceId?: string },
): Promise<OAuthConnection[]> {
  const { rows } = await tx.query<Row>(
    `SELECT g.grant_id, g.client_id, g.account_id, g.resource, g.payload, g.expires_at,
            (SELECT k.payload->>'client_name' FROM platform.oauth_store k WHERE k.model = 'Client' AND k.client_id = g.client_id LIMIT 1) AS client_name,
            c.name, c.read_only, c.dockets, c.legacy_scopes, c.created_at, c.last_used_at
       FROM platform.oauth_store g
       LEFT JOIN platform.oauth_connections c ON c.grant_id = g.grant_id
      WHERE g.model = 'Grant' AND (g.expires_at IS NULL OR g.expires_at > now())
        AND (c.org_id = $1 OR (c.grant_id IS NULL AND g.resource = ANY ($2::text[])))
        AND ($3::text IS NULL OR g.account_id = $3)
      ORDER BY coalesce(c.created_at, to_timestamp((g.payload->>'iat')::bigint)) DESC LIMIT 500`,
    [input.orgId, [...input.resources.keys()], input.userId ?? null],
  )
  const connections = rows.map((row): OAuthConnection => {
    const legacy = row.name === null
    const granted = parseScopeString(row.payload.resources?.[row.resource] ?? '')
    const pinned = input.resources.get(row.resource)
    return {
      id: row.grant_id,
      name: row.name ?? row.client_name ?? row.client_id,
      clientId: row.client_id,
      clientName: row.client_name,
      userId: row.account_id,
      readOnly: legacy ? fromLegacyScopes(granted).readOnly : row.read_only === true,
      dockets: legacy ? (pinned ? [pinned] : []) : row.dockets,
      scopes: legacy ? granted : credentialScopes({ readOnly: row.read_only === true, legacy: row.legacy_scopes }),
      resource: row.resource,
      createdAt: row.created_at ?? new Date((row.payload.iat ?? 0) * 1000),
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
      legacy,
    }
  })
  return input.workspaceId === undefined
    ? connections
    : connections.filter((connection) => connection.dockets === null || connection.dockets.includes(input.workspaceId as string))
}

/**
 * Renames a connection; `userId` limits it to that user's own. A grant made
 * before connections becomes one here, keeping exactly what it reached: its
 * one docket and the scopes it was granted.
 */
export async function renameConnection(
  tx: Tx,
  input: { orgId: string; grantId: string; name: string; userId?: string; resources: ReadonlyMap<string, string> },
): Promise<{ before: string; after: string }> {
  const [found] = (await listConnections(tx, { orgId: input.orgId, resources: input.resources, ...(input.userId ? { userId: input.userId } : {}) })).filter(
    (connection) => connection.id === input.grantId,
  )
  if (!found) throw new ConnectionError('No such connection.')
  const after = connectionName(input.name, found.name)
  if (found.legacy) {
    const pinned = found.dockets?.[0]
    if (!pinned) throw new ConnectionError('No such connection.')
    const { readOnly, legacy } = fromLegacyScopes(found.scopes)
    await tx.query(
      `INSERT INTO platform.oauth_connections (grant_id, org_id, user_id, client_id, name, read_only, dockets, legacy_scopes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (grant_id) DO UPDATE SET name = EXCLUDED.name`,
      [found.id, input.orgId, found.userId, found.clientId, after, readOnly, [pinned], legacy, found.createdAt],
    )
  } else {
    await tx.query('UPDATE platform.oauth_connections SET name = $2 WHERE grant_id = $1 AND org_id = $3', [found.id, after, input.orgId])
  }
  // A connection's name is in the evidence it files from now on: cached lookups carry the old one.
  await notifyRevoked(tx, 'oauth:connection')
  return { before: found.name, after }
}

/**
 * Revokes a connection; `userId` limits it to that user's own, and
 * `ownOrPinned` to a docket admin's own and anyone's that reach only their
 * docket. Returns it as it was, for the audit event.
 */
export async function revokeConnection(
  tx: Tx,
  input: {
    orgId: string
    grantId: string
    userId?: string
    ownOrPinned?: { userId: string; workspaceId: string }
    resources: ReadonlyMap<string, string>
  },
): Promise<OAuthConnection> {
  const [found] = (await listConnections(tx, { orgId: input.orgId, resources: input.resources, ...(input.userId ? { userId: input.userId } : {}) })).filter(
    (connection) => connection.id === input.grantId,
  )
  const pinned = (connection: OAuthConnection, workspaceId: string) => connection.dockets?.length === 1 && connection.dockets[0] === workspaceId
  if (!found || (input.ownOrPinned && found.userId !== input.ownOrPinned.userId && !pinned(found, input.ownOrPinned.workspaceId))) {
    throw new ConnectionError('No such connection.')
  }
  await tx.query('DELETE FROM platform.oauth_store WHERE grant_id = $1', [found.id])
  await tx.query('DELETE FROM platform.oauth_connections WHERE grant_id = $1', [found.id])
  await notifyRevoked(tx, 'oauth:grant')
  return found
}
