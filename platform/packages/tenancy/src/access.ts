// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import type { Tx } from './db.js'
import { TenancyError } from './model.js'
import {
  BUILTIN_ROLES,
  CAPABILITIES,
  appliesTo,
  grantCaps,
  isCapability,
  mayEditRoles,
  mayGrant,
  type Access,
  type Capability,
  type Grant,
  type Grantee,
  type Place,
  type Role,
} from './roles.js'

/**
 * Roles and grants over the platform schema (tenancy v2 §3.1, platform
 * 0017). Every function runs inside a `withPlatform` transaction. Callers name
 * a docket by a workspace id they have already found in the org's schema.
 */

const BUILTIN = new Map(BUILTIN_ROLES.map((role) => [role.id, role]))

type RoleRow = { id: string; org_id: string | null; name: string; description: string | null; caps: string[] }

function toRole(row: RoleRow): Role {
  // The built-in roles are what this build says they are, whatever the row holds.
  return BUILTIN.get(row.id) ?? { id: row.id, name: row.name, description: row.description, caps: row.caps.filter(isCapability), builtin: false }
}

/** The roles an account can give: the built-in ones, then its own by name. */
export async function rolesOf(tx: Tx, orgId: string): Promise<Role[]> {
  const { rows } = await tx.query<RoleRow>(
    'SELECT id, org_id, name, description, caps FROM platform.roles WHERE org_id = $1 ORDER BY lower(name)',
    [orgId],
  )
  return [...BUILTIN_ROLES, ...rows.map(toRole)]
}

export interface RoleUse extends Role {
  /** How many grants give it. */
  grants: number
}

/** The account's roles, each with how many grants give it. */
export async function listRoles(tx: Tx, orgId: string): Promise<RoleUse[]> {
  const roles = await rolesOf(tx, orgId)
  const { rows } = await tx.query<{ role_id: string; count: string }>(
    'SELECT role_id, count(*) FROM platform.grants WHERE org_id = $1 GROUP BY role_id',
    [orgId],
  )
  const counts = new Map(rows.map((row) => [row.role_id, Number(row.count)]))
  return roles.map((role) => ({ ...role, grants: counts.get(role.id) ?? 0 }))
}

function cleanCaps(values: Iterable<unknown>): Capability[] {
  const wanted = new Set([...values].filter(isCapability))
  return CAPABILITIES.filter((cap) => wanted.has(cap))
}

/**
 * Makes one of the account's own roles, or changes one (`id`): a name and a
 * bundle of capabilities. Changing a role changes it for everyone who holds
 * it. Only an admin on the whole account may; the built-in roles never change.
 */
export async function saveRole(
  tx: Tx,
  input: { orgId: string; id?: string; name: string; description: string | null; caps: Iterable<unknown>; actor: Access; actorId: string },
): Promise<{ role: Role; before: Role | null }> {
  if (!mayEditRoles(input.actor)) throw new TenancyError('forbidden', 'Only an admin on the whole account can change roles.')
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (name.length < 1 || name.length > 60) throw new TenancyError('invalid', 'Name the role in 1-60 characters.')
  if (BUILTIN_ROLES.some((role) => role.name.toLowerCase() === name.toLowerCase())) {
    throw new TenancyError('conflict', `${name} is a built-in role.`)
  }
  const caps = cleanCaps(input.caps)
  if (caps.length === 0) throw new TenancyError('invalid', 'Choose at least one capability.')
  const description = input.description?.trim().slice(0, 200) || null
  try {
    if (input.id) {
      if (BUILTIN.has(input.id)) throw new TenancyError('forbidden', 'The built-in roles cannot be changed.')
      const { rows: old } = await tx.query<RoleRow>(
        'SELECT id, org_id, name, description, caps FROM platform.roles WHERE id = $1 AND org_id = $2 FOR UPDATE',
        [input.id, input.orgId],
      )
      if (!old[0]) throw new TenancyError('not-found', 'No such role.')
      const { rows } = await tx.query<RoleRow>(
        'UPDATE platform.roles SET name = $3, description = $4, caps = $5 WHERE id = $1 AND org_id = $2 RETURNING id, org_id, name, description, caps',
        [input.id, input.orgId, name, description, caps],
      )
      return { role: toRole(rows[0] as RoleRow), before: toRole(old[0]) }
    }
    const { rows } = await tx.query<RoleRow>(
      `INSERT INTO platform.roles (id, org_id, name, description, caps, created_by) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, org_id, name, description, caps`,
      [`r_${randomUUID().replaceAll('-', '')}`, input.orgId, name, description, caps, input.actorId],
    )
    return { role: toRole(rows[0] as RoleRow), before: null }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new TenancyError('conflict', 'A role with that name exists.')
    throw error
  }
}

