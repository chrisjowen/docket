import type { Tool } from '@chrisjowen/docket'

import { RETIRE_DEFINITION, hasErrors, retireAnswer, retireArguments } from '../../docket.js'
import { retireResource } from '../../postgres/write.js'
import type { ServerTool, ToolContext } from '../context.js'

/** `docket_retire`: soft-retire a cloud-origin resource, with a reason; repo documents change in the repo. */
export function retireTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: RETIRE_DEFINITION,
    async call(raw) {
      const { id, reason } = retireArguments(raw)
      const writer = await context.writer()
      const result = await context.audited(async (ctx) => {
        const value = await retireResource(ctx, writer, { id, reason })
        return { value, outcome: hasErrors(value.diagnostics) ? 'invalid' : 'ok', target: [id] }
      })
      return retireAnswer(id, result)
    }
  }
  return { scope: 'docket:write', tool }
}
