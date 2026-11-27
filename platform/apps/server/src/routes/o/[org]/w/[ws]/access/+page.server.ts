// SPDX-License-Identifier: AGPL-3.0-only
import {
  ACCOUNT,
  CAPABILITIES,
  appliesTo,
  capsAt,
  covers,
  docketPlace,
  grantRoleLabel,
  listGrants,
  listMembers,
  listSystemAccounts,
  summarise,
  type Access,
} from '@docket/platform-tenancy'

import { docketNames, grantActions, grantView, placeKey, rolesFor } from '$lib/server/grants'
import { getRuntime } from '$lib/server/runtime'
import { docketAccess } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/**
 * A docket's Access tab (tenancy v2 §3, §8): what you may do here and why.
 * Whoever manages access here (or system accounts) also sees everyone who
 * reaches it - from a grant on the docket, the whole account, or everyone -
 * with why, and gives, adjusts and removes the grants on this docket. A role
 * on the account is changed on the Users page.
 */
export const load: PageServerLoad = async (event) => {
  const { access, workspace } = await docketAccess(event)
  const here = docketPlace(workspace.id)
  const manages = access.can('access') || access.can('system')
  const dockets = await docketNames(access.org.id)
  const { router } = getRuntime()
  const { grants, members, managed } = await router.withPlatform(async (tx) => ({
    grants: manages ? await listGrants(tx, access.org.id) : [],
    members: manages ? await listMembers(tx, access.org.id) : [],
    // The org admin API's own accounts are changed only through it.
    managed: manages ? new Set((await listSystemAccounts(tx, access.org.id)).filter((account) => account.managed).map((account) => account.id)) : new Set<string>(),
  }))
  const view = (grant: (typeof grants)[number]) => grantView(grant, access.principal, dockets, access.org.name)
  const mine = access.principal.grants.filter((grant) => covers(grant.place, here))

  /** Everyone who reaches this docket, with what they may do and which grants say so. */
  const reach = members.flatMap((member) => {
    const principal: Access = {
      userId: member.id,
      kind: member.kind,
      owner: member.owner,
      guest: member.guest,
      grants: grants.filter((grant) => appliesTo(grant, { userId: member.id, kind: member.kind, guest: member.guest })),
    }
    const caps = capsAt(principal, here)
    if (caps.size === 0) return []
    const summary = summarise(caps)
    return [
      {
        id: member.id,
        login: member.login,
        name: member.name,
        kind: member.kind,
        guest: member.guest,
        summary: member.owner ? 'Owner' : summary.label,
        extra: summary.extra,
        caps: CAPABILITIES.filter((cap) => caps.has(cap)),
        because: member.owner
          ? [`Owner of ${access.org.name}`]
          : principal.grants
              .filter((grant) => covers(grant.place, here))
              .map((grant) => `${grantRoleLabel(grant)} on ${grant.place.kind === 'account' ? `${access.org.name} (the whole account)` : 'this docket'}${grant.who.kind === 'everyone' ? ', given to everyone' : ''}`),
      },
    ]
  })

  return {
    you: {
      summary: access.owner ? 'Owner' : summarise(access.caps).label,
      caps: CAPABILITIES.filter((cap) => access.caps.has(cap)),
      because: access.owner
        ? [`You own ${access.org.name}: every capability, everywhere.`]
        : mine.map((grant) => `${grantRoleLabel(grant)} on ${grant.place.kind === 'account' ? `${access.org.name} (the whole account)` : 'this docket'}${grant.who.kind === 'everyone' ? ', given to everyone' : ''}`),
    },
    manages,
    reach,
    onDocket: grants.filter((grant) => grant.place.kind === 'docket' && grant.place.id === workspace.id).map(view),
    onAccount: grants.filter((grant) => grant.place.kind === 'account').map(view),
    roles: manages ? await rolesFor(access.org.id) : [],
    place: { key: placeKey(here), label: `${workspace.name} (docket)` },
    people: [
      ...(access.can('access') ? [{ id: 'everyone', label: `Everyone at ${access.org.name}` }] : []),
      ...members
        .filter((member) => !member.owner && !managed.has(member.id) && (member.kind === 'human' ? access.can('access') : true))
        .map((member) => ({ id: member.id, label: member.kind === 'service' ? `${member.login} (system account)` : `${member.name ?? member.login} (@${member.login})${member.guest ? ', guest' : ''}` })),
    ],
    accountPlace: placeKey(ACCOUNT),
  }
}

// Every change here is to a grant on this docket, by someone who may read it: the docket is checked first,
// and its access reused for the change itself rather than read from the platform a second time.
export const actions: Actions = grantActions({
  at: async (event) => {
    const { access, workspace } = await docketAccess(event)
    return { access, place: docketPlace(workspace.id) }
  },
})
