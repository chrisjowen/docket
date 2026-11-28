// SPDX-License-Identifier: AGPL-3.0-only
import { ACCOUNT, TenancyError, createInvite, placeKey, spacePlace } from '@docket/platform-tenancy'
import { error, type RequestEvent } from '@sveltejs/kit'

import { changeAccess, grantActions, placeNames } from '$lib/server/grants'
import { invitedView } from '$lib/server/invites'
import { placeAccess } from '$lib/server/place-access'
import { spaceAccess } from '$lib/server/spaces'

import type { Actions, PageServerLoad } from './$types'

/**
 * A space's Users & system accounts (tenancy v2 §3, §8): what you may do on
 * the space and why. Whoever manages access here (or system accounts) also
 * sees everyone who reaches it, gives, adjusts and removes the grants on it -
 * a role here covers every docket in the space, including ones added later -
 * and invites people who are not in the account yet straight into it.
 */
export const load: PageServerLoad = async (event) => {
  const { access, space, caps } = await spaceAccess(event)
  const here = spacePlace(space.id)
  const names = await placeNames(access.org.id)
  const page = await placeAccess({ access, here, caps, names })
  return {
    ...page,
    onSpace: page.onHere,
    place: { key: placeKey(here), label: `${space.name} (space)` },
    accountPlace: placeKey(ACCOUNT),
    /** May invite people who are not in the account yet into this space. */
    invites: caps.has('access') && !access.principal.guest,
  }
}

// Every change here is to a grant on this space, by someone who may see it: the space is checked first,
// and its access reused for the change itself rather than read from the platform a second time.
const pinned = async (event: RequestEvent) => {
  const { access, space } = await spaceAccess(event)
  return { access, place: spacePlace(space.id) }
}

export const actions: Actions = {
  ...grantActions({ at: pinned }),

  /** Invites someone new to a role on this space: anyone who manages access here may (tenancy v2 §10, question 10). */
  invite: async (event) => {
    const { access, place } = await pinned(event)
    if (access.principal.guest) error(403, 'You do not have access to that.')
    return changeAccess(
      event,
      async (tx, { userId, form, names }) => {
        const invite = await createInvite(tx, {
          orgId: access.org.id,
          who: String(form.get('who') ?? ''),
          roleId: String(form.get('role') ?? ''),
          place,
          guest: form.get('guest') === 'on',
          actorId: userId,
          actor: access.principal,
        }).catch((cause: unknown) => {
          throw cause instanceof TenancyError && cause.code === 'forbidden' ? new TenancyError('forbidden', 'You can only invite people where you manage access.') : cause
        })
        const to = invite.githubLogin ? `@${invite.githubLogin}` : (invite.email ?? '')
        const spaceName = place.kind === 'space' ? (names.spaces.get(place.id)?.name ?? 'this space') : 'this space'
        return {
          action: 'members.invite',
          target: [`invite:${invite.id}`],
          args: { who: to, role: invite.roleId, place: placeKey(place), guest: invite.guest },
          flash: `Invited ${to} as ${invite.roleName} on ${spaceName}.`,
          after: () => invitedView(event, access.org.name, invite, spaceName),
        }
      },
      access,
    )
  },
}
