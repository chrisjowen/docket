// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool } from '@chrisjowen/docket'
import { parseOntology } from '@docket/platform-canonical-store'

import { argumentsOf, failed, type CloudTool, type CloudToolContext } from './context.js'

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
  annotations: { title: "Read the workspace's ontology", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
}

type HeadRow = { number: number; yaml: string; yaml_hash: string; published_at: Date; published_by: string | null; message: string | null }

/** `docket_ontology` (§9): the published head, as YAML for the model and parsed for a client. */
export function ontologyTool(context: CloudToolContext): CloudTool {
  const tool: Tool = {
    definition: DEFINITION,
    async call(raw) {
      argumentsOf('docket_ontology', raw, [], '{}')
      const head = await context.inTenant(async ({ tx }) => {
        const { rows } = await tx.query<HeadRow>(
          `SELECT number, yaml, yaml_hash, published_at, published_by, message FROM ontology_versions
            WHERE workspace_id = $1 AND status = 'published' ORDER BY number DESC LIMIT 1`,
          [context.workspaceId],
        )
        return rows[0] ?? null
      })
      if (!head) return failed('This workspace has no published ontology yet: an admin publishes one in the web app.')
      const loaded = parseOntology(head.yaml)
      const structured = {
        schema: ONTOLOGY_SCHEMA,
        version: head.number,
        revision: head.yaml_hash,
        publishedAt: head.published_at.toISOString(),
        message: head.message,
        ontology: loaded.ontology,
        yaml: head.yaml,
      }
      const text = `The published ontology of this workspace, version ${head.number} (${head.yaml_hash}):\n\n${head.yaml}`
      return { content: [{ type: 'text', text }], structuredContent: structured }
    },
  }
  return { scope: 'ontology:read', tool }
}
