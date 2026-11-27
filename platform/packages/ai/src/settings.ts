// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from '@docket/platform-tenancy'

import { capOf } from './caps.js'
import { modelAllowlist, type ModelUse } from './models.js'

/**
 * Storage and AI per space (tenancy v2 §5, phase 5.1): the AI settings a
 * docket runs on resolve account -> space -> docket. The account chooses its
 * models from the platform's list; a space may choose others, pay with its
 * own provider key and take a slice of the account's monthly cap; a docket
 * may choose its own models. A higher place's limits cap every place below
 * it: the models a place lets the places inside it choose from, the account's
 * cap over a space's slice, and the platform's list over everything.
 */

export const MODEL_USES: readonly ModelUse[] = ['cypher', 'synthesis']

/** How each model use reads in the UI, said for what it does. */
export const MODEL_USE_INFO: Record<ModelUse, { label: string; help: string }> = {
  cypher: { label: 'Lookups and background work', help: 'Writes graph queries from questions, and runs enrichment, consolidation and summaries' },
  synthesis: { label: 'Answers and the Ask agent', help: 'Writes answers from what the dockets hold, and drives the Ask page' },
}

/** The model providers a space may bring its own key for. */
export type Provider = 'openrouter' | 'anthropic' | 'openai'
export const PROVIDERS: readonly Provider[] = ['openrouter', 'anthropic', 'openai']

export const PROVIDER_INFO: Record<Provider, { label: string; apiBase: string | undefined; dialect: 'openrouter' | 'openai' }> = {
  openrouter: { label: 'OpenRouter', apiBase: undefined, dialect: 'openrouter' },
  // Anthropic's and OpenAI's own APIs take OpenAI-style chat completions.
  anthropic: { label: 'Anthropic', apiBase: 'https://api.anthropic.com/v1', dialect: 'openai' },
  openai: { label: 'OpenAI', apiBase: 'https://api.openai.com/v1', dialect: 'openai' },
}

export function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value)
}

/**
 * A model on the platform's list as `provider` names it, or null when that
 * provider does not serve it. The list uses OpenRouter's names
 * (`anthropic/claude-sonnet-5.5`); Anthropic's own API names the same model
 * `claude-sonnet-5-5`, and OpenAI's `openai/gpt-4.1` is `gpt-4.1`.
 */
export function providerModel(provider: Provider, model: string): string | null {
  if (provider === 'openrouter') return model
  const prefix = `${provider}/`
  if (!model.startsWith(prefix)) return null
  const name = model.slice(prefix.length)
  return provider === 'anthropic' ? name.replaceAll('.', '-') : name
}

/** Where a resolved setting came from: a place's own choice, or the platform's default. */
export type SettingsSource = 'platform' | 'account' | 'space' | 'docket'

/** One place's own AI settings, as stored: nothing set means it takes what the place above it has. */
export interface PlaceAiSettings {
  /** The model it chose for each use. */
  models: Partial<Record<ModelUse, string>>
  /** The models the places inside it may choose from, per use; none: whatever this place may. */
  allowed: Partial<Record<ModelUse, readonly string[]>>
  /** A space's slice of the account's monthly cap, in US dollars; null: none of its own. */
  monthlyUsd: number | null
}

export const NO_SETTINGS: PlaceAiSettings = { models: {}, allowed: {}, monthlyUsd: null }

/** A space's own key, as anyone may see it: never the key itself. */
export interface ProviderKeyInfo {
  spaceId: string
  provider: Provider
  /** The key's last four characters. */
  hint: string
  createdAt: Date
  createdBy: string | null
}

/** Everything a docket's (or a space's, or the account's) AI settings resolve from. */
export interface SettingsChain {
  account: PlaceAiSettings
  accountCapUsd: number
  space?: { id: string; settings: PlaceAiSettings; key: ProviderKeyInfo | null }
  docket?: { id: string; settings: PlaceAiSettings }
}

export type AiPlace = 'account' | 'space' | 'docket'

export interface ResolvedModel {
  /** Null only when nothing on the list is served by the space's own key's provider. */
  model: string | null
  from: SettingsSource
}

