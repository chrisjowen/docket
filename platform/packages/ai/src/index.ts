// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AI via OpenRouter, with per-team caps (§11): one capped key per org (or a
 * shared platform key, capped by metering alone), every call metered, owners
 * warned at 80% and calls refused at 100%. Search never goes through here.
 */
export {
  AiCapReached,
  CapError,
  DEFAULT_MONTHLY_CAP_USD,
  MAX_MONTHLY_CAP_USD,
  WARN_AT,
  aiCaps,
  capOf,
  setCap,
} from './caps.js'
export type { AiCaps, CapStatus, CapWarning, CapsDeps } from './caps.js'
export { AiNotConfigured, openRouterKeys, orgAiKeys } from './keys.js'
export type { AiKeyMode, KeyOutcome, OrgAiKeys, OrgAiKeysDeps, OrgKeys } from './keys.js'
export { auditCapWarning } from './notify.js'
export { MODEL_ALLOWLIST, chatOf, configureModels, meteredModel, meteredTurns, modelAllowlist, modelChoices, openRouterModels } from './models.js'
export type { AiDeps, MeteredCall, ModelClient, ModelUse, Models, TurnModel } from './models.js'
export { OPENROUTER_API, OpenRouterError, PRIVACY_ROUTING, openRouterClient } from './openrouter-client.js'
export type {
  ChatMessage,
  ChatResult,
  ChatUsage,
  OpenRouterClient,
  OpenRouterOptions,
  ProvisionedKey,
  ToolCall,
  TurnMessage,
  TurnResult,
  TurnTool,
} from './openrouter-client.js'
export { actorMonthSpend, monthOf, monthSpend, recordUsage } from './usage.js'
export type { Purpose, UsageRecord } from './usage.js'
