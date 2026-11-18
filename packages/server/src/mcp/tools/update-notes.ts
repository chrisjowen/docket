import type { Tool } from '@chrisjowen/docket'

import { UPDATE_NOTES_DEFINITION, hasErrors, updateNotesArguments, writeAnswer } from '../../docket.js'
import { appendNotes } from '../../postgres/write.js'
import type { ServerTool, ToolContext } from '../context.js'

/** Append to existing notes without sending back a potentially stale body. */
export function updateNotesTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: UPDATE_NOTES_DEFINITION,
    async call(raw) {
      const { input, dryRun } = updateNotesArguments(raw)
      const writer = await context.writer()
      const result = await context.audited(async (ctx) => {
        const value = await appendNotes(ctx, writer, input, { dryRun })
        return { value, outcome: hasErrors(value.diagnostics) ? 'invalid' : 'ok', target: [input.id] }
      })
      return writeAnswer('docket_update_notes', input.id, context.viewer, result, dryRun)
    }
  }
  return { scope: 'docket:write', tool }
}
