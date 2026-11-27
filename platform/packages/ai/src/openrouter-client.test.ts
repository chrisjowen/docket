// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'

import { OpenRouterError, PRIVACY_ROUTING, openRouterClient } from './openrouter-client.js'

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('openRouterClient', () => {
  it('asks for no-training, zero-retention providers and the cost of every call', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      reply(200, {
        id: 'gen-1',
        model: 'anthropic/claude-haiku-5.5',
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.0004 },
      }),
    )
    const client = openRouterClient({ fetch: fetchImpl })
    const result = await client.chat('sk-or-org', { model: 'anthropic/claude-haiku-5.5', messages: [{ role: 'user', content: 'hi' }] })
    expect(result).toEqual({
      text: 'hello',
      model: 'anthropic/claude-haiku-5.5',
      generationId: 'gen-1',
      usage: { promptTokens: 10, completionTokens: 2, costUsd: 0.0004 },
    })
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer sk-or-org')
    expect(JSON.parse(String(init?.body))).toMatchObject({ provider: PRIVACY_ROUTING, usage: { include: true }, temperature: 0 })
    expect(PRIVACY_ROUTING).toEqual({ data_collection: 'deny', zdr: true })
  })

  it('sends plain OpenAI-style requests to an OpenAI-compatible endpoint: no OpenRouter routing or usage fields', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      reply(200, { id: 'chatcmpl-1', model: 'qwen2.5:7b', choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
    )
    const client = openRouterClient({ fetch: fetchImpl, apiBase: 'http://ollama:11434/v1/', dialect: 'openai' })
    const result = await client.chat('none', { model: 'qwen2.5:7b', messages: [{ role: 'user', content: 'hi' }] })
    expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 1, costUsd: 0 })
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe('http://ollama:11434/v1/chat/completions')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body).toEqual({ model: 'qwen2.5:7b', messages: [{ role: 'user', content: 'hi' }], temperature: 0 })
  })

  it('runs an agent turn with tools: the calls the model asks for, and the conversation in the wire format', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      reply(200, {
        id: 'gen-2',
        model: 'anthropic/claude-sonnet-5.5',
        choices: [{ message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'docket_search', arguments: '{"query":"orders"}' } }] } }],
        usage: { prompt_tokens: 120, completion_tokens: 9, cost: 0.002 },
      }),
    )
    const client = openRouterClient({ fetch: fetchImpl })
    const tool = { name: 'docket_search', description: 'Search.', parameters: { type: 'object', properties: { query: { type: 'string' } } } }
    const result = await client.turn('sk-or-org', {
      model: 'anthropic/claude-sonnet-5.5',
      messages: [
        { role: 'system', content: 'You look things up.' },
        { role: 'user', content: 'Who owns orders?' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_0', name: 'docket_get', arguments: '{"id":"service.orders"}' }] },
        { role: 'tool', toolCallId: 'call_0', content: 'service.orders (service)' },
      ],
      tools: [tool],
      maxTokens: 500,
    })
    expect(result).toEqual({
      content: '',
      toolCalls: [{ id: 'call_1', name: 'docket_search', arguments: '{"query":"orders"}' }],
      model: 'anthropic/claude-sonnet-5.5',
      generationId: 'gen-2',
      usage: { promptTokens: 120, completionTokens: 9, costUsd: 0.002 },
    })
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({ tools: [{ type: 'function', function: tool }], tool_choice: 'auto', max_tokens: 500, provider: PRIVACY_ROUTING, temperature: 0 })
    expect(body.messages.slice(2)).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'docket_get', arguments: '{"id":"service.orders"}' } }] },
      { role: 'tool', tool_call_id: 'call_0', content: 'service.orders (service)' },
    ])

    // With no tools, nothing about tools is sent.
    await client.turn('sk-or-org', { model: 'm', messages: [{ role: 'user', content: 'Answer now.' }], tools: [] })
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).not.toHaveProperty('tools')
  })

  it('provisions a key with a monthly credit limit through the provisioning key', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(201, { key: 'sk-or-v1-new', data: { hash: 'abc' } }))
    const client = openRouterClient({ fetch: fetchImpl, provisioningKey: 'sk-or-prov' })
    expect(await client.createKey({ name: 'docket-cloud org_x', limitUsd: 20 })).toEqual({ key: 'sk-or-v1-new', hash: 'abc' })
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe('https://openrouter.ai/api/v1/keys')
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer sk-or-prov')
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'docket-cloud org_x', limit: 20, limit_reset: 'monthly', include_byok_in_limit: true })
  })

  it('reports OpenRouter errors without the request', async () => {
    const client = openRouterClient({ fetch: async () => reply(402, { error: { message: 'Key limit exceeded' } }) })
    const failed = client.chat('k', { model: 'm', messages: [{ role: 'user', content: 'secret customer text' }] })
    await expect(failed).rejects.toBeInstanceOf(OpenRouterError)
    await expect(client.chat('k', { model: 'm', messages: [{ role: 'user', content: 'secret customer text' }] })).rejects.toThrow(
      /402 Key limit exceeded$/,
    )
    await expect(openRouterClient().createKey({ name: 'x', limitUsd: 1 })).rejects.toThrow(/no OpenRouter provisioning key/)
  })
})