/** Deletes one of the account's own roles that no grant gives. */
export async function deleteRole(tx: Tx, input: { orgId: string; id: string; actor: Access }): Promise<Role> {
  if (!mayEditRoles(input.actor)) throw new TenancyError('forbidden', 'Only an admin on the whole account can change roles.')
  if (BUILTIN.has(input.id)) throw new TenancyError('forbidden', 'The built-in roles cannot be deleted.')
  const { rows } = await tx.query<RoleRow>(
    'SELECT id, org_id, name, description, caps FROM platform.roles WHERE id = $1 AND org_id = $2 FOR UPDATE',
    [input.id, input.orgId],
  )
  if (!rows[0]) throw new TenancyError('not-found', 'No such role.')
  const used = await tx.query('SELECT 1 FROM platform.grants WHERE role_id = $1 LIMIT 1', [input.id])
  if (used.rowCount) throw new TenancyError('conflict', 'Someone holds this role. Give them another one first.')
  await tx.query('DELETE FROM platform.roles WHERE id = $1 AND org_id = $2', [input.id, input.orgId])
  return toRole(rows[0])
}

// --- Grants -----------------------------------------------------------------------

/** A grant as the app lists it: who it is for, by name, and who gave it. */
export interface GrantView extends Grant {
  orgId: string
  grantee:
    | { kind: 'user'; id: string; login: string; name: string | null; userKind: 'human' | 'service'; guest: boolean; owner: boolean }
    | { kind: 'everyone' }
  grantedByLogin: string | null
  createdAt: Date
}

type GrantRow = {
  id: string
  org_id: string
  principal_id: string | null
  place_kind: 'account' | 'docket'
  place_id: string | null
  role_id: string
  add_caps: string[]
  remove_caps: string[]
  created_at: Date
  login: string | null
  name: string | null
  user_kind: 'human' | 'service' | null
  guest: boolean | null
  owner: boolean | null
  granted_by_login: string | null
}

const GRANT_SELECT = `
  SELECT g.id, g.org_id, g.principal_id, g.place_kind, g.place_id, g.role_id, g.add_caps, g.remove_caps, g.created_at,
         u.login, u.name, u.kind AS user_kind, m.guest, m.owner, b.login AS granted_by_login
    FROM platform.grants g
    LEFT JOIN platform.memberships m ON m.org_id = g.org_id AND m.user_id = g.principal_id
    LEFT JOIN platform.users u ON u.id = g.principal_id
    LEFT JOIN platform.users b ON b.id = g.granted_by`

function toGrant(row: GrantRow, roles: ReadonlyMap<string, Role>): GrantView | null {
  const role = roles.get(row.role_id)
  if (!role) return null
  const place: Place = row.place_kind === 'account' ? { kind: 'account' } : { kind: 'docket', id: row.place_id as string }
  const who: Grantee = row.principal_id ? { kind: 'user', id: row.principal_id } : { kind: 'everyone' }
  return {
    id: row.id,
    orgId: row.org_id,
    who,
    place,
    role,
    add: cleanCaps(row.add_caps),
    remove: cleanCaps(row.remove_caps),
    grantee: row.principal_id
      ? {
          kind: 'user',
          id: row.principal_id,
          login: row.login ?? row.principal_id,
          name: row.name,
          userKind: row.user_kind ?? 'human',
          guest: row.guest ?? false,
          owner: row.owner ?? false,
        }
      : { kind: 'everyone' },
    grantedByLogin: row.granted_by_login,
    createdAt: row.created_at,
  }
}

async function roleMap(tx: Tx, orgId: string): Promise<Map<string, Role>> {
  return new Map((await rolesOf(tx, orgId)).map((role) => [role.id, role]))
}

/** The account's grants: on one place, to one user (theirs only, not everyone's), or all of them. */
export async function listGrants(tx: Tx, orgId: string, filter: { place?: Place; userId?: string } = {}): Promise<GrantView[]> {
  const where = ['g.org_id = $1']
  const params: unknown[] = [orgId]
  if (filter.place) {
    params.push(filter.place.kind)
    where.push(`g.place_kind = $${params.length}`)
    if (filter.place.kind === 'docket') {
      params.push(filter.place.id)
      where.push(`g.place_id = $${params.length}`)
    }
  }
  if (filter.userId) {
    params.push(filter.userId)
    where.push(`g.principal_id = $${params.length}`)
  }
  const { rows } = await tx.query<GrantRow>(
    `${GRANT_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY g.place_kind, (g.principal_id IS NOT NULL), u.kind, lower(u.login), g.created_at`,
    params,
  )
  const roles = await roleMap(tx, orgId)
  return rows.flatMap((row) => toGrant(row, roles) ?? [])
}

