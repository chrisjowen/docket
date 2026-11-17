import { InvalidArgumentsError, type Tool } from '@chrisjowen/docket'

import { argumentsOf } from '../args.js'
import { failed, ModelCallRefused, UNTRUSTED_NOTE, type ServerTool, type ToolContext } from '../context.js'
import { QueryError, type AskResponse } from '../query.js'

/** `docket_ask`'s `structuredContent.schema`. */
export const ASK_SCHEMA = 'docket-ask.v1'
const MAX_QUESTION = 2_000
const MAX_RESULTS = 50

/** What the model reads when the AI budget is spent (`beforeModelCall` threw `AiCapReached`). */
export const CAP_MESSAGE = 'AI budget for this month reached — search still works; ask an owner to raise the cap.'

const DEFINITION = {
  name: 'docket_ask',
  title: 'Ask the docket',
  description:
    "Ask a question about this workspace's knowledge in words. docket puts it to every projection (the graph and " +
    'semantic memory), checks each answer against the canonical documents, and has a model write a short answer ' +
    'that cites the resources and evidence it relies on. Uses the organisation\'s AI budget; docket_search does not.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', minLength: 1, maxLength: MAX_QUESTION, description: 'The question, in words.' },
      maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS, description: 'Results asked of each projection.' }
    },
    required: ['question'],
    additionalProperties: false
  },
  annotations: { title: 'Ask the docket', readOnlyHint: true, idempotentHint: false, openWorldHint: false }
}

function answerText(response: AskResponse): string {
  const { answer } = response
  const lines = [UNTRUSTED_NOTE, '']
  if (answer.synthesis) lines.push(answer.synthesis.text, '', `(Written by ${answer.synthesis.model}.)`)
  else lines.push(response.notice ?? answer.notice?.message ?? 'No summary was written; the results stand on their own.')
  if (response.changes?.length) {
    lines.push('', 'Changed since recorded - never present these as current:', ...response.changes.map((change) => `- ${change.note}`))
  }
  const references = (answer.references ?? []).filter((reference) => reference.status !== 'unresolved')
  if (references.length > 0) {
    lines.push('', 'What the projections found:')
    for (const reference of references.slice(0, 30)) {
      lines.push(`- ${reference.entity ?? reference.id} (${reference.kind}${reference.status === 'stale' ? ', changed since it was projected' : ''}) - ${reference.foundBy.map((by) => by.adapter).join(', ')}`)
    }
  }
  for (const result of answer.results) {
    if (result.state === 'failed') lines.push(`${result.adapter}: unavailable: ${result.error.message}`)
  }
  lines.push('', 'Call docket_get with an id for its full record.')
  return lines.join('\n')
}

export function askTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: DEFINITION,
    async call(raw) {
      const args = argumentsOf('docket_ask', raw, ['question', 'maxResults'], '{ "question": "...", "maxResults"?: n }')
      const question = typeof args.question === 'string' ? args.question.trim() : ''
      if (!question) throw new InvalidArgumentsError('Ask something: the question is empty.')
      if (question.length > MAX_QUESTION) throw new InvalidArgumentsError(`Keep the question under ${MAX_QUESTION} characters.`)
      const maxResults = args.maxResults
      if (maxResults !== undefined && (typeof maxResults !== 'number' || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS)) {
        throw new InvalidArgumentsError(`maxResults must be a whole number from 1 to ${MAX_RESULTS}.`)
      }
      try {
        await context.beforeModelCall()
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'AiCapReached') return failed(CAP_MESSAGE)
        if (cause instanceof ModelCallRefused) return failed(cause.message)
        throw cause
      }
      try {
        const response = await context.query.ask({
          workspaceId: context.workspaceId,
          question,
          actor: context.actor,
          userId: context.userId,
          ...(maxResults !== undefined ? { maxResults } : {})
        })
        return { content: [{ type: 'text', text: answerText(response) }], structuredContent: { schema: ASK_SCHEMA, ...response } }
      } catch (cause) {
        if (cause instanceof QueryError) return failed(`The docket could not answer: ${cause.message}`)
        throw cause
      }
    }
  }
  return { scope: 'docket:read', tool }
}
