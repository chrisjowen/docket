import type { Tool } from '@chrisjowen/docket'

import { parseOntology } from '../../docket.js'
import { headOf } from '../../postgres/ontology.js'
import { argumentsOf } from '../args.js'
import { failed, type ServerTool, type ToolContext } from '../context.js'

/** `docket_ontology`'s `structuredContent.schema`. */
export const ONTOLOGY_SCHEMA = 'docket-ontology.v1'

const DEFINITION = {
  name: 'docket_ontology',
  title: "Read the workspace's ontology",
  description:
    "Read this workspace's published ontology: its resource types and their attributes, the relationships between " +
    'them, the evidence sources it accepts with the location each requires, and its extraction guidance, with its ' +
    'version number. Read it before writing knowledge, so a write fits the types and evidence the workspace expects.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: "Read the workspace's ontology", readOnlyHint: true, idempotentHint: true, openWorldHint: false }
}

/** `docket_ontology`: the published head, as YAML for the model and parsed for a client. */
export function ontologyTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: DEFINITION,
    async call(raw) {
      argumentsOf('docket_ontology', raw, [], '{}')
      const head = await context.store.run(({ tx }) => headOf(tx, context.workspaceId))
      if (!head || head.number === null || head.publishedAt === null) return failed('This workspace has no published ontology yet: an admin publishes one in the web app.')
      const loaded = parseOntology(head.yaml)
      const structured = {
        schema: ONTOLOGY_SCHEMA,
        version: head.number,
        revision: head.yamlHash,
        publishedAt: head.publishedAt.toISOString(),
        message: head.message,
        ontology: loaded.ontology,
        yaml: head.yaml
      }
      const text = `The published ontology of this workspace, version ${head.number} (${head.yamlHash}):\n\n${head.yaml}`
      return { content: [{ type: 'text', text }], structuredContent: structured }
    }
  }
  return { scope: 'ontology:read', tool }
}
