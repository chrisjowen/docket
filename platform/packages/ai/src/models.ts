// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from '@docket/platform-tenancy'

import type { AiCaps } from './caps.js'
import { AiNotConfigured, type OrgAiKeys, type SpaceAiKeys } from './keys.js'
import type { ChatMessage, ChatUsage, OpenRouterClient, TurnMessage, TurnResult, TurnTool } from './openrouter-client.js'
import { PROVIDER_INFO, providerModel, resolveAiSettings, type Provider } from './settings.js'
import { recordUsage, type Purpose } from './usage.js'

/** docket's `ModelClient` (`AdapterServices.models`): a chat model an adapter may use. */
export interface ModelClient {
  chat(messages: ChatMessage[], options?: { signal?: AbortSignal | undefined }): Promise<string>
}
export type Models = Readonly<Record<string, ModelClient>>

/**
 * The models an org may choose from (§11): a small, cheap one for Cypher
 * and extraction, and a mid-tier one for synthesis. The first is the default.
 */
export const MODEL_ALLOWLIST = {
  cypher: ['anthropic/claude-haiku-5.5', 'google/gemini-3.5-flash-lite', 'openai/gpt-4.1-mini'],
  synthesis: ['anthropic/claude-sonnet-5.5', 'google/gemini-3.8-flash', 'openai/gpt-4.1'],
} as const satisfies Record<string, readonly string[]>

export type ModelUse = keyof typeof MODEL_ALLOWLIST

let configured: Readonly<Record<ModelUse, readonly string[]>> | null = null

/**
 * The models orgs may choose from: the server's own list when the operator
 * gave one (`DOCKET_AI_MODELS`, from docket-server.yaml's `ai.models`: the
 * names their provider serves), else `MODEL_ALLOWLIST` (OpenRouter's names).
 */
export function modelAllowlist(): Readonly<Record<ModelUse, readonly string[]>> {
  return configured ?? MODEL_ALLOWLIST
}

/**
 * Sets the server's model list from `DOCKET_AI_MODELS`, a JSON object with a
 * non-empty list of model names for each use; unset or empty restores the
 * default. A malformed value is an error, so the server does not start on it.
 */
