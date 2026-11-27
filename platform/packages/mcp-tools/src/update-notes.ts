// SPDX-License-Identifier: AGPL-3.0-only
import { InvalidArgumentsError, type Tool } from '@chrisjowen/docket'
import { WRITE_LIMITS, appendNotes, hasErrors } from '@docket/platform-canonical-store'

import { argumentsOf, type CloudTool, type CloudToolContext } from './context.js'
import { EVIDENCE_SCHEMA, parseEvidence, requiredText, writeAnswer } from './write-args.js'

/** Append to existing notes without sending back a potentially stale body. */
export function updateNotesTool(context: CloudToolContext): CloudTool {
  const tool: Tool = {
    definition: {
      name: 'docket_update_notes',
      title: 'Append narrative notes to a resource',
      description:
        'Add narrative Markdown notes to an existing resource in this workspace, with evidence. The server reads the latest ' +
        'notes and appends yours with a dated separator, preserving existing notes and concurrent additions. Send only the ' +
        'new prose, including your reasoning and source citations. Repeating a call appends again; this tool is not idempotent. ' +
        'Use docket_remember to create a resource or deliberately replace its body. Repo and CLI notes stay at their source; ' +
        'additions go in the resource\'s cloud document and are shown together with those notes.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 200, description: 'The existing resource id.' },
          additional_notes: { type: 'string', minLength: 1, maxLength: 60000, description: 'Only the new narrative Markdown notes to append. Explain observations, relationships and reasoning in substantial prose, citing supporting evidence.' },
          evidence: { type: 'array', minItems: 1, maxItems: WRITE_LIMITS.evidencePerCall, items: EVIDENCE_SCHEMA, description: 'Evidence supporting the new notes; at least one entry.' },
          dryRun: { type: 'boolean', description: 'Validate the append without writing.' },
        },
        required: ['id', 'additional_notes', 'evidence'],
        additionalProperties: false,
      },
      annotations: { title: 'Append narrative notes to a resource', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async call(raw) {
      const args = argumentsOf('docket_update_notes', raw, ['id', 'additional_notes', 'evidence', 'dryRun'], '{ "id", "additional_notes", "evidence": [...] }')
      if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') throw new InvalidArgumentsError('dryRun must be true or false.')
      const input = {
        id: requiredText(args.id, 'id', 200),
        additionalNotes: requiredText(args.additional_notes, 'additional_notes', 60000),
        evidence: parseEvidence(args.evidence, 'evidence'),
      }
      const dryRun = args.dryRun === true
      const writer = await context.writer()
      const result = await context.audited(async (ctx) => {
        const value = await appendNotes(ctx, writer, input, { dryRun })
        return { value, outcome: hasErrors(value.diagnostics) ? 'invalid' : 'ok', target: [input.id] }
      })
      return writeAnswer('docket_update_notes', input.id, context.viewer, result, dryRun)
    },
  }
  return { scope: 'docket:write', tool }
}
