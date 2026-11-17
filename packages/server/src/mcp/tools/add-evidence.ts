import { InvalidArgumentsError, type Tool } from '@chrisjowen/docket'

import { addEvidence } from '../../postgres/write.js'
import { hasErrors } from '../../write/evidence.js'
import { WRITE_LIMITS, type AddEvidenceInput } from '../../write/inputs.js'
import { argumentsOf, isObject } from '../args.js'
import type { ServerTool, ToolContext } from '../context.js'
import { EVIDENCE_SCHEMA, parseEvidence, requiredText, writeAnswer } from '../write-args.js'

const DEFINITION = {
  name: 'docket_add_evidence',
  title: 'Add evidence to a resource or link',
  description:
    'Record more evidence for a resource already in this workspace, or for one of its links: where else it was seen. ' +
    'Evidence is append-only and raises confidence when it comes from an independent source. To add a new link, use ' +
    'docket_remember with the link and its evidence.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200, description: 'The resource id, as docket_search returns it.' },
      link: {
        type: 'object',
        description: 'Add the evidence to this link of the resource instead of the resource itself.',
        properties: {
          rel: { type: 'string', minLength: 1, maxLength: 100 },
          target: { type: 'string', minLength: 1, maxLength: 200 }
        },
        required: ['rel', 'target'],
        additionalProperties: false
      },
      evidence: { type: 'array', maxItems: WRITE_LIMITS.evidencePerCall, items: EVIDENCE_SCHEMA, description: 'At least one entry.' }
    },
    required: ['id', 'evidence'],
    additionalProperties: false
  },
  annotations: { title: 'Add evidence to a resource or link', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}

/** `docket_add_evidence`: append evidence to an existing resource or link. */
export function addEvidenceTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: DEFINITION,
    async call(raw) {
      const args = argumentsOf('docket_add_evidence', raw, ['id', 'link', 'evidence'], '{ "id", "evidence": [...], "link"?: { "rel", "target" } }')
      let link: AddEvidenceInput['link']
      if (args.link !== undefined) {
        if (!isObject(args.link) || Object.keys(args.link).some((key) => key !== 'rel' && key !== 'target')) {
          throw new InvalidArgumentsError('link must be { "rel": "...", "target": "..." }.')
        }
        link = { rel: requiredText(args.link.rel, 'link.rel', 100), target: requiredText(args.link.target, 'link.target', 200) }
      }
      const input: AddEvidenceInput = { id: requiredText(args.id, 'id', 200), ...(link ? { link } : {}), evidence: parseEvidence(args.evidence, 'evidence') }
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
