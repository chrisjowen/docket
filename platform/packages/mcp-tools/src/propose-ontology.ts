// SPDX-License-Identifier: AGPL-3.0-only
import { InvalidArgumentsError, type Tool } from '@chrisjowen/docket'
import { MAX_ONTOLOGY_BYTES, OntologyInvalid, proposeOntologyChange, type Proposal } from '@docket/platform-ontology-service'

import { argumentsOf, failed, type CloudTool, type CloudToolContext } from './context.js'
import { optionalText } from './write-args.js'

const DEFINITION = {
  name: 'docket_propose_ontology_change',
  title: 'Propose an ontology change',
  description:
    "Propose a change to this workspace's ontology as a draft: new resource types, relationships, attributes or " +
    'evidence sources. Give either patch, a YAML merge patch onto the published ontology (a mapping merges key by key; ' +
    'null removes a key), or yaml, a whole ontology. It returns the change check: what the draft would do to every ' +
    'document. It never publishes; someone who holds Publish ontology changes reviews and publishes drafts in the web ' +
    'app (or, if you hold it, docket_publish_ontology_change publishes directly).',
  inputSchema: {
    type: 'object',
    properties: {
      patch: { type: 'string', maxLength: MAX_ONTOLOGY_BYTES, description: 'YAML merge patch onto the published ontology, for example "resourceTypes:\\n  queue:\\n    description: A message queue.\\n".' },
      yaml: { type: 'string', maxLength: MAX_ONTOLOGY_BYTES, description: 'A whole ontology (entities.yaml), instead of a patch.' },
      message: { type: 'string', maxLength: 500, description: 'Why: shown to the admin who reviews the draft.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Propose an ontology change', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}

/** `docket_propose_ontology_change` (§9): a draft with its check result; never a publish. */
export function proposeOntologyTool(context: CloudToolContext): CloudTool {
  const tool: Tool = {
    definition: DEFINITION,
    async call(raw) {
      const args = argumentsOf('docket_propose_ontology_change', raw, ['patch', 'yaml', 'message'], '{ "patch": "..." } or { "yaml": "..." }')
      const patch = optionalText(args.patch, 'patch', MAX_ONTOLOGY_BYTES)
      const yaml = optionalText(args.yaml, 'yaml', MAX_ONTOLOGY_BYTES)
      const message = optionalText(args.message, 'message', 500)
      if ((patch === undefined) === (yaml === undefined)) throw new InvalidArgumentsError('Give either patch or yaml, not both.')
      const proposal: Proposal = patch !== undefined ? { patch, ...(message ? { message } : {}) } : { yaml: yaml as string, ...(message ? { message } : {}) }
      const writer = await context.writer()
      let answer
      try {
        answer = await context.audited(async (ctx) => {
          const value = await proposeOntologyChange(ctx, writer, proposal)
          return { value, outcome: 'ok', target: [`ontology-draft:${value.draft.id}`] }
        })
      } catch (caught) {
        if (!(caught instanceof OntologyInvalid)) throw caught
        return failed(`The proposal is not a valid ontology; no draft was made:\n${caught.diagnostics.map((d) => `- ${d.code}: ${d.message}`).join('\n')}`)
      }
      const { draft, check } = answer
      const lines = [
        `Draft ${draft.id} made against v${check.head}: ${check.classification}.`,
        `${check.changes.length} change(s); checked against ${check.documents} document(s).`,
      ]
      if (check.introduced.length) {
        lines.push('', 'It would give existing documents these diagnostics:', ...check.introduced.slice(0, 20).map((d) => `- ${d.code} ${d.id ?? d.path ?? ''}: ${d.message}`))
      }
      lines.push('', 'An admin reviews and publishes drafts in the web app; this tool never publishes.')
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          schema: 'docket-ontology-proposal.v1',
          draftId: draft.id,
          head: check.head,
          classification: check.classification,
          changes: check.changes,
          introduced: check.introduced.map(({ severity, code, message, id, path }) => ({ severity, code, message, ...(id ? { id } : {}), ...(path ? { path } : {}) })),
          affected: check.affected,
          unresolved: check.unresolved,
          ontology: check.ontology.map(({ severity, code, message }) => ({ severity, code, message })),
        },
      }
    },
  }
  return { scope: 'ontology:propose', tool }
}
