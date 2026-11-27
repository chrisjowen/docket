// SPDX-License-Identifier: AGPL-3.0-only
import { InvalidArgumentsError, type ToolContext } from '@chrisjowen/docket'
import type { TurnMessage, TurnTool } from '@docket/platform-ai'
import { QueryError, type CloudTool, type QueryClient, type TurnResponse } from '@docket/platform-mcp-tools'
import { createParser } from '@openuidev/svelte-lang'

import { citedSources, referencesIn, sourceKey } from '$lib/ask/agent'
import type { AgentAnswer, AgentStep, AnswerSource, AskWorkspace } from '$lib/ask/model'
import { answerLibrary, answerPrompt } from '$lib/components/ask/answer/library'

import type { AskDeps, OrgWorkspace } from './ask'

/**
 * The Ask page's agent: a question put to one or more of the org's dockets,
 * answered in as many steps as it needs. Each step is a call to a docket's
 * own MCP read tools - `docket_search`, `docket_get`, `docket_ask`'s grounded
 * retrieval and `docket_ontology` - exactly as an MCP client gets them; each
 * turn of the model runs on the org's model in the worker, which checks the
 * org's AI cap and meters it. The loop stops at a fixed number of turns,
 * look-ups and dollars, and the answer comes back as OpenUI Lang for the
 * page's components, every record it names one the tools returned.
 */

export const AGENT_LIMITS = {
  /** Model turns, the answer included. */
  turns: 8,
  /** Tool calls across the whole question. */
  calls: 16,
  /** Tool calls run from one turn. */
  perTurn: 6,
  /** What one question's turns may cost, in US dollars; past 60% of it the next turn must answer. */
  costUsd: 0.5,
  /** The most of one tool's answer the model reads. */
  resultChars: 12_000,
  /** What the model may write in a turn that looks things up, and in the answer. */
  lookupTokens: 1_500,
  answerTokens: 3_000,
} as const

export interface AgentDeps extends Pick<AskDeps, 'orgId' | 'actor' | 'userId' | 'describe'> {
  query: Pick<QueryClient, 'turn'>
  /** A docket's MCP read tools, as the member asking may call them. */
  tools(workspace: OrgWorkspace): CloudTool[]
}

/** What the page hears as the agent works: each turn of the model, and each look-up as it starts and ends. */
export type AgentEvent = { type: 'turn'; turn: number } | { type: 'step'; index: number; step: AgentStep }

/** The agent's answer, or why no model could be asked at all: the caller answers another way. */
export type AgentOutcome = { answered: AgentAnswer } | { unavailable: string }

/** The tools the agent calls, each taking the docket to look in. */
const AGENT_TOOLS = ['docket_search', 'docket_get', 'docket_ask', 'docket_ontology'] as const

/** `docket_ask` for the agent is the grounded retrieval alone: the agent writes the answer. */
const ASK_DESCRIPTION =
  'Put a question in words to every projection of the docket (the graph and semantic memory). Returns the records each found, checked against the documents, with how they were found. No summary is written: you write the answer.'

/** The arguments' schema with `workspace` first, and without what the agent has no use for. */
function withWorkspace(schema: Record<string, unknown>, slugs: readonly string[]): Record<string, unknown> {
  const properties = Object.entries((schema.properties ?? {}) as Record<string, Record<string, unknown>>).filter(
    ([name, property]) => property.deprecated !== true && name !== 'project',
  )
  return {
    ...schema,
    properties: { workspace: { type: 'string', enum: [...slugs], description: 'The docket to look in, by its slug.' }, ...Object.fromEntries(properties) },
    required: ['workspace', ...((schema.required as string[] | undefined) ?? [])],
  }
}

