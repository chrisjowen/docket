// SPDX-License-Identifier: AGPL-3.0-only
import {
  CAPABILITIES,
  appliesTo,
  capsAt,
  covers,
  grantRoleLabel,
  listGrants,
  listMembers,
  listSystemAccounts,
  placeKey,
  summarise,
  type Access,
  type Capability,
  type Grant,
  type Place,
} from '@docket/platform-tenancy'

import { grantView, rolesFor, type PlaceNames } from './grants'
import type { OrgAccess } from './request'
import { getRuntime } from './runtime'

/**
 * What a docket's or a space's access page shows (tenancy v2 §3, §8): what
 * the viewer may do there and why; and, for whoever manages access (or
 * system accounts) there, everyone who reaches it and why, the grants on it,
 * and the grants on the bigger places that cover it.
 */

/** Why a grant reaches `here`, in words: "Writer on Engineering (space), given to everyone". */
export function becauseLabel(grant: Grant, here: Place, names: PlaceNames, orgName: string): string {
  const where =
    grant.place.kind === 'account'
      ? `${orgName} (the whole account)`
      : grant.place.kind === here.kind && grant.place.id === (here as { id: string }).id
        ? `this ${here.kind}`
        : grant.place.kind === 'space'
          ? `${names.spaces.get(grant.place.id)?.name ?? 'a space'} (space)`
          : `${names.dockets.get(grant.place.id)?.name ?? 'a docket'} (docket)`
  return `${grantRoleLabel(grant)} on ${where}${grant.who.kind === 'everyone' ? ', given to everyone' : ''}`
}

export async function placeAccess(input: { access: OrgAccess; here: Place; caps: ReadonlySet<Capability>; names: PlaceNames }) {
  const { access, here, caps, names } = input
  const org = access.org
  const manages = caps.has('access') || caps.has('system')
  const { grants, members, managed } = await getRuntime().router.withPlatform(async (tx) => ({
    grants: manages ? await listGrants(tx, org.id) : [],
    members: manages ? await listMembers(tx, org.id) : [],
    // The org admin API's own accounts are changed only through it.
    managed: manages ? new Set((await listSystemAccounts(tx, org.id)).filter((account) => account.managed).map((account) => account.id)) : new Set<string>(),
  }))
  const spaces = access.principal.spaces
  const view = (grant: (typeof grants)[number]) => grantView(grant, access.principal, names, org.name)
  const why = (grant: Grant) => becauseLabel(grant, here, names, org.name)

  /** Everyone who reaches this place, with what they may do and which grants say so. */
  const reach = members.flatMap((member) => {
    const principal: Access = {
      userId: member.id,
      kind: member.kind,
      owner: member.owner,
      guest: member.guest,
      grants: grants.filter((grant) => appliesTo(grant, { userId: member.id, kind: member.kind, guest: member.guest })),
      ...(spaces ? { spaces } : {}),
    }
    const held = capsAt(principal, here)
    if (held.size === 0) return []
    const summary = summarise(held)
    return [
      {
        id: member.id,
        login: member.login,
        name: member.name,
        kind: member.kind,
        guest: member.guest,
        summary: member.owner ? 'Owner' : summary.label,
        extra: summary.extra,
        caps: CAPABILITIES.filter((cap) => held.has(cap)),
        because: member.owner ? [`Owner of ${org.name}`] : principal.grants.filter((grant) => covers(grant.place, here, spaces)).map(why),
      },
    ]
  })

  const onHere = grants.filter((grant) => placeKey(grant.place) === placeKey(here))
  // The bigger places that cover this one: the account, and for a docket its space.
  const spaceId = here.kind === 'docket' ? names.dockets.get(here.id)?.spaceId : undefined
  const space = spaceId ? names.spaces.get(spaceId) : undefined
  const readOnly = (list: typeof grants) => list.map((grant) => ({ ...view(grant), mayChange: false }))

  return {
    you: {
      summary: access.owner ? 'Owner' : summarise(caps).label,
      caps: CAPABILITIES.filter((cap) => caps.has(cap)),
      because: access.owner
        ? [`You own ${org.name}: every capability, everywhere.`]
        : access.principal.grants.filter((grant) => covers(grant.place, here, spaces)).map(why),
    },
    manages,
    reach,
    onHere: onHere.map(view),
    /** Grants on the space this docket is in, which cover it too; changed on the space's own page. */
    fromSpace:
      spaceId && space
        ? { id: spaceId, slug: space.slug, name: space.name, grants: readOnly(grants.filter((grant) => grant.place.kind === 'space' && grant.place.id === spaceId)) }
        : null,
    onAccount: readOnly(grants.filter((grant) => grant.place.kind === 'account')),
    roles: manages ? await rolesFor(org.id) : [],
    people: [
      ...(caps.has('access') ? [{ id: 'everyone', label: `Everyone at ${org.name}` }] : []),
      ...members
        .filter((member) => !member.owner && !managed.has(member.id) && (member.kind === 'human' ? caps.has('access') : true))
        .map((member) => ({
          id: member.id,
          label: member.kind === 'service' ? `${member.login} (system account)` : `${member.name ?? member.login} (@${member.login})${member.guest ? ', guest' : ''}`,
        })),
    ],
  }
}
