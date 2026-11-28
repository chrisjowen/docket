// SPDX-License-Identifier: AGPL-3.0-only
import { TenancyError, answerInviteByLink, inviteByLink, inviteLinkAdmits, type Place } from '@docket/platform-tenancy'
import { fail, redirect, type RequestEvent } from '@sveltejs/kit'

import { placeLabel, placeNames, type PlaceNames } from '$lib/server/grants'
import { inviteGives } from '$lib/server/invites'
import { recordAudit, requireUser } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { Actions, PageServerLoad } from './$types'

/**
 * An invite's link (tenancy v2 §6): who invited you to what, and Accept or
 * Decline. Someone not signed in signs in from here and comes back; holding
 * the link is what lets them in, so an invite by email reaches whoever its
 * address belongs to, whatever GitHub knows them by. An invite to a GitHub
 * login is that login's alone. It works once, for 7 days.
 */
export const load: PageServerLoad = async (event) => {
  const link = event.params.link
  const { router } = getRuntime()
  const invite = await router.withPlatform((tx) => inviteByLink(tx, link))
  const user = event.locals.user
  if (!invite) return { invite: null, signedIn: user !== null, next: event.url.pathname }
  const names = await placeNames(invite.orgId)
  return {
    signedIn: user !== null,
    next: event.url.pathname,
    invite: {
      accountName: invite.orgName,
      gives: inviteGives(invite, placeLabel(invite.place, names, invite.orgName)),
      invitedBy: invite.invitedByLogin,
      to: invite.githubLogin ? `@${invite.githubLogin}` : invite.email,
      expiresAt: invite.expiresAt.toISOString(),
      state: invite.state,
      /** Whether the signed-in person may answer it: anyone holding an invite by email, only its login an invite to one. */
      mine: user !== null && inviteLinkAdmits(invite, user.login),
    },
  }
}

/** Where someone lands once they join: the docket, the space, or the account they were invited to. */
function landing(slug: string, place: Place, names: PlaceNames): string {
  if (place.kind === 'docket') {
    const docket = names.dockets.get(place.id)
    if (docket) return `/a/${slug}/d/${docket.slug}/overview`
  }
  if (place.kind === 'space') {
    const space = names.spaces.get(place.id)
    if (space) return `/a/${slug}/s/${space.slug}`
  }
  return `/a/${slug}`
}

async function answer(event: RequestEvent<{ link: string }>, accept: boolean) {
  const user = requireUser(event)
  const { router } = getRuntime()
  try {
    const invite = await router.withPlatform(async (tx) => {
      const answered = await answerInviteByLink(tx, { secret: event.params.link, user, accept })
      // The membership is a platform row; the event belongs in the account's own log.
      await router.enterTenant(tx, answered.orgId)
      await recordAudit(tx, event, {
        action: accept ? 'members.invite.accept' : 'members.invite.decline',
        orgId: answered.orgId,
        target: [`user:${user.id}`, `invite:${answered.id}`],
        args: { via: 'link' },
      })
      return answered
    })
    if (accept) redirect(303, landing(invite.orgSlug, invite.place, await placeNames(invite.orgId)))
    return { declined: invite.orgName }
  } catch (cause) {
    if (cause instanceof TenancyError) return fail(cause.code === 'forbidden' ? 403 : 400, { problem: cause.message })
    throw cause
  }
}

export const actions: Actions = {
  accept: (event) => answer(event, true),
  decline: (event) => answer(event, false),
}
