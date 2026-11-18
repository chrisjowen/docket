import type { Tool } from '@chrisjowen/docket'

import { PUBLISH_ONTOLOGY_DEFINITION, publishAnswer, publishArguments, publishRefusal } from '../../docket.js'
import { publishOntologyChange } from '../../postgres/ontology.js'
import type { ServerTool, ToolContext } from '../context.js'

/**
 * `docket_publish_ontology_change`: publishes the ontology directly, where
 * the workspace's owner allows the caller's role to (an editor's publish,
 * over MCP). Needs `ontology:write`, which is effective only while the setting
 * names the caller's role; the publish re-reads it under its own locks.
 */
export function publishOntologyTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: PUBLISH_ONTOLOGY_DEFINITION,
    async call(raw) {
      const change = publishArguments(raw)
      const writer = await context.writer()
      const role = await context.role()
      let published
      try {
        published = await context.audited(async (ctx) => {
          const value = await publishOntologyChange(ctx, writer, role, change)
          return { value, outcome: 'ok', target: [`ontology:v${value.number}`, ...value.rewritten.map((document) => document.resourceId)] }
        })
      } catch (caught) {
        const refused = publishRefusal(caught)
        if (refused === null) throw caught
        return refused
      }
      return publishAnswer(
        {
          version: published.number ?? 0,
          previous: published.parentNumber ?? 0,
          classification: published.checkResult?.classification ?? 'safe',
          rewritten: published.rewritten.map((document) => ({ resourceId: document.resourceId, path: document.path, revision: document.revision })),
          migration: published.migration ?? [],
          dispositions: (published.dispositions ?? []).map(({ resourceId, disposition }) => ({ resourceId, disposition }))
        },
        context.ontologyHistory,
        `It is in the ontology history, where an admin can roll it back: ${context.ontologyHistory}`
      )
    }
  }
  return { scope: 'ontology:write', tool }
}
