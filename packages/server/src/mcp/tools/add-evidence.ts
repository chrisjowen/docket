import type { Tool } from '@chrisjowen/docket'

import { ADD_EVIDENCE_DEFINITION, addEvidenceArguments, hasErrors, writeAnswer } from '../../docket.js'
import { addEvidence } from '../../postgres/write.js'
import type { ServerTool, ToolContext } from '../context.js'

/** `docket_add_evidence`: append evidence to an existing resource or link. */
export function addEvidenceTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: ADD_EVIDENCE_DEFINITION,
    async call(raw) {
      const input = addEvidenceArguments(raw)
      const writer = await context.writer()
      const result = await context.audited(async (ctx) => {
        const value = await addEvidence(ctx, writer, input)
        return { value, outcome: hasErrors(value.diagnostics) ? 'invalid' : 'ok', target: [input.id] }
      })
      return writeAnswer('docket_add_evidence', input.id, context.viewer, result, false)
    }
  }
  return { scope: 'docket:write', tool }
}