/** A place's AI settings, resolved. */
export interface ResolvedAiSettings {
  place: AiPlace
  /** The space this is in: the space itself, or the docket's; null for the account. */
  spaceId: string | null
  /** The model each use runs on here, and whose choice it is. */
  models: Record<ModelUse, ResolvedModel>
  /** What the place above offers for each use: what "the same as above" means here. */
  inherited: Record<ModelUse, ResolvedModel>
  /** The models this place may choose from for each use: the platform's list, narrowed by every limit above it and by its key. */
  choices: Record<ModelUse, readonly string[]>
  /** The models this place's own limit may list for the places inside it: what it may choose itself (none for a docket). */
  offers: Record<ModelUse, readonly string[]>
  /** Whose key the calls go on: the account's (Docket's, capped), or the space's own. */
  key: { from: 'account' } | { from: 'space'; spaceId: string; provider: Provider; hint: string }
  /** The monthly caps that hold here: the account's, and the space's slice of it (never above the account's). */
  caps: { accountUsd: number; spaceUsd: number | null }
}

/** `list` narrowed by a place's limit; a limit that leaves nothing (stale since the place above changed) is ignored. */
function narrow(list: readonly string[], limit: readonly string[] | undefined): readonly string[] {
  if (!limit?.length) return list
  const narrowed = list.filter((model) => limit.includes(model))
  return narrowed.length ? narrowed : list
}

function pick(choices: readonly string[], candidates: readonly [SettingsSource, string | undefined][]): ResolvedModel {
  for (const [from, model] of candidates) if (model && choices.includes(model)) return { model, from }
  return { model: choices[0] ?? null, from: 'platform' }
}

const perUse = <T>(fn: (use: ModelUse) => T): Record<ModelUse, T> => ({ cypher: fn('cypher'), synthesis: fn('synthesis') })

/**
 * Resolves a place's AI settings from its chain: the docket's when the chain
 * has one, else the space's, else the account's. Each use runs on the
 * nearest place's choice that every limit above still allows, else the
 * first model the limits allow. A space's own key narrows its models, and
 * its dockets', to those its provider serves.
 */
export function resolveChain(chain: SettingsChain, allowlist: Readonly<Record<ModelUse, readonly string[]>> = modelAllowlist()): ResolvedAiSettings {
  const place: AiPlace = chain.docket ? 'docket' : chain.space ? 'space' : 'account'
  const key = chain.space?.key
  const served = (list: readonly string[]) => (key ? list.filter((model) => providerModel(key.provider, model) !== null) : list)
  const accountOffers = perUse((use) => narrow(allowlist[use], chain.account.allowed[use]))
  const spaceOffers = perUse((use) => narrow(accountOffers[use], chain.space?.settings.allowed[use]))

  const resolveAt = (at: AiPlace): { choices: Record<ModelUse, readonly string[]>; models: Record<ModelUse, ResolvedModel> } => {
    const choices = perUse((use) => (at === 'account' ? allowlist[use] : served(at === 'space' ? accountOffers[use] : spaceOffers[use])))
    const models = perUse((use) =>
      pick(choices[use], [
        ...(at === 'docket' ? [['docket', chain.docket?.settings.models[use]] as [SettingsSource, string | undefined]] : []),
        ...(at !== 'account' ? [['space', chain.space?.settings.models[use]] as [SettingsSource, string | undefined]] : []),
        ['account', chain.account.models[use]],
      ]),
    )
    return { choices, models }
  }

  const here = resolveAt(place)
  const above = place === 'docket' ? (chain.space ? resolveAt('space') : resolveAt('account')) : place === 'space' ? resolveAt('account') : here
  const spaceCap = chain.space?.settings.monthlyUsd ?? null
  return {
    place,
    spaceId: chain.space?.id ?? null,
    models: here.models,
    inherited: place === 'account' ? perUse(() => ({ model: null, from: 'platform' as const })) : above.models,
    choices: here.choices,
    // What this place's own limit may pick from: what it may choose itself. A docket has nothing inside it.
    offers: place === 'docket' ? perUse(() => [] as readonly string[]) : here.choices,
    key: key ? { from: 'space', spaceId: key.spaceId, provider: key.provider, hint: key.hint } : { from: 'account' },
    caps: { accountUsd: chain.accountCapUsd, spaceUsd: spaceCap === null ? null : Math.min(spaceCap, chain.accountCapUsd) },
  }
}

// --- Stored settings -------------------------------------------------------------

type SettingsRow = { models: Record<string, unknown>; allowed: Record<string, unknown>; monthly_usd: string | null }

function toSettings(row: SettingsRow | undefined): PlaceAiSettings {
  if (!row) return NO_SETTINGS
  const models: Partial<Record<ModelUse, string>> = {}
  const allowed: Partial<Record<ModelUse, readonly string[]>> = {}
  for (const use of MODEL_USES) {
    const model = row.models[use]
    if (typeof model === 'string' && model) models[use] = model
    const list = row.allowed[use]
    if (Array.isArray(list)) allowed[use] = list.filter((each): each is string => typeof each === 'string')
  }
  return { models, allowed, monthlyUsd: row.monthly_usd === null ? null : Number(row.monthly_usd) }
}

