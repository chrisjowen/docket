import type { Tool } from '@chrisjowen/docket'

import { SUPERSEDE_DEFINITION, hasErrors, supersedeAnswer, supersedeArguments } from '../../docket.js'
import { supersedeResource } from '../../postgres/supersession.js'
import type { ServerTool, ToolContext } from '../context.js'

/** `docket_supersede`: mark an out-of-date resource superseded by its replacement, keeping both on file. */
export function supersedeTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: SUPERSEDE_DEFINITION,
    async call(raw) {
      const input = supersedeArguments(raw)
      const writer = await context.writer()
      const result = await context.audited(async (ctx) => {
        const value = await supersedeResource(ctx, writer, input)
        return { value, outcome: hasErrors(value.diagnostics) ? 'invalid' : 'ok', target: [input.id, input.by] }
      })
      return supersedeAnswer(input, context.viewer, result)
    }
  }
  return { scope: 'docket:write', tool }
}
