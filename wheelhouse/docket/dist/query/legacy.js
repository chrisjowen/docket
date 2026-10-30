import { warning } from '../model/index.js';
import { connectingPaths } from '../open/paths.js';
/** The entities each answering adapter's entity blocks name, in its own order and terms. */
const hitsOf = (outcome) => {
    if (outcome.state !== 'answered')
        return [];
    const seen = new Set();
    return outcome.answer.blocks.flatMap((block) => block.kind === 'entities'
        ? block.entities.flatMap((item) => {
            if (item.ref.kind !== 'entity' || seen.has(item.ref.id))
                return [];
            seen.add(item.ref.id);
            return [
                {
                    id: item.ref.id,
                    ...(item.score !== undefined ? { score: item.score } : {}),
                    ...(item.detail !== undefined ? { detail: item.detail } : {})
                }
            ];
        })
        : []);
};
/**
 * The coordinated answer as `docket search` reports it: every adapter that can
 * answer, its entity hits and how it read the query, and each document found,
 * described from the canonical files. A hit for a record the files no longer
 * hold - an index not yet synced - was left out, with a warning.
 */
export const toSearchResult = ({ answer, snapshot, rejected }) => {
    const sources = answer.results
        .filter((result) => !(result.state === 'failed' && result.error.code === 'unsupported'))
        .map((result) => {
        if (result.state === 'failed')
            return { name: result.adapter, hits: [], error: result.error.message };
        const note = result.answer.interpretation.description;
        return { name: result.adapter, hits: hitsOf(result), ...(note ? { note } : {}) };
    });
    const diagnostics = [...new Set([...rejected.values()].flat())]
        .sort()
        .map((id) => warning('stale-search-hit', `A projection returned ${id}, which no file defines - run \`docket sync\`.`, { id }));
    const foundBy = new Map();
    for (const source of sources) {
        for (const hit of source.hits) {
            const by = foundBy.get(hit.id) ?? [];
            if (!by.includes(source.name))
                by.push(source.name);
            foundBy.set(hit.id, by);
        }
    }
    const documents = [...foundBy.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .flatMap(([id, by]) => {
        const entity = snapshot.entity(id);
        const document = entity ?? snapshot.documents.find((candidate) => candidate.id === id);
        if (!document)
            return [];
        return [
            {
                id,
                type: document.type,
                title: document.title,
                path: document.path,
                ...(entity?.confidence === undefined ? {} : { confidence: entity.confidence }),
                foundBy: by
            }
        ];
    });
    return { query: answer.question, sources, documents, diagnostics };
};
/** The legacy `GET /api/ask` answer: search's, with the canonical paths joining what it found. */
export const toLegacyAnswer = (outcome, index) => {
    const search = toSearchResult(outcome);
    // Most relevant first: the order the first answering source ranked them in.
    const ranked = [
        ...new Set([...search.sources.flatMap((source) => source.hits.map((hit) => hit.id)), ...search.documents.map((document) => document.id)])
    ];
    const edges = outcome.snapshot.entities.flatMap((entity) => entity.links.map((link) => ({ source: entity.id, rel: link.rel, target: link.target })));
    return {
        query: search.query,
        sources: search.sources,
        documents: search.documents,
        paths: connectingPaths(edges, ranked),
        diagnostics: search.diagnostics,
        index
    };
};
/** The legacy `GET /api/chat` reply: the legacy answer, with the coordinator's summary as its summary. */
export const toLegacyChat = (outcome, index) => {
    const { synthesis, notice } = outcome.answer;
    return {
        query: outcome.answer.question,
        answer: toLegacyAnswer(outcome, index),
        summary: synthesis
            ? {
                text: synthesis.text,
                cited: synthesis.citedEntities,
                model: synthesis.model,
                cached: synthesis.cached ?? false,
                createdAt: synthesis.createdAt ?? new Date().toISOString()
            }
            : null,
        ...(notice && notice.reason !== 'disabled' ? { notice: { reason: notice.reason, message: notice.message } } : {})
    };
};