const placeId = (place: { kind: AiPlace; id?: string }) => (place.kind === 'account' ? '' : (place.id ?? ''))

/** One place's own AI settings. */
export async function placeAiSettings(tx: Tx, orgId: string, place: { kind: AiPlace; id?: string }): Promise<PlaceAiSettings> {
  const { rows } = await tx.query<SettingsRow>(
    'SELECT models, allowed, monthly_usd FROM platform.ai_settings WHERE org_id = $1 AND place_kind = $2 AND place_id = $3',
    [orgId, place.kind, placeId(place)],
  )
  return toSettings(rows[0])
}

/** A space's own provider key, as anyone may see it (never the key), or null. */
export async function providerKeyInfo(tx: Tx, orgId: string, spaceId: string): Promise<ProviderKeyInfo | null> {
  const { rows } = await tx.query<{ provider: Provider; hint: string; created_at: Date; created_by: string | null }>(
    'SELECT provider, hint, created_at, created_by FROM platform.provider_keys WHERE org_id = $1 AND space_id = $2',
    [orgId, spaceId],
  )
  const row = rows[0]
  return row ? { spaceId, provider: row.provider, hint: row.hint, createdAt: row.created_at, createdBy: row.created_by } : null
}

/** The space a docket is in, read through `platform.docket_spaces` (platform 0018); null for one the org does not have. */
export async function spaceOfDocket(tx: Tx, orgId: string, docketId: string): Promise<string | null> {
  const { rows } = await tx.query<{ space_id: string }>('SELECT space_id FROM platform.docket_spaces($1) WHERE docket_id = $2', [orgId, docketId])
  return rows[0]?.space_id ?? null
}

/** Where AI settings are read: the account, a space, or a docket (whose space is found for it). */
export type AiSettingsAt = { spaceId?: string | null; docketId?: string | null }

/** The chain a place's AI settings resolve from. */
export async function settingsChain(tx: Tx, orgId: string, at: AiSettingsAt = {}): Promise<SettingsChain> {
  const docketId = at.docketId ?? null
  const spaceId = at.spaceId ?? (docketId ? await spaceOfDocket(tx, orgId, docketId) : null)
  // One query at a time: they share the caller's transaction.
  const account = await placeAiSettings(tx, orgId, { kind: 'account' })
  const accountCapUsd = await capOf(tx, orgId)
  const space = spaceId ? await placeAiSettings(tx, orgId, { kind: 'space', id: spaceId }) : null
  const key = spaceId ? await providerKeyInfo(tx, orgId, spaceId) : null
  const docket = docketId ? await placeAiSettings(tx, orgId, { kind: 'docket', id: docketId }) : null
  return {
    account,
    accountCapUsd,
    ...(spaceId && space ? { space: { id: spaceId, settings: space, key } } : {}),
    ...(docketId && docket ? { docket: { id: docketId, settings: docket } } : {}),
  }
}

/** A place's AI settings, resolved: the account's with nothing given, a space's, or a docket's. */
export async function resolveAiSettings(tx: Tx, orgId: string, at: AiSettingsAt = {}): Promise<ResolvedAiSettings> {
  return resolveChain(await settingsChain(tx, orgId, at))
}

/**
 * The model each use runs on, for the account, or for one docket when
 * `docketId` is given. With no choices anywhere this is the platform's
 * default for each use, as it always was.
 */
export async function modelChoices(tx: Tx, orgId: string, docketId?: string | null): Promise<Record<ModelUse, string>> {
  const resolved = await resolveAiSettings(tx, orgId, { docketId: docketId ?? null })
  const fallback = modelAllowlist()
  return perUse((use) => resolved.models[use].model ?? (fallback[use][0] as string))
}

export class SettingsError extends Error {
  override name = 'SettingsError'
}

export interface SaveAiSettings {
  orgId: string
  place: { kind: AiPlace; id?: string }
  /** Each use's model; an empty or missing one takes the place above's. */
  models: Partial<Record<ModelUse, string | null>>
  /** Each use's limit for the places inside; empty or missing: no limit. Not for a docket. */
  allowed?: Partial<Record<ModelUse, readonly string[] | null>>
  /** A space's slice of the account's cap; null: none of its own. Only for a space. */
  monthlyUsd?: number | null
  by: string
}

