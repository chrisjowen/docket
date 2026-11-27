// SPDX-License-Identifier: AGPL-3.0-only
import { listApiTokens, listConnections, mcpResourceUrl, type ApiTokenRecord, type OAuthConnection } from '@docket/platform-auth'
import { listWorkspaces } from '@docket/platform-canonical-store'
import { listMembers, type Tx } from '@docket/platform-tenancy'

import { getRuntime } from './runtime'

/**
 * Tokens and named connections as the app's pages and the CLI's
 * `GET .../tokens` show them (tenancy v2 §3.4): each acts as its owner,
 * read-only or not, on every docket its owner reaches or on chosen ones.
 * Never a token's text.
 */

/** A docket a credential names: shown by name, linked by slug. */
export interface DocketRef {
  id: string
  slug: string
  name: string
}

export interface TokenView {
  id: string
  prefix: string
  /** Its name; the CLI also reads it as `description`. */
  name: string | null
  description: string | null
  owner: string
  ownerKind: 'human' | 'service'
  mine: boolean
  readOnly: boolean
  /** The dockets it reaches; null: every docket its owner reaches. */
  dockets: DocketRef[] | null
  /** What it can do at most, in MCP's scopes: kept for the CLI's `token list`. */
  scopes: ApiTokenRecord['scopes']
  createdAt: string
  expiresAt: string
  lastUsedAt: string | null
  status: 'live' | 'revoked' | 'expired'
}

const refs = (ids: readonly string[] | null, dockets: ReadonlyMap<string, DocketRef>): DocketRef[] | null =>
  ids === null ? null : ids.map((id) => dockets.get(id) ?? { id, slug: id, name: 'A deleted docket' })

export function tokenView(token: ApiTokenRecord, userId: string, dockets: ReadonlyMap<string, DocketRef> = new Map(), now = Date.now()): TokenView {
  return {
    id: token.id,
    prefix: token.prefix,
    name: token.description,
    description: token.description,
    owner: token.ownerKind === 'service' ? token.ownerLogin : `@${token.ownerLogin}`,
    ownerKind: token.ownerKind,
    mine: token.ownerId === userId,
    readOnly: token.readOnly,
    dockets: refs(token.dockets, dockets),
    scopes: token.scopes,
    createdAt: token.createdAt.toISOString(),
    expiresAt: token.expiresAt.toISOString(),
    lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
    status: token.revokedAt ? 'revoked' : token.expiresAt.getTime() <= now ? 'expired' : 'live',
  }
}

export interface ConnectionView {
  id: string
  name: string
  client: string
  clientId: string
  user: string
  mine: boolean
  readOnly: boolean
  dockets: DocketRef[] | null
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
}

export function connectionView(
  connection: OAuthConnection,
  userId: string,
  dockets: ReadonlyMap<string, DocketRef>,
  logins: ReadonlyMap<string, string>,
): ConnectionView {
  return {
    id: connection.id,
    name: connection.name,
    client: connection.clientName ?? connection.clientId,
    clientId: connection.clientId,
    user: logins.has(connection.userId) ? `@${logins.get(connection.userId)}` : connection.userId,
    mine: connection.userId === userId,
    readOnly: connection.readOnly,
    dockets: refs(connection.dockets, dockets),
    createdAt: connection.createdAt.toISOString(),
    lastUsedAt: connection.lastUsedAt ? connection.lastUsedAt.toISOString() : null,
    expiresAt: connection.expiresAt ? connection.expiresAt.toISOString() : null,
  }
}

/** The account's live dockets by id, and their MCP URLs, which a grant made before connections is bound to. */
export async function accountDockets(org: { id: string; slug: string }): Promise<{ dockets: Map<string, DocketRef>; resources: Map<string, string> }> {
  const { router, origin } = getRuntime()
  const all = await router.withTenant(org.id, listWorkspaces)
  return {
    dockets: new Map(all.map((workspace) => [workspace.id, { id: workspace.id, slug: workspace.slug, name: workspace.name }])),
    resources: new Map(all.map((workspace) => [mcpResourceUrl(origin, org.slug, workspace.slug), workspace.id])),
  }
}

/** A docket's tokens, as its MCP page and the CLI's `token list` show them: everyone's for its admins, else the member's own. */
export async function workspaceTokens(tx: Tx, input: { orgId: string; workspaceId: string; userId: string; manage: boolean }): Promise<ApiTokenRecord[]> {
  return listApiTokens(tx, { orgId: input.orgId, workspaceId: input.workspaceId, ...(input.manage ? {} : { ownerId: input.userId }) })
}

/** A docket's connections: everyone's for its admins, else the member's own. */
export async function workspaceConnections(
  tx: Tx,
  input: { orgId: string; workspaceId: string; userId: string; manage: boolean; resources: ReadonlyMap<string, string> },
): Promise<OAuthConnection[]> {
  return listConnections(tx, { orgId: input.orgId, resources: input.resources, workspaceId: input.workspaceId, ...(input.manage ? {} : { userId: input.userId }) })
}

/**
 * How audit actors read on a page (tenancy v2 §3.4: who, and through what):
 * `user:<id>` as `@login`, a token as `@login with token 'name'`, a named
 * connection as `@login via 'name'`, a grant made before them as
 * `@login via <client>`, anything else as it is.
 */
export async function actorNamer(org: { id: string }): Promise<(actor: string | null) => string> {
  const { router } = getRuntime()
  const { members, tokens, connections } = await router.withPlatform(async (tx) => ({
    members: await listMembers(tx, org.id),
    tokens: (await tx.query<{ prefix: string; login: string; kind: string; description: string | null }>(
      `SELECT t.prefix, u.login, u.kind, t.description FROM platform.api_tokens t JOIN platform.users u ON u.id = t.owner_id WHERE t.org_id = $1`,
      [org.id],
    )).rows,
    connections: (await tx.query<{ grant_id: string; name: string }>('SELECT grant_id, name FROM platform.oauth_connections WHERE org_id = $1', [org.id])).rows,
  }))
  const names = new Map(members.map((member) => [member.id, member.kind === 'service' ? member.login : `@${member.login}`]))
  const byPrefix = new Map(tokens.map((token) => [token.prefix, { who: token.kind === 'service' ? token.login : `@${token.login}`, name: token.description }]))
  const byGrant = new Map(connections.map((connection) => [connection.grant_id, connection.name]))
  return (actor) => {
    if (!actor) return ''
    const user = /^user:(.+)$/.exec(actor)?.[1]
    if (user) return names.get(user) ?? actor
    const token = /^token:(.+)$/.exec(actor)?.[1]
    if (token) {
      const found = byPrefix.get(token)
      if (!found) return actor
      return found.name ? `${found.who} with token '${found.name}'` : `${found.who} with token ${token}…`
    }
    const oauth = /^oauth:(.+?)(?:\/conn:([^/]+))?\/user:([^/]+)$/.exec(actor)
    if (oauth) {
      const who = names.get(oauth[3] as string)
      if (!who) return actor
      const connection = oauth[2] ? byGrant.get(oauth[2]) : undefined
      return connection ? `${who} via '${connection}'` : `${who} via ${oauth[1]}`
    }
    return actor
  }
}
