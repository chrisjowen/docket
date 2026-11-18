import { MAX_HOPS } from './config.js';
/*
 * The SQL the adapter searches and traverses with. The schema and the
 * dimension count are the only values written into a query - the schema a
 * validated name, the dimensions a validated integer - and everything else is
 * a parameter.
 */
/** How far a title named in the query lifts a match: its word similarity to the query, times this. */
export const TITLE_BOOST = 1;
/** A title lifts its match only when at least this similar to some run of the query's words. */
export const TITLE_SIMILARITY = 0.6;
/**
 * The query's full-text form, as `websearch_to_tsquery` reads it - quoted
 * phrases, `or`, `-` to exclude - with each remaining AND loosened to OR, as
 * Neo4j's full-text search ORs a question's words: a question's words need not
 * all appear, and a match with more of them ranks higher. A query that
 * excludes a word keeps every AND, so the exclusion still applies.
 */
const tsquery = `(SELECT CASE WHEN position('!' IN parsed::text) > 0 THEN parsed
                             ELSE replace(parsed::text, ' & ', ' | ')::tsquery END
                  FROM websearch_to_tsquery($2::regconfig, $3) AS parsed)`;
/** BM25's term-frequency saturation and length normalisation: Lucene's defaults, and FTS5's. */
export const BM25 = { k1: 1.2, b: 0.75 };
/**
 * Full-text matches in scope, best first, ranked by BM25 as Lucene - and so
 * Neo4j's full-text search - and SQLite's FTS5 rank. Each of the query's
 * lexemes (its words stemmed, stop words dropped, in the text search
 * configuration) counts its idf, ln(1 + (N - n + 0.5) / (n + 0.5)) over the
 * scope's N searchable entities n of which hold it, times its frequency in
 * the entity - a word in the title counting 5, in the type or tags 2, in the
 * body 1 - saturated and weighed by the entity's length against the scope's
 * average. A word in most entities therefore counts for little, and a rare
 * one for a lot. With trigrams, a title close to some run of the query's
 * words - a name, or a name misspelt - lifts its match, and a title close to
 * the whole query is a match even when no word matches exactly. The
 * statistics are worked out once a query (MATERIALIZED), not once for every
 * entity they score.
 *
 * Parameters: $1 scope, $2 text search configuration, $3 query, $4 limit.
 */
export const lexicalQuery = (schema, trigram) => {
    const boost = trigram
        ? `CASE WHEN word_similarity(lower(e.title), lower($3)) >= ${TITLE_SIMILARITY}
            THEN ${TITLE_BOOST} * word_similarity(lower(e.title), lower($3)) ELSE 0 END`
        : '0';
    const { k1, b } = BM25;
    return `WITH q AS (SELECT ${tsquery} AS tsq),
stats AS MATERIALIZED (
  SELECT count(*)::float8 AS n, greatest(avg(len), 1)::float8 AS avglen
  FROM ${schema}.entities WHERE scope = $1 AND searchable
),
terms AS MATERIALIZED (
  SELECT l.lexeme, ln(1 + (stats.n - holding.n + 0.5) / (holding.n + 0.5)) AS idf
  FROM (SELECT DISTINCT unnest(tsvector_to_array(to_tsvector($2::regconfig, $3))) AS lexeme) l
  CROSS JOIN stats
  CROSS JOIN LATERAL (
    SELECT count(*)::float8 AS n FROM ${schema}.entities h
    WHERE h.scope = $1 AND h.searchable AND h.tsv @@ quote_literal(l.lexeme)::tsquery
  ) holding
)
SELECT e.id, e.title, e.body, e.revision,
       (SELECT coalesce(sum(t.idf * f.f * ${k1 + 1} / (f.f + ${k1} * (${1 - b} + ${b} * e.len / stats.avglen))), 0)
        FROM unnest(e.tsv) u
        JOIN terms t ON t.lexeme = u.lexeme
        CROSS JOIN LATERAL (
          SELECT sum(CASE w WHEN 'A' THEN 5 WHEN 'B' THEN 2 ELSE 1 END)::float8 AS f FROM unnest(u.weights) w
        ) f) + ${boost} AS score
FROM ${schema}.entities e, q, stats
WHERE e.scope = $1 AND e.searchable
  AND (e.tsv @@ q.tsq${trigram ? ' OR lower(e.title) % lower($3)' : ''})
ORDER BY score DESC, e.id
LIMIT $4`;
};
/**
 * The entities nearest the query's embedding in scope, best first, scored by
 * cosine similarity. Only vectors of the configured model and size count; the
 * cast to that size is what lets the partial HNSW index answer.
 *
 * Parameters: $1 scope, $2 model, $3 query vector, $4 limit.
 */
