import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { checkoutScope, DEFAULT_TRAVERSAL, embeddingText, fuseRankings, matchesOf, ollamaEmbedder, PATHS_PER_MATCH, pathsAnswer, prefixesOf, questionTerms, relevantExcerpt } from '../../adapter-kit/dist/index.js';
import { DEFAULT_FILE, MAX_HOPS, searchModeOf } from './config.js';
/** The most of a matched entity's body a hit quotes as its passage. */
const PASSAGE_CHARS = 600;
/** How much a word in the title, the type and tags, and the body counts in the BM25 rank: as Postgres weighs A, B and C. */
const COLUMN_WEIGHTS = [5, 2, 1];
/**
 * better-sqlite3 is an optional dependency: only repositories that configure
 * a sqlite projection need it installed, so it is loaded on first use.
 */
const loadSqlite = async () => {
    try {
        return (await import('better-sqlite3')).default;
    }
    catch (cause) {
        throw new Error('The sqlite projection needs the "better-sqlite3" package. Install it next to ' +
            `@chrisjowen/docket (e.g. \`pnpm add better-sqlite3\`). (${cause.message})`);
    }
};
const hashOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 32);
/*
 * The tables, all derived and rebuildable from the canonical files, migrated
 * forward on open by numbered steps recorded in `migrations`:
 *
 * - `entities`: one row per entity; its `rid` is its row in `entities_fts`.
 * - `entities_fts`: FTS5 over title, type and tags, and body, stemmed by
 *   Porter's English stemmer.
 * - `edges`: one row per (source, rel, target) a graph entity links, the
 *   target projected or not.
 * - `embeddings`: with `semantic`, one vector per entity as 32-bit floats, and
 *   the text and model it was computed from, so a changed entity or model is
 *   re-embedded.
 */
const MIGRATIONS = [
    {
        name: '0001_entities_edges',
        up: `
      CREATE TABLE entities (
        rid INTEGER PRIMARY KEY,
        scope TEXT NOT NULL,
        id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        tags TEXT NOT NULL,
        body TEXT NOT NULL,
        attrs TEXT NOT NULL,
        revision TEXT NOT NULL,
        paths TEXT NOT NULL,
        confidence REAL,
        searchable INTEGER NOT NULL,
        in_graph INTEGER NOT NULL,
        vectorize INTEGER NOT NULL,
        text_hash TEXT NOT NULL,
        UNIQUE (scope, id)
      );
      CREATE VIRTUAL TABLE entities_fts USING fts5(title, kind, body, tokenize = 'porter unicode61 remove_diacritics 2');
      CREATE TABLE edges (
        scope TEXT NOT NULL,
        source TEXT NOT NULL,
        rel TEXT NOT NULL,
        target TEXT NOT NULL,
        confidence REAL,
        sources TEXT NOT NULL,
        attrs TEXT,
        evidence TEXT NOT NULL,
        PRIMARY KEY (scope, source, rel, target)
      );
      CREATE INDEX edges_target ON edges (scope, target);
      CREATE TABLE embeddings (
        rid INTEGER PRIMARY KEY REFERENCES entities (rid) ON DELETE CASCADE,
        model TEXT NOT NULL,
        dims INTEGER NOT NULL,
        text_hash TEXT NOT NULL,
        embedding BLOB NOT NULL
      );`
    }
];
/**
 * The paths from each seed, as Neo4j's subgraph query finds them (see
 * adapter-postgres's `pathsQuery`, which this mirrors): up to `hops` links in
 * either direction, each of confidence at least the minimum and of a named
 * `rel` when any are named, never visiting a node twice, a link's
 * unprojected target a stub. A path ranks by the product of its links'
 * confidence divided by the log of its end's degree; each seed keeps its best
 * `@paths`, ties going to the shorter path, then its ids in order. A path's
 * nodes and links are JSON arrays.
 */
