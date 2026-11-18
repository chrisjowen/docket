import type { Tool } from '@chrisjowen/docket'

import { ASK_DEFINITION, ASK_SCHEMA, answerText, askArguments } from '../../docket.js'
import { failed, ModelCallRefused, type ServerTool, type ToolContext } from '../context.js'
import { QueryError } from '../query.js'

export { ASK_SCHEMA }

/** What the model reads when the AI budget is spent (`beforeModelCall` threw `AiCapReached`). */
export const CAP_MESSAGE = 'AI budget for this month reached — search still works; ask an owner to raise the cap.'

export function askTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: ASK_DEFINITION,
    async call(raw) {
      const { question, maxResults } = askArguments(raw)
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
