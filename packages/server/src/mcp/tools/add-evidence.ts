import type { Tool } from '@chrisjowen/docket'

import { ADD_EVIDENCE_DEFINITION, addEvidenceArguments, hasErrors, isProposalEvidence, proposalEvidenceAnswer, writeAnswer } from '../../docket.js'
import { addProposalEvidence } from '../../postgres/supersession.js'
import { addEvidence } from '../../postgres/write.js'
import type { ServerTool, ToolContext } from '../context.js'

/** `docket_add_evidence`: append evidence to an existing resource or link, or to a supersede proposal. */
export function addEvidenceTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: ADD_EVIDENCE_DEFINITION,
    async call(raw) {
      const input = addEvidenceArguments(raw)
      const writer = await context.writer()
      if (isProposalEvidence(input)) {
        const result = await context.audited(async (ctx) => {
          const value = await addProposalEvidence(ctx, writer, input)
          return { value, outcome: hasErrors(value.diagnostics) ? 'invalid' : 'ok', target: value.proposal ? [value.proposal.resource] : [] }
        })
        return proposalEvidenceAnswer(input, context.viewer, result)
      }
      const result = await context.audited(async (ctx) => {
        const value = await addEvidence(ctx, writer, input)
        return { value, outcome: hasErrors(value.diagnostics) ? 'invalid' : 'ok', target: [input.id] }
      })
      return writeAnswer('docket_add_evidence', input.id, context.viewer, result, false)
    }
  }
  return { scope: 'docket:write', tool }
}
