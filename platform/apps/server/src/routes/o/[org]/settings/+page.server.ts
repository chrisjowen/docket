// SPDX-License-Identifier: AGPL-3.0-only
import { CapError, MAX_MONTHLY_CAP_USD, capOf, modelAllowlist, modelChoices, setCap, type ModelUse } from '@docket/platform-ai'
import { fail, redirect } from '@sveltejs/kit'

import { authorise, orgAccess, recordAudit } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { Actions, PageServerLoad } from './$types'

/**
 * The org's settings: its monthly AI cap and model choices (§11), owners
 * only (§4). Those who manage access but do not own the account go straight
 * to the settings they do have: System accounts.
 */
export const load: PageServerLoad = async (event) => {
  const access = await orgAccess(event)
  if (!access.can('org.administer') && access.can('members.manage')) redirect(303, `/o/${access.org.slug}/settings/system-accounts`)
  authorise(access, 'org.administer')
  const { router, caps } = getRuntime()
  const [status, models] = await Promise.all([caps.status(access.org.id), router.withPlatform((tx) => modelChoices(tx, access.org.id))])
  return {
    ai: { capUsd: status.capUsd, spentUsd: status.spentUsd, month: status.month, warnedAt: status.warnedAt?.toISOString() ?? null },
    models,
    allowlist: modelAllowlist(),
    maxCapUsd: MAX_MONTHLY_CAP_USD,
  }
}

const isAllowed = (use: ModelUse, model: string) => modelAllowlist()[use].includes(model)

export const actions: Actions = {
  /** Sets the cap and models. The worker moves the org's OpenRouter key limit to match within minutes. */
  ai: async (event) => {
    const access = await orgAccess(event)
    authorise(access, 'org.administer')
    const form = await event.request.formData()
    const cap = Number(String(form.get('cap') ?? '').trim())
    const cypher = String(form.get('cypher') ?? '')
    const synthesis = String(form.get('synthesis') ?? '')
    if (!isAllowed('cypher', cypher) || !isAllowed('synthesis', synthesis)) return fail(400, { problem: 'Choose models from the list.' })
    const user = event.locals.user
    if (!user) return fail(401, { problem: 'Sign in first.' })
    try {
      await getRuntime().router.withPlatform(async (tx) => {
        const before = await capOf(tx, access.org.id)
        await setCap(tx, access.org.id, cap, user.id)
        await tx.query('UPDATE platform.ai_caps SET models = $2 WHERE org_id = $1', [access.org.id, JSON.stringify({ cypher, synthesis })])
        await getRuntime().router.enterTenant(tx, access.org.id)
        await recordAudit(tx, event, { action: 'ai.settings', orgId: access.org.id, args: { before, cap, cypher, synthesis } })
      })
    } catch (caught) {
      if (caught instanceof CapError) return fail(400, { problem: caught.message })
      throw caught
    }
    return { flash: `Saved: $${cap.toFixed(2)} a month.` }
  },
}
