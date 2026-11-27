// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OpenRouter (§11): chat completions on an org's own key, and the key
 * provisioning API that gives each org that key with a credit limit equal to
 * its monthly cap, so the cap holds upstream even if the cloud's own metering
 * had a bug.
 */
export const OPENROUTER_API = 'https://openrouter.ai/api/v1'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** A tool the model may call in a turn, as OpenAI-style function calling describes it. */
export interface TurnTool {
  name: string
  description: string
  /** The arguments' JSON Schema. */
  parameters: Record<string, unknown>
}

/** A call the model asked for: its id, the tool, and the arguments as the JSON text the model wrote. */
export interface ToolCall {
  id: string
  name: string
  arguments: string
}

/** One message of a turn: a chat message, the model's own tool calls, or what a tool answered. */
export type TurnMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export interface TurnResult {
  /** What the model wrote, beside or instead of its tool calls. */
  content: string
  /** The tools it asked to call; none once it has answered. */
  toolCalls: ToolCall[]
  model: string
  generationId: string | null
  usage: ChatUsage
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  /** What OpenRouter charged, in US dollars (credits). */
  costUsd: number
}

export interface ChatResult {
  text: string
  /** The model that answered, as OpenRouter reports it. */
  model: string
  generationId: string | null
  usage: ChatUsage
}

export interface ProvisionedKey {
  /** The key itself: shown once by OpenRouter, sealed with the org's data key here. */
  key: string
  /** OpenRouter's id for the key, for changing its limit or deleting it. */
  hash: string
}

export interface OpenRouterClient {
  chat(apiKey: string, request: { model: string; messages: ChatMessage[]; signal?: AbortSignal | undefined }): Promise<ChatResult>
  /**
   * One turn of an agent: the conversation so far and the tools it may call;
   * `toolChoice: 'none'` asks for an answer now. `maxTokens` bounds what it writes.
   */
  turn(
    apiKey: string,
    request: { model: string; messages: TurnMessage[]; tools: TurnTool[]; toolChoice?: 'auto' | 'none'; maxTokens?: number; signal?: AbortSignal | undefined },
  ): Promise<TurnResult>
  /** Creates a key whose spend OpenRouter stops at `limitUsd`, reset each month. Needs the provisioning key. */
  createKey(request: { name: string; limitUsd: number }): Promise<ProvisionedKey>
  updateKeyLimit(hash: string, limitUsd: number): Promise<void>
  deleteKey(hash: string): Promise<void>
}

export class OpenRouterError extends Error {
  override name = 'OpenRouterError'
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface OpenRouterOptions {
  /** The management key that creates per-org keys. Without it, keys cannot be provisioned. */
  provisioningKey?: string | undefined
  apiBase?: string | undefined
  /**
   * `openrouter` (the default) adds OpenRouter's privacy routing and usage
   * accounting to every request; `openai` sends plain OpenAI-style chat
   * completions, for any compatible endpoint (OpenAI, Ollama, vLLM, LiteLLM),
   * which reports tokens but no cost.
   */
  dialect?: 'openrouter' | 'openai' | undefined
  fetch?: typeof fetch
  /** Shown on OpenRouter's activity page. */
  appUrl?: string | undefined
  timeoutMs?: number
}

/**
 * Every request asks OpenRouter to route only to providers that neither train
 * on prompts nor retain them (§11).
 */
export const PRIVACY_ROUTING = { data_collection: 'deny', zdr: true } as const

type Completion = {
  id?: string
  model?: string
  choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] | null } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
  error?: { message?: string }
}

/** A turn's message as the chat completions API takes it. */
function wireMessage(message: TurnMessage) {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })),
    }
  }
  return { role: message.role, content: message.content }
}

export function openRouterClient(options: OpenRouterOptions = {}): OpenRouterClient {
  const fetchImpl = options.fetch ?? fetch
  const base = (options.apiBase ?? OPENROUTER_API).replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? 60_000
  const routing = options.dialect === 'openai' ? {} : { usage: { include: true }, provider: PRIVACY_ROUTING }

  async function call(method: string, path: string, bearer: string, body?: unknown, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(timeoutMs)
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.appUrl ? { 'http-referer': options.appUrl, 'x-title': 'Docket Cloud' } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    const text = await response.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    if (!response.ok) {
      // The error text OpenRouter gives, never the request: it may hold customer content.
      const message = (json as { error?: { message?: string } } | null)?.error?.message ?? response.statusText
      throw new OpenRouterError(response.status, `OpenRouter ${method} ${path}: ${response.status} ${message}`)
    }
    return json
  }

  const provisioning = () => {
    if (!options.provisioningKey) throw new OpenRouterError(0, 'no OpenRouter provisioning key is configured')
    return options.provisioningKey
  }

  return {
    async chat(apiKey, request) {
      const completion = (await call(
        'POST',
        '/chat/completions',
        apiKey,
        {
          model: request.model,
          messages: request.messages,
          temperature: 0,
          ...routing,
        },
        request.signal,
      )) as Completion
      if (completion.error) throw new OpenRouterError(502, `OpenRouter: ${completion.error.message ?? 'error'}`)
      return {
        text: completion.choices?.[0]?.message?.content ?? '',
        model: completion.model ?? request.model,
        generationId: completion.id ?? null,
        usage: {
          promptTokens: completion.usage?.prompt_tokens ?? 0,
          completionTokens: completion.usage?.completion_tokens ?? 0,
          costUsd: completion.usage?.cost ?? 0,
        },
      }
    },

    async turn(apiKey, request) {
      const completion = (await call(
        'POST',
        '/chat/completions',
        apiKey,
        {
          model: request.model,
          messages: request.messages.map(wireMessage),
          ...(request.tools.length
            ? { tools: request.tools.map((tool) => ({ type: 'function', function: tool })), tool_choice: request.toolChoice ?? 'auto' }
            : {}),
          ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
          temperature: 0,
          ...routing,
        },
        request.signal,
      )) as Completion
      if (completion.error) throw new OpenRouterError(502, `OpenRouter: ${completion.error.message ?? 'error'}`)
      const message = completion.choices?.[0]?.message
      return {
        content: message?.content ?? '',
        toolCalls: (message?.tool_calls ?? []).flatMap((call, index) =>
          call.function?.name ? [{ id: call.id ?? `call_${index}`, name: call.function.name, arguments: call.function.arguments ?? '{}' }] : [],
        ),
        model: completion.model ?? request.model,
        generationId: completion.id ?? null,
        usage: {
          promptTokens: completion.usage?.prompt_tokens ?? 0,
          completionTokens: completion.usage?.completion_tokens ?? 0,
          costUsd: completion.usage?.cost ?? 0,
        },
      }
    },

    async createKey(request) {
      const created = (await call('POST', '/keys', provisioning(), {
        name: request.name,
        limit: request.limitUsd,
        limit_reset: 'monthly',
        include_byok_in_limit: true,
      })) as { key?: string; data?: { hash?: string } }
      if (!created.key || !created.data?.hash) throw new OpenRouterError(502, 'OpenRouter created a key but returned no key or hash')
      return { key: created.key, hash: created.data.hash }
    },

    async updateKeyLimit(hash, limitUsd) {
      await call('PATCH', `/keys/${encodeURIComponent(hash)}`, provisioning(), { limit: limitUsd, limit_reset: 'monthly' })
    },

    async deleteKey(hash) {
      await call('DELETE', `/keys/${encodeURIComponent(hash)}`, provisioning())
    },
  }
}