export const semanticQuery = (schema, dims) => {
    if (!Number.isInteger(dims) || dims < 1)
        throw new Error(`An embedding has a positive whole number of dimensions, not ${dims}`);
    return `SELECT e.id, e.title, e.body, e.revision,
       1 - (m.embedding::vector(${dims}) <=> $3::vector(${dims})) AS score
FROM ${schema}.embeddings m
JOIN ${schema}.entities e ON e.scope = m.scope AND e.id = m.id
WHERE m.scope = $1 AND m.dims = ${dims} AND m.model = $2
ORDER BY m.embedding::vector(${dims}) <=> $3::vector(${dims}), e.id
LIMIT $4`;
};
/**
 * The paths from each seed, as Neo4j's subgraph query finds them: up to
 * `hops` links in either direction to other nodes in scope, each link of
 * confidence at least the minimum and of a named `rel` when any are named,
 * never visiting a node twice. A link's target need not be projected: it is
 * a stub then, as in Neo4j. A path ranks by the product of its links'
 * confidence divided by the log of its end's degree - every link it has, in
 * either direction - so the best-connected nodes do not end every path. Each
 * seed keeps its best `$4` paths, ties going to the shorter path, then the
 * path's ids in order, so the same graph always gives the same paths.
 *
 * Only seeds projected into the graph have paths. Parameters: $1 scope,
 * $2 seed ids, $3 minimum confidence, $4 paths per seed, $5 rels or null.
 */
export const pathsQuery = (schema, hops) => {
    if (!Number.isInteger(hops) || hops < 1 || hops > MAX_HOPS) {
        throw new Error(`An answer reaches 1 to ${MAX_HOPS} hops, not ${hops}`);
    }
    const step = (from, to) => `SELECT ${from} AS here, ${to} AS there,
            jsonb_build_object('source', source, 'rel', rel, 'target', target,
                               'confidence', confidence, 'sources', to_jsonb(sources)) AS edge,
            coalesce(confidence, 0) AS confidence
     FROM ${schema}.edges
     WHERE scope = $1 AND coalesce(confidence, 0) >= $3 AND ($5::text[] IS NULL OR rel = ANY($5::text[]))`;
    return `WITH RECURSIVE
seeds AS (
  SELECT s.id FROM unnest($2::text[]) AS s(id)
  JOIN ${schema}.entities e ON e.scope = $1 AND e.id = s.id AND e.in_graph
),
steps AS (
  ${step('source', 'target')}
  UNION ALL
  ${step('target', 'source')}
),
walk AS (
  SELECT s.id AS seed, st.there AS here, ARRAY[s.id, st.there] AS nodes,
         jsonb_build_array(st.edge) AS edges, st.confidence::float8 AS confidence
  FROM seeds s JOIN steps st ON st.here = s.id
  WHERE st.there <> s.id
  UNION ALL
  SELECT w.seed, st.there, w.nodes || st.there, w.edges || st.edge, w.confidence * st.confidence
  FROM walk w JOIN steps st ON st.here = w.here
  WHERE cardinality(w.nodes) <= ${hops} AND st.there <> ALL (w.nodes)
),
ranked AS (
  SELECT w.seed, w.nodes, w.edges,
         w.confidence / ln(2 + (SELECT count(*) FROM ${schema}.edges d WHERE d.scope = $1 AND d.source = w.here)
                             + (SELECT count(*) FROM ${schema}.edges d WHERE d.scope = $1 AND d.target = w.here)) AS rank
  FROM walk w
),
kept AS (
  SELECT r.*, row_number() OVER (PARTITION BY r.seed ORDER BY r.rank DESC, cardinality(r.nodes), r.nodes) AS n
  FROM ranked r
)
SELECT seed, nodes, edges FROM kept WHERE n <= $4 ORDER BY seed, n`;
};
/** The traversal the config asks for, defaults filled in. */
export const traversalParameters = (traversal) => ({
    minConfidence: traversal.minConfidence,
    rels: traversal.rels ? [...traversal.rels] : null
});
