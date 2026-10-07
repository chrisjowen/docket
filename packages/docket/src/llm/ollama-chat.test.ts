import { describe, expect, it } from 'vitest'

import { ollamaChat } from './ollama-chat.js'

describe('ollamaChat', () => {
  it('sends the prompt deterministically and returns the reply', async () => {
    const calls: { url: string; body: unknown }[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ message: { role: 'assistant', content: 'MATCH (n) RETURN n' } }))
    }
    const chat = ollamaChat({ url: 'http://localhost:11434/', model: 'qwen2.5:7b', timeoutMs: 1000 }, fetchImpl)

    expect(await chat({ system: 'sys', user: 'q' })).toBe('MATCH (n) RETURN n')
    expect(calls).toEqual([
      {
        url: 'http://localhost:11434/api/chat',
        body: {
          model: 'qwen2.5:7b',
          stream: false,
          options: { temperature: 0 },
          messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'q' }
          ]
        }
      }
    ])
  })

  it('reports what Ollama said when it fails', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('{"error":"model \\"nope\\" not found"}', { status: 404 })
    const chat = ollamaChat({ url: 'http://localhost:11434', model: 'nope', timeoutMs: 1000 }, fetchImpl)

    await expect(chat({ system: '', user: '' })).rejects.toThrow(/404.*not found/)
  })
})
