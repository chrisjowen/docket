// SPDX-License-Identifier: AGPL-3.0-only
import { InvalidArgumentsError, searchTool as docketSearchTool, type Tool } from '@chrisjowen/docket'
import { MAX_SEARCH_LIMIT, searchText } from '@chrisjowen/docket/mcp/search'

import { argumentsOf, failed, UNTRUSTED_NOTE, type CloudTool, type CloudToolContext } from './context.js'
import { MIN_CONFIDENCE_IGNORED, QueryError, SEARCH_BACKENDS, searchScope, type WorkspaceSearch } from './query.js'

const DEFAULT_LIMIT = 10
/** Results below this confidence are marked ⚠ in the text: shown, never filtered on. */
const LOW_CONFIDENCE = 0.5

const definition: Tool['definition'] = {
  ...docketSearchTool.definition,
  description:
    `${docketSearchTool.definition.description} Searches the workspace's facts, the graph the projections return and its timeline at once, ` +
    'each resource once, tagged with where it was found. A re-ranker reads the query with each result and only the relevant ones come back, ' +
    'most relevant first: often fewer than limit, and none when the workspace holds nothing that answers the query. ' +
    'Each result shows its confidence (how well its evidence supports it), which never decides what is returned.',
  inputSchema: {
    ...docketSearchTool.definition.inputSchema,
    properties: {
      ...(docketSearchTool.definition.inputSchema.properties as Record<string, unknown>),
      include: {
        type: 'array',
        items: { type: 'string', enum: [...SEARCH_BACKENDS] },
        minItems: 1,
        description: 'Where to look: the facts the projections hold, the graph they return, the activity timeline. All three when omitted.',
      },
      minConfidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        deprecated: true,
        description: 'Ignored: relevance decides what is returned; confidence is shown with each result.',
      },
    },
  },
}

/**
 * docket's text, with the matches grouped by type, each tagged with where it
 * was found and ⚠ when its confidence is low, and first, what has gone out of
 * date: each record the search found that was superseded, and what replaced it.
 */
function annotated(found: WorkspaceSearch, text: string): string {
  const types = new Map<string, number>()
  let out = text
  for (const match of found.matches) {
    types.set(match.type, (types.get(match.type) ?? 0) + 1)
    const low = match.confidence !== undefined && match.confidence < LOW_CONFIDENCE
    const replaces = match.supersedes?.length ? ` (current record for ${match.supersedes.join(', ')})` : ''
    out = out.replace(`\n- ${match.id} (${match.type}) `, `\n- ${low ? '⚠ ' : ''}${match.id} (${match.type}) [${match.foundIn.join(', ')}]${replaces} `)
  }
  const changes = found.changes ?? []
  if (types.size === 0 && changes.length === 0) return out
  const [head, ...rest] = out.split('\n')
  return [
    head,
    ...(changes.length ? ['Changed since recorded - never present these as current:', ...changes.map((change) => `- ${change.note}`)] : []),
    ...(types.size ? [`By type: ${[...types].map(([type, count]) => `${count} ${type}`).join(', ')}.`] : []),
    ...rest,
  ].join('\n')
}

/**
 * `docket_search` (§9): docket's contract - its `docket-search.v1` result and
 * the `ui://docket/search.html` app - over the workspace's projections in the
 * org's own stores and its activity log, with `include` added to its
 * arguments, and only the results relevant to the query kept. It needs no model, so it
 * keeps working when the org's AI budget is spent (§11). `viewer` is the
 * workspace's graph browser, so "Open in docket" opens the cloud at `#<id>`.
 */
export function searchTool(context: CloudToolContext): CloudTool {
  const tool: Tool = {
    definition,
    async call(raw) {
      const args = argumentsOf(
        'docket_search',
        raw,
        ['query', 'limit', 'project', 'include', 'minConfidence'],
        '{ "query": "...", "limit"?: n, "project"?: "...", "include"?: ["facts" | "graph" | "timeline"], "minConfidence"?: n }',
      )
      if (args.project !== undefined && typeof args.project !== 'string') throw new InvalidArgumentsError('project must be a string.')
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) throw new InvalidArgumentsError('Say what to look for: query is empty.')
      const limit = args.limit ?? DEFAULT_LIMIT
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
        throw new InvalidArgumentsError(`limit must be a whole number from 1 to ${MAX_SEARCH_LIMIT}.`)
      }
      const scope = searchScope(args.include, args.minConfidence)
      if (typeof scope === 'string') throw new InvalidArgumentsError(scope)
      try {
        const searched = await context.query.search({ orgId: context.orgId, workspaceId: context.workspaceId, query, limit, actor: context.actor, userId: context.userId, ...scope })
        const found = {
          ...searched,
          viewer: context.viewer,
          ...(scope.minConfidence !== undefined ? { warnings: [...searched.warnings, MIN_CONFIDENCE_IGNORED] } : {}),
        }
        const text = annotated(found, searchText(found))
          .replace(/: run `docket sync`\./, ': the cloud is still projecting the latest writes.')
          .replace(/Read the canonical files above for the full record\.$/, 'Call docket_get with an id for its full record.')
        return { content: [{ type: 'text', text: `${UNTRUSTED_NOTE}\n\n${text}` }], structuredContent: found }
      } catch (cause) {
        if (cause instanceof QueryError) return failed(`The docket could not be searched: ${cause.message}`)
        throw cause
      }
    },
  }
  return { scope: 'docket:read', tool }
}
