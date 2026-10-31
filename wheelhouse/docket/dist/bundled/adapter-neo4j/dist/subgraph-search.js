import { questionTerms, relevantExcerpt, searchAnswer } from '../../adapter-kit/dist/index.js';
import { MAX_HOPS } from './config.js';
/*
 * Search without a model: one query finds the full-text matches and, from
 * each, the best few paths through the graph, ranked by how far their
 * relationships are corroborated. The matches are the answer's entities, the
 * paths its graph, and each path a derived fact saying why it holds.
 */
export const FULLTEXT_INDEX = 'memory_text';
/** The paths an answer keeps from each match. */
export const PATHS_PER_MATCH = 3;
/** The most of a matched node's body an answer quotes as its passage. */
const PASSAGE_CHARS = 600;
export const DEFAULT_TRAVERSAL = { hops: 2, minConfidence: 0 };
/**
 * The one query a search runs: full-text matches in scope, best first, and
 * for each the paths of up to `hops` relationships to other nodes in scope,
 * in either direction. A path ranks by the product of its relationships'
 * confidence, divided by the log of its end's degree so the best-connected
 * nodes do not end every path. Each match brings twice the paths it keeps,
 * so dropping those another path extends still leaves enough.
 *
 * The hop count is a validated integer, the only value written into the
 * query: Cypher takes no parameter for a path's length.
 */
