// SPDX-License-Identifier: AGPL-3.0-only
import { env } from '$env/dynamic/private'
import {
  MODEL_USES,
  MODEL_USE_INFO,
  PROVIDER_INFO,
  spaceAiKeys,
  type ModelUse,
  type PlaceAiSettings,
  type ProviderKeyInfo,
  type ResolvedAiSettings,
  type SpaceAiKeys,
} from '@docket/platform-ai'
import type { Tx } from '@docket/platform-tenancy'

import { getRuntime } from './runtime'

/**
 * Storage and AI per space (tenancy v2 §5) as the Settings pages show and
 * change them: the account's, a space's and a docket's models, a space's own
 * provider key, and a space's own Neo4j instance.
 */

/** About 8 Neo4j pods fit on a 16 GB box (tenancy v2 §5); `DOCKET_NEO4J_POD_CAPACITY` says how many this one holds. */
const DEFAULT_POD_CAPACITY = 8

export function podCapacity(): number {
  const raw = env.DOCKET_NEO4J_POD_CAPACITY
  const value = raw === undefined || raw === '' ? DEFAULT_POD_CAPACITY : Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_POD_CAPACITY
}

/** How many Neo4j pods the box runs, every account's included, and how many more fit. */
export async function podsOnBox(tx: Tx): Promise<{ used: number; capacity: number; left: number }> {
  const { rows } = await tx.query<{ count: string }>("SELECT count(*) FROM platform.stores WHERE kind = 'neo4j' AND status <> 'retiring'")
  const used = Number(rows[0]?.count ?? 0)
  const capacity = podCapacity()
  return { used, capacity, left: Math.max(0, capacity - used) }
}

let keys: SpaceAiKeys | undefined

/** Spaces' own provider keys, sealed with each org's data key. */
export function spaceKeys(): SpaceAiKeys {
  const { router, keyring } = getRuntime()
  return (keys ??= spaceAiKeys({ platform: (fn) => router.withPlatform(fn), keysFor: (orgId) => keyring.forOrg(orgId) }))
}

/** One use's settings as a page shows them: the model it runs on and whose choice that is, what it may be, and what "the same as above" means. */
export interface ModelSlot {
  use: ModelUse
  label: string
  help: string
  /** This place's own choice, '' for none. */
  own: string
  model: string | null
  from: string
  inherited: string | null
  inheritedFrom: string
  choices: readonly string[]
  /** What the places inside may choose from, before this place's own limit. */
  offers: readonly string[]
  /** This place's own limit, empty for none. */
  allowed: readonly string[]
}

export function modelSlots(resolved: ResolvedAiSettings, own: PlaceAiSettings): ModelSlot[] {
  return MODEL_USES.map((use) => ({
    use,
    label: MODEL_USE_INFO[use].label,
    help: MODEL_USE_INFO[use].help,
    own: own.models[use] ?? '',
    model: resolved.models[use].model,
    from: resolved.models[use].from,
    inherited: resolved.inherited[use].model,
    inheritedFrom: resolved.inherited[use].from,
    choices: resolved.choices[use],
    offers: resolved.offers[use],
    allowed: own.allowed[use] ?? [],
  }))
}

/** A space's key as a page shows it: never the key, only its provider and last four characters. */
export const keyView = (info: ProviderKeyInfo | null, createdByLogin: string | null) =>
  info
    ? {
        provider: info.provider,
        providerLabel: PROVIDER_INFO[info.provider].label,
        hint: info.hint,
        createdAt: info.createdAt.toISOString(),
        createdBy: createdByLogin,
      }
    : null

/** A form's models and limits: `<use>` is the model ('' takes the place above's), `allowed_<use>` each model the places inside may choose. */
export function modelsFrom(form: FormData): { models: Partial<Record<ModelUse, string | null>>; allowed: Partial<Record<ModelUse, string[]>> } {
  const models: Partial<Record<ModelUse, string | null>> = {}
  const allowed: Partial<Record<ModelUse, string[]>> = {}
  for (const use of MODEL_USES) {
    models[use] = String(form.get(use) ?? '').trim() || null
    allowed[use] = form.getAll(`allowed_${use}`).map(String)
  }
  return { models, allowed }
}

/** "Same as the account" / "the platform's default": where a resolved model came from, for a page. */
export function sourceLabel(from: string, names: { space?: string; account: string }): string {
  if (from === 'docket') return 'this docket'
  if (from === 'space') return names.space ?? 'the space'
  if (from === 'account') return names.account
  return 'the default'
}
