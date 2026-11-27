// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from '@docket/platform-tenancy'

import type { AiCaps } from './caps.js'
import type { OrgAiKeys } from './keys.js'
import type { ChatMessage, ChatUsage, OpenRouterClient, TurnMessage, TurnResult, TurnTool } from './openrouter-client.js'
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

/** The org's model for each use: its own choice when the allowlist still has it, else the default. */
export async function modelChoices(tx: Tx, orgId: string): Promise<Record<ModelUse, string>> {
  const { rows } = await tx.query<{ models: Partial<Record<string, string>> }>('SELECT models FROM platform.ai_caps WHERE org_id = $1', [orgId])
  const chosen = rows[0]?.models ?? {}
  const pick = (use: ModelUse) => {
    const allowed: readonly string[] = MODEL_ALLOWLIST[use]
    const choice = chosen[use]
    return choice && allowed.includes(choice) ? choice : (allowed[0] as string)
  }
  return { cypher: pick('cypher'), synthesis: pick('synthesis') }
}

export interface AiDeps {
  platform<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
  caps: AiCaps
  keys: OrgAiKeys
  client: OpenRouterClient
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

/**
 * One call on the org's model for `use`: the cap checked first, the org's own
 * key, and what it cost metered before `onUsage` hears of it.
 */
async function metered<T extends { model: string; generationId: string | null; usage: ChatUsage }>(
  deps: AiDeps,
  orgId: string,
  context: { workspaceId?: string | null; actor: string; onUsage?: (call: MeteredCall) => void },
  use: ModelUse,
  purpose: Purpose,
  call: (apiKey: string, model: string) => Promise<T>,
): Promise<T> {
  await deps.caps.assertWithinCap(orgId)
  const [model, apiKey] = await Promise.all([deps.platform((tx) => modelChoices(tx, orgId)).then((m) => m[use]), deps.keys.key(orgId)])
  const result = await call(apiKey, model)
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
      const result = await metered(deps, orgId, context, use, purpose, (apiKey, model) => deps.client.chat(apiKey, { model, messages, signal: options?.signal }))
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
    turn: (request) => metered(deps, orgId, context, use, purpose, (apiKey, model) => deps.client.turn(apiKey, { ...request, model })),
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
