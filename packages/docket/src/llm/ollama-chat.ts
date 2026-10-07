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

/** Sends a prompt, returns the model's reply text. */
export type Chat = (prompt: ChatPrompt) => Promise<string>

/** A local Ollama model, at temperature 0 so the same question reads the same way twice. */
export const ollamaChat =
  (config: OllamaChatConfig, fetchImpl: typeof fetch = fetch): Chat =>
  async (prompt) => {
    const response = await fetchImpl(`${config.url.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(config.timeoutMs),
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
