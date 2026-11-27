// SPDX-License-Identifier: AGPL-3.0-only

/**
 * For unit tests that fake the database: the rows the platform's access
 * queries (`membershipBySlug`, `accessOf`, `rolesOf`) answer for a member who
 * holds one built-in role on the whole account, or owns it. Undefined for any
 * other query, which the test answers itself.
 */
export type FakeRole = 'owner' | 'admin' | 'writer' | 'reader'

/** The built-in role each of the old per-org roles became (platform 0017), so a test may still say `editor`. */
const AS_ROLE: Record<string, FakeRole> = { owner: 'owner', admin: 'admin', editor: 'writer', viewer: 'reader', writer: 'writer', reader: 'reader' }

export function accessRows(sql: string, named: string | null, ids: { orgId?: string; userId?: string } = {}): unknown[] | undefined {
  const role = named ? (AS_ROLE[named] ?? null) : null
  const orgId = ids.orgId ?? 'orgacme'
  const userId = ids.userId ?? 'u1'
  if (sql.includes('FROM platform.orgs o JOIN platform.memberships m')) {
    return role ? [{ id: orgId, slug: 'acme', name: 'Acme', status: 'active', owner: role === 'owner', guest: false }] : []
  }
  if (sql.includes('FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id') && sql.includes('m.owner, m.guest, u.kind')) {
    return role ? [{ owner: role === 'owner', guest: false, kind: 'human' }] : []
  }
  if (sql.includes('FROM platform.grants g')) {
    return role && role !== 'owner'
      ? [
          {
            id: 'g1',
            org_id: orgId,
            principal_id: userId,
            place_kind: 'account',
            place_id: null,
            role_id: role,
            add_caps: [],
            remove_caps: [],
            created_at: new Date(0),
            login: 'u1',
            name: null,
            user_kind: 'human',
            guest: false,
            owner: false,
            granted_by_login: null,
          },
        ]
      : []
  }
  if (sql.includes('FROM platform.roles WHERE org_id')) return []
  return undefined
}
