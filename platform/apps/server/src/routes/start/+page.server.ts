// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_MONTHLY_CAP_USD } from '@docket/platform-ai'
import { audit } from '@docket/platform-audit'
import {
  TenancyError,
  answerInvite,
  countLiveOrgs,
  discardUnprovisionedOrg,
  insertOrg,
  newTenantId,
  openInvitesFor,
  slugProblem,
} from '@docket/platform-tenancy'
import { fail, redirect } from '@sveltejs/kit'

import { placeLabel, placeNames } from '$lib/server/grants'
import { inviteGives } from '$lib/server/invites'
import { auditInput, recordAudit, requireUser } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { Actions, PageServerLoad } from './$types'

/**
 * Signing up, steps 1 and 2 (tenancy v2 §6). Someone not signed in signs in
 * first and comes back. An open invite skips them ahead: they accept it and
 * are in its account. Otherwise they create an account and become its Owner;
 * the page spells out what the account gets. Only people on the beta list
 * may create one (no self-serve sign-up beyond it, §10 question 14).
 */
export const load: PageServerLoad = async (event) => {
  const user = requireUser(event)
  const { router, maxOrgs } = getRuntime()
  const { live, invites } = await router.withPlatform(async (tx) => ({ live: await countLiveOrgs(tx), invites: await openInvitesFor(tx, user) }))
  const named = await Promise.all(
    invites.map(async (invite) => {
      const names = await placeNames(invite.orgId)
      return {
        id: invite.id,
        accountName: invite.orgName,
        gives: inviteGives(invite, placeLabel(invite.place, names, invite.orgName)),
        invitedBy: invite.invitedByLogin,
        expiresAt: invite.expiresAt.toISOString(),
      }
    }),
  )
  return {
    allowlisted: user.allowlisted,
    full: live >= maxOrgs,
    limit: maxOrgs,
    invites: named,
    aiCapUsd: DEFAULT_MONTHLY_CAP_USD,
  }
}

export const actions: Actions = {
  /**
   * Step 2: records the account and its owner, then provisions its stores
   * (§16): the Postgres schema and role, the account migrations and a
   * wrapped data key. General comes with it, where everyone reads. Then
   * step 3.
   */
  create: async (event) => {
    const user = requireUser(event)
    const form = await event.request.formData()
    const name = String(form.get('name') ?? '').trim()
    const slug = String(form.get('slug') ?? '').trim().toLowerCase()
    const values = { name, slug }
    if (!user.allowlisted) return fail(403, { ...values, problem: 'Only people on the beta list can create an account. Ask for an invite to one instead.' })
    if (!name || name.length > 80) return fail(400, { ...values, problem: 'Give the account a name of up to 80 characters.' })
    const problem = slugProblem(slug)
    if (problem) return fail(400, { ...values, problem })

    const { router, provisioner, maxOrgs } = getRuntime()
    const id = newTenantId()
    try {
      await router.withPlatform(async (tx) => {
        await insertOrg(tx, { id, slug, name, ownerId: user.id, maxOrgs })
        await recordAudit(tx, event, { action: 'org.create', orgId: null, target: [`org:${id}`, `slug:${slug}`] })
      })
    } catch (caught) {
      if (caught instanceof TenancyError) return fail(400, { ...values, problem: caught.message })
      throw caught
    }

    try {
      await provisioner.provision({ orgId: id })
    } catch (caught) {
      console.error(`[${event.locals.requestId}] provisioning org ${id}: ${caught instanceof Error ? caught.message : String(caught)}`)
      await router.withPlatform(async (tx) => {
        await discardUnprovisionedOrg(tx, id)
        await audit(tx, auditInput(event, { action: 'org.provision', outcome: 'error', orgId: null, target: [`org:${id}`] }))
      })
      return fail(500, { ...values, problem: 'The account could not be set up. Nothing was kept; try again.' })
    }

    // The first event in the account's own log.
    await router.withTenant(id, (tx) =>
      audit(tx, auditInput(event, { action: 'org.provision', outcome: 'ok', orgId: id, target: [`org:${id}`] })),
    )
    redirect(303, `/a/${slug}/start/space`)
  },

  /** An open invite skips ahead (step 1): accepting it lands in its account. */
  accept: async (event) => {
    const user = requireUser(event)
    const inviteId = String((await event.request.formData()).get('invite') ?? '')
    const { router } = getRuntime()
    let slug: string
    try {
      slug = await router.withPlatform(async (tx) => {
        const answered = await answerInvite(tx, { inviteId, user, accept: true })
        await router.enterTenant(tx, answered.orgId)
        await recordAudit(tx, event, { action: 'members.invite.accept', orgId: answered.orgId, target: [`user:${user.id}`, `invite:${answered.id}`] })
        return answered.orgSlug
      })
    } catch (caught) {
      if (caught instanceof TenancyError) return fail(400, { problem: caught.message })
      throw caught
    }
    redirect(303, `/a/${slug}`)
  },
}
