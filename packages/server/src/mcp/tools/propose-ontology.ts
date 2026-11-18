import type { Tool } from '@chrisjowen/docket'

import { PROPOSE_ONTOLOGY_DEFINITION, proposalAnswer, proposalArguments, proposalRefusal } from '../../docket.js'
import { proposeOntologyChange } from '../../postgres/ontology.js'
import type { ServerTool, ToolContext } from '../context.js'

/** `docket_propose_ontology_change`: a draft with its check result; never a publish. */
export function proposeOntologyTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: PROPOSE_ONTOLOGY_DEFINITION,
    async call(raw) {
      const proposal = proposalArguments(raw)
      const writer = await context.writer()
      let answer
      try {
        answer = await context.audited(async (ctx) => {
          const value = await proposeOntologyChange(ctx, writer, proposal)
          return { value, outcome: 'ok', target: [`ontology-draft:${value.draft.id}`] }
        })
      } catch (caught) {
        const refused = proposalRefusal(caught)
        if (refused === null) throw caught
        return refused
      }
      return proposalAnswer(answer.draft.id, answer.check, 'An admin reviews and publishes drafts in the web app; this tool never publishes.')
    }
  }
  return { scope: 'ontology:propose', tool }
}
