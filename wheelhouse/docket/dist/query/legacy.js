import { warning } from '../model/index.js';
import { connectingPaths } from '../open/paths.js';
/**
 * A path step by step, each with the relationship returned between the two
 * nodes in its direction: `a -depends_on-> b <-owned_by- c`, and `--` where
 * none was returned.
 */
export const describePath = (edges, path) => path
    .map((id, index) => {
    const previous = path[index - 1];
    if (previous === undefined)
        return id;
    const forward = edges.find((edge) => edge.source === previous && edge.target === id);
    if (forward)
        return ` -${forward.rel}-> ${id}`;
    const backward = edges.find((edge) => edge.source === id && edge.target === previous);
    return backward ? ` <-${backward.rel}- ${id}` : ` -- ${id}`;
})
    .join('');
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
 * The graph blocks of one answer, as one subgraph in canonical terms: a node
 * naming an entity the files hold takes its id, and any other keeps the id the
 * adapter gave it - prefixed with the adapter's, should that be an entity's id
 * it did not claim. Each edge carries the text of the evidence it cites.
 */
const graphOf = (adapter, answer, snapshot) => {
    const blocks = answer.blocks.flatMap((block) => (block.kind === 'graph' ? [block] : []));
    if (blocks.length === 0)
        return undefined;
    const evidence = new Map(answer.evidence.map((item) => [item.id, item.text]));
    const nodes = new Map();
    const edges = new Map();
    const paths = new Map();
    for (const block of blocks) {
        const ids = new Map();
        for (const node of block.nodes) {
            const named = node.ref?.kind === 'entity' ? snapshot.entity(node.ref.id) : undefined;
            const own = node.ref?.id ?? node.id;
            const id = named ? named.id : snapshot.entity(own) ? `${adapter}:${own}` : own;
            ids.set(node.id, id);
            if (nodes.has(id))
                continue;
            nodes.set(id, {
                id,
                label: node.label || (named?.title ?? own),
                ...(named ? { type: named.type } : node.type !== undefined ? { type: node.type } : {}),
                canonical: named !== undefined
            });
        }
        // The contract keeps every edge end and path step among the block's nodes.
        const idOf = (local) => ids.get(local) ?? local;
        for (const edge of block.edges) {
            const [source, target] = [idOf(edge.source), idOf(edge.target)];
            const key = `${source}\u0000${edge.rel}\u0000${target}`;
            const why = (edge.evidenceIds ?? []).flatMap((id) => {
                const text = evidence.get(id);
                return text === undefined ? [] : [text];
            });
            const known = edges.get(key);
            if (known) {
                for (const text of why)
                    if (!known.why.includes(text))
                        known.why.push(text);
                if (edge.confidence !== undefined && (known.confidence === undefined || edge.confidence > known.confidence))
                    known.confidence = edge.confidence;
                continue;
            }
            edges.set(key, { source, rel: edge.rel, target, ...(edge.confidence !== undefined ? { confidence: edge.confidence } : {}), why: [...new Set(why)] });
        }
        for (const path of block.paths ?? []) {
            const steps = path.map(idOf);
            paths.set(steps.join('\u0000'), steps);
        }
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()], paths: [...paths.values()] };
};
/**
 * The coordinated answer as `docket search` reports it: every adapter that can
 * answer, its entity hits, the subgraph it returned and how it read the query, and each document found,
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
        const graph = graphOf(result.adapter, result.answer, snapshot);
        return { name: result.adapter, hits: hitsOf(result), ...(graph ? { graph } : {}), ...(note ? { note } : {}) };
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
