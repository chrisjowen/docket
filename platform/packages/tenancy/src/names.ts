// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Org and workspace ids, and the names each store derives from them.
 *
 * Ids become SQL identifiers (`org_<orgId>`), Neo4j scopes (`ws_<workspaceId>`)
 * and Qdrant collection prefixes, so they are restricted to lowercase letters
 * and digits and kept short enough for Postgres' 63-byte identifier limit.
 */
const ID = /^[a-z0-9]{1,40}$/

export class TenantIdError extends Error {
  override name = 'TenantIdError'
}

function checked(kind: string, id: string): string {
  if (!ID.test(id)) {
    throw new TenantIdError(`${kind} id must be 1-40 lowercase letters or digits`)
  }
  return id
}

/** The org's Postgres schema and its login-less role (§5.1). */
export function orgSchema(orgId: string): string {
  return `org_${checked('org', orgId)}`
}

/** The docket `scope` a workspace's projections carry (§4). */
export function workspaceScope(workspaceId: string): string {
  return `ws_${checked('workspace', workspaceId)}`
}

/** The prefix of every Qdrant collection the org owns (§5.3). */
export function qdrantCollectionPrefix(orgId: string): string {
  return `${orgSchema(orgId)}__`
}

/** The org's login-less Postgres role: named like its schema (§5.1). */
export function orgRole(orgId: string): string {
  return orgSchema(orgId)
}

/** A fresh org or workspace id: 12 random base-36 characters. */
export function newTenantId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

/**
 * The org's name in URLs (`/a/{slug}`): lowercase letters, digits and inner
 * hyphens, 2-40 characters. The slug is separate from the id, so a rename never
 * touches the org's schema.
 */
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/

/** Slugs that would shadow an app route or confuse a reader. */
const RESERVED_SLUGS = new Set(['new', 'api', 'admin', 'auth', 'signin', 'signout', 'settings', 'docket', 'platform'])

export function slugProblem(slug: string): string | null {
  if (!SLUG.test(slug)) return 'Use 2-40 lowercase letters, digits or hyphens, starting and ending with a letter or digit.'
  if (slug.includes('--')) return 'Use single hyphens only.'
  if (RESERVED_SLUGS.has(slug)) return 'That name is reserved.'
  return null
}
