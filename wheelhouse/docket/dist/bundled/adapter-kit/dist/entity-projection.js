const bytes = (text) => Buffer.byteLength(text, 'utf8');
/**
 * A search's hits as an answer: the entities in one block, in the
 * projection's order with its scores and details, and each hit's passage as
 * evidence shown in a passages block - within the request's result and
 * evidence budgets. A ranked search is a top-k, never a count.
 */
export const searchAnswer = (search, request, interpretation = {}) => {
    const { maxResults, maxEvidenceBytes } = request.budget;
    const hits = search.hits.slice(0, maxResults);
    const evidence = [];
    let used = 0;
    let truncated = search.hits.length >= maxResults;
    const refOf = (hit) => ({
        kind: 'entity',
        id: hit.id,
        ...(hit.revision !== undefined ? { revision: hit.revision } : {})
    });
    for (const hit of hits) {
        if (hit.passage === undefined || hit.passage.text.trim() === '')
            continue;
        const size = bytes(hit.passage.text);
        if (used + size > maxEvidenceBytes) {
            truncated = true;
            continue;
        }
        used += size;
        evidence.push({
            id: `passage-${evidence.length + 1}`,
            ...(hit.passage.nativeId !== undefined ? { nativeId: hit.passage.nativeId } : {}),
            kind: 'passage',
            text: hit.passage.text,
            canonicalRefs: [refOf(hit)],
            ...(hit.score !== undefined && Number.isFinite(hit.score) ? { score: hit.score } : {})
        });
    }
    const blocks = [];
    if (hits.length > 0) {
        blocks.push({
            kind: 'entities',
            id: 'hits',
            evidenceIds: evidence.map((item) => item.id),
            entities: hits.map((hit) => ({
                ref: refOf(hit),
                ...(hit.score !== undefined && Number.isFinite(hit.score) ? { score: hit.score } : {}),
                ...(hit.detail !== undefined ? { detail: hit.detail } : {})
            }))
        });
    }
    if (evidence.length > 0)
        blocks.push({ kind: 'passages', id: 'passages', evidenceIds: evidence.map((item) => item.id) });
    return {
        // The note says how the projection read the query - e.g. the Cypher it ran.
        interpretation: { description: search.note ?? '', assumptions: [], ...interpretation },
        blocks,
        evidence,
        coverage: { mode: 'top-k', truncated, scope: request.context.scope },
        diagnostics: []
    };
};
/**
 * Presents an `EntityProjection` as a `MemoryAdapter`: entity inputs only,
 * and a query port answering with its own `answer`, or else with its search
 * hits as an entities block and their passages.
 * Errors propagate as they always have; a batch that throws acknowledges
 * nothing, and replaying it is safe because upserts and removes are idempotent.
 */
export const entityProjectionAdapter = (projection, options) => {
    const search = projection.search?.bind(projection);
    const apply = async (batch) => {
        const receipt = { batchId: batch.batchId, applied: [], failed: [] };
        for (const change of batch.changes) {
            if (change.operation === 'upsert') {
                if (change.record.kind !== 'entity') {
                    receipt.failed.push({ id: change.record.id, retryable: false, message: `${projection.name} projects entities only` });
                    continue;
                }
                await projection.upsert(change.record);
                receipt.applied.push(change.record.id);
            }
            else {
                if (change.kind !== 'entity') {
                    receipt.failed.push({ id: change.id, retryable: false, message: `${projection.name} projects entities only` });
                    continue;
                }
                await projection.remove(change.id);
                receipt.applied.push(change.id);
            }
        }
        return receipt;
    };
    const answer = projection.answer?.bind(projection);
    const ask = async (request) => answer ? answer(request) : searchAnswer(await search(request.question, request.budget.maxResults), request);
    return {
        describe: () => ({
            name: projection.name,
            version: options.version,
            inputs: ['entity'],
            resultKinds: answer ? [...(projection.resultKinds ?? [])] : search ? ['entities', 'passages'] : [],
            rebuild: options.rebuild ?? 'deterministic'
        }),
        status: async () => ({ state: 'ready', message: `${projection.name} projection; its health is not probed` }),
        projection: {
            apply,
            flush: async () => projection.flush?.(),
            // An entity projection holds one namespace, set in its own config.
            reset: async () => projection.reset?.()
        },
        ...(answer || search ? { query: { ask } } : {}),
        close: async () => projection.close?.()
    };
};
/**
 * An adapter definition around an `EntityProjection`: `create` builds the
 * projection, initialises it against the project, and closes it again if that
 * fails, so a projection that cannot start never leaks a connection.
 */
export const entityProjectionDefinition = (options) => ({
    apiVersion: 1,
    name: options.name,
    validateConfig: (input) => options.validateConfig(input),
    async create(config, services) {
        const projection = options.createProjection(config, services);
        try {
            await projection.init?.({ projectRoot: services.projectRoot });
        }
        catch (error) {
            await projection.close?.().catch(() => undefined);
            throw error;
        }
        return entityProjectionAdapter(projection, { version: options.version, rebuild: options.rebuild });
    }
});