export function configureModels(raw: string | undefined): void {
  if (!raw?.trim()) {
    configured = null
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('DOCKET_AI_MODELS is a JSON object: { "cypher": [...], "synthesis": [...] }')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('DOCKET_AI_MODELS is a JSON object of model lists')
  const value = parsed as Record<string, unknown>
  const list = (use: ModelUse): string[] => {
    const models = value[use]
    if (!Array.isArray(models) || !models.length || !models.every((model) => typeof model === 'string' && model.trim())) {
      throw new Error(`DOCKET_AI_MODELS.${use} is a non-empty list of model names, the default first`)
    }
    return models.map((model: string) => model.trim())
  }
  configured = { cypher: list('cypher'), synthesis: list('synthesis') }
}

export interface AiDeps {
  platform<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
  caps: AiCaps
  /** The account's key: Docket's, capped (§11). */
  keys: OrgAiKeys
  client: OpenRouterClient
  /** Spaces' own provider keys (tenancy v2 §5); absent, a space's own key cannot be used and its calls are refused. */
  spaceKeys?: SpaceAiKeys
  /** A client for a provider a space brought its own key for. */
  providerClient?(provider: Provider): OpenRouterClient
}

/** One metered call, as `onUsage` hears of it. */
export interface MeteredCall {
  purpose: Purpose
  model: string
  promptTokens: number
  completionTokens: number
  costUsd: number
}

/**
 * The org's models as docket's `AdapterServices.models` (§2, §6.3): `cypher`
 * for the Neo4j adapter's model-written Cypher, `synthesis` for answers.
 * Every call checks the cap first, runs on the org's own capped key, and
 * meters what it cost; `onUsage` hears of each call once it is metered, so a
 * question's trace can say what it cost.
 */
export function openRouterModels(
  deps: AiDeps,
  orgId: string,
  context: { workspaceId?: string | null; actor: string; onUsage?: (call: MeteredCall) => void },
): Models {
  const client = (use: ModelUse, purpose: Purpose) => meteredModel(deps, orgId, context, use, purpose)
  return { cypher: client('cypher', 'cypher'), synthesis: client('synthesis', 'synthesis') }
}

/** Where one call goes: the client and key to call with, the model as that provider names it, and the docket's space. */
interface Route {
  client: OpenRouterClient
  apiKey: string
  model: string
  spaceId: string | null
}

/**
 * Where a call for `use` goes, from the docket's settings resolved account ->
 * space -> docket (tenancy v2 §5): its model, and the space's own key when it
 * has one, else the account's. A call with no docket runs on the account's.
 */
async function routeOf(deps: AiDeps, orgId: string, docketId: string | null, use: ModelUse): Promise<Route> {
  const resolved = await deps.platform((tx) => resolveAiSettings(tx, orgId, { docketId }))
  const { spaceId } = resolved
  const model = resolved.models[use].model
  if (resolved.key.from === 'space') {
    const { provider } = resolved.key
    const label = PROVIDER_INFO[provider].label
    const own = deps.spaceKeys && deps.providerClient ? await deps.spaceKeys.key(orgId, resolved.key.spaceId) : null
    if (!own || !deps.providerClient) throw new AiNotConfigured(orgId, `This space pays for AI with its own ${label} key, which this server cannot use yet`)
    const named = model === null ? null : providerModel(own.provider, model)
    if (!named) throw new AiNotConfigured(orgId, `None of the models this space may choose is served by its ${label} key — choose one in the space's Settings`)
    return { client: deps.providerClient(own.provider), apiKey: own.key, model: named, spaceId }
  }
  if (model === null) throw new AiNotConfigured(orgId)
  return { client: deps.client, apiKey: await deps.keys.key(orgId), model, spaceId }
}

/**
 * One call on the docket's model for `use` (the account's, with no docket):
 * the caps checked first, the space's own key or the account's, and what it
 * cost metered before `onUsage` hears of it.
 */
async function metered<T extends { model: string; generationId: string | null; usage: ChatUsage }>(
  deps: AiDeps,
  orgId: string,
  context: { workspaceId?: string | null; actor: string; onUsage?: (call: MeteredCall) => void },
  use: ModelUse,
  purpose: Purpose,
  call: (client: OpenRouterClient, apiKey: string, model: string) => Promise<T>,
): Promise<T> {
  const route = await routeOf(deps, orgId, context.workspaceId ?? null, use)
  await deps.caps.assertWithinCap(orgId, { spaceId: route.spaceId })
  const result = await call(route.client, route.apiKey, route.model)
  await deps.platform((tx) =>
    recordUsage(tx, {
      orgId,
      workspaceId: context.workspaceId ?? null,
      actor: context.actor,
      purpose,
      model: result.model,
      generationId: result.generationId,
      ...result.usage,
    }),
  )
  context.onUsage?.({ purpose, model: result.model, ...result.usage })
  return result
}

/** One of the org's models, for one purpose: the cap checked first, the org's own key, every call metered. */
export function meteredModel(
  deps: AiDeps,
  orgId: string,
  context: { workspaceId?: string | null; actor: string; onUsage?: (call: MeteredCall) => void },
  use: ModelUse,
  purpose: Purpose,
): ModelClient {
  return {
    async chat(messages, options) {
      const result = await metered(deps, orgId, context, use, purpose, (client, apiKey, model) => client.chat(apiKey, { model, messages, signal: options?.signal }))
      return result.text
    },
  }
}

/** An agent's turns on one of the org's models: each a tool-calling chat completion, capped and metered like any other call. */
export interface TurnModel {
  turn(request: { messages: TurnMessage[]; tools: TurnTool[]; toolChoice?: 'auto' | 'none'; maxTokens?: number; signal?: AbortSignal | undefined }): Promise<TurnResult>
}

/** The org's `use` model for an agent's turns, metered as `purpose`. */
export function meteredTurns(
  deps: AiDeps,
  orgId: string,
  context: { workspaceId?: string | null; actor: string; onUsage?: (call: MeteredCall) => void },
  use: ModelUse,
  purpose: Purpose,
): TurnModel {
  return {
    turn: (request) => metered(deps, orgId, context, use, purpose, (client, apiKey, model) => client.turn(apiKey, { ...request, model })),
  }
}

/** A `ModelClient` as the adapters' `Chat` (`{ system, user }` in, text out). */
export function chatOf(model: ModelClient) {
  return (prompt: { system: string; user: string }, options?: { signal?: AbortSignal | undefined }) =>
    model.chat(
      [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      options,
    )
}
