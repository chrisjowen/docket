import { changeNote, currentRecord, dayOf } from '../../workspace/supersession.js';
import { MIN_CONFIDENCE_IGNORED } from '../surface/results.js';
import { describeResource, liveSupersessions, readWorkspace, storeOf } from './files.js';
/*
 * docket's own search as `docket_search` answers it on every Docket MCP
 * server: the board `searchGraph` draws, cut to where the call said to look,
 * each match tagged with where it was found, and each superseded match
 * answered by the record current now.
 */
/** A match's score where no re-ranker reads it: its rank among the matches, from 1 down. */
const rankScore = (index, count) => Number((1 - index / Math.max(count, 1)).toFixed(3));
/**
 * The board, as `include` asks: the projections' hits are the facts, the
 * subgraphs they returned the graph. A docket keeps no activity timeline, so
 * asking for it alone finds nothing.
 */
export function scopedSearch(found, args) {
    const include = new Set(args.include ?? ['facts', 'graph']);
    const warnings = [...found.warnings];
    if (args.include?.includes('timeline'))
        warnings.push('This docket keeps no activity timeline: the search looked in the facts and the graph only.');
    if (args.minConfidence !== undefined)
        warnings.push(MIN_CONFIDENCE_IGNORED);
    let { nodes, paths } = found;
    const matches = include.has('facts')
        ? found.matches.map((match, index, all) => ({ ...match, foundIn: ['facts'], score: rankScore(index, all.length) }))
        : [];
    if (!include.has('facts'))
        nodes = nodes.filter((node) => !node.match && node.via === 'adapter');
    if (!include.has('graph')) {
        nodes = nodes.filter((node) => node.match || node.via === 'canonical');
        paths = [];
    }
    const onBoard = new Set(nodes.map((node) => node.id));
    const links = found.links.filter((link) => onBoard.has(link.source) && onBoard.has(link.target) && (include.has('graph') || link.via === 'canonical'));
    return { ...found, matches, nodes, links, paths, warnings };
}
/** The out-of-date records among `ids`, each with the record current now. */
export function changesOf(workspace, live, ids) {
    return ids.flatMap((id) => {
        const own = live.get(id);
        const old = describeResource(workspace, id);
        if (!own || !old)
            return [];
        const currentId = currentRecord(live, id);
        const found = currentId !== id && !live.has(currentId) ? describeResource(workspace, currentId) : null;
        const current = found ? { id: found.id, type: found.type, title: found.title } : null;
        return [{ id, type: old.type, title: old.title, supersededBy: own.supersededBy, current, since: dayOf(own.validUntil), reason: own.reason, note: changeNote(old, current, own) }];
    });
}
/**
 * The search with every superseded match answered by its current record: the
 * old one leaves the matches for `changes`, and the current one stands in its
 * place, naming what it `supersedes`.
 */
export async function withSupersessions(resolved, found) {
    const live = await liveSupersessions(storeOf(resolved));
    if (!found.matches.some((match) => live.has(match.id)))
        return found;
    const workspace = await readWorkspace(resolved);
    const changes = changesOf(workspace, live, found.matches.map((match) => match.id));
    const answered = new Map();
    for (const match of found.matches) {
        const change = changes.find((each) => each.id === match.id);
        const stands = change ? change.current : match;
        if (!stands)
            continue;
        const entry = answered.get(stands.id) ??
            found.matches.find((other) => other.id === stands.id && !live.has(other.id)) ?? {
            id: stands.id,
            type: stands.type,
            title: stands.title,
            path: describeResource(workspace, stands.id)?.path ?? '',
            foundBy: match.foundBy,
            foundIn: match.foundIn,
            score: match.score
        };
        if (change)
            entry.supersedes = [...(entry.supersedes ?? []), match.id];
        answered.set(stands.id, entry);
    }
    const matches = [...answered.values()];
    const current = new Set(matches.map((match) => match.id));
    const nodes = found.nodes.map((node) => (node.match === current.has(node.id) ? node : { ...node, match: current.has(node.id) }));
    for (const match of matches) {
        if (!nodes.some((node) => node.id === match.id))
            nodes.push({ id: match.id, type: match.type, title: match.title, path: match.path, match: true, ghost: false, via: 'canonical' });
    }
    return { ...found, matches, nodes, ...(changes.length ? { changes } : {}) };
}
