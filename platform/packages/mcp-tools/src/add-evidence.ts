// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool } from '@chrisjowen/docket'
import { ADD_EVIDENCE_DEFINITION, addEvidenceArguments, isProposalEvidence, proposalEvidenceAnswer } from '@chrisjowen/docket/mcp/surface'
import { addEvidence, addProposalEvidence, hasErrors } from '@docket/platform-canonical-store'

import type { CloudTool, CloudToolContext } from './context.js'
import { writeAnswer } from './write-args.js'

/**
 * `docket_add_evidence` (§9): append evidence to an existing resource or
 * link, or to a pending supersede proposal - which is scored again, and
 * accepted when it now clears its bar.
 */
export function addEvidenceTool(context: CloudToolContext): CloudTool {
  const tool: Tool = {
    definition: ADD_EVIDENCE_DEFINITION,
    async call(raw) {
      const input = addEvidenceArguments(raw)
      const writer = await context.writer()
      if (isProposalEvidence(input)) {
        const result = await context.audited(async (ctx) => {
          const value = await addProposalEvidence(ctx, writer, input)
          return { value, outcome: hasErrors(value.diagnostics) ? 'invalid' : 'ok', target: value.proposal ? [value.proposal.resource, value.proposal.supersededBy] : [input.supersession] }
        })
        return proposalEvidenceAnswer(input, context.viewer, result)
      }
      const result = await context.audited(async (ctx) => {
        const value = await addEvidence(ctx, writer, input)
        return { value, outcome: hasErrors(value.diagnostics) ? 'invalid' : 'ok', target: [input.id] }
      })
      return writeAnswer('docket_add_evidence', input.id, context.viewer, result, false)
    },
  }
  return { scope: 'docket:write', tool }
}
