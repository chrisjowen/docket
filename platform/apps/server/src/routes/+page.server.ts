// SPDX-License-Identifier: AGPL-3.0-only
import { TenancyError, answerInvite, openInvitesFor } from '@docket/platform-tenancy'
import { fail, redirect } from '@sveltejs/kit'

import { recordAudit, requireUser } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { Actions, PageServerLoad } from './$types'

/** `/` is the home page for someone signed in; a visitor is sent to sign in. */
export const load: PageServerLoad = async (event) => {
  const user = event.locals.user
  if (!user) redirect(303, '/signin')
  const invites = await getRuntime().router.withPlatform((tx) => openInvitesFor(tx, user))
  return {
    view: 'home' as const,
    invites: invites.map((invite) => ({
      id: invite.id,
      orgName: invite.orgName,
      orgSlug: invite.orgSlug,
      // What they get: a role on the account or on one docket (they see which once they are in).
      role: invite.owner ? 'Owner' : `${invite.roleName}${invite.place.kind === 'docket' ? ' on one docket' : ''}${invite.guest ? ', as a guest' : ''}`,
      invitedByLogin: invite.invitedByLogin,
      expiresAt: invite.expiresAt.toISOString(),
    })),
  }
}

async function answer(event: Parameters<Actions[string]>[0], accept: boolean) {
  const user = requireUser(event)
  const inviteId = String((await event.request.formData()).get('invite') ?? '')
  const { router } = getRuntime()
  try {
    const invite = await router.withPlatform(async (tx) => {
      const answered = await answerInvite(tx, { inviteId, user, accept })
      // The membership is a platform row; the event belongs in the org's own log.
      await router.enterTenant(tx, answered.orgId)
      await recordAudit(tx, event, {
        action: accept ? 'members.invite.accept' : 'members.invite.decline',
        orgId: answered.orgId,
        target: [`user:${user.id}`, `invite:${answered.id}`],
      })
      return answered
    })
    if (accept) redirect(303, `/o/${invite.orgSlug}`)
    return { declined: invite.orgName }
  } catch (error) {
    if (error instanceof TenancyError) return fail(400, { problem: error.message })
    throw error
  }
}

export const actions: Actions = {
  accept: (event) => answer(event, true),
  decline: (event) => answer(event, false),
}
