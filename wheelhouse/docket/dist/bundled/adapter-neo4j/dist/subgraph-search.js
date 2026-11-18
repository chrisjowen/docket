import { pathsAnswer } from '../../adapter-kit/dist/index.js';
import { MAX_HOPS } from './config.js';
/*
 * Search without a model: one query finds the full-text matches and, from
 * each, the best few paths through the graph, ranked by how far their
 * relationships are corroborated. adapter-kit's `pathsAnswer` turns them into
 * an answer: the matches its entities, the paths its graph, and each path a
 * derived fact saying why it holds.
 */
export { DEFAULT_TRAVERSAL, describePath, hitOf, matchesOf, PATHS_PER_MATCH } from '../../adapter-kit/dist/index.js';
export const FULLTEXT_INDEX = 'memory_text';
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
/** The matches as an answer, each path a fact Neo4j derived (adapter-kit's `pathsAnswer`). */
export const subgraphAnswer = (matches, request, interpretation) => pathsAnswer(matches, request, interpretation, 'neo4j');
