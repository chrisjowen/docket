import type { Tool } from '@chrisjowen/docket'

import { REMEMBER_DEFINITION, hasErrors, rememberArguments, writeAnswer } from '../../docket.js'
import { writeResource } from '../../postgres/write.js'
import type { ServerTool, ToolContext } from '../context.js'

/** `docket_remember`: upsert one resource with links, evidence required, checked against the published ontology. */
export function rememberTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: REMEMBER_DEFINITION,
    async call(raw) {
      const { input, dryRun } = rememberArguments(raw)
      const writer = await context.writer()
      const result = await context.audited(async (ctx) => {
        const value = await writeResource(ctx, writer, input, { dryRun })
        return { value, outcome: hasErrors(value.diagnostics) ? 'invalid' : 'ok', target: [input.id] }
      })
      return writeAnswer('docket_remember', input.id, context.viewer, result, dryRun)
    }
  }
  return { scope: 'docket:write', tool }
}