export const pathsQuery = (hops) => {
    if (!Number.isInteger(hops) || hops < 1 || hops > MAX_HOPS) {
        throw new Error(`An answer reaches 1 to ${MAX_HOPS} hops, not ${hops}`);
    }
    const edge = `json_object('source', e.source, 'rel', e.rel, 'target', e.target, 'confidence', e.confidence, 'sources', json(e.sources))`;
    const allowed = `coalesce(e.confidence, 0) >= @minConfidence AND (@rels IS NULL OR e.rel IN (SELECT value FROM json_each(@rels)))`;
    // Each step follows a link out of where the path is, or into it: two joins, each on an index of `edges`. CROSS
    // JOIN keeps SQLite from turning them round, which would scan every link in scope for each step of every path.
    const first = (here, there) => `SELECT s.id, e.${there}, json_array(s.id, e.${there}), json_array(${edge}), coalesce(e.confidence, 0), 1
  FROM seeds s CROSS JOIN edges e ON e.scope = @scope AND e.${here} = s.id
  WHERE ${allowed} AND e.${there} <> s.id`;
    const next = (here, there) => `SELECT w.seed, e.${there}, json_insert(w.nodes, '$[#]', e.${there}), json_insert(w.edges, '$[#]', ${edge}),
         w.confidence * coalesce(e.confidence, 0), w.depth + 1
  FROM walk w CROSS JOIN edges e ON e.scope = @scope AND e.${here} = w.here
  WHERE w.depth < ${hops} AND ${allowed} AND NOT EXISTS (SELECT 1 FROM json_each(w.nodes) WHERE value = e.${there})`;
    return `WITH RECURSIVE
seeds AS (
  SELECT j.value AS id FROM json_each(@seeds) j
  JOIN entities e ON e.scope = @scope AND e.id = j.value AND e.in_graph
),
walk(seed, here, nodes, edges, confidence, depth) AS (
  ${first('source', 'target')}
  UNION ALL
  ${first('target', 'source')}
  UNION ALL
  ${next('source', 'target')}
  UNION ALL
  ${next('target', 'source')}
),
ranked AS (
  SELECT w.seed, w.nodes, w.edges, w.depth,
         w.confidence / ln(2 + (SELECT count(*) FROM edges d WHERE d.scope = @scope AND d.source = w.here)
                             + (SELECT count(*) FROM edges d WHERE d.scope = @scope AND d.target = w.here)) AS rank
  FROM walk w
),
kept AS (
  SELECT r.*, row_number() OVER (PARTITION BY r.seed ORDER BY r.rank DESC, r.depth, r.nodes) AS n
  FROM ranked r
)
SELECT seed, nodes, edges FROM kept WHERE n <= @paths ORDER BY seed, n`;
};
/**
 * A search's words as FTS5 queries: each word worth matching, quoted. A row
 * matches when it holds any of them - as Neo4j's full-text search ORs a
 * question's words - and one holding more ranks higher.
 */
export const ftsWords = (query) => questionTerms(query).map((term) => `"${term}"`);
/** Cosine similarity of two vectors stored as 32-bit floats. */
const cosine = (a, b) => {
    const x = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4);
    const y = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    if (x.length !== y.length)
        return 0;
    let dot = 0;
    let nx = 0;
    let ny = 0;
    for (let i = 0; i < x.length; i++) {
        dot += x[i] * y[i];
        nx += x[i] * x[i];
        ny += y[i] * y[i];
    }
    return dot / (Math.sqrt(nx * ny) || 1);
};
const blobOf = (vector) => Buffer.from(new Float32Array(vector).buffer);
/**
 * Projects entities into one SQLite file: one row per entity, indexed by
 * FTS5, one row per (source, rel, target) link, and, with `semantic`, one
 * embedding per entity. Every row carries `scope` (one per checkout by
 * default), so checkouts can share a file and `reset` only clears its own.
 *
 * A search ranks by full-text, by embedding or by both fused; an answer adds
 * the best paths from each match through the links, found by a recursive
 * query, so what links to what is read exactly rather than guessed.
 */
