/*
 * The adapter's own tables, all derived and rebuildable from the canonical
 * files: `docket rebuild` (`reset`) empties a scope and a sync fills it again.
 * They live in one schema of their own (`docket_index` by default), migrated
 * forward on open by numbered steps recorded in `migrations`, under an
 * advisory lock so two processes opening at once migrate once.
 *
 * - `entities`: one row per entity, its full-text vector kept beside it,
 *   weighted title (A), tags and type (B), body (C), and the number of words
 *   it holds, which BM25 weighs a match's length by.
 * - `edges`: one row per (source, rel, target) a graph entity links, the
 *   target projected or not.
 * - `scopes`: what each scope's full-text vectors were built with.
 * - `embeddings`: only with pgvector - one vector per entity, and the text and
 *   model it was computed from, so a changed entity or model is re-embedded.
 */
/** A step's name is its version: steps run in this order and never change once released. */
export const CORE_MIGRATIONS = [
    {
        name: '0001_entities_edges',
        up: (s) => [
            `CREATE TABLE ${s}.scopes (
         scope text PRIMARY KEY,
         language text NOT NULL,
         updated_at timestamptz NOT NULL DEFAULT now()
       )`,
            `CREATE TABLE ${s}.entities (
         scope text NOT NULL,
         id text NOT NULL,
         type text NOT NULL,
         title text NOT NULL,
         tags text[] NOT NULL DEFAULT '{}',
         body text NOT NULL DEFAULT '',
         attrs jsonb NOT NULL DEFAULT '{}',
         revision text NOT NULL,
         paths text[] NOT NULL DEFAULT '{}',
         confidence real,
         searchable boolean NOT NULL,
         in_graph boolean NOT NULL,
         vectorize boolean NOT NULL,
         text_hash text NOT NULL,
         tsv tsvector NOT NULL,
         len integer NOT NULL DEFAULT 0,
         PRIMARY KEY (scope, id)
       )`,
            `CREATE INDEX entities_tsv ON ${s}.entities USING gin (tsv)`,
            `CREATE TABLE ${s}.edges (
         scope text NOT NULL,
         source text NOT NULL,
         rel text NOT NULL,
         target text NOT NULL,
         confidence real,
         sources text[] NOT NULL DEFAULT '{}',
         attrs jsonb,
         evidence jsonb NOT NULL DEFAULT '[]',
         PRIMARY KEY (scope, source, rel, target)
       )`,
            `CREATE INDEX edges_target ON ${s}.edges (scope, target)`
        ]
    }
];
/** With pg_trgm: a trigram index on titles, for the title boost. */
export const TRIGRAM_MIGRATIONS = [
    {
        name: 't0001_title_trigrams',
        up: (s) => [`CREATE INDEX entities_title_trgm ON ${s}.entities USING gin (lower(title) gin_trgm_ops)`]
    }
];
/**
 * With pgvector: the embeddings. The column takes vectors of any size, so
 * models of different sizes can share it; each size gets its own HNSW
 * index over the rows of that size (`hnswIndex`).
 */
export const VECTOR_MIGRATIONS = [
    {
        name: 'v0001_embeddings',
        up: (s) => [
            `CREATE TABLE ${s}.embeddings (
         scope text NOT NULL,
         id text NOT NULL,
         model text NOT NULL,
         dims integer NOT NULL,
         text_hash text NOT NULL,
         embedding vector NOT NULL,
         PRIMARY KEY (scope, id),
         FOREIGN KEY (scope, id) REFERENCES ${s}.entities (scope, id) ON DELETE CASCADE
       )`
        ]
    }
];
/** The HNSW index for vectors of `dims` dimensions: a partial index over the rows of that size, cast to it. */
export const hnswIndex = (schema, dims) => `CREATE INDEX IF NOT EXISTS embeddings_hnsw_${dims} ON ${schema}.embeddings
   USING hnsw ((embedding::vector(${dims})) vector_cosine_ops) WHERE dims = ${dims}`;
