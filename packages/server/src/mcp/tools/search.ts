import type { Tool } from '@chrisjowen/docket'

import { SEARCH_DEFINITION, searchAnswer, searchArguments } from '../../docket.js'
import { failed, type ServerTool, type ToolContext } from '../context.js'
import { MIN_CONFIDENCE_IGNORED, QueryError } from '../query.js'

/**
 * `docket_search`: docket's contract - its `docket-search.v1` result and the
 * `ui://docket/search.html` app - over the workspace's projections and its
 * activity log, with only the results relevant to the query kept. It needs no
 * model, so it keeps working when the AI budget is spent. `viewer` is the
 * workspace's graph browser, so "Open in docket" opens it at `#<id>`.
 */
export function searchTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: SEARCH_DEFINITION,
    async call(raw) {
      const { query, limit, ...scope } = searchArguments(raw)
      try {
        const searched = await context.query.search({ workspaceId: context.workspaceId, query, limit, actor: context.actor, userId: context.userId, ...scope })
        const found = {
          ...searched,
          viewer: context.viewer,
          ...(scope.minConfidence !== undefined ? { warnings: [...searched.warnings, MIN_CONFIDENCE_IGNORED] } : {})
        }
        return searchAnswer(found, { behind: 'the server is still projecting the latest writes.' })
      } catch (cause) {
        if (cause instanceof QueryError) return failed(`The docket could not be searched: ${cause.message}`)
        throw cause
      }
    }
  }
  return { scope: 'docket:read', tool }
}
