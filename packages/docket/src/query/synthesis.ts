import { ollamaChat, questionTerms, relevantExcerpt, stableStringify, type Chat, type ChatPrompt } from '@docket/adapter-kit'
import type { AdapterAnswer, ConversationTurn, ResultBlock, RetrievedEvidence, TableCell } from '@docket/contracts'

import type { SummarizeConfig } from '../config/config.js'
import { ClaudeNotFoundError, claudeChat } from '../llm/claude-chat.js'
import type { MemoryEntity } from '../model/index.js'
import { readCachedSummary, summaryCacheDir, summaryKey, writeCachedSummary, type CachedExhibit } from '../open/summary-cache.js'
import { hashContent } from '../source/hashing.js'
import type { RequestSnapshot } from './snapshot.js'
import type { AdapterResult, Connection, FoundReference, ReferenceStatus, Synthesis, SynthesisNotice } from './wire.js'

export const SYNTHESIS_INSTRUCTIONS = `You answer questions about a software project from its casebook: exhibits, each a record of one service, team, datasource, decision or other resource with the relationships it declares, and the results memory adapters returned for the question, each with its evidence.

Rules:
- Use only the exhibits, results and evidence given. When they do not answer the question - nothing relevant was found, or what would answer it was never recorded - say so plainly.
- Cite every exhibit you rely on by its id in square brackets, exactly as given, e.g.
  "Checkout runs on the Orders API [service.orders], owned by Payments [team.payments]."
  Cite evidence the same way by its id, e.g. [graph:row-1].
- Evidence marked "derived" was computed or extracted by an engine, not recorded in the files. Say so when you rely on it, and prefer recorded evidence where they differ.
- Say what each result covers. A result of "top matches only" is a sample: never present how many it found as a count or a total. Only a result covering "every match" can be counted, and only within what the files record.
- When results disagree - adapters give different counts or facts - give each figure with the adapter that gave it. Never pick one silently or average them.
- Exhibits listed as on the paths between others connect them: mention one when it explains how the others relate.
- Be brief: a short paragraph, or a few bullet points when listing things.
- No preamble, and do not restate the question.`

/** The whole prompt stays within this: relevant excerpts are chosen to fit, rather than every text cut at the same length. */
export const SYNTHESIS_BUDGET_CHARS = 24_000

/** Exhibits found by the adapters, and exhibits on the paths between them, a prompt describes at most. */
const MAX_FOUND_EXHIBITS = 12
const MAX_PATH_EXHIBITS = 8
/** One exhibit's notes or one piece of evidence never take more than this, however much room is left. */
const MAX_TEXT_CHARS = 1_500
const MIN_TEXT_CHARS = 160
const MAX_TABLE_ROWS = 15
const MAX_TIMELINE_EVENTS = 15
const MAX_GRAPH_EDGES = 20

/** A configured model: how to ask it, and what it is called. */
interface Summarizer {
  /** Shown beside its summaries, e.g. `claude` or `qwen2.5:7b`. */
  name: string
  /** What cached summaries are keyed on, so switching model or provider never returns another's answer. */
  identity: string
  chat: Chat
}

export const summarizerFor = (config: SummarizeConfig): Summarizer =>
  config.provider === 'claude'
    ? {
        name: config.model ? `claude (${config.model})` : 'claude',
        identity: `claude:${config.model ?? ''}`,
        chat: claudeChat(config)
      }
    : { name: config.model, identity: `ollama:${config.url}:${config.model}`, chat: ollamaChat(config) }

export const NOT_INSTALLED =
  'Claude Code is not installed, so here is what the adapters found. Install it (https://claude.com/claude-code) ' +
  'and log in to have answers summarized by the `claude` CLI, or add a `summarize` section to .docket.yaml - ' +
  'e.g. `summarize: { model: "qwen2.5:7b" }` for Ollama at http://localhost:11434.'

/**
 * Ids cited as `[id]`, grouped as `[a, b]` or `[a; b]` - or in backticks, as
 * models often write ids anyway - in first-cited order, keeping only ids the
 * model was given.
 */