export const subgraphQuery = (hops) => {
    if (!Number.isInteger(hops) || hops < 1 || hops > MAX_HOPS) {
        throw new Error(`A search reaches 1 to ${MAX_HOPS} hops, not ${hops}`);
    }
    return `CALL db.index.fulltext.queryNodes('${FULLTEXT_INDEX}', $lucene) YIELD node AS seed, score
WHERE seed.scope = $scope AND seed.stub = false
WITH seed, score ORDER BY score DESC, seed.id LIMIT $matches
OPTIONAL MATCH p = (seed)-[*1..${hops}]-(reached:Memory {scope: $scope})
WHERE reached <> seed
  AND all(n IN nodes(p) WHERE n.scope = $scope)
  AND all(r IN relationships(p) WHERE coalesce(r.confidence, 0.0) >= $minConfidence AND r.rel IN coalesce($rels, [r.rel]))
WITH seed, score, p,
     reduce(c = 1.0, r IN relationships(p) | c * coalesce(r.confidence, 0.0)) / log(2 + COUNT { (reached)--() }) AS rank
ORDER BY score DESC, seed.id, rank DESC, length(p)
WITH seed, score, collect(CASE WHEN p IS NULL THEN null ELSE {
       nodes: [n IN nodes(p) | n {.id, .title, .type, .hash, .stub}],
       edges: [r IN relationships(p) | {source: startNode(r).id, rel: r.rel, target: endNode(r).id, confidence: r.confidence, sources: r.sources}]
     } END)[0..$paths] AS paths
RETURN seed.id AS id, seed.title AS title, seed.content AS content, seed.hash AS hash, score, paths
ORDER BY score DESC, id`;
};
const text = (value) => (typeof value === 'string' ? value : undefined);
const pathNode = (value) => {
    const [title, type, hash] = [text(value.title), text(value.type), text(value.hash)];
    return {
        id: String(value.id),
        ...(title !== undefined ? { title } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(hash !== undefined ? { hash } : {}),
        stub: value.stub === true
    };
};
const pathEdge = (value) => ({
    source: String(value.source),
    rel: String(value.rel),
    target: String(value.target),
    ...(typeof value.confidence === 'number' && value.confidence >= 0 && value.confidence <= 1 ? { confidence: value.confidence } : {}),
    sources: Array.isArray(value.sources) ? value.sources.filter((source) => typeof source === 'string') : []
});
const extendsPath = (longer, shorter) => longer.nodes.length > shorter.nodes.length && shorter.nodes.every((node, index) => longer.nodes[index]?.id === node.id);
/**
 * The query's rows as matches, each keeping its best `PATHS_PER_MATCH`
 * paths. A path another one extends says nothing that one does not, so it
 * goes; so does one that visits a node twice.
 */
export const matchesOf = (rows) => rows.map((row) => {
    const all = (Array.isArray(row.paths) ? row.paths : []).map((value) => ({
        nodes: value.nodes.map(pathNode),
        edges: value.edges.map(pathEdge)
    }));
    const simple = all.filter((path) => new Set(path.nodes.map((node) => node.id)).size === path.nodes.length);
    const paths = simple.filter((path) => !simple.some((other) => extendsPath(other, path))).slice(0, PATHS_PER_MATCH);
    const [title, content, hash] = [text(row.title), text(row.content), text(row.hash)];
    return {
        id: String(row.id),
        ...(title !== undefined ? { title } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(hash !== undefined ? { hash } : {}),
        score: Number(row.score),
        paths
    };
});
const round = (value) => String(Math.round(value * 100) / 100);
/**
 * A path step by step from the match, each relationship drawn in its stored
 * direction: `a -depends_on-> b <-owned_by- c`. With `why`, each step also
 * says how far it is corroborated and from which sources: `(0.95, code+manifest)`.
 */
export const describePath = (path, why = false) => path.nodes
    .map((node, index) => {
    const edge = path.edges[index - 1];
    if (index === 0 || edge === undefined)
        return node.id;
    const arrow = edge.target === node.id ? `-${edge.rel}->` : `<-${edge.rel}-`;
    const support = [
        ...(edge.confidence !== undefined ? [round(edge.confidence)] : []),
        ...(edge.sources.length > 0 ? [edge.sources.join('+')] : [])
    ];
    return ` ${arrow} ${node.id}${why && support.length > 0 ? ` (${support.join(', ')})` : ''}`;
})
    .join('');
/** A match as a search hit: its score, its paths as the detail, and the part of its body the question names. */
export const hitOf = (match, terms) => {
    const detail = match.paths.map((path) => describePath(path)).join('; ');
    const body = match.content !== undefined && match.content.trim() !== '' ? match.content : (match.title ?? '');
    const passage = relevantExcerpt(body, [...terms], PASSAGE_CHARS).text;
    return {
        id: match.id,
        score: match.score,
        ...(detail ? { detail } : {}),
        ...(match.hash !== undefined ? { revision: match.hash } : {}),
        ...(passage ? { passage: { text: passage } } : {})
    };
};
const bytes = (value) => Buffer.byteLength(value, 'utf8');
const refOf = (node) => node.stub ? undefined : { kind: 'entity', id: node.id, ...(node.hash !== undefined ? { revision: node.hash } : {}) };
/**
 * The matches as an answer: an entities block of the matches with their
 * scores, a graph block of their paths - every relationship in its stored
 * direction with its confidence, citing the paths it lies on - and a passages
 * block of what each match says. Each path is a derived fact of its own, the
 * why its relationships hold, within the evidence budget. The nodes a path
 * reaches are context, never matches. Ranked, so a top-k.
 */
export const subgraphAnswer = (matches, request, interpretation) => {
    const terms = questionTerms(request.question);
    const answer = searchAnswer({ hits: matches.map((match) => hitOf(match, terms)) }, request, interpretation);
    const shown = matches.slice(0, request.budget.maxResults);
    const evidence = [];
    let used = answer.evidence.reduce((total, item) => total + bytes(item.text), 0);
    let truncated = answer.coverage.truncated;
    const nodes = new Map();
    const edges = new Map();
    const paths = [];
    for (const path of shown.flatMap((match) => match.paths)) {
        const why = describePath(path, true);
        let evidenceId;
        if (used + bytes(why) <= request.budget.maxEvidenceBytes) {
            used += bytes(why);
            evidenceId = `path-${evidence.length + 1}`;
            const refs = new Map(path.nodes.flatMap((node) => {
                const ref = refOf(node);
                return ref ? [[node.id, ref]] : [];
            }));
            evidence.push({ id: evidenceId, kind: 'derived-fact', text: why, canonicalRefs: [...refs.values()], derivation: { engine: 'neo4j' } });
        }
        else {
            truncated = true;
        }
        for (const node of path.nodes) {
            if (nodes.has(node.id))
                continue;
            const ref = refOf(node);
            nodes.set(node.id, {
                id: node.id,
                label: node.title !== undefined && node.title !== '' ? node.title : node.id,
                ...(node.type !== undefined ? { type: node.type } : {}),
                ...(ref ? { ref } : {})
            });
        }
        for (const edge of path.edges) {
            const key = `${edge.source}\u0000${edge.rel}\u0000${edge.target}`;
            const known = edges.get(key);
            if (known) {
                if (evidenceId !== undefined)
                    known.evidenceIds = [...(known.evidenceIds ?? []), evidenceId];
                continue;
            }
            edges.set(key, {
                source: edge.source,
                target: edge.target,
                rel: edge.rel,
                ...(edge.confidence !== undefined ? { confidence: edge.confidence } : {}),
                ...(evidenceId !== undefined ? { evidenceIds: [evidenceId] } : {})
            });
        }
        paths.push(path.nodes.map((node) => node.id));
    }
    const graph = edges.size > 0
        ? [
            {
                kind: 'graph',
                id: 'paths',
                title: 'Paths from the matches',
                evidenceIds: evidence.map((item) => item.id),
                nodes: [...nodes.values()],
                edges: [...edges.values()],
                paths
            }
        ]
        : [];
    const [entities, ...rest] = answer.blocks;
    return {
        ...answer,
        blocks: entities ? [entities, ...graph, ...rest] : graph,
        evidence: [...answer.evidence, ...evidence],
        coverage: { ...answer.coverage, truncated }
    };
};
