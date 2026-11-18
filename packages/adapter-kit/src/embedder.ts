import { z } from 'zod'

/** nomic-embed-text, the model Docket Cloud embeds with, wants these before what it embeds (its model card). */
export const NOMIC_PREFIXES = { document: 'search_document: ', query: 'search_query: ' } as const

/**
 * Embeddings for semantic search, from a local Ollama model. `prefixes` is
 * what the model wants before each stored text and each query; unset, it is
 * nomic-embed-text's for a nomic-embed-text model and nothing for any other.
 */
export const semanticConfigSchema = z.strictObject({
  provider: z.literal('ollama').default('ollama'),
  url: z.string().url().default('http://localhost:11434'),
  model: z.string().min(1).default('nomic-embed-text'),
  /** The model's vector size: nomic-embed-text's is 768. */
  dimensions: z.number().int().min(1).max(16_000).default(768),
  prefixes: z.strictObject({ document: z.string(), query: z.string() }).optional(),
  /** Texts per request to the model. */
  batchSize: z.number().int().min(1).max(512).default(32),
  timeoutMs: z.number().int().positive().default(60_000)
})

export type SemanticConfig = z.infer<typeof semanticConfigSchema>

/** The prefixes the configured model is given, nomic-embed-text's by default for that model. */
export const prefixesOf = (semantic: SemanticConfig): { document: string; query: string } =>
  semantic.prefixes ?? (/^nomic-embed-text(:|$)/.test(semantic.model) ? NOMIC_PREFIXES : { document: '', query: '' })

/** What an entity says about itself, as an embedder reads it: title, type, body and tags, as adapter-mem0 renders it. */
export const embeddingText = (entity: { title: string; type: string; content: string; tags: readonly string[] }): string => {
  const lines = [`# ${entity.title}`, entity.type]
  const body = entity.content.trim()
  if (body) lines.push('', body)
  if (entity.tags.length > 0) lines.push('', `Tags: ${entity.tags.join(', ')}`)
  return `${lines.join('\n')}\n`
}

/** Turns texts into vectors, one per text, in order. */
export interface Embedder {
  /** What `embeddings.model` records, so vectors from another model are told apart. */
  readonly model: string
  readonly dimensions: number
  embed(texts: readonly string[]): Promise<number[][]>
}

/** An embedding model behind Ollama's `/api/embed`, which truncates what is too long for it. */
export const ollamaEmbedder = (config: SemanticConfig, fetchImpl: typeof fetch = fetch): Embedder => ({
  model: config.model,
  dimensions: config.dimensions,
  async embed(texts) {
    if (texts.length === 0) return []
    const response = await fetchImpl(`${config.url.replace(/\/+$/, '')}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(config.timeoutMs),
      body: JSON.stringify({ model: config.model, input: texts })
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Ollama ${config.model} embed failed: ${response.status} ${text}`)
    const { embeddings } = JSON.parse(text) as { embeddings?: unknown }
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new Error(`Ollama ${config.model} returned ${Array.isArray(embeddings) ? embeddings.length : 'no'} embeddings for ${texts.length} texts`)
    }
    return embeddings.map((vector: unknown) => {
      if (!Array.isArray(vector) || vector.length !== config.dimensions || !vector.every((value) => typeof value === 'number')) {
        throw new Error(
          `Ollama ${config.model} returned a vector of ${Array.isArray(vector) ? vector.length : 0} dimensions; ` +
            `semantic.dimensions says ${config.dimensions}`
        )
      }
      return vector as number[]
    })
  }
})
