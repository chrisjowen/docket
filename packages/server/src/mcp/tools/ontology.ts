import type { Tool } from '@chrisjowen/docket'

import { ONTOLOGY_DEFINITION, ONTOLOGY_SCHEMA, ontologyAnswer, ontologyArguments, parseOntology } from '../../docket.js'
import { headOf } from '../../postgres/ontology.js'
import { failed, type ServerTool, type ToolContext } from '../context.js'

export { ONTOLOGY_SCHEMA }

/** `docket_ontology`: the published head, as YAML for the model and parsed for a client. */
export function ontologyTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: ONTOLOGY_DEFINITION,
    async call(raw) {
      ontologyArguments(raw)
      const head = await context.store.run(({ tx }) => headOf(tx, context.workspaceId))
      if (!head || head.number === null || head.publishedAt === null) return failed('This workspace has no published ontology yet: an admin publishes one in the web app.')
      return ontologyAnswer({
        version: head.number,
        revision: head.yamlHash,
        publishedAt: head.publishedAt,
        message: head.message,
        ontology: parseOntology(head.yaml).ontology,
        yaml: head.yaml
      })
    }
  }
  return { scope: 'ontology:read', tool }
}
