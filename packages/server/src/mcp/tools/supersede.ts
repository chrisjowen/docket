import type { Tool } from '@chrisjowen/docket'

import { supersedeResource, type SupersedeInput } from '../../postgres/supersession.js'
import { dayOf } from '../../supersession.js'
import { hasErrors } from '../../write/evidence.js'
import { WRITE_LIMITS } from '../../write/inputs.js'
import { argumentsOf } from '../args.js'
import type { ServerTool, ToolContext } from '../context.js'
import { EVIDENCE_SCHEMA, WRITE_SCHEMA, optionalText, parseEvidence, requiredText } from '../write-args.js'

const DEFINITION = {
  name: 'docket_supersede',
  title: 'Mark a resource superseded by a newer one',
  description:
    'Mark a resource out of date because a newer resource replaces it - a renamed bot, a moved owner, a decision ' +
    'reversed - with the reason and evidence of the change. Nothing is deleted: the older resource stays on file with ' +
    'until when it held and a link to its replacement, and docket_search answers with the replacement and a note of ' +
    'the change instead of presenting the older one as current. Write the newer resource first with docket_remember. ' +
    'Use docket_retire instead for a resource that was simply wrong and has no replacement.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200, description: 'The resource that went out of date.' },
      by: { type: 'string', minLength: 1, maxLength: 200, description: 'The resource that replaces it: one already in this workspace, and current itself.' },
      reason: {
        type: 'string',
        minLength: 1,
        maxLength: WRITE_LIMITS.reasonLength,
        description: 'What changed, in a sentence a reader will see beside the older resource, e.g. "The Muse bot was renamed from Sophia to Captin."'
      },
      validUntil: { type: 'string', maxLength: 40, description: 'When the older resource stopped holding: YYYY-MM-DD or an ISO timestamp. Defaults to now.' },
      evidence: { type: 'array', minItems: 1, maxItems: WRITE_LIMITS.evidencePerCall, items: EVIDENCE_SCHEMA, description: 'Where the change was seen: at least one entry.' }
    },
    required: ['id', 'by', 'reason', 'evidence'],
    additionalProperties: false
  },
  annotations: { title: 'Mark a resource superseded by a newer one', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}

/** `docket_supersede`: mark an out-of-date resource superseded by its replacement, keeping both on file. */
export function supersedeTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: DEFINITION,
    async call(raw) {
      const args = argumentsOf(
        'docket_supersede',
        raw,
        ['id', 'by', 'reason', 'validUntil', 'evidence'],
        '{ "id": "...", "by": "...", "reason": "...", "evidence": [...], "validUntil"?: "YYYY-MM-DD" }'
      )
      const validUntil = optionalText(args.validUntil, 'validUntil', 40)?.trim()
      const input: SupersedeInput = {
        id: requiredText(args.id, 'id', 200),
        by: requiredText(args.by, 'by', 200),
        reason: requiredText(args.reason, 'reason', WRITE_LIMITS.reasonLength),
        evidence: parseEvidence(args.evidence, 'evidence'),
        ...(validUntil ? { validUntil } : {})
      }
      const writer = await context.writer()
      const result = await context.audited(async (ctx) => {
        const value = await supersedeResource(ctx, writer, input)
        return { value, outcome: hasErrors(value.diagnostics) ? 'invalid' : 'ok', target: [input.id, input.by] }
      })
      const errors = result.diagnostics.filter((d) => d.severity === 'error')
      const warnings = result.diagnostics.filter((d) => d.severity === 'warning')
      const held = result.supersession
      const lines = errors.length
        ? ['Refused: nothing was superseded. Fix these and call docket_supersede again:', ...errors.map((d) => `- ${d.code}: ${d.message}`)]
        : !result.changed
          ? [`Nothing new: ${input.id} is already superseded by ${input.by}.`]
          : [
              `${input.id} is now superseded by ${input.by} since ${held ? dayOf(held.validUntil) : 'now'}. It stays on file with its history; ` +
                'search answers with the replacement and a note of the change.'
            ]
      if (warnings.length) lines.push('', ...warnings.map((d) => `- ${d.code}: ${d.message}`))
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          schema: WRITE_SCHEMA,
          tool: 'docket_supersede',
          id: input.id,
          ok: errors.length === 0,
          changed: result.changed,
          ...(held ? { supersededBy: held.supersededBy, validUntil: held.validUntil.toISOString() } : {}),
          ...(result.replaced ? { replaced: result.replaced } : {}),
          viewer: `${context.viewer}#${encodeURIComponent(input.id)}`,
          diagnostics: result.diagnostics.map(({ severity, code, message }) => ({ severity, code, message }))
        },
        ...(errors.length ? { isError: true } : {})
      }
    }
  }
  return { scope: 'docket:write', tool }
}
