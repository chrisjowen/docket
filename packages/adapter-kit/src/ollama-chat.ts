import { z } from 'zod'

/** A local Ollama chat model. */
export const ollamaModelSchema = z.object({
  provider: z.literal('ollama').default('ollama'),
  url: z.string().url().default('http://localhost:11434'),
  model: z.string().min(1),
  timeoutMs: z.number().int().positive().default(60_000)
})

export type OllamaModelConfig = z.infer<typeof ollamaModelSchema>

/** What a model is asked: its instructions, and the question. */
export interface ChatPrompt {
  system: string
  user: string
}

export interface OllamaChatConfig {
  url: string
  model: string
  timeoutMs: number
}

/** Sends a prompt, returns the model's reply text. Aborting `signal` gives up on the reply. */
export type Chat = (prompt: ChatPrompt, options?: { signal?: AbortSignal | undefined }) => Promise<string>

/** A local Ollama model, at temperature 0 so the same question reads the same way twice. */
export const ollamaChat =
  (config: OllamaChatConfig, fetchImpl: typeof fetch = fetch): Chat =>
  async (prompt, options = {}) => {
    const timeout = AbortSignal.timeout(config.timeoutMs)
    const response = await fetchImpl(`${config.url.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
      body: JSON.stringify({
        model: config.model,
        stream: false,
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ]
      })
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Ollama ${config.model} failed: ${response.status} ${text}`)
    const content = (JSON.parse(text) as { message?: { content?: unknown } }).message?.content
    if (typeof content !== 'string') throw new Error(`Ollama ${config.model} returned no message`)
    return content
  }