/**
 * Saves one place's AI settings, within every limit above it: each model is
 * one the place may choose, each limit lists only models the place itself
 * offers (and holds the place's own choice), and a space's slice is no more
 * than the account's cap. Returns the settings before and after, for the audit.
 */
export async function saveAiSettings(tx: Tx, input: SaveAiSettings): Promise<{ before: PlaceAiSettings; after: PlaceAiSettings }> {
  const { orgId, place } = input
  if (place.kind !== 'account' && !place.id) throw new SettingsError('Say which place these settings are for.')
  const at: AiSettingsAt = place.kind === 'space' ? { spaceId: place.id ?? null } : place.kind === 'docket' ? { docketId: place.id ?? null } : {}
  const chain = await settingsChain(tx, orgId, at)
  if (place.kind === 'docket' && !chain.space) throw new SettingsError('No such docket.')
  const resolved = resolveChain(chain)
  const before = place.kind === 'account' ? chain.account : place.kind === 'space' ? (chain.space?.settings ?? NO_SETTINGS) : (chain.docket?.settings ?? NO_SETTINGS)

  const models: Partial<Record<ModelUse, string>> = {}
  const allowed: Partial<Record<ModelUse, readonly string[]>> = {}
  for (const use of MODEL_USES) {
    const model = input.models[use]?.trim()
    if (model) {
      if (!resolved.choices[use].includes(model)) {
        throw new SettingsError(
          resolved.key.from === 'space'
            ? `Choose a model ${PROVIDER_INFO[resolved.key.provider].label} serves, from the list: this space pays with its own ${PROVIDER_INFO[resolved.key.provider].label} key.`
            : 'Choose models from the list.',
        )
      }
      models[use] = model
    }
    const limit = [...new Set((input.allowed?.[use] ?? []).map((each) => each.trim()).filter(Boolean))]
    if (limit.length) {
      if (place.kind === 'docket') throw new SettingsError('A docket has no places inside it to limit.')
      const offered = resolved.offers[use]
      if (!limit.every((each) => offered.includes(each))) throw new SettingsError('Limit the places inside to models from the list.')
      if (model && !limit.includes(model)) throw new SettingsError(`Keep ${model} in the list the places inside may choose from, or choose another model.`)
      allowed[use] = offered.filter((each) => limit.includes(each))
    }
  }

  let monthlyUsd: number | null = null
  if (input.monthlyUsd !== undefined && input.monthlyUsd !== null) {
    if (place.kind !== 'space') throw new SettingsError('Only a space takes a slice of the monthly cap.')
    if (!Number.isFinite(input.monthlyUsd) || input.monthlyUsd < 0) throw new SettingsError('A monthly slice is $0 or more.')
    if (input.monthlyUsd > chain.accountCapUsd) {
      throw new SettingsError(`A space's slice is at most the account's monthly cap, $${chain.accountCapUsd.toFixed(2)}.`)
    }
    monthlyUsd = Math.round(input.monthlyUsd * 100) / 100
  }

  const after: PlaceAiSettings = { models, allowed, monthlyUsd }
  if (!Object.keys(models).length && !Object.keys(allowed).length && monthlyUsd === null) {
    await tx.query('DELETE FROM platform.ai_settings WHERE org_id = $1 AND place_kind = $2 AND place_id = $3', [orgId, place.kind, placeId(place)])
  } else {
    await tx.query(
      `INSERT INTO platform.ai_settings (org_id, place_kind, place_id, models, allowed, monthly_usd, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (org_id, place_kind, place_id) DO UPDATE SET models = EXCLUDED.models, allowed = EXCLUDED.allowed,
         monthly_usd = EXCLUDED.monthly_usd, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [orgId, place.kind, placeId(place), JSON.stringify(models), JSON.stringify(allowed), monthlyUsd, input.by],
    )
  }
  return { before, after }
}

/** The spaces and dockets that chose something of their own, for the account's Settings. */
export async function placesWithSettings(tx: Tx, orgId: string): Promise<{ kind: 'space' | 'docket'; id: string; settings: PlaceAiSettings }[]> {
  const { rows } = await tx.query<SettingsRow & { place_kind: 'space' | 'docket'; place_id: string }>(
    `SELECT place_kind, place_id, models, allowed, monthly_usd FROM platform.ai_settings
      WHERE org_id = $1 AND place_kind <> 'account' ORDER BY place_kind DESC, place_id`,
    [orgId],
  )
  return rows.map((row) => ({ kind: row.place_kind, id: row.place_id, settings: toSettings(row) }))
}
