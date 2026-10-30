/** Scope ids as mem0 writes them on the wire: snake_case, only those that are set. */
export const scopeFilters = (scope) => {
    const filters = {};
    if (scope.userId)
        filters.user_id = scope.userId;
    if (scope.agentId)
        filters.agent_id = scope.agentId;
    if (scope.runId)
        filters.run_id = scope.runId;
    return filters;
};
/** Responses have been both a bare array and `{ results }` across mem0 versions. */
export const resultsOf = (response) => {
    const items = Array.isArray(response)
        ? response
        : (response?.results ?? []);
    return Array.isArray(items)
        ? items.filter((item) => typeof item?.id === 'string')
        : [];
};
