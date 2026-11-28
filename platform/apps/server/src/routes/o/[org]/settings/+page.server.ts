// SPDX-License-Identifier: AGPL-3.0-only
import {
  CapError,
  MAX_MONTHLY_CAP_USD,
  PROVIDER_INFO,
  SettingsError,
  capOf,
  placeAiSettings,
  placesWithSettings,
  resolveAiSettings,
  saveAiSettings,
  setCap,
} from '@docket/platform-ai'
import { listSpaces, listWorkspaces } from '@docket/platform-canonical-store'
import { fail, redirect } from '@sveltejs/kit'

import { modelSlots, modelsFrom } from '$lib/server/place-settings'
import { authorise, orgAccess, recordAudit } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { Actions, PageServerLoad } from './$types'

/**
 * The org's settings: its model choices (§11) and which models its spaces and
 * dockets may choose from (tenancy v2 §5), for whoever may change settings on
 * the whole account, and its monthly AI cap, which only an owner sets (§4, as
 * billing). Anyone else who reaches Settings goes straight to the settings
 * they do have: the account's roles.
 */
export const load: PageServerLoad = async (event) => {
  const access = await orgAccess(event)
  if (!access.can('settings')) redirect(303, `/o/${access.org.slug}/settings/roles`)
  const { router, caps } = getRuntime()
  const orgId = access.org.id
  const [status, view, spaces, dockets] = await Promise.all([
    caps.status(orgId),
    router.withPlatform(async (tx) => {
      // One query at a time: they share the transaction.
      const resolved = await resolveAiSettings(tx, orgId)
      const own = await placeAiSettings(tx, orgId, { kind: 'account' })
      const places = await placesWithSettings(tx, orgId)
      const keys = await tx.query<{ space_id: string; provider: keyof typeof PROVIDER_INFO; hint: string }>(
        'SELECT space_id, provider, hint FROM platform.provider_keys WHERE org_id = $1',
        [orgId],
      )
      return { resolved, own, places, keys: keys.rows }
    }),
    router.withTenant(orgId, listSpaces),
    router.withTenant(orgId, listWorkspaces),
  ])
  const docketName = new Map(dockets.map((docket) => [docket.id, { name: docket.name, slug: docket.slug }]))
  const keyOf = new Map(view.keys.map((key) => [key.space_id, `${PROVIDER_INFO[key.provider].label} key …${key.hint}`]))
  // Every space or docket that chose something of its own, or pays with its own key.
  type Override = { kind: 'space' | 'docket'; name: string; slug: string; models: string[]; sliceUsd: number | null; key: string | null }
  const overrides: Override[] = []
  for (const space of spaces) {
    const settings = view.places.find((place) => place.kind === 'space' && place.id === space.id)?.settings
    const key = keyOf.get(space.id) ?? null
    if (!settings && !key) continue
    overrides.push({
      kind: 'space',
      name: space.name,
      slug: space.slug,
      models: Object.values(settings?.models ?? {}).filter((model): model is string => Boolean(model)),
      sliceUsd: settings?.monthlyUsd ?? null,
      key,
    })
  }
  for (const place of view.places) {
    const docket = place.kind === 'docket' ? docketName.get(place.id) : undefined
    if (!docket) continue
    const models = Object.values(place.settings.models).filter((model): model is string => Boolean(model))
    overrides.push({ kind: 'docket', name: docket.name, slug: docket.slug, models, sliceUsd: null, key: null })
  }
  return {
    ai: { capUsd: status.capUsd, spentUsd: status.spentUsd, month: status.month, warnedAt: status.warnedAt?.toISOString() ?? null },
    models: modelSlots(view.resolved, view.own),
    overrides,
    maxCapUsd: MAX_MONTHLY_CAP_USD,
  }
}

export const actions: Actions = {
  /** Sets the models and, for an owner, the cap. The worker moves the org's OpenRouter key limit to match within minutes. */
  ai: async (event) => {
    const access = await orgAccess(event)
    authorise(access, 'settings')
    const form = await event.request.formData()
    if (form.has('cap') && !access.owner) return fail(403, { problem: 'Only an owner of the account sets its monthly AI cap.' })
    const cap = access.owner ? Number(String(form.get('cap') ?? '').trim()) : null
    const { models, allowed } = modelsFrom(form)
    if (!models.cypher || !models.synthesis) return fail(400, { problem: 'Choose models from the list.' })
    const user = event.locals.user
    if (!user) return fail(401, { problem: 'Sign in first.' })
    try {
      await getRuntime().router.withPlatform(async (tx) => {
        const before = cap === null ? null : await capOf(tx, access.org.id)
        if (cap !== null) await setCap(tx, access.org.id, cap, user.id)
        const saved = await saveAiSettings(tx, { orgId: access.org.id, place: { kind: 'account' }, models, allowed, by: user.id })
        await getRuntime().router.enterTenant(tx, access.org.id)
        await recordAudit(tx, event, {
          action: 'ai.settings',
          orgId: access.org.id,
          args: { ...(cap === null ? {} : { before, cap }), cypher: models.cypher, synthesis: models.synthesis, allowed: saved.after.allowed },
        })
      })
    } catch (caught) {
      if (caught instanceof CapError || caught instanceof SettingsError) return fail(400, { problem: caught.message })
      throw caught
    }
    return { flash: cap === null ? `Saved ${access.org.name}'s models.` : `Saved: $${cap.toFixed(2)} a month.` }
  },
}