/**
 * A principal's access to an account now: their owner and guest flags and
 * every grant that applies to them. Null when they are not a member, or the
 * account is not active. Read on every request, so a grant given or taken
 * away counts from the next one.
 */
export async function accessOf(tx: Tx, orgId: string, userId: string): Promise<Access | null> {
  const { rows } = await tx.query<{ owner: boolean; guest: boolean; kind: 'human' | 'service' }>(
    `SELECT m.owner, m.guest, u.kind FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id
      WHERE m.org_id = $1 AND m.user_id = $2`,
    [orgId, userId],
  )
  const row = rows[0]
  if (!row) return null
  const principal = { userId, kind: row.kind, guest: row.guest }
  const { rows: grants } = await tx.query<GrantRow>(
    `${GRANT_SELECT} WHERE g.org_id = $1 AND (g.principal_id = $2 OR g.principal_id IS NULL)`,
    [orgId, userId],
  )
  const roles = await roleMap(tx, orgId)
  return {
    ...principal,
    owner: row.owner,
    grants: grants.flatMap((grant) => {
      const view = toGrant(grant, roles)
      return view && appliesTo(view, principal) ? [view] : []
    }),
  }
}

/** Whether a member is one the org admin API manages (`org-admin` and its databases' accounts): never changed here. */
async function managedMember(tx: Tx, orgId: string, userId: string): Promise<boolean> {
  const { rows } = await tx.query<{ managed: boolean }>(
    `SELECT ((o.org_admin_id = $2) IS TRUE
             OR EXISTS (SELECT 1 FROM platform.database_accounts d WHERE d.org_id = $1 AND d.user_id = $2)) AS managed
       FROM platform.orgs o WHERE o.id = $1`,
    [orgId, userId],
  )
  return rows[0]?.managed ?? false
}

async function granteeKind(tx: Tx, orgId: string, who: Grantee): Promise<'human' | 'service' | 'everyone'> {
  if (who.kind === 'everyone') return 'everyone'
  const { rows } = await tx.query<{ kind: 'human' | 'service' }>(
    'SELECT u.kind FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id WHERE m.org_id = $1 AND m.user_id = $2',
    [orgId, who.id],
  )
  if (!rows[0]) throw new TenancyError('not-found', 'No such user or system account in this account.')
  if (await managedMember(tx, orgId, who.id)) throw new TenancyError('forbidden', 'That system account is managed through the org admin API.')
  return rows[0].kind
}

async function grantAt(tx: Tx, orgId: string, who: Grantee, place: Place): Promise<GrantView | null> {
  const { rows } = await tx.query<GrantRow>(
    `${GRANT_SELECT} WHERE g.org_id = $1 AND coalesce(g.principal_id, '') = $2 AND g.place_kind = $3 AND coalesce(g.place_id, '') = $4 FOR UPDATE OF g`,
    [orgId, who.kind === 'user' ? who.id : '', place.kind, place.kind === 'docket' ? place.id : ''],
  )
  return rows[0] ? toGrant(rows[0], await roleMap(tx, orgId)) : null
}

async function grantById(tx: Tx, orgId: string, grantId: string): Promise<GrantView | null> {
  const { rows } = await tx.query<GrantRow>(`${GRANT_SELECT} WHERE g.org_id = $1 AND g.id = $2 FOR UPDATE OF g`, [orgId, grantId])
  return rows[0] ? toGrant(rows[0], await roleMap(tx, orgId)) : null
}

/**
 * Gives a user, a system account or everyone a role on a place, adjusted by
 * single capabilities, replacing the grant they already had there. The actor
 * must manage access on the place (or manage system accounts there, for a
 * system account), and may give nothing beyond what they hold there - nor
 * change a grant that already gives more.
 */
