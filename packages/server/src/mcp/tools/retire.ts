import type { Tool } from '@chrisjowen/docket'

import { retireResource } from '../../postgres/write.js'
import { hasErrors } from '../../write/evidence.js'
import { WRITE_LIMITS } from '../../write/inputs.js'
import { argumentsOf } from '../args.js'
import type { ServerTool, ToolContext } from '../context.js'
import { WRITE_SCHEMA, requiredText } from '../write-args.js'

const DEFINITION = {
  name: 'docket_retire',
  title: 'Retire a resource',
  description:
    'Retire a resource that was written on this server (through MCP or the web app) and is wrong or gone, with the reason. ' +
    'It leaves search and the graph at the next index update; its history is kept. A resource that comes from a ' +
    'repository cannot be retired here: change it in the repo and push.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200, description: 'The resource id.' },
      reason: { type: 'string', minLength: 1, maxLength: WRITE_LIMITS.reasonLength, description: 'Why it is retired, for the activity log.' }
    },
    required: ['id', 'reason'],
    additionalProperties: false
  },
  annotations: { title: 'Retire a resource', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
}

/** `docket_retire`: soft-retire a cloud-origin resource, with a reason; repo documents change in the repo. */
export function retireTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: DEFINITION,
    async call(raw) {
      const args = argumentsOf('docket_retire', raw, ['id', 'reason'], '{ "id": "...", "reason": "..." }')
      const id = requiredText(args.id, 'id', 200)
      const reason = requiredText(args.reason, 'reason', WRITE_LIMITS.reasonLength)
      const writer = await context.writer()
      const result = await context.audited(async (ctx) => {
        const value = await retireResource(ctx, writer, { id, reason })
        return { value, outcome: hasErrors(value.diagnostics) ? 'invalid' : 'ok', target: [id] }
      })
      const errors = result.diagnostics.filter((d) => d.severity === 'error')
      const warnings = result.diagnostics.filter((d) => d.severity === 'warning')
      const lines = errors.length
        ? ['Refused: nothing was retired.', ...errors.map((d) => `- ${d.code}: ${d.message}`)]
        : [`Retired ${id}: ${result.retired.map((document) => document.path).join(', ')}. It leaves search at the next index update.`]
      if (warnings.length) lines.push('', ...warnings.map((d) => `- ${d.code}: ${d.message}`))
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          schema: WRITE_SCHEMA,
          tool: 'docket_retire',
          id,
          ok: errors.length === 0,
          retired: result.retired.map(({ path, revision }) => ({ path, revision })),
          remaining: result.remaining,
          diagnostics: result.diagnostics.map(({ severity, code, message }) => ({ severity, code, message }))
        },
        ...(errors.length ? { isError: true } : {})
      }
    }
  }
  return { scope: 'docket:write', tool }
}
