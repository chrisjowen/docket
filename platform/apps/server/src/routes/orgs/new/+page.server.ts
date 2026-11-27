// SPDX-License-Identifier: AGPL-3.0-only
import { audit } from '@docket/platform-audit'
import {
  TenancyError,
  countLiveOrgs,
  discardUnprovisionedOrg,
  insertOrg,
  newTenantId,
  slugProblem,
} from '@docket/platform-tenancy'
import { error, fail, redirect } from '@sveltejs/kit'

import { auditInput, recordAudit, requireUser } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async (event) => {
  const user = requireUser(event)
  if (!user.allowlisted) error(403, 'Only accounts on the beta list can create an organisation.')
  const { router, maxOrgs } = getRuntime()
  const live = await router.withPlatform(countLiveOrgs)
  return { full: live >= maxOrgs, limit: maxOrgs }
}

export const actions: Actions = {
  /**
   * Records the org and its owner, then provisions its stores (§16): the
   * Postgres schema and role, the org migrations and a wrapped data key.
   */
  default: async (event) => {
    const user = requireUser(event)
    if (!user.allowlisted) error(403, 'Only accounts on the beta list can create an organisation.')
    const form = await event.request.formData()
    const name = String(form.get('name') ?? '').trim()
    const slug = String(form.get('slug') ?? '').trim().toLowerCase()
    const values = { name, slug }
    if (!name || name.length > 80) return fail(400, { ...values, problem: 'Give the organisation a name of up to 80 characters.' })
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
      return fail(500, { ...values, problem: 'The organisation could not be set up. Nothing was kept; try again.' })
    }

    // The first event in the org's own log.
    await router.withTenant(id, (tx) =>
      audit(tx, auditInput(event, { action: 'org.provision', outcome: 'ok', orgId: id, target: [`org:${id}`] })),
    )
    redirect(303, `/o/${slug}/members`)
  },
}