export async function setGrant(
  tx: Tx,
  input: { orgId: string; who: Grantee; place: Place; roleId: string; add?: Iterable<unknown>; remove?: Iterable<unknown>; actor: Access; actorId: string },
): Promise<{ grant: GrantView; before: GrantView | null }> {
  const kind = await granteeKind(tx, input.orgId, input.who)
  const role = (await roleMap(tx, input.orgId)).get(input.roleId)
  if (!role) throw new TenancyError('invalid', 'Choose a role.')
  const add = cleanCaps(input.add ?? []).filter((cap) => !role.caps.includes(cap))
  const remove = cleanCaps(input.remove ?? []).filter((cap) => role.caps.includes(cap))
  const caps = grantCaps({ role, add, remove })
  if (caps.length === 0) throw new TenancyError('invalid', 'That grant would give nothing. Remove it instead.')
  if (!mayGrant(input.actor, input.place, caps, kind)) {
    throw new TenancyError('forbidden', 'You can only give access you hold yourself, where you manage access.')
  }
  const before = await grantAt(tx, input.orgId, input.who, input.place)
  if (before && !mayGrant(input.actor, input.place, grantCaps(before), kind)) {
    throw new TenancyError('forbidden', 'That grant gives more than you hold here, so you cannot change it.')
  }
  const id = before?.id ?? `g_${randomUUID()}`
  if (before) {
    await tx.query(
      'UPDATE platform.grants SET role_id = $3, add_caps = $4, remove_caps = $5, granted_by = $6 WHERE org_id = $1 AND id = $2',
      [input.orgId, id, role.id, add, remove, input.actorId],
    )
  } else {
    await tx.query(
      `INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id, add_caps, remove_caps, granted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        input.orgId,
        input.who.kind === 'user' ? input.who.id : null,
        input.place.kind,
        input.place.kind === 'docket' ? input.place.id : null,
        role.id,
        add,
        remove,
        input.actorId,
      ],
    )
  }
  const grant = await grantById(tx, input.orgId, id)
  if (!grant) throw new Error('grant vanished')
  return { grant, before }
}

/** Takes a grant away, as `setGrant` allows changing it. */
export async function removeGrant(tx: Tx, input: { orgId: string; grantId: string; actor: Access }): Promise<GrantView> {
  const grant = await grantById(tx, input.orgId, input.grantId)
  if (!grant) throw new TenancyError('not-found', 'No such grant.')
  const kind = grant.grantee.kind === 'everyone' ? 'everyone' : grant.grantee.userKind
  if (grant.grantee.kind === 'user' && (await managedMember(tx, input.orgId, grant.grantee.id))) {
    throw new TenancyError('forbidden', 'That system account is managed through the org admin API.')
  }
  if (!mayGrant(input.actor, grant.place, grantCaps(grant), kind)) {
    throw new TenancyError('forbidden', 'That grant gives more than you hold here, so you cannot remove it.')
  }
  await tx.query('DELETE FROM platform.grants WHERE org_id = $1 AND id = $2', [input.orgId, input.grantId])
  return grant
}

/** How many owners an account has. */
export async function ownerCount(tx: Tx, orgId: string): Promise<number> {
  const { rows } = await tx.query<{ count: string }>('SELECT count(*) FROM platform.memberships WHERE org_id = $1 AND owner', [orgId])
  return Number(rows[0]?.count ?? 0)
}

/**
 * Makes a person an owner of the account, or no longer one. Only an owner
 * may, and the account always keeps one. A system account is never an owner.
 */
export async function setOwner(tx: Tx, input: { orgId: string; userId: string; owner: boolean; actor: Access }): Promise<boolean> {
  if (!input.actor.owner) throw new TenancyError('forbidden', 'Only an owner can change who owns the account.')
  await tx.query('SELECT 1 FROM platform.orgs WHERE id = $1 FOR UPDATE', [input.orgId])
  const { rows } = await tx.query<{ owner: boolean; kind: string }>(
    `SELECT m.owner, u.kind FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id
      WHERE m.org_id = $1 AND m.user_id = $2 FOR UPDATE OF m`,
    [input.orgId, input.userId],
  )
  const row = rows[0]
  if (!row) throw new TenancyError('not-found', 'No such member.')
  if (row.kind !== 'human') throw new TenancyError('forbidden', 'A system account cannot own the account.')
  if (row.owner && !input.owner && (await ownerCount(tx, input.orgId)) <= 1) {
    throw new TenancyError('last-owner', 'An organisation needs an owner. Make someone else owner first.')
  }
  await tx.query('UPDATE platform.memberships SET owner = $3, guest = guest AND NOT $3 WHERE org_id = $1 AND user_id = $2', [
    input.orgId,
    input.userId,
    input.owner,
  ])
  return row.owner
}
