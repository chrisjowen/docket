// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool } from '@chrisjowen/docket'
import { SUPERSEDE_DEFINITION, supersedeAnswer, supersedeArguments } from '@chrisjowen/docket/mcp/surface'
import { hasErrors, supersedeResource } from '@docket/platform-canonical-store'

import type { CloudTool, CloudToolContext } from './context.js'

/**
 * `docket_supersede`: propose that a newer resource replaces an out-of-date
 * one, fire and forget. The proposal is recorded at once and scored by the
 * workspace's policies; it becomes fact - the older resource out of date -
 * when its score clears the bar, and the answer says what would carry it
 * until then. Both stay on file.
 */
export function supersedeTool(context: CloudToolContext): CloudTool {
  const tool: Tool = {
    definition: SUPERSEDE_DEFINITION,
    async call(raw) {
      const input = supersedeArguments(raw)
      const writer = await context.writer()
      const result = await context.audited(async (ctx) => {
        const value = await supersedeResource(ctx, writer, input)
        return { value, outcome: hasErrors(value.diagnostics) ? 'invalid' : 'ok', target: [input.id, input.by] }
      })
      return supersedeAnswer(input, context.viewer, result)
    },
  }
  return { scope: 'docket:write', tool }
}
