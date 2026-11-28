// SPDX-License-Identifier: AGPL-3.0-only
import type { z } from 'zod'

import type * as Wire from '@docket/api'
import { accountMcpUrl, mcpResourceUrl, type ApiTokenRecord, type OAuthConnection } from '@docket/platform-auth'
import type { Space as StoreSpace, Workspace } from '@docket/platform-canonical-store'
import {
  ACCOUNT,
  CAPABILITIES,
  docketPlace,
  grantCaps,
  grantRoleLabel,
  mayGrant,
  spacePlace,
  type Access,
  type Capability,
  type GrantView,
  type Invite as StoreInvite,
  type Member as StoreMember,
  type Org,
  type Place,
  type Role as StoreRole,
} from '@docket/platform-tenancy'

import type { PlaceNames } from '../grants'
import { getRuntime } from '../runtime'
import { ApiFailure } from './caller'

/**
 * The records `/api/v1` answers with, from the stores' own (the schemas in
 * `@docket/api`): snake_case, ISO timestamps, places and dockets by slug with
 * their ids, and never a token's text but once, when it is issued.
 */

type Out<T extends z.ZodType> = z.output<T>

const iso = (date: Date | null) => (date ? date.toISOString() : null)
const capList = (caps: Iterable<Capability>): Capability[] => {
  const held = new Set(caps)
  return CAPABILITIES.filter((cap) => held.has(cap))
}

/** A place as the API names it in a request: `account`, `space:<slug>`, `docket:<slug>`. */
export function placeFromRef(ref: string, names: PlaceNames): Place {
  if (ref === 'account') return ACCOUNT
  const [kind, slug] = ref.split(':') as [string, string]
  if (kind === 'space') {
    for (const [id, space] of names.spaces) if (space.slug === slug) return spacePlace(id)
  } else if (kind === 'docket') {
    for (const [id, docket] of names.dockets) if (docket.slug === slug) return docketPlace(id)
  }
  throw new ApiFailure('not_found', `No such ${kind}: ${slug}.`)
}

export function placeView(place: Place, names: PlaceNames, org: Pick<Org, 'name'>): Out<typeof Wire.Place> {
  if (place.kind === 'account') return { kind: 'account', id: null, slug: null, name: org.name, ref: 'account' }
  const found = place.kind === 'space' ? names.spaces.get(place.id) : names.dockets.get(place.id)
  const slug = found?.slug ?? null
  return {
    kind: place.kind,
    id: place.id,
    slug,
    name: found?.name ?? `A deleted ${place.kind}`,
    ref: `${place.kind}:${slug ?? place.id}`,
  }
}

export const roleView = (role: StoreRole & { grants?: number }): Out<typeof Wire.Role> => ({
  id: role.id,
  name: role.name,
  description: role.description,
  caps: capList(role.caps),
  builtin: role.builtin,
  grants: role.grants ?? 0,
})

/** A role a request names: by id (`reader`, `r_...`) or by name, case aside. */
export function roleFrom(ref: string, roles: readonly StoreRole[]): StoreRole {
  const found = roles.find((role) => role.id === ref) ?? roles.find((role) => role.name.toLowerCase() === ref.trim().toLowerCase())
  if (!found) throw new ApiFailure('invalid_request', `No such role: ${ref}. Roles are ${roles.map((role) => role.name).join(', ')}.`)
  return found
}

export function grantView(grant: GrantView, viewer: Access, names: PlaceNames, org: Pick<Org, 'name'>): Out<typeof Wire.Grant> {
  const caps = grantCaps(grant)
  const kind = grant.grantee.kind === 'everyone' ? 'everyone' : grant.grantee.userKind
  return {
    id: grant.id,
    who:
      grant.grantee.kind === 'everyone'
        ? { kind: 'everyone', name: `Everyone at ${org.name}` }
        : {
            kind: grant.grantee.userKind === 'service' ? 'system' : 'user',
            id: grant.grantee.id,
            login: grant.grantee.login,
            name: grant.grantee.name,
            guest: grant.grantee.guest,
          },
    place: placeView(grant.place, names, org),
    role: { id: grant.role.id, name: grant.role.name },
    add: [...grant.add],
    remove: [...grant.remove],
    caps,
    label: grantRoleLabel(grant),
    granted_by: grant.grantedByLogin,
    created_at: grant.createdAt.toISOString(),
    may_change: mayGrant(viewer, grant.place, caps, kind),
  }
}