export const citationsIn = (text: string, known: ReadonlySet<string>): string[] => {
  const cited = new Set<string>()
  for (const match of text.matchAll(/\[([^[\]]+)\]|`([^`\s]+)`/g)) {
    for (const id of (match[1] ?? match[2] ?? '').split(/[,;]/).map((part) => part.trim())) {
      if (known.has(id)) cited.add(id)
    }
  }
  return [...cited]
}

/** One pool of the prompt's budget, handing what it does not use on to the next. */
class Budget {
  constructor(private left: number) {}
  get remaining(): number {
    return this.left
  }
  /** Room for one of `count` items still to come, within the bounds every text keeps. */
  share(count: number): number {
    return Math.max(MIN_TEXT_CHARS, Math.min(MAX_TEXT_CHARS, Math.floor(this.left / Math.max(1, count))))
  }
  take(text: string): boolean {
    if (text.length > this.left) return false
    this.left -= text.length
    return true
  }
  carry(next: number): Budget {
    return new Budget(this.left + next)
  }
}

const COVERAGE: Record<AdapterAnswer['coverage']['mode'], string> = {
  exhaustive: 'every match in scope',
  'top-k': 'top matches only - a sample, not a count',
  unknown: 'coverage unknown'
}

const STANDING: Record<ReferenceStatus, string> = {
  resolved: 'on record',
  stale: 'from an index behind the files',
  unresolved: 'not found in the files'
}

const cellText = (cell: TableCell | undefined): string =>
  cell === null || cell === undefined ? '' : typeof cell === 'object' ? cell.id : String(cell)

const cites = (ids: readonly string[] | undefined): string => (ids && ids.length > 0 ? ` [${ids.join(', ')}]` : '')

/** A block as lines the model can read, its rows and edges citing their own evidence. */
const blockLines = (block: ResultBlock): string[] => {
  const title = block.title ? ` "${block.title}"` : ''
  switch (block.kind) {
    case 'entities':
      return [`  entities${title}: ${block.entities.map((item) => item.ref.id).join(', ') || 'none'}`]
    case 'passages':
    case 'facts':
      return [`  ${block.kind}${title}:${cites(block.evidenceIds)}`]
    case 'metric':
      return [`  metric: ${block.label} = ${block.value}${block.unit ? ` ${block.unit}` : ''}${cites(block.evidenceIds)}`]
    case 'table': {
      const shown = block.rows.slice(0, MAX_TABLE_ROWS)
      return [
        `  table${title} (${block.rows.length} row${block.rows.length === 1 ? '' : 's'}):`,
        `    ${block.columns.map((column) => column.label).join(' | ')}`,
        ...shown.map((row) => `    ${block.columns.map((column) => cellText(row.cells[column.key])).join(' | ')}${cites(row.evidenceIds)}`),
        ...(block.rows.length > shown.length ? [`    … ${block.rows.length - shown.length} more rows`] : [])
      ]
    }
    case 'timeline': {
      const shown = block.events.slice(0, MAX_TIMELINE_EVENTS)
      return [
        `  timeline${title}:`,
        ...shown.map((event) => `    ${event.at} (${event.semantics === 'event' ? 'happened' : event.semantics}) ${event.label}${cites(event.evidenceIds)}`),
        ...(block.events.length > shown.length ? [`    … ${block.events.length - shown.length} more events`] : [])
      ]
    }
    case 'graph': {
      const shown = block.edges.slice(0, MAX_GRAPH_EDGES)
      return [
        `  graph${title}: ${shown.map((edge) => `${edge.source} -${edge.rel}-> ${edge.target}${cites(edge.evidenceIds)}`).join('; ')}`,
        ...(block.paths ?? []).map((path) => `    path: ${path.join(' - ')}`)
      ]
    }
    default:
      return []
  }
}

/** One adapter's part: how it read the question, how much it covered, and what it returned - or why it returned nothing. */
const resultLines = (result: AdapterResult): string[] => {
  if (result.state === 'failed') return [`${result.adapter}: no answer (${result.error.code}) - ${result.error.message}`]
  const { interpretation, coverage, blocks } = result.answer
  return [
    `${result.adapter}: ${interpretation.description || 'no description of how it searched'} (${COVERAGE[coverage.mode]}${coverage.truncated ? ', cut short' : ''})`,
    ...interpretation.assumptions.map((assumption) => `  assumes: ${assumption}`),
    ...(interpretation.timeRange ? [`  time range: ${interpretation.timeRange.from} to ${interpretation.timeRange.to}`] : []),
    ...(blocks.length === 0 ? ['  found nothing'] : blocks.flatMap(blockLines))
  ]
}

/** Metrics two or more adapters gave different values for, side by side, so the model never chooses one. */
const disagreements = (results: readonly AdapterResult[]): string[] => {
  const readings = new Map<string, { label: string; values: { adapter: string; value: string; coverage: string }[] }>()
  for (const result of results) {
    if (result.state !== 'answered') continue
    for (const block of result.answer.blocks) {
      if (block.kind !== 'metric') continue
      const key = block.label.trim().toLowerCase()
      const entry = readings.get(key) ?? { label: block.label, values: [] }
      entry.values.push({
        adapter: result.adapter,
        value: `${block.value}${block.unit ? ` ${block.unit}` : ''}`,
        coverage: COVERAGE[result.answer.coverage.mode]
      })
      readings.set(key, entry)
    }
  }
  return [...readings.values()]
    .filter(({ values }) => new Set(values.map((reading) => reading.adapter)).size > 1 && new Set(values.map((reading) => reading.value)).size > 1)
    .map(({ label, values }) => `- ${label}: ${values.map((reading) => `${reading.adapter} says ${reading.value} (${reading.coverage})`).join('; ')}`)
}

const describeExhibit = (entity: MemoryEntity, notes: string): string => {
  const lines = [`[${entity.id}] ${entity.title} (${entity.type})`]
  if (entity.tags.length > 0) lines.push(`tags: ${entity.tags.join(', ')}`)
  if (Object.keys(entity.attributes).length > 0) lines.push(`attributes: ${JSON.stringify(entity.attributes)}`)
  if (entity.links.length > 0) lines.push(`links: ${entity.links.map((link) => `${link.rel} -> ${link.target}`).join('; ')}`)
  if (notes) lines.push(`notes: ${notes}`)
  return lines.join('\n')
}

const walk = (path: Connection): string =>
  path.nodes
    .map((id, index) => {
      const step = path.steps[index]
      return step ? `${id} ${step.forward ? `-${step.rel}->` : `<-${step.rel}-`} ` : id
    })
    .join('')

export interface SynthesisInput {
  question: string
  context: { scope: string; now: string; timezone: string }
  conversation?: readonly ConversationTurn[] | undefined
  /** Checked and namespaced. */
  results: readonly AdapterResult[]
  references: readonly FoundReference[]
  connections: readonly Connection[]
  snapshot: RequestSnapshot
}

/** What a prompt was built from: the exhibits it describes and every evidence id it shows. */
export interface SynthesisPrompt {
  prompt: ChatPrompt
  exhibits: MemoryEntity[]
  evidence: string[]
}

/**
 * The prompt a model writes the answer from (docs/adapter-spec.md §10 step 5):
 * each adapter's results as it gave them, with how it read the question and
 * how much it covered; metrics that disagree, side by side; the exhibits the
 * answers point at, then those on the canonical paths between them; and each
 * piece of evidence, recorded or derived, with its standing against the files.
 *
 * Everything fits one total budget: results first, then exhibits, then
 * evidence, each pool passing on what it leaves. Long texts give their most
 * relevant paragraphs rather than their first lines.
 */
export const synthesisPrompt = (input: SynthesisInput, budget = SYNTHESIS_BUDGET_CHARS): SynthesisPrompt => {
  const terms = questionTerms(input.question)
  const header = [
    `Question: ${input.question}`,
    `Asked: ${input.context.now} (time zone ${input.context.timezone}), in scope "${input.context.scope}"`
  ]
  if (input.conversation && input.conversation.length > 0) {
    header.push(`Conversation so far:\n${input.conversation.map((turn) => `${turn.role}: ${turn.content}`).join('\n')}`)
  }
  const sections = [header.join('\n')]

  let pool = new Budget(Math.floor(budget * 0.3))
  const results: string[] = []
  for (const result of input.results) {
    const text = resultLines(result).join('\n')
    if (pool.take(text)) results.push(text)
    else results.push(`${result.adapter}: results left out for space`)
  }
  if (results.length > 0) sections.push(`Results:\n\n${results.join('\n\n')}`)
  const disagree = disagreements(input.results)
  if (disagree.length > 0) sections.push(`Adapters disagree:\n${disagree.join('\n')}`)

  // Exhibits: what the answers point at, then what joins them.
  const found: string[] = []
  for (const reference of input.references) {
    if (reference.status === 'unresolved') continue
    const id = reference.kind === 'entity' ? reference.id : reference.entity
    if (id !== undefined && !found.includes(id) && input.snapshot.entity(id)) found.push(id)
  }
  const foundIds = found.slice(0, MAX_FOUND_EXHIBITS)
  const onPaths = [...new Set(input.connections.flatMap((path) => path.nodes))]
    .filter((id) => !foundIds.includes(id) && input.snapshot.entity(id) !== undefined)
    .slice(0, MAX_PATH_EXHIBITS)

  pool = pool.carry(Math.floor(budget * 0.4))
  const exhibits: MemoryEntity[] = []
  const describe = (ids: readonly string[]): string[] =>
    ids.flatMap((id, index) => {
      const entity = input.snapshot.entity(id) as MemoryEntity
      const notes = relevantExcerpt(entity.content, terms, pool.share(ids.length - index)).text
      const text = describeExhibit(entity, notes)
      if (!pool.take(text)) return []
      exhibits.push(entity)
      return [text]
    })
  const foundText = describe(foundIds)
  const pathText = describe(onPaths)
  if (foundText.length > 0) sections.push(`Exhibits:\n\n${foundText.join('\n\n')}`)
  if (pathText.length > 0) sections.push(`On the paths between them:\n\n${pathText.join('\n\n')}`)
  if (input.connections.length > 0) sections.push(`How they connect:\n${input.connections.map(walk).join('\n')}`)

  pool = pool.carry(budget - Math.floor(budget * 0.3) - Math.floor(budget * 0.4))
  const items = input.results.flatMap((result) =>
    result.state === 'answered' ? result.answer.evidence.map((item) => ({ adapter: result.adapter, item, statuses: result.references?.[item.id] ?? [] })) : []
  )
  const shown: string[] = []
  const evidence: string[] = []
  let omitted = 0
  items.forEach(({ adapter, item, statuses }, index) => {
    const text = describeEvidence(adapter, item, statuses, relevantExcerpt(item.text, terms, pool.share(items.length - index)).text)
    if (!pool.take(text)) {
      omitted += 1
      return
    }
    shown.push(text)
    evidence.push(item.id)
  })
  if (shown.length > 0) {
    sections.push(`Evidence:\n\n${shown.join('\n\n')}${omitted > 0 ? `\n\n(${omitted} more pieces of evidence left out for space)` : ''}`)
  }

  return { prompt: { system: SYNTHESIS_INSTRUCTIONS, user: sections.join('\n\n') }, exhibits, evidence }
}

const describeEvidence = (adapter: string, item: RetrievedEvidence, statuses: readonly ReferenceStatus[], text: string): string => {
  const derived = item.kind === 'derived-fact' || item.derivation !== undefined
  const how = derived
    ? `derived${item.derivation ? ` by ${item.derivation.engine}${item.derivation.model ? ` (${item.derivation.model})` : ''}` : ''}, not recorded`
    : item.kind
  const when = [item.eventAt ? `happened ${item.eventAt}` : '', item.observedAt ? `observed ${item.observedAt}` : ''].filter(Boolean).join(', ')
  const sources = item.canonicalRefs.map((ref, index) => `${ref.kind} ${ref.id} (${STANDING[statuses[index] ?? 'unresolved']})`)
  return [
    `[${item.id}] ${how}, from ${adapter}${when ? `, ${when}` : ''}; ${sources.length > 0 ? `source: ${sources.join(', ')}` : 'no canonical source'}`,
    text
  ].join('\n')
}

export interface SynthesizeOptions {
  summarize: SummarizeConfig
  /** Where `.docket/` is: summaries are kept in its `.cache/`. */
  memoryRoot: string
  /**
   * Each answering adapter's configuration fingerprint and the checkpoint it
   * answered at, when known. A summary built on an answer of unknown
   * freshness is neither read from nor written to the cache.
   */
  adapters: ReadonlyMap<string, { fingerprint: string; checkpoint?: string | undefined }>
  signal?: AbortSignal | undefined
}

export interface SynthesisOutcome {
  synthesis: Synthesis | null
  notice?: SynthesisNotice
}

/** The calendar day `now` falls on in `timezone`: questions about "this week" read differently tomorrow. */
const dayIn = (now: string, timezone: string): string => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
  } catch {
    return now.slice(0, 10)
  }
}

/**
 * Has the configured model - the `claude` CLI unless an Ollama model is set -
 * write an answer from the results, citing exhibits and evidence. Results stand
 * without it: a missing model, a failing one or nothing to summarise is a
 * notice, never an error.
 *
 * A summary is kept in `.docket/.cache/chat/` against everything it was
 * written from (`summaryKey`) and returned unchanged, without the model, until
 * any of it changes. An adapter whose freshness is unknown - no checkpoint from
 * sync or from its own answer - makes the summary uncacheable.
 */
export const synthesize = async (input: SynthesisInput, options: SynthesizeOptions): Promise<SynthesisOutcome> => {
  const model = summarizerFor(options.summarize)
  const built = synthesisPrompt(input)
  const structured = input.results.some(
    (result) => result.state === 'answered' && result.answer.blocks.some((block) => block.kind !== 'entities')
  )
  if (built.exhibits.length === 0 && built.evidence.length === 0 && !structured) {
    return { synthesis: null, notice: { reason: 'empty', message: 'The adapters found nothing, so there is nothing to summarize.' } }
  }

  const exhibits: CachedExhibit[] = built.exhibits.map((entity) => ({ id: entity.id, hash: entity.hash }))
  const answered = input.results.filter((result): result is Extract<AdapterResult, { state: 'answered' }> => result.state === 'answered')
  const checkpoints = answered.map((result) => result.answer.coverage.checkpoint ?? options.adapters.get(result.adapter)?.checkpoint)
  const cacheable = checkpoints.every((checkpoint) => checkpoint !== undefined)
  const key = summaryKey(input.question, { model: model.identity, instructions: SYNTHESIS_INSTRUCTIONS }, {
    context: {
      scope: input.context.scope,
      timezone: input.context.timezone,
      day: dayIn(input.context.now, input.context.timezone),
      conversation: input.conversation ?? []
    },
    adapters: input.results.map((result) =>
      result.state === 'answered'
        ? {
            id: result.adapter,
            fingerprint: options.adapters.get(result.adapter)?.fingerprint ?? null,
            checkpoint: result.answer.coverage.checkpoint ?? options.adapters.get(result.adapter)?.checkpoint ?? null,
            answer: hashContent(stableStringify(result.answer))
          }
        : { id: result.adapter, failed: result.error.code }
    ),
    exhibits,
    sources: input.references.map((reference) => ({ kind: reference.kind, id: reference.id, revision: reference.revision ?? null })),
    paths: input.connections
  })
  const dir = summaryCacheDir(options.memoryRoot)
  const evidenceIds = new Set(built.evidence)
  const exhibitIds = new Set(exhibits.map((exhibit) => exhibit.id))

  if (cacheable) {
    const cached = await readCachedSummary(dir, input.question, key)
    if (cached) {
      return {
        synthesis: {
          text: cached.text,
          citedEvidence: cached.citedEvidence ?? [],
          citedEntities: cached.cited,
          model: cached.model,
          cached: true,
          createdAt: cached.createdAt
        }
      }
    }
  }

  let text: string
  try {
    text = (await model.chat(built.prompt, { signal: options.signal })).trim()
  } catch (cause) {
    if (cause instanceof ClaudeNotFoundError) return { synthesis: null, notice: { reason: 'unconfigured', message: NOT_INSTALLED } }
    return {
      synthesis: null,
      notice: { reason: 'failed', message: `Could not summarize with ${model.name}: ${cause instanceof Error ? cause.message : String(cause)}` }
    }
  }

  const citedEntities = citationsIn(text, exhibitIds)
  const citedEvidence = citationsIn(text, evidenceIds)
  const createdAt = new Date().toISOString()
  if (cacheable) {
    try {
      await writeCachedSummary(dir, {
        key,
        question: input.question,
        model: model.name,
        adapters: input.results.map((result) => result.adapter),
        exhibits,
        text,
        cited: citedEntities,
        citedEvidence,
        createdAt
      })
    } catch {
      // A docket that cannot be written to still gets its answer, just not kept.
    }
  }
  return { synthesis: { text, citedEvidence, citedEntities, model: model.name, cached: false, createdAt } }
}
