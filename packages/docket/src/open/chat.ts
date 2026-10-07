import type { MemoryConfig, OllamaModelConfig } from '../config/config.js'
import { ollamaChat, type ChatPrompt } from '../llm/ollama-chat.js'
import type { MemoryEntity } from '../model/index.js'
import { askCasebook } from './ask.js'
import {
  readCachedSummary,
  summaryCacheDir,
  summaryKey,
  writeCachedSummary,
  type CachedExhibit
} from './summary-cache.js'
import type { UiAnswer, UiChatAnswer } from './types.js'

/** An exhibit's notes beyond this are cut: the model needs the gist, not the whole file. */
const MAX_NOTES = 1_500

/**
 * The model chat summarizes with: `summarize`, else the one a `neo4j`
 * projection already writes Cypher with, else none.
 */
export const summarizerOf = (config: MemoryConfig): OllamaModelConfig | undefined =>
  config.summarize ??
  config.projections.flatMap((projection) => (projection.type === 'neo4j' && projection.cypher ? [projection.cypher] : []))[0]

const SYSTEM = `You answer questions about a software project from its casebook: exhibits, each a record of one service, team, datasource, decision or other resource, with the relationships it declares.

Rules:
- Use only the exhibits given. When they do not answer the question, say so plainly.
- Cite every exhibit you rely on by its id in square brackets, exactly as given, e.g.
  "Checkout runs on the Orders API [service.orders], owned by Payments [team.payments]."
- Be brief: a short paragraph, or a few bullet points when listing things.
- No preamble, and do not restate the question.`

const describe = (entity: MemoryEntity): string => {
  const lines = [`[${entity.id}] ${entity.title} (${entity.type})`]
  if (entity.tags.length > 0) lines.push(`tags: ${entity.tags.join(', ')}`)
  if (Object.keys(entity.attributes).length > 0) lines.push(`attributes: ${JSON.stringify(entity.attributes)}`)
  if (entity.links.length > 0) {
    lines.push(`links: ${entity.links.map((link) => `${link.rel} -> ${link.target}`).join('; ')}`)
  }
  const notes = entity.content.trim()
  if (notes) lines.push(`notes: ${notes.length > MAX_NOTES ? `${notes.slice(0, MAX_NOTES)}…` : notes}`)
  return lines.join('\n')
}

export const summaryPrompt = (question: string, exhibits: readonly MemoryEntity[], answer: UiAnswer): ChatPrompt => {
  const sections = [`Question: ${question}`, `Exhibits:\n\n${exhibits.map(describe).join('\n\n')}`]
  if (answer.paths.length > 0) {
    const walked = answer.paths.map((path) =>
      path.nodes
        .map((id, index) => {
          const step = path.steps[index]
          return step ? `${id} ${step.forward ? `-${step.rel}->` : `<-${step.rel}-`} ` : id
        })
        .join('')
    )
    sections.push(`How they connect:\n${walked.join('\n')}`)
  }
  return { system: SYSTEM, user: sections.join('\n\n') }
}

/**
 * Ids cited as `[id]`, grouped as `[a, b]` or `[a; b]` - or in backticks, as
 * models often write ids anyway - in first-cited order, keeping only exhibits
 * the model was given.
 */
export const citationsIn = (text: string, exhibits: ReadonlySet<string>): string[] => {
  const cited = new Set<string>()
  for (const match of text.matchAll(/\[([^[\]]+)\]|`([^`\s]+)`/g)) {
    for (const id of (match[1] ?? match[2] ?? '').split(/[,;]/).map((part) => part.trim())) {
      if (exhibits.has(id)) cited.add(id)
    }
  }
  return [...cited]
}

/**
 * Asks the casebook, then has a model summarize what was found, citing the
 * exhibits. A summary is kept in `.docket/.cache/` against the question, the
 * hash of every exhibit it was built from and the paths connecting them, so
 * asking again returns it unchanged - without the model - until the question,
 * one of those exhibits or a connection between them changes. The cache is the only thing this writes.
 */
export const chat = async (cwd: string, query: string, limit: number): Promise<UiChatAnswer> => {
  const { answer, resolved, entities } = await askCasebook(cwd, query, limit)
  const model = summarizerOf(resolved.config)
  if (!model) {
    return {
      query,
      answer,
      summary: null,
      notice: {
        reason: 'unconfigured',
        message:
          'No model is configured to summarize answers, so here is what search found. ' +
          'Add a `summarize` section to .docket.yaml - e.g. `summarize: { model: "qwen2.5:7b" }` for Ollama at ' +
          'http://localhost:11434 - to have answers summarized.'
      }
    }
  }

  const byId = new Map(entities.map((entity) => [entity.id, entity]))
  const exhibits = answer.documents.flatMap((document) => {
    const entity = byId.get(document.id)
    return entity ? [entity] : []
  })
  if (exhibits.length === 0) {
    return { query, answer, summary: null, notice: { reason: 'empty', message: 'Nothing in the casebook matched, so there is nothing to summarize.' } }
  }

  const hashes: CachedExhibit[] = exhibits.map((entity) => ({ id: entity.id, hash: entity.hash }))
  const key = summaryKey(query, { model: model.model, instructions: SYSTEM }, hashes, answer.paths)
  const dir = summaryCacheDir(resolved.memoryRoot)
  const cached = await readCachedSummary(dir, query, key)
  if (cached) {
    return {
      query,
      answer,
      summary: { text: cached.text, cited: cached.cited, model: cached.model, cached: true, createdAt: cached.createdAt }
    }
  }

  let text: string
  try {
    text = (await ollamaChat(model)(summaryPrompt(query, exhibits, answer))).trim()
  } catch (cause) {
    return {
      query,
      answer,
      summary: null,
      notice: { reason: 'failed', message: `Could not summarize with ${model.model}: ${cause instanceof Error ? cause.message : String(cause)}` }
    }
  }

  const cited = citationsIn(text, new Set(hashes.map((exhibit) => exhibit.id)))
  const createdAt = new Date().toISOString()
  try {
    await writeCachedSummary(dir, { key, question: query, model: model.model, exhibits: hashes, text, cited, createdAt })
  } catch {
    // A docket that cannot be written to still gets its answer, just not kept.
  }
  return { query, answer, summary: { text, cited, model: model.model, cached: false, createdAt } }
}
