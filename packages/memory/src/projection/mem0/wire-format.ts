import type { Mem0Scope, StoredMemory } from './backend.js'

/** Scope ids as mem0 writes them on the wire: snake_case, only those that are set. */
export const scopeFilters = (scope: Mem0Scope): Record<string, string> => {
  const filters: Record<string, string> = {}
  if (scope.userId) filters.user_id = scope.userId
  if (scope.agentId) filters.agent_id = scope.agentId
  if (scope.runId) filters.run_id = scope.runId
  return filters
}

/** Responses have been both a bare array and `{ results }` across mem0 versions. */
export const resultsOf = (response: unknown): StoredMemory[] => {
  const items = Array.isArray(response)
    ? response
    : ((response as { results?: unknown } | null)?.results ?? [])
  return Array.isArray(items)
    ? items.filter((item): item is StoredMemory => typeof item?.id === 'string')
    : []
}
