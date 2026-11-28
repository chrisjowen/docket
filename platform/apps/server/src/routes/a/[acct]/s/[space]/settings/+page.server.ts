// SPDX-License-Identifier: AGPL-3.0-only
import {
  PROVIDERS,
  PROVIDER_INFO,
  ProviderKeyError,
  SettingsError,
  isProvider,
  placeAiSettings,
  providerKeyInfo,
  resolveAiSettings,
  saveAiSettings,
} from '@docket/platform-ai'
import { listWorkspaces } from '@docket/platform-canonical-store'
import type { Tx } from '@docket/platform-tenancy'
import { error, fail, type RequestEvent } from '@sveltejs/kit'

import { askOwnGraph, giveUpOwnGraph, keyView, modelSlots, modelsFrom, podsOnBox, setSpaceKey, spaceKeys } from '$lib/server/place-settings'
import { recordAudit } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { spaceAccess } from '$lib/server/spaces'

import type { Actions, PageServerLoad } from './$types'

/**
 * A space's Settings (tenancy v2 §5): the models its dockets run on, its
 * slice of the account's monthly AI cap, its own provider key, and where its
 * dockets' graph and vectors live - the account's Neo4j or the space's own
 * instance (one more pod on the box), and a Qdrant collection per docket.
 * Whoever may change settings on the space (the capability, on the space or
 * the whole account) sees and changes them; everything they choose stays
 * within what the account allows.
 */
async function settingsAccess(event: RequestEvent) {
  const found = await spaceAccess(event)
  if (!found.caps.has('settings')) error(403, 'Changing settings here needs the Change settings capability on this space.')
  return found
}

type StoreRow = { id: string; status: string; last_error: string | null; requested_by: string | null; login: string | null; created_at: Date }

export const load: PageServerLoad = async (event) => {
  const { access, space } = await settingsAccess(event)
  const { router, caps } = getRuntime()
  const orgId = access.org.id
  const dockets = (await router.withTenant(orgId, listWorkspaces)).filter((workspace) => workspace.spaceId === space.id)
  const view = await router.withPlatform(async (tx) => {
    // One query at a time: they share the transaction.
    const resolved = await resolveAiSettings(tx, orgId, { spaceId: space.id })
    const own = await placeAiSettings(tx, orgId, { kind: 'space', id: space.id })
    const key = await providerKeyInfo(tx, orgId, space.id)
    const pods = await podsOnBox(tx)
    const keyBy = key?.createdBy
      ? ((await tx.query<{ login: string }>('SELECT login FROM platform.users WHERE id = $1', [key.createdBy])).rows[0]?.login ?? null)
      : null
    const graph = (
      await tx.query<StoreRow>(
        `SELECT s.id, s.status, s.last_error, s.requested_by, u.login, s.created_at FROM platform.stores s
           LEFT JOIN platform.users u ON u.id = s.requested_by
          WHERE s.org_id = $1 AND s.kind = 'neo4j' AND s.space_id = $2`,
        [orgId, space.id],
      )
    ).rows[0]
    const shared = dockets.length
      ? Number(
          (
            await tx.query<{ count: string }>(
              `SELECT count(*) FROM platform.docket_stores d JOIN platform.stores s ON s.id = d.store_id
                WHERE d.org_id = $1 AND d.kind = 'qdrant' AND s.docket_id IS NULL AND d.docket_id = ANY($2)`,
              [orgId, dockets.map((each) => each.id)],
            )
          ).rows[0]?.count ?? 0,
        )
      : 0
    return { resolved, own, key: keyView(key, keyBy), pods, graph, shared }
  })
  const spend = await caps.spaceStatus(orgId, space.id)
  const accountCap = await caps.status(orgId)
  return {
    models: modelSlots(view.resolved, view.own),
    key: view.key,
    providers: PROVIDERS.map((id) => ({ id, label: PROVIDER_INFO[id].label })),
    budget: {
      sliceUsd: view.own.monthlyUsd,
      effectiveUsd: view.resolved.caps.spaceUsd,
      accountCapUsd: view.resolved.caps.accountUsd,
      spentUsd: spend.spentUsd,
      accountSpentUsd: accountCap.spentUsd,
      month: spend.month,
    },
    storage: {
      graph: view.graph
        ? {
            status: view.graph.status,
            lastError: view.graph.last_error,
            requestedBy: view.graph.login,
            requestedAt: view.graph.created_at.toISOString(),
          }
        : null,
      pods: view.pods,
      dockets: dockets.length,
      sharedCollection: view.shared,
    },
  }
}

/** Runs a change on the platform schema and records it in the org's audit log, in one transaction. */
async function change<T>(
  event: RequestEvent,
  orgId: string,
  fn: (tx: Tx, userId: string) => Promise<{ audit: { action: string; args: unknown }; result: T }>,
): Promise<T> {
  const user = event.locals.user
  if (!user) error(401, 'Sign in first.')
  const { router } = getRuntime()
  return router.withPlatform(async (tx) => {
    const { audit, result } = await fn(tx, user.id)
    await router.enterTenant(tx, orgId)
    await recordAudit(tx, event, { action: audit.action, orgId, args: audit.args })
    return result
  })
}

