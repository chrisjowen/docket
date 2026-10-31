/** Longer chains connect almost anything to anything, which says nothing. */
export const MAX_PATH_LENGTH = 3;
/** Found entities considered for paths. Pairs grow quadratically. */
export const MAX_PATH_ENDPOINTS = 8;
const adjacency = (edges) => {
    const neighbours = new Map();
    const add = (from, neighbour) => {
        const list = neighbours.get(from);
        if (list)
            list.push(neighbour);
        else
            neighbours.set(from, [neighbour]);
    };
    for (const edge of edges) {
        if (edge.source === edge.target)
            continue;
        add(edge.source, { id: edge.target, step: { rel: edge.rel, forward: true } });
        add(edge.target, { id: edge.source, step: { rel: edge.rel, forward: false } });
    }
    // Sorted so the same files always give the same paths.
    for (const list of neighbours.values()) {
        list.sort((a, b) => compare(a.id, b.id) || compare(a.step.rel, b.step.rel) || Number(b.step.forward) - Number(a.step.forward));
    }
    return neighbours;
};
/** Breadth-first, ignoring direction: a shortest chain from `from` to `to`, or null. */
const shortestPath = (neighbours, from, to, maxLength) => {
    const previous = new Map([[from, null]]);
    let frontier = [from];
    for (let depth = 0; depth < maxLength && frontier.length > 0; depth += 1) {
        const next = [];
        for (const id of frontier) {
            for (const neighbour of neighbours.get(id) ?? []) {
                if (previous.has(neighbour.id))
                    continue;
                previous.set(neighbour.id, { id, step: neighbour.step });
                if (neighbour.id === to)
                    return walkBack(previous, to);
                next.push(neighbour.id);
            }
        }
        frontier = next;
    }
    return null;
};
const walkBack = (previous, to) => {
    const nodes = [to];
    const steps = [];
    for (let link = previous.get(to); link; link = previous.get(link.id)) {
        nodes.unshift(link.id);
        steps.unshift(link.step);
    }
    return { nodes, steps };
};
/**
 * How the entities a search found relate to each other: the shortest chain of
 * relationships, in either direction, between each pair of them. A search hit
 * says which entities matter; the paths say why they belong together.
 */
export const connectingPaths = (edges, ids, maxLength = MAX_PATH_LENGTH) => {
    const neighbours = adjacency(edges);
    const endpoints = [...new Set(ids)].slice(0, MAX_PATH_ENDPOINTS);
    const paths = [];
    for (let i = 0; i < endpoints.length; i += 1) {
        for (let j = i + 1; j < endpoints.length; j += 1) {
            const path = shortestPath(neighbours, endpoints[i], endpoints[j], maxLength);
            if (path)
                paths.push(path);
        }
    }
    return paths.sort((a, b) => a.steps.length - b.steps.length || compare(a.nodes.join(' '), b.nodes.join(' ')));
};
function compare(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
