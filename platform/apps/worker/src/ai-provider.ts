// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The model provider the worker calls, from the variables `docket serve` sets
 * from docket-server.yaml's `ai` (or a container sets itself):
 *
 * - `DOCKET_AI_PROVIDER`: `openrouter` (the default, as before), or
 *   `openai-compatible` for any OpenAI-style chat completions API.
 * - OpenRouter: `OPENROUTER_API_KEY` (one key every org shares) and/or
 *   `OPENROUTER_PROVISIONING_KEY` (a key per org, capped at its budget).
 * - OpenAI-compatible: `DOCKET_AI_URL`, its base URL, and `DOCKET_AI_API_KEY`
 *   when it takes a key (a local Ollama takes none).
 *
 * Without a provider AI is off, and search works without it.
 */
export interface AiProviderSettings {
  kind: 'openrouter' | 'openai-compatible'
  /** The chat completions base URL; undefined: OpenRouter's. */
  apiBase: string | undefined
  dialect: 'openrouter' | 'openai'
  /** The key every org shares, which cognee's calls go on too; undefined: none (OpenRouter then needs a provisioning key). */
  sharedKey: string | undefined
  provisioningKey: string | undefined
}

/** A placeholder bearer for an endpoint that takes no key: OpenAI-style clients send one regardless. */
const NO_KEY = 'none'

export function aiProviderOf(env: NodeJS.ProcessEnv): AiProviderSettings | null {
  const kind = env.DOCKET_AI_PROVIDER || 'openrouter'
  if (kind === 'openai-compatible') {
    const url = env.DOCKET_AI_URL
    if (!url) throw new Error('DOCKET_AI_PROVIDER is openai-compatible, so DOCKET_AI_URL names its base URL, like http://ollama:11434/v1')
    return { kind, apiBase: url.replace(/\/+$/, ''), dialect: 'openai', sharedKey: env.DOCKET_AI_API_KEY || NO_KEY, provisioningKey: undefined }
  }
  if (kind !== 'openrouter') throw new Error(`DOCKET_AI_PROVIDER is openrouter or openai-compatible, not ${kind}`)
  const sharedKey = env.OPENROUTER_API_KEY || undefined
  const provisioningKey = env.OPENROUTER_PROVISIONING_KEY || undefined
  if (!sharedKey && !provisioningKey) return null
  return { kind, apiBase: undefined, dialect: 'openrouter', sharedKey, provisioningKey }
}
