// SPDX-License-Identifier: AGPL-3.0-only
import type { PlaceSettings } from '@docket/api'
import {
  MODEL_USES,
  MODEL_USE_INFO,
  capOf,
  placeAiSettings,
  resolveAiSettings,
  type ModelUse,
  type PlaceAiSettings,
  type SaveAiSettings,
} from '@docket/platform-ai'
import { cogneeSettings } from '@docket/platform-canonical-store'
import { enrichmentSettings } from '@docket/platform-enrichment'
import type { Org } from '@docket/platform-tenancy'
import type { z } from 'zod'

import type { PlaceNames } from '../grants'
import { spaceGraph } from '../place-settings'
import { getRuntime } from '../runtime'
import { ApiFailure } from './caller'

/**
 * Storage and AI settings on `/api/v1` (tenancy v2 §3.5, §5): what a place's
 * settings read as, and how a partial change merges onto what the place
 * chose before. Saving goes through the settings resolver
 * (`saveAiSettings`), which keeps every choice within the limits of the
 * places above it. A space's own provider key is write-only: only its
 * provider and last four characters are ever answered.
 */

/** The place whose settings a call reads or changes. */
export type SettingsPlace = { kind: 'account' } | { kind: 'space'; id: string } | { kind: 'docket'; id: string }

type Models = Partial<Record<ModelUse, string | null>>
type Limits = Partial<Record<ModelUse, readonly string[] | null>>

/**
 * A place's own models and limits after a partial change: a use the request
 * leaves out keeps the place's own choice, null clears it.
 */
export function mergedModels(own: PlaceAiSettings, body: { models?: unknown; allowed?: unknown }): Pick<SaveAiSettings, 'models' | 'allowed'> {
  const sentModels = (body.models ?? {}) as Models
  const sentLimits = (body.allowed ?? {}) as Limits
  const models: Models = {}
  const allowed: Limits = {}
  for (const use of MODEL_USES) {
    models[use] = sentModels[use] === undefined ? (own.models[use] ?? null) : sentModels[use]
    allowed[use] = sentLimits[use] === undefined ? (own.allowed[use] ?? null) : sentLimits[use]
  }
  return { models, allowed }
}

/** Whether a request changes anything: a body with nothing in it is refused rather than answered as a change. */
export function nothingSent(body: Record<string, unknown>): boolean {
  return Object.values(body).every((value) => value === undefined)
}

export function requireChange(body: Record<string, unknown>): void {
  if (nothingSent(body)) throw new ApiFailure('invalid_request', 'Send at least one setting to change.')
}

/** A place's settings, as `PlaceSettings` answers them. */
export async function settingsView(
  org: Pick<Org, 'id' | 'name'>,
  place: SettingsPlace,
  names: PlaceNames,
): Promise<z.output<typeof PlaceSettings>> {
  const { router, cognee } = getRuntime()
  const at = place.kind === 'space' ? { spaceId: place.id } : place.kind === 'docket' ? { docketId: place.id } : {}
  const read = await router.withPlatform(async (tx) => {
    // One query at a time: they share the transaction.
    const resolved = await resolveAiSettings(tx, org.id, at)
    const own = await placeAiSettings(tx, org.id, place.kind === 'account' ? { kind: 'account' } : { kind: place.kind, id: place.id })
    const capUsd = await capOf(tx, org.id)
    const graph = place.kind === 'space' ? await spaceGraph(tx, org.id, place.id) : null
    return { resolved, own, capUsd, graph }
  })
  const agents =
    place.kind === 'docket'
      ? await router.withTenant(org.id, async (tx) => ({ enrichment: await enrichmentSettings(tx, place.id), cognee: await cogneeSettings(tx, place.id) }))
      : null
  const { resolved, own } = read
  const model = (use: ModelUse) => ({
    label: MODEL_USE_INFO[use].label,
    own: own.models[use] ?? null,
    model: resolved.models[use].model,
    from: resolved.models[use].from,
    inherited: { model: resolved.inherited[use].model, from: resolved.inherited[use].from },
    choices: [...resolved.choices[use]],
    allowed: [...(own.allowed[use] ?? [])],
  })
  const ref =
    place.kind === 'account'
      ? { kind: 'account' as const, id: null, slug: null, name: org.name, ref: 'account' }
      : (() => {
          const found = place.kind === 'space' ? names.spaces.get(place.id) : names.dockets.get(place.id)
          const slug = found?.slug ?? null
          return { kind: place.kind, id: place.id, slug, name: found?.name ?? `A deleted ${place.kind}`, ref: `${place.kind}:${slug ?? place.id}` }
        })()
  return {
    place: ref,
    models: { cypher: model('cypher'), synthesis: model('synthesis') },
    // Never the key: whose it is, its provider, and its last four characters.
    key:
      resolved.key.from === 'space'
        ? { from: 'space', space: names.spaces.get(resolved.key.spaceId)?.slug ?? resolved.key.spaceId, provider: resolved.key.provider, hint: resolved.key.hint }
        : { from: 'account' },
    budget: { monthly_cap_usd: read.capUsd, space_slice_usd: resolved.caps.spaceUsd },
    storage:
      place.kind === 'space'
        ? {
            graph: read.graph && read.graph.status !== 'retiring' ? 'own' : 'account',
            status: read.graph?.status ?? null,
            last_error: read.graph?.lastError ?? null,
          }
        : null,
    agents: agents
      ? {
          enrichment: { enabled: agents.enrichment.enabled, schedule: agents.enrichment.schedule, monthly_limit_usd: agents.enrichment.monthlyLimitUsd },
          cognee: { enabled: agents.cognee.enabled, floor: agents.cognee.floor, monthly_limit_usd: agents.cognee.monthlyLimitUsd, available: cognee === true },
        }
      : null,
  }
}