/** The tools as the model is offered them, from a docket's own tool definitions. */
export function agentTools(tools: readonly CloudTool[], slugs: readonly string[]): TurnTool[] {
  return AGENT_TOOLS.flatMap((name) => {
    const tool = tools.find((entry) => entry.tool.definition.name === name)?.tool
    if (!tool) return []
    const { definition } = tool
    return [
      {
        name,
        description: name === 'docket_ask' ? ASK_DESCRIPTION : definition.description,
        parameters: withWorkspace(definition.inputSchema as Record<string, unknown>, slugs),
      },
    ]
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const words = (text: string, most = 80) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

type Found = Omit<AnswerSource, 'workspace' | 'cited'>
type CallResult = { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean }

/** What a step looked for, from its arguments. */
function inputOf(name: string, args: Record<string, unknown>): string {
  const value = name === 'docket_search' ? args.query : name === 'docket_get' ? args.id : name === 'docket_ask' ? args.question : null
  return typeof value === 'string' ? words(value.trim()) : ''
}

/** The records a tool's answer names, and what it found in a few words. */
function readResult(name: string, structured: unknown): { found: Found[]; result: string } {
  if (!isRecord(structured)) return { found: [], result: 'done' }
  if (name === 'docket_search' && Array.isArray(structured.matches)) {
    const found = (structured.matches as Record<string, unknown>[]).flatMap((match) =>
      typeof match.id === 'string'
        ? [
            {
              id: match.id,
              title: typeof match.title === 'string' ? match.title : match.id,
              type: typeof match.type === 'string' ? match.type : '',
              stale: false,
              foundBy: Array.isArray(match.foundIn) ? (match.foundIn as string[]) : [],
            },
          ]
        : [],
    )
    return { found, result: found.length ? plural(found.length, 'record') : 'nothing relevant' }
  }
  if (name === 'docket_get' && typeof structured.id === 'string') {
    const resource = isRecord(structured.resource) ? structured.resource : null
    const title = typeof resource?.title === 'string' ? resource.title : structured.id
    const type = typeof resource?.type === 'string' ? resource.type : ''
    return { found: [{ id: structured.id, title, type, stale: false, foundBy: ['documents'] }], result: `${title}${structured.superseded ? ' (out of date)' : ''}` }
  }
  if (name === 'docket_ask' && isRecord(structured.answer)) {
    const references = Array.isArray(structured.answer.references) ? (structured.answer.references as Record<string, unknown>[]) : []
    const found = new Map<string, Found>()
    for (const reference of references) {
      if (reference.status === 'unresolved') continue
      const id = typeof reference.entity === 'string' ? reference.entity : typeof reference.id === 'string' ? reference.id : null
      if (!id) continue
      const by = Array.isArray(reference.foundBy) ? (reference.foundBy as { adapter?: unknown }[]).flatMap((one) => (typeof one.adapter === 'string' ? [one.adapter] : [])) : []
      const known = found.get(id)
      if (known) known.foundBy = [...new Set([...known.foundBy, ...by])]
      else found.set(id, { id, title: id, type: '', stale: reference.status === 'stale', foundBy: [...new Set(by)] })
    }
    return { found: [...found.values()], result: found.size ? `${plural(found.size, 'record')} found` : 'nothing found' }
  }
  if (name === 'docket_ontology' && isRecord(structured.ontology)) {
    const types = isRecord(structured.ontology.types) ? Object.keys(structured.ontology.types).length : Array.isArray(structured.ontology.types) ? structured.ontology.types.length : null
    return { found: [], result: `version ${String(structured.version)}${types !== null ? `, ${plural(types, 'type')}` : ''}` }
  }
  return { found: [], result: 'done' }
}

/** A tool answer as the model reads it, cut to what a turn can hold. */
function resultText(slug: string, result: CallResult): string {
  const text = (result.content ?? []).flatMap((part) => (part.type === 'text' && part.text ? [part.text] : [])).join('\n')
  const cut = text.length > AGENT_LIMITS.resultChars ? `${text.slice(0, AGENT_LIMITS.resultChars)}\n[… cut short]` : text
  return `Docket ${slug}:\n${cut}`
}

/** The model's answer as an OpenUI Lang program: fences dropped, and plain prose wrapped in one Prose. */
export function answerProgram(content: string): string | null {
  const text = content
    .trim()
    .replace(/^```[\w-]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
  if (!text) return null
  if (/^root\s*=/m.test(text)) return text
  return `root = Answer([p])\np = Prose(${JSON.stringify(text)})`
}

const parser = createParser(answerLibrary.toJSONSchema())

/** The cloud's read tools work from their own workspace context and never read docket's: theirs is a placeholder. */
const TOOL_CONTEXT: ToolContext = { source: () => Promise.reject(new Error('The cloud tools read the workspace through their own context.')), viewer: null }

/** A member's question to the org's dockets, answered by the agent; `history` is the chat so far. */
export async function runAgent(
  deps: AgentDeps,
  workspaces: readonly OrgWorkspace[],
  question: string,
  history: readonly TurnMessage[],
  emit: (event: AgentEvent) => void = () => undefined,
): Promise<AgentOutcome> {
  const bySlug = new Map(workspaces.map((workspace) => [workspace.slug, workspace]))
  const slugs = workspaces.map((workspace) => workspace.slug)
  const first = workspaces[0]
  const tools = first ? agentTools(deps.tools(first), slugs) : []
  const messages: TurnMessage[] = [
    { role: 'system', content: answerPrompt(workspaces) },
    ...history,
    { role: 'user', content: question },
  ]
  const steps: AgentStep[] = []
  const found = new Map<string, AnswerSource>()
  let spent = 0
  let calls = 0
  let model: string | null = null
  let content: string | null = null
  let notice: string | null = null

  /** Runs one tool call, as one step on the page. */
  const call = async (name: string, rawArgs: string): Promise<string> => {
    let args: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(rawArgs || '{}') as unknown
      if (isRecord(parsed)) args = parsed
    } catch {
      // Answered below as arguments it could not read.
    }
    const { workspace: slug, ...rest } = args
    const workspace = typeof slug === 'string' ? bySlug.get(slug) : undefined
    const index = steps.length
    const step: AgentStep = { tool: name, workspace: workspace?.slug ?? null, input: inputOf(name, rest), result: '', state: 'running', ms: 0 }
    steps.push(step)
    emit({ type: 'step', index, step: { ...step } })
    const started = performance.now()
    const finish = (state: AgentStep['state'], result: string) => {
      Object.assign(step, { state, result, ms: Math.round(performance.now() - started) })
      emit({ type: 'step', index, step: { ...step } })
    }
    const tool = workspace ? deps.tools(workspace).find((entry) => entry.tool.definition.name === name)?.tool : undefined
    if (!workspace || !tool || !(AGENT_TOOLS as readonly string[]).includes(name)) {
      finish('failed', workspace ? 'no such tool' : 'no such docket')
      return workspace ? `There is no tool ${name}.` : `Name a docket to look in: one of ${slugs.join(', ')}.`
    }
    try {
      const result = (await tool.call(rest, TOOL_CONTEXT)) as CallResult
      if (result.isError) {
        const text = resultText(workspace.slug, result)
        finish('failed', words(text.split('\n')[1] ?? 'failed', 60))
        return text
      }
      const read = readResult(name, result.structuredContent)
      for (const record of read.found) {
        const source = { ...record, workspace: workspace.slug, cited: false }
        const known = found.get(sourceKey(source))
        if (!known) found.set(sourceKey(source), source)
        else {
          known.foundBy = [...new Set([...known.foundBy, ...source.foundBy])]
          if (known.title === known.id && source.title !== source.id) Object.assign(known, { title: source.title, type: source.type })
        }
      }
      finish('done', read.result)
      return resultText(workspace.slug, result)
    } catch (cause) {
      if (cause instanceof InvalidArgumentsError) {
        finish('failed', words(cause.message, 60))
        return `Invalid arguments: ${cause.message}`
      }
      throw cause
    }
  }

  for (let turn = 0; turn < AGENT_LIMITS.turns; turn += 1) {
    if (spent >= AGENT_LIMITS.costUsd) {
      notice = `Stopped at this question's limit of $${AGENT_LIMITS.costUsd.toFixed(2)} of AI before writing an answer; what it looked up is below.`
      break
    }
    const last = turn === AGENT_LIMITS.turns - 1 || calls >= AGENT_LIMITS.calls || spent >= AGENT_LIMITS.costUsd * 0.6
    emit({ type: 'turn', turn })
    let reply: TurnResponse
    try {
      reply = await deps.query.turn({
        orgId: deps.orgId,
        actor: deps.actor,
        userId: deps.userId,
        messages,
        tools,
        toolChoice: last ? 'none' : 'auto',
        maxTokens: last ? AGENT_LIMITS.answerTokens : AGENT_LIMITS.lookupTokens,
      })
    } catch (cause) {
      if (!(cause instanceof QueryError)) throw cause
      if (turn === 0) return { unavailable: cause.message }
      notice = `The model stopped answering part way (${cause.message}); what it looked up is below.`
      break
    }
    if ('unavailable' in reply) {
      if (turn === 0) return { unavailable: reply.notice }
      notice = reply.notice
      break
    }
    spent += reply.costUsd
    model = reply.model
    if (last || reply.toolCalls.length === 0) {
      content = reply.content
      break
    }
    messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls })
    // Every call the model asked for is answered, so the conversation stays well formed; past the limits, with why it did not run.
    const room = Math.max(0, Math.min(AGENT_LIMITS.perTurn, AGENT_LIMITS.calls - calls))
    const answers = await Promise.all(
      reply.toolCalls.map((toolCall, index) =>
        index < room
          ? call(toolCall.name, toolCall.arguments)
          : Promise.resolve(`Not run: at most ${AGENT_LIMITS.perTurn} look-ups a turn and ${AGENT_LIMITS.calls} a question. Answer with what you have.`),
      ),
    )
    calls += Math.min(reply.toolCalls.length, room)
    reply.toolCalls.forEach((toolCall, index) => messages.push({ role: 'tool', toolCallId: toolCall.id, content: answers[index] ?? '' }))
  }

  // Records an ask found carry only their ids: their titles and types, from the documents.
  const untitled = workspaces.flatMap((workspace) => {
    const ids = [...found.values()].filter((source) => source.workspace === workspace.slug && source.title === source.id).map((source) => source.id)
    return ids.length ? [{ workspace, ids }] : []
  })
  if (untitled.length) {
    const described = await deps.describe(untitled)
    for (const source of found.values()) {
      const known = described.get(source.workspace)?.get(source.id)
      if (known) Object.assign(source, known)
    }
  }

  const ui = content === null ? null : answerProgram(content)
  const sources = [...found.values()]
  const { cited, unknown } = citedSources(ui ? referencesIn(parser.parse(ui).root) : [], sources)
  for (const source of cited) source.cited = true
  const notices = [
    notice,
    ui === null && notice === null ? 'No answer was written; what it looked up is below.' : null,
    ui !== null && cited.length === 0 ? 'This answer cites no record, so check it against what was looked up below.' : null,
    unknown.length ? `It named ${plural(unknown.length, 'record')} no look-up returned, shown unlinked: ${unknown.slice(0, 5).join(', ')}.` : null,
  ].filter((line): line is string => line !== null)

  return {
    answered: {
      ui,
      model,
      notice: notices.length ? notices.join(' ') : null,
      error: null,
      steps,
      sources: [...cited, ...sources.filter((source) => !source.cited)],
      workspaces: workspaces.map(({ slug, name }): AskWorkspace => ({ slug, name })),
      costUsd: Math.round(spent * 1_000_000) / 1_000_000,
    },
  }
}