export function accountView(org: Org, access: Access, caps: ReadonlySet<Capability>, membership: { owner: boolean; guest: boolean }): Out<typeof Wire.Account> {
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    owner: membership.owner,
    guest: membership.guest,
    caps: capList(access.owner ? CAPABILITIES : caps),
    mcp_url: accountMcpUrl(getRuntime().origin, org.slug),
  }
}

export const spaceView = (space: StoreSpace, caps: ReadonlySet<Capability>): Out<typeof Wire.Space> => ({
  id: space.id,
  slug: space.slug,
  name: space.name,
  description: space.description,
  general: space.general,
  caps: capList(caps),
})

export function docketView(org: Pick<Org, 'slug'>, workspace: Workspace, names: PlaceNames, caps: ReadonlySet<Capability>): Out<typeof Wire.Docket> {
  const space = names.spaces.get(workspace.spaceId)
  return {
    id: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
    space: { id: workspace.spaceId, slug: space?.slug ?? workspace.spaceId, name: space?.name ?? '' },
    caps: capList(caps),
    created_at: workspace.createdAt.toISOString(),
    mcp_url: mcpResourceUrl(getRuntime().origin, org.slug, workspace.slug),
  }
}

export const memberView = (member: StoreMember, role: string): Out<typeof Wire.Member> => ({
  id: member.id,
  login: member.login,
  name: member.name,
  kind: member.kind,
  owner: member.owner,
  guest: member.guest,
  role,
  joined_at: member.joinedAt.toISOString(),
})

export const inviteView = (invite: StoreInvite, names: PlaceNames, org: Pick<Org, 'name'>): Out<typeof Wire.Invite> => ({
  id: invite.id,
  to: invite.githubLogin ?? invite.email ?? '',
  role: { id: invite.roleId, name: invite.roleName },
  place: placeView(invite.place, names, org),
  guest: invite.guest,
  owner: invite.owner,
  invited_by: invite.invitedByLogin,
  created_at: invite.createdAt.toISOString(),
  expires_at: invite.expiresAt.toISOString(),
  emailed: invite.emailedAt !== null,
  emailed_to: invite.emailedTo,
})

type DocketRef = { id: string; slug: string; name: string }
const refs = (ids: readonly string[] | null, names: PlaceNames): DocketRef[] | null =>
  ids === null ? null : ids.map((id) => ({ id, slug: names.dockets.get(id)?.slug ?? id, name: names.dockets.get(id)?.name ?? 'A deleted docket' }))

export const tokenView = (token: ApiTokenRecord, names: PlaceNames, now = Date.now()): Out<typeof Wire.Token> => ({
  id: token.id,
  prefix: token.prefix,
  name: token.description,
  owner: token.ownerKind === 'service' ? token.ownerLogin : `@${token.ownerLogin}`,
  owner_kind: token.ownerKind,
  read_only: token.readOnly,
  dockets: refs(token.dockets, names),
  created_at: token.createdAt.toISOString(),
  expires_at: token.expiresAt.toISOString(),
  last_used_at: iso(token.lastUsedAt),
  status: token.revokedAt ? 'revoked' : token.expiresAt.getTime() <= now ? 'expired' : 'live',
})

export const connectionView = (connection: OAuthConnection, names: PlaceNames): Out<typeof Wire.Connection> => ({
  id: connection.id,
  name: connection.name,
  client: connection.clientName ?? connection.clientId,
  client_id: connection.clientId,
  read_only: connection.readOnly,
  dockets: refs(connection.dockets, names),
  created_at: connection.createdAt.toISOString(),
  last_used_at: iso(connection.lastUsedAt),
  expires_at: iso(connection.expiresAt),
})

/** The dockets a token or connection names, by slug, as ids: each must be one of the account's. */
export function docketIds(slugs: readonly string[] | null | undefined, names: PlaceNames): string[] | null {
  if (slugs === null || slugs === undefined) return null
  return slugs.map((slug) => {
    for (const [id, docket] of names.dockets) if (docket.slug === slug) return id
    throw new ApiFailure('not_found', `No such docket: ${slug}.`)
  })
}