class SqliteProjection {
    config;
    stateRoot;
    name = 'sqlite';
    resultKinds = ['entities', 'passages', 'graph'];
    db = null;
    scope = '';
    embedder;
    prefixes;
    mode;
    traversal;
    constructor(config, stateRoot, dependencies = {}) {
        this.config = config;
        this.stateRoot = stateRoot;
        this.embedder = config.semantic ? (dependencies.embedder ?? ollamaEmbedder(config.semantic)) : undefined;
        this.prefixes = config.semantic ? prefixesOf(config.semantic) : { document: '', query: '' };
        this.mode = searchModeOf(config);
        this.traversal = { ...DEFAULT_TRAVERSAL, ...config.traverse };
    }
    async init(context) {
        this.scope = this.config.scope ?? checkoutScope(context.projectRoot);
        const file = this.config.file ? resolve(context.projectRoot, this.config.file) : join(this.stateRoot, DEFAULT_FILE);
        mkdirSync(dirname(file), { recursive: true });
        const Sqlite = await loadSqlite();
        const db = new Sqlite(file);
        this.db = db;
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 5000');
        db.pragma('foreign_keys = ON');
        db.function('cosine', { deterministic: true }, (a, b) => cosine(a, b));
        // Immediate, so two processes opening one file at once migrate once.
        db.transaction(() => {
            db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
            const applied = new Set(db.prepare('SELECT name FROM migrations').pluck().all());
            for (const step of MIGRATIONS) {
                if (applied.has(step.name))
                    continue;
                db.exec(step.up);
                db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(step.name, new Date().toISOString());
            }
        }).immediate();
    }
    /**
     * Writes the entity and replaces its outgoing links - a document owns them,
     * so they are rewritten whole. `index.fts`, `index.graph` and
     * `index.vector` decide whether it is searched by full-text, has links and
     * is embedded (spec §21). Its embedding is computed at `flush`, and only
     * when what it says has changed.
     */
    async upsert(entity) {
        const db = this.requireDb();
        db.transaction(() => {
            const { rid } = db
                .prepare(`INSERT INTO entities (scope, id, type, title, tags, body, attrs, revision, paths, confidence, searchable, in_graph, vectorize, text_hash)
           VALUES (@scope, @id, @type, @title, @tags, @body, @attrs, @revision, @paths, @confidence, @searchable, @inGraph, @vectorize, @textHash)
           ON CONFLICT (scope, id) DO UPDATE SET
             type = excluded.type, title = excluded.title, tags = excluded.tags, body = excluded.body, attrs = excluded.attrs,
             revision = excluded.revision, paths = excluded.paths, confidence = excluded.confidence, searchable = excluded.searchable,
             in_graph = excluded.in_graph, vectorize = excluded.vectorize, text_hash = excluded.text_hash
           RETURNING rid`)
                .get({
                scope: this.scope,
                id: entity.id,
                type: entity.type,
                title: entity.title,
                tags: JSON.stringify(entity.tags),
                body: entity.content,
                attrs: JSON.stringify(entity.attributes),
                revision: entity.revision,
                paths: JSON.stringify(entity.paths),
                confidence: entity.confidence,
                searchable: entity.index.fts ? 1 : 0,
                inGraph: entity.index.graph ? 1 : 0,
                vectorize: entity.index.vector ? 1 : 0,
                textHash: hashOf(embeddingText(entity))
            });
            db.prepare('DELETE FROM entities_fts WHERE rowid = ?').run(rid);
            if (entity.index.fts) {
                db.prepare('INSERT INTO entities_fts (rowid, title, kind, body) VALUES (?, ?, ?, ?)').run(rid, entity.title, [entity.type, ...entity.tags].join(' '), entity.content);
            }
            db.prepare('DELETE FROM edges WHERE scope = ? AND source = ?').run(this.scope, entity.id);
            if (!entity.index.graph)
                return;
            const insert = db.prepare(`INSERT OR IGNORE INTO edges (scope, source, rel, target, confidence, sources, attrs, evidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const link of entity.links) {
                insert.run(this.scope, entity.id, link.rel, link.target, link.confidence, JSON.stringify(link.sources), link.attributes ? JSON.stringify(link.attributes) : null, JSON.stringify(link.evidence));
            }
        })();
    }
    /** Removes the entity and its outgoing links. Links to it stay: its id is a stub target until it returns. */
    async remove(id) {
        const db = this.requireDb();
        db.transaction(() => {
            db.prepare('DELETE FROM edges WHERE scope = ? AND source = ?').run(this.scope, id);
            db.prepare('DELETE FROM entities_fts WHERE rowid IN (SELECT rid FROM entities WHERE scope = ? AND id = ?)').run(this.scope, id);
            // Its embedding goes with it.
            db.prepare('DELETE FROM entities WHERE scope = ? AND id = ?').run(this.scope, id);
        })();
    }
    /**
     * Embeds every entity in scope whose embedding is missing, or was computed
     * from other text or by another model, in batches. Without `semantic`
     * there is nothing to do.
     */
    async flush() {
        const embedder = this.embedder;
        if (!embedder)
            return;
        const db = this.requireDb();
        const stale = db.prepare(`SELECT e.rid, e.title, e.type, e.body, e.tags, e.text_hash AS textHash
       FROM entities e LEFT JOIN embeddings m ON m.rid = e.rid
       WHERE e.scope = ? AND e.vectorize AND (m.rid IS NULL OR m.text_hash <> e.text_hash OR m.model <> ? OR m.dims <> ?)
       ORDER BY e.id LIMIT ?`);
        const write = db.prepare(`INSERT INTO embeddings (rid, model, dims, text_hash, embedding) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (rid) DO UPDATE SET model = excluded.model, dims = excluded.dims, text_hash = excluded.text_hash, embedding = excluded.embedding`);
        for (;;) {
            const rows = stale.all(this.scope, embedder.model, embedder.dimensions, this.config.semantic?.batchSize ?? 32);
            if (rows.length === 0)
                return;
            const vectors = await embedder.embed(rows.map((row) => `${this.prefixes.document}${embeddingText({ ...row, content: row.body, tags: JSON.parse(row.tags) })}`));
            db.transaction(() => {
                rows.forEach((row, index) => write.run(row.rid, embedder.model, embedder.dimensions, row.textHash, blobOf(vectors[index] ?? [])));
            })();
        }
    }
    async reset() {
        const db = this.requireDb();
        db.transaction(() => {
            db.prepare('DELETE FROM edges WHERE scope = ?').run(this.scope);
            db.prepare('DELETE FROM entities_fts WHERE rowid IN (SELECT rid FROM entities WHERE scope = ?)').run(this.scope);
            db.prepare('DELETE FROM entities WHERE scope = ?').run(this.scope);
        })();
    }
    /** The entities most relevant to `query`, ranked as the config says; each hit quotes the part of its body the query names. */
    async search(query, limit) {
        const terms = questionTerms(query);
        const rows = await this.ranked(query, limit);
        return { hits: rows.map((row) => this.hitOf(row, terms)), note: this.describeSearch() };
    }
    /**
     * The search's matches, and from each the best paths through the links
     * (`pathsQuery`): an entities block of the matches, a graph block of the
     * paths with each a derived fact saying why it holds, and a passages block
     * of what each match says (adapter-kit's `pathsAnswer`).
     */
    async answer(request) {
        const rows = await this.ranked(request.question, request.budget.maxResults);
        const { hops, minConfidence, rels } = this.traversal;
        const reach = [
            `up to ${hops} hop${hops === 1 ? '' : 's'}`,
            ...(minConfidence > 0 ? [`of confidence at least ${minConfidence}`] : []),
            ...(rels ? [`along ${rels.join(', ')}`] : [])
        ].join(' ');
        return pathsAnswer(this.matches(rows), request, {
            description: `${this.describeSearch()} in scope "${this.scope}", each match followed ${reach} through its links`,
            assumptions: [
                'Matches are ranked by relevance: the best matches, not every match, and never a count.',
                `Each match keeps its best ${PATHS_PER_MATCH} paths, ranked by the product of their links' confidence ` +
                    'and damped where they end at a well-connected node. The entities they reach are context, not matches.'
            ],
            nativeQuery: pathsQuery(hops)
        }, 'sqlite');
    }
    describeSearch() {
        const fulltext = 'SQLite FTS5 full-text search (Porter stemming) over titles, types, tags and bodies';
        const semantic = `cosine similarity of ${this.embedder?.model ?? ''} embeddings`;
        return this.mode === 'lexical' ? fulltext : this.mode === 'semantic' ? `SQLite ${semantic}` : `${fulltext}, fused by reciprocal rank with ${semantic}`;
    }
    /** The rows a search ranks first: full-text, embedding, or both fused by reciprocal rank. */
    async ranked(query, limit) {
        if (query.trim() === '' || limit < 1)
            return [];
        if (this.mode === 'lexical')
            return this.lexical(query, limit);
        if (this.mode === 'semantic')
            return this.semantic(query, limit);
        return fuseRankings([this.lexical(query, limit), await this.semantic(query, limit)], limit);
    }
    /**
     * BM25 over the weighted columns, best first, any of the query's words
     * matching (`ftsWords`), with Lucene's idf - ln(1 + (N - n + 0.5) / (n + 0.5)),
     * as Neo4j's full-text search ranks. FTS5's own `bm25` would do, but it
     * counts a word in more than half the rows as all but worthless (an idf of
     * 1e-6), which in a small docket is most of the words that matter. So each
     * word is matched alone, its `bm25` divided by the idf FTS5 gave it - which
     * leaves how often and where the row holds it - and weighed by Lucene's idf
     * instead. The counts are over the whole file, every scope included, as
     * FTS5's are.
     */
    lexical(query, limit) {
        const words = ftsWords(query);
        if (words.length === 0)
            return [];
        const db = this.requireDb();
        const total = db.prepare('SELECT count(*) FROM entities_fts').pluck().get();
        const count = db.prepare('SELECT count(*) FROM entities_fts WHERE entities_fts MATCH ?').pluck();
        const matches = db.prepare(`SELECT entities_fts.rowid AS rid, bm25(entities_fts, ${COLUMN_WEIGHTS.join(', ')}) AS bm25
       FROM entities_fts JOIN entities e ON e.rid = entities_fts.rowid
       WHERE entities_fts MATCH ? AND e.scope = ? AND e.searchable`);
        const scores = new Map();
        for (const word of words) {
            const holding = count.get(word);
            if (holding === 0)
                continue;
            const odds = (total - holding + 0.5) / (holding + 0.5);
            const fts5Idf = Math.max(1e-6, Math.log(odds));
            const idf = Math.log(1 + odds);
            for (const row of matches.all(word, this.scope)) {
                scores.set(row.rid, (scores.get(row.rid) ?? 0) + (idf * -row.bm25) / fts5Idf);
            }
        }
        if (scores.size === 0)
            return [];
        const rows = db
            .prepare(`SELECT rid, id, title, body, revision FROM entities WHERE rid IN (SELECT value FROM json_each(?))`)
            .all(JSON.stringify([...scores.keys()]));
        return rows
            .map(({ rid, ...row }) => ({ ...row, score: scores.get(rid) ?? 0 }))
            .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .slice(0, limit);
    }
    /** Every embedding in scope of the configured model, compared with the query's: no index, so a scan. */
    async semantic(query, limit) {
        const embedder = this.embedder;
        if (!embedder)
            return [];
        const [vector] = await embedder.embed([`${this.prefixes.query}${query}`]);
        if (!vector)
            return [];
        return this.requireDb()
            .prepare(`SELECT e.id, e.title, e.body, e.revision, cosine(m.embedding, ?) AS score
         FROM embeddings m JOIN entities e ON e.rid = m.rid
         WHERE e.scope = ? AND m.model = ? AND m.dims = ?
         ORDER BY score DESC, e.id
         LIMIT ?`)
            .all(blobOf(vector), this.scope, embedder.model, embedder.dimensions, limit);
    }
    /** The rows as matches, each with its best paths through the links. */
    matches(rows) {
        if (rows.length === 0)
            return [];
        const db = this.requireDb();
        const { hops, minConfidence, rels } = this.traversal;
        const found = db.prepare(pathsQuery(hops)).all({
            scope: this.scope,
            seeds: JSON.stringify(rows.map((row) => row.id)),
            minConfidence,
            paths: PATHS_PER_MATCH * 2,
            rels: rels ? JSON.stringify(rels) : null
        }).map((row) => ({ seed: row.seed, nodes: JSON.parse(row.nodes), edges: JSON.parse(row.edges) }));
        const ids = [...new Set(found.flatMap((row) => row.nodes))];
        const nodes = new Map(db
            .prepare(`SELECT id, title, type, revision, in_graph AS inGraph FROM entities WHERE scope = ? AND id IN (SELECT value FROM json_each(?))`)
            .all(this.scope, JSON.stringify(ids)).map((row) => [row.id, row]));
        // A target not projected, or projected out of the graph, is a stub: its id alone, as in Neo4j.
        const nodeOf = (id) => {
            const node = nodes.get(id);
            return node?.inGraph ? { id, title: node.title, type: node.type, hash: node.revision, stub: false } : { id, stub: true };
        };
        const paths = new Map();
        for (const row of found) {
            paths.set(row.seed, [...(paths.get(row.seed) ?? []), { nodes: row.nodes.map(nodeOf), edges: row.edges }]);
        }
        return matchesOf(rows.map((row) => ({ id: row.id, title: row.title, content: row.body, hash: row.revision, score: row.score, paths: paths.get(row.id) ?? [] })));
    }
    hitOf(row, terms) {
        const body = row.body.trim() !== '' ? row.body : row.title;
        const passage = relevantExcerpt(body, [...terms], PASSAGE_CHARS).text;
        return { id: row.id, score: row.score, revision: row.revision, ...(passage ? { passage: { text: passage } } : {}) };
    }
    async close() {
        this.db?.close();
        this.db = null;
    }
    requireDb() {
        if (!this.db) {
            throw new Error('sqlite projection used before init() - call ProjectionManager.init() first');
        }
        return this.db;
    }
}
/** A sqlite projection keeping its file, when `file` is unset, in `stateRoot` - the instance's own state directory. */
export function createSqliteProjection(config, stateRoot, dependencies = {}) {
    return new SqliteProjection(config, stateRoot, dependencies);
}