const money = (value: number) => `$${value.toFixed(2)}`

export const actions: Actions = {
  /** The space's models, what its dockets may choose from, and its slice of the account's cap. */
  models: async (event) => {
    const { access, space } = await settingsAccess(event)
    const form = await event.request.formData()
    const { models, allowed } = modelsFrom(form)
    const rawSlice = String(form.get('slice') ?? '').trim()
    const slice = rawSlice === '' ? null : Number(rawSlice)
    if (slice !== null && !Number.isFinite(slice)) return fail(400, { problem: 'Give the monthly slice in US dollars, or leave it empty.' })
    try {
      await change(event, access.org.id, async (tx, userId) => {
        const saved = await saveAiSettings(tx, { orgId: access.org.id, place: { kind: 'space', id: space.id }, models, allowed, monthlyUsd: slice, by: userId })
        return { audit: { action: 'space.settings', args: { space: space.id, before: saved.before, after: saved.after } }, result: saved }
      })
    } catch (caught) {
      if (caught instanceof SettingsError) return fail(400, { problem: caught.message })
      throw caught
    }
    return { flash: slice === null ? `Saved ${space.name}'s models.` : `Saved ${space.name}'s models and its ${money(slice)} monthly slice.` }
  },

  /** Gives the space its own provider key: its dockets' calls go on it from the next one. */
  setKey: async (event) => {
    const { access, space } = await settingsAccess(event)
    const form = await event.request.formData()
    const provider = String(form.get('provider') ?? '')
    const key = String(form.get('key') ?? '')
    if (!isProvider(provider)) return fail(400, { problem: 'Choose OpenRouter, Anthropic or OpenAI.' })
    try {
      const saved = await change(event, access.org.id, async (tx, userId) => {
        const info = await setSpaceKey(tx, { orgId: access.org.id, orgName: access.org.name, spaceId: space.id, provider, key, by: userId })
        // Only the provider and the last four characters: never the key.
        return { audit: { action: 'space.key.set', args: { space: space.id, provider, hint: info.hint } }, result: info }
      })
      return { flash: `${space.name} now pays for AI with its own ${PROVIDER_INFO[saved.provider].label} key (…${saved.hint}).` }
    } catch (caught) {
      if (caught instanceof ProviderKeyError) return fail(400, { problem: caught.message })
      throw caught
    }
  },

  /** Removes the space's own key: its dockets' calls go on the account's again. */
  removeKey: async (event) => {
    const { access, space } = await settingsAccess(event)
    const removed = await change(event, access.org.id, async (tx) => {
      const before = await spaceKeys().remove(tx, { orgId: access.org.id, spaceId: space.id })
      return { audit: { action: 'space.key.remove', args: { space: space.id, provider: before?.provider ?? null, hint: before?.hint ?? null } }, result: before }
    })
    return { flash: removed ? `${space.name} pays for AI on ${access.org.name}'s key again.` : `${space.name} had no key of its own.` }
  },

  /** Asks for the space's own Neo4j instance: one more pod on the box, made by the worker; the space's dockets move once it is up. */
  ownGraph: async (event) => {
    const { access, space } = await settingsAccess(event)
    const outcome = await change(event, access.org.id, async (tx, userId) => {
      const asked = await askOwnGraph(tx, access.org.id, space.id, userId)
      const args = asked === 'requested' ? { space: space.id, kind: 'neo4j' } : { space: space.id, outcome: asked }
      return { audit: { action: 'space.store.add', args }, result: asked }
    })
    if (outcome === 'full') return fail(409, { problem: 'There is no room for another Neo4j pod on this box. Ask whoever runs Docket for more room.' })
    if (outcome === 'exists') return { flash: `${space.name} already has its own Neo4j.` }
    return {
      flash: `Asked for ${space.name}'s own Neo4j. Its dockets move there, and are rebuilt from their records, once it is up - usually within a few minutes.`,
    }
  },

  /** Gives up the space's own Neo4j: its dockets move back to the account's, then the pod is removed. */
  sharedGraph: async (event) => {
    const { access, space } = await settingsAccess(event)
    const moved = await change(event, access.org.id, async (tx) => ({
      audit: { action: 'space.store.remove', args: { space: space.id, kind: 'neo4j' } },
      result: await giveUpOwnGraph(tx, access.org.id, space.id),
    }))
    return {
      flash: moved
        ? `${space.name}'s dockets go back to ${access.org.name}'s Neo4j and are rebuilt there; then its own pod is removed.`
        : `${space.name} uses ${access.org.name}'s Neo4j already.`,
    }
  },
}
