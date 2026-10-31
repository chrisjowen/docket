import { DEFAULT_SEARCH_LIMIT, search } from '../commands/search.js';
import { iconFor } from '../ontology/icons.js';
import { readGraph } from '../open/graph.js';
import { SEARCH_SCHEMA } from './types.js';
/** The most hits `docket_search` asks of each projection. */
export const MAX_SEARCH_LIMIT = 50;
/** The most entities the board carries: every match, then neighbours until it is full. */
export const MAX_NODES = 60;
/**
 * `docket search`, with the board the casebook would draw for it: every
 * resource the projections found, most relevant first (the order the first
 * answering projection ranked them in), and the resources one link away from
 * them, with the links between all of these, read from the canonical files.
 */
export const searchGraph = async (options) => {
    const [result, graph] = await Promise.all([
        search(options.query, { cwd: options.cwd, limit: options.limit ?? DEFAULT_SEARCH_LIMIT }),
        readGraph(options.cwd)
    ]);
    const documents = new Map(result.documents.map((document) => [document.id, document]));
    const ranked = [...new Set([...result.sources.flatMap((source) => source.hits.map((hit) => hit.id)), ...documents.keys()])];
    const matches = ranked.flatMap((id) => {
        const document = documents.get(id);
        return document ? [{ ...document, foundBy: [...document.foundBy] }] : [];
    });
    const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
    const nodeOf = (id, match) => {
        const entity = entities.get(id);
        if (entity)
            return { id, type: entity.type, title: entity.title, path: entity.path, match, ghost: false };
        const found = documents.get(id);
        return found
            ? { id, type: found.type, title: found.title, path: found.path, match, ghost: false }
            : { id, type: '', title: id, match, ghost: true };
    };
    const board = new Map(matches.map((match) => [match.id, nodeOf(match.id, true)]));
    const neighbours = [];
    for (const match of matches) {
        for (const edge of graph.edges) {
            const other = edge.source === match.id ? edge.target : edge.target === match.id ? edge.source : null;
            if (other !== null && !board.has(other) && !neighbours.includes(other))
                neighbours.push(other);
        }
    }
    const room = Math.max(0, MAX_NODES - board.size);
    for (const id of neighbours.slice(0, room))
        board.set(id, nodeOf(id, false));
    const seen = new Set();
    const links = graph.edges.flatMap((edge) => {
        const key = `${edge.source}\u0000${edge.rel}\u0000${edge.target}`;
        if (!board.has(edge.source) || !board.has(edge.target) || seen.has(key))
            return [];
        seen.add(key);
        return [{ source: edge.source, rel: edge.rel, target: edge.target }];
    });
    const counts = new Map();
    for (const entity of graph.entities)
        counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1);
    const icons = new Map(graph.types.map((type) => [type.name, type.icon]));
    return {
        schema: SEARCH_SCHEMA,
        query: result.query,
        project: graph.project,
        matches,
        nodes: [...board.values()],
        links,
        omitted: Math.max(0, neighbours.length - room),
        types: [...new Set([...icons.keys(), ...counts.keys()])].map((name) => ({
            name,
            icon: icons.get(name) ?? iconFor(name),
            count: counts.get(name) ?? 0
        })),
        sources: result.sources.map((source) => ({
            name: source.name,
            hits: source.hits.length,
            ...(source.note ? { note: source.note } : {}),
            ...(source.error ? { error: source.error } : {})
        })),
        index: graph.index,
        viewer: options.viewer ?? null,
        warnings: result.diagnostics.map((diagnostic) => diagnostic.message)
    };
};
/**
 * The same result as text, for the model reading the tool's answer: each
 * match with its file and its links on the board, then how each projection
 * answered.
 */
export const searchText = (found) => {
    const lines = [];
    const count = found.matches.length;
    lines.push(`Docket search for "${found.query}" in ${found.project.name} (${found.project.root}): ` +
        `${count === 0 ? 'nothing found' : `${count} ${count === 1 ? 'resource' : 'resources'}`}.`);
    for (const match of found.matches) {
        const confidence = match.confidence === undefined ? '' : `, confidence ${match.confidence}`;
        lines.push('', `- ${match.id} (${match.type}) "${match.title}": ${match.path}${confidence}`);
        const outgoing = found.links.filter((link) => link.source === match.id).map((link) => `${link.rel} -> ${link.target}`);
        const incoming = found.links.filter((link) => link.target === match.id).map((link) => `${link.source} ${link.rel} ->`);
        if (outgoing.length > 0)
            lines.push(`  links: ${outgoing.join('; ')}`);
        if (incoming.length > 0)
            lines.push(`  linked from: ${incoming.join('; ')}`);
    }
    const neighbours = found.nodes.filter((node) => !node.match);
    if (neighbours.length > 0) {
        lines.push('', `One link away: ${neighbours.map((node) => (node.ghost ? `${node.id} (no file yet)` : `${node.id} "${node.title}"`)).join(', ')}` +
            (found.omitted > 0 ? `, and ${found.omitted} more` : '') + '.');
    }
    lines.push('');
    if (found.sources.length === 0)
        lines.push('No configured projection can search.');
    for (const source of found.sources) {
        const how = source.error ? `unavailable: ${source.error}` : `${source.hits} ${source.hits === 1 ? 'hit' : 'hits'}`;
        lines.push(`${source.name}: ${how}${source.note ? ` (${source.note.replace(/\s+/g, ' ')})` : ''}`);
    }
    if (!found.index.synced || found.index.behind > 0) {
        lines.push(`The search index is behind the files${found.index.behind > 0 ? ` by ${found.index.behind} resources` : ''}: run \`docket sync\`.`);
    }
    for (const warning of found.warnings)
        lines.push(`Warning: ${warning}`);
    lines.push('', 'Read the canonical files above for the full record.');
    return lines.join('\n');
};
