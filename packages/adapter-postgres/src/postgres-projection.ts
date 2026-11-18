import { createHash } from 'node:crypto'

import type { Pool, PoolClient } from 'pg'

import type { AdapterAnswer, AskRequest, EntityInput, ResultKind } from '@docket/contracts'
import {
  checkoutScope,
  DEFAULT_TRAVERSAL,
  embeddingText,
  fuseRankings,
  matchesOf,
  ollamaEmbedder,
  PATHS_PER_MATCH,
  pathsAnswer,
  prefixesOf,
  questionTerms,
  relevantExcerpt,
  type Embedder,
  type EntityProjection,
  type Match,
  type ProjectionContext,
  type SearchAnswer,
  type SearchHit,
  type Traversal
} from '@docket/adapter-kit'

import { searchModeOf, type PostgresConfig } from './config.js'
import { vectorLiteral } from './embedder.js'
import { lexicalQuery, pathsQuery, semanticQuery, traversalParameters } from './queries.js'
import { CORE_MIGRATIONS, hnswIndex, TRIGRAM_MIGRATIONS, VECTOR_MIGRATIONS } from './schema.js'

/** The most of a matched entity's body a hit quotes as its passage. */
const PASSAGE_CHARS = 600
/** pgvector's HNSW index takes vectors of at most this many dimensions; larger ones are searched without it. */
const HNSW_MAX_DIMENSIONS = 2000

/**
 * pg is an optional dependency: only repositories that configure a postgres
 * projection need it installed, so it is loaded on first use.
 */
const loadPg = async () => {
  try {
    return (await import('pg')).default
  } catch (cause) {
    throw new Error(
      'The postgres projection needs the "pg" package. Install it next to ' +
        `@chrisjowen/docket (e.g. \`pnpm add pg\`). (${(cause as Error).message})`
    )
  }
}

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 32)

/** How many words an entity's full-text vector holds - every position of every lexeme - for BM25's length norm. */
const LENGTH = '(SELECT coalesce(sum(cardinality(positions)), 0) FROM unnest(tsv))'

/** A schema name as SQL, quoted. The config only accepts names that need no escaping. */
const quoted = (name: string): string => `"${name}"`

interface Row {
  id: string
  title: string
  body: string
  revision: string
  score: number
}

/**
 * Projects entities into Postgres tables in a schema of its own: one row per
 * entity with its weighted full-text vector, one row per (source, rel,
 * target) link, and, with `semantic`, one embedding per entity. Every row
 * carries `scope` (one per checkout by default), so several checkouts can
 * share one database and `reset` only clears its own.
 *
 * A search ranks by full-text, by embedding or by both fused; an answer adds
 * the best paths from each match through the links, found by a recursive
 * query, so what links to what is read exactly rather than guessed.
 */
class PostgresProjection implements EntityProjection {
  readonly name = 'postgres'
  readonly resultKinds: readonly ResultKind[] = ['entities', 'passages', 'graph']

  private pool: Pool | null = null
  private scope = ''
  private readonly schema: string
  private readonly embedder: Embedder | undefined
  private readonly prefixes: { document: string; query: string }
  private readonly mode: 'lexical' | 'semantic' | 'hybrid'
  private readonly traversal: Traversal
  /** Whether pg_trgm is there to lift titles with; off when the config says so or the extension cannot be had. */
  private trigram: boolean
  /** Whether pgvector can keep scanning past what its filters drop (`hnsw.iterative_scan`, pgvector 0.8 and later). */
  private iterativeScan = false

  constructor(
    private readonly config: PostgresConfig,
    dependencies: PostgresProjectionDependencies = {}
  ) {
    this.schema = quoted(config.schema)
    this.embedder = config.semantic ? (dependencies.embedder ?? ollamaEmbedder(config.semantic)) : undefined
    this.prefixes = config.semantic ? prefixesOf(config.semantic) : { document: '', query: '' }
    this.mode = searchModeOf(config)
    this.traversal = { ...DEFAULT_TRAVERSAL, ...config.traverse }
    this.trigram = config.trigram
    this.pool = dependencies.pool ?? null
  }

  async init(context: ProjectionContext): Promise<void> {
    this.scope = this.config.scope ?? checkoutScope(context.projectRoot)
    if (!this.pool) this.pool = await this.connect()
    await this.migrate()
  }

  private async connect(): Promise<Pool> {
    const pg = await loadPg()
    const url = this.config.urlEnv ? process.env[this.config.urlEnv] : this.config.url
    if (this.config.urlEnv && !url) {
      throw new Error(`The postgres projection reads its connection URL from ${this.config.urlEnv}, which is not set.`)
    }
    const password = this.config.passwordEnv ? process.env[this.config.passwordEnv] : undefined
    if (this.config.passwordEnv && password === undefined) {
      throw new Error(`The postgres projection reads its password from ${this.config.passwordEnv}, which is not set.`)
    }
    const pool = new pg.Pool({
      ...(url ? { connectionString: url } : {}),
      ...(password !== undefined ? { password } : {}),
      max: 4
    })
    // An idle client the server drops must not crash the process.
    pool.on('error', () => undefined)
    return pool
  }

  /**
   * Brings the schema up to date, once however many processes open it at
   * once: the extensions it can use, then every step not yet recorded.
   * pg_trgm is trusted, so any role that may create in the database can add
   * it; without it, titles are not lifted. pgvector usually needs a
   * superuser to add, so semantic search fails here, saying how, when it is
   * missing.
   */
  private async migrate(): Promise<void> {
    await this.transaction(async (client) => {
      // One lock for every schema: extensions are database-wide, so two schemas migrating at once would race to add them.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('docket-adapter-postgres'))`)
      const version = Number((await client.query<{ v: string }>(`SELECT current_setting('server_version_num') AS v`)).rows[0]?.v)
      if (version < 160000) {
        throw new Error(`The postgres projection needs Postgres 16 or later; this server is ${Math.floor(version / 10000)}.`)
      }
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`)
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.schema}.migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
      )
      if (this.trigram) this.trigram = await this.ensureExtension(client, 'pg_trgm')
      if (this.embedder && !(await this.ensureExtension(client, 'vector'))) {
        throw new Error(
          'Semantic search needs the pgvector extension, and this role cannot add it. ' +
            'Run `CREATE EXTENSION vector` as a superuser, or run Postgres from an image that has it, such as pgvector/pgvector:pg17.'
        )
      }
      if (this.embedder) {
        const { rows } = await client.query<{ v: string }>(`SELECT extversion AS v FROM pg_extension WHERE extname = 'vector'`)
        const [major = 0, minor = 0] = (rows[0]?.v ?? '0').split('.').map(Number)
        this.iterativeScan = major > 0 || minor >= 8
      }

      const applied = new Set((await client.query<{ name: string }>(`SELECT name FROM ${this.schema}.migrations`)).rows.map((row) => row.name))
      const steps = [...CORE_MIGRATIONS, ...(this.trigram ? TRIGRAM_MIGRATIONS : []), ...(this.embedder ? VECTOR_MIGRATIONS : [])]
      for (const step of steps) {
        if (applied.has(step.name)) continue
        for (const statement of step.up(this.schema)) await client.query(statement)
        await client.query(`INSERT INTO ${this.schema}.migrations (name) VALUES ($1)`, [step.name])
      }
      if (this.embedder && this.embedder.dimensions <= HNSW_MAX_DIMENSIONS) {
        await client.query(hnswIndex(this.schema, this.embedder.dimensions))
      }

      // A scope built with another text search configuration is rebuilt with this one: its vectors are derived.
      const scope = await client.query<{ language: string }>(`SELECT language FROM ${this.schema}.scopes WHERE scope = $1`, [this.scope])
      const language = scope.rows[0]?.language
      if (language !== this.config.language) {
        if (language !== undefined) {
          await client.query(
            `UPDATE ${this.schema}.entities SET tsv = ${this.tsvector('title', 'type', 'tags', 'body', '$2')} WHERE scope = $1`,
            [this.scope, this.config.language]
          )
          await client.query(`UPDATE ${this.schema}.entities SET len = ${LENGTH} WHERE scope = $1`, [this.scope])
        }
        await client.query(
          `INSERT INTO ${this.schema}.scopes (scope, language) VALUES ($1, $2)
           ON CONFLICT (scope) DO UPDATE SET language = $2, updated_at = now()`,
          [this.scope, this.config.language]
        )
      }
    })
  }

  /** Whether `name` is installed, adding it when this role may. */
  private async ensureExtension(client: PoolClient, name: string): Promise<boolean> {
    const installed = await client.query('SELECT 1 FROM pg_extension WHERE extname = $1', [name])
    if (installed.rowCount) return true
    await client.query('SAVEPOINT extension')
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS ${quoted(name)}`)
      await client.query('RELEASE SAVEPOINT extension')
      return true
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT extension')
      return false
    }
  }

  /** The weighted full-text vector of an entity's columns: title A, type and tags B, body C. */
  private tsvector(title: string, type: string, tags: string, body: string, language: string): string {
    const config = `${language}::regconfig`
    return `setweight(to_tsvector(${config}, ${title}), 'A')
         || setweight(to_tsvector(${config}, ${type} || ' ' || array_to_string(${tags}, ' ')), 'B')
         || setweight(to_tsvector(${config}, ${body}), 'C')`
  }

  /**
   * Writes the entity and replaces its outgoing links - a document owns them,
   * so they are rewritten whole. `index.fts`, `index.graph` and
   * `index.vector` decide whether it is searched by full-text, has links and
   * is embedded (spec §21). Its embedding is computed at `flush`, and only
   * when what it says has changed.
   */
  async upsert(entity: EntityInput): Promise<void> {
    const text = embeddingText(entity)
    await this.transaction(async (client) => {
      await client.query(
        `INSERT INTO ${this.schema}.entities
           (scope, id, type, title, tags, body, attrs, revision, paths, confidence, searchable, in_graph, vectorize, text_hash, tsv)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 ${this.tsvector('$4', '$3', '$5::text[]', '$6', '$15')})
         ON CONFLICT (scope, id) DO UPDATE SET
           type = EXCLUDED.type, title = EXCLUDED.title, tags = EXCLUDED.tags, body = EXCLUDED.body,
           attrs = EXCLUDED.attrs, revision = EXCLUDED.revision, paths = EXCLUDED.paths,
           confidence = EXCLUDED.confidence, searchable = EXCLUDED.searchable, in_graph = EXCLUDED.in_graph,
           vectorize = EXCLUDED.vectorize, text_hash = EXCLUDED.text_hash, tsv = EXCLUDED.tsv`,
        [
          this.scope,
          entity.id,
          entity.type,
          entity.title,
          entity.tags,
          entity.content,
          JSON.stringify(entity.attributes),
          entity.revision,
          entity.paths,
          entity.confidence,
          entity.index.fts,
          entity.index.graph,
          entity.index.vector,
          hashOf(text),
          this.config.language
        ]
      )
      await client.query(`UPDATE ${this.schema}.entities SET len = ${LENGTH} WHERE scope = $1 AND id = $2`, [this.scope, entity.id])
      await client.query(`DELETE FROM ${this.schema}.edges WHERE scope = $1 AND source = $2`, [this.scope, entity.id])
      if (!entity.index.graph || entity.links.length === 0) return
      await client.query(
        `INSERT INTO ${this.schema}.edges (scope, source, rel, target, confidence, sources, attrs, evidence)
         SELECT $1, $2, link.rel, link.target, link.confidence,
                ARRAY(SELECT jsonb_array_elements_text(link.sources)), link.attributes, link.evidence
         FROM jsonb_to_recordset($3::jsonb)
           AS link(rel text, target text, confidence real, sources jsonb, attributes jsonb, evidence jsonb)
         ON CONFLICT (scope, source, rel, target) DO NOTHING`,
        [
          this.scope,
          entity.id,
          JSON.stringify(
            entity.links.map((link) => ({
              rel: link.rel,
              target: link.target,
              confidence: link.confidence,
              sources: link.sources,
              attributes: link.attributes ?? null,
              evidence: link.evidence
            }))
          )
        ]
      )
    })
  }

  /** Removes the entity and its outgoing links. Links to it stay: its id is a stub target until it returns. */
  async remove(id: string): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(`DELETE FROM ${this.schema}.edges WHERE scope = $1 AND source = $2`, [this.scope, id])
      await client.query(`DELETE FROM ${this.schema}.entities WHERE scope = $1 AND id = $2`, [this.scope, id])
    })
  }

  /**
   * Embeds every entity in scope whose embedding is missing, or was computed
   * from other text or by another model, in batches. Without `semantic`
   * there is nothing to do.
   */
  async flush(): Promise<void> {
    const embedder = this.embedder
    if (!embedder) return
    for (;;) {
      const { rows } = await this.requirePool().query<{ id: string; title: string; type: string; body: string; tags: string[]; text_hash: string }>(
        `SELECT e.id, e.title, e.type, e.body, e.tags, e.text_hash
         FROM ${this.schema}.entities e
         LEFT JOIN ${this.schema}.embeddings m ON m.scope = e.scope AND m.id = e.id
         WHERE e.scope = $1 AND e.vectorize
           AND (m.id IS NULL OR m.text_hash <> e.text_hash OR m.model <> $2 OR m.dims <> $3)
         ORDER BY e.id
         LIMIT $4`,
        [this.scope, embedder.model, embedder.dimensions, this.config.semantic?.batchSize ?? 32]
      )
      if (rows.length === 0) return
      const vectors = await embedder.embed(rows.map((row) => `${this.prefixes.document}${embeddingText({ ...row, content: row.body })}`))
      await this.requirePool().query(
        `INSERT INTO ${this.schema}.embeddings (scope, id, model, dims, text_hash, embedding)
         SELECT $1, item.id, $2, $3, item.text_hash, item.embedding::vector
         FROM jsonb_to_recordset($4::jsonb) AS item(id text, text_hash text, embedding text)
         ON CONFLICT (scope, id) DO UPDATE SET
           model = EXCLUDED.model, dims = EXCLUDED.dims, text_hash = EXCLUDED.text_hash, embedding = EXCLUDED.embedding`,
        [
          this.scope,
          embedder.model,
          embedder.dimensions,
          JSON.stringify(rows.map((row, index) => ({ id: row.id, text_hash: row.text_hash, embedding: vectorLiteral(vectors[index] ?? []) })))
        ]
      )
    }
  }

  async reset(): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(`DELETE FROM ${this.schema}.edges WHERE scope = $1`, [this.scope])
      // Embeddings go with their entities.
      await client.query(`DELETE FROM ${this.schema}.entities WHERE scope = $1`, [this.scope])
    })
  }

  /** The entities most relevant to `query`, ranked as the config says; each hit quotes the part of its body the query names. */
  async search(query: string, limit: number): Promise<SearchAnswer> {
    const terms = questionTerms(query)
    const rows = await this.ranked(query, limit)
    return { hits: rows.map((row) => this.hitOf(row, terms)), note: this.describeSearch() }
  }

  /**
   * The search's matches, and from each the best paths through the links
   * (queries.ts `pathsQuery`): an entities block of the matches, a graph
   * block of the paths with each a derived fact saying why it holds, and a
   * passages block of what each match says (adapter-kit's `pathsAnswer`).
   */
  async answer(request: AskRequest): Promise<AdapterAnswer> {
    const rows = await this.ranked(request.question, request.budget.maxResults)
    const matches = await this.matches(rows)
    const { hops, minConfidence, rels } = this.traversal
    const reach = [
      `up to ${hops} hop${hops === 1 ? '' : 's'}`,
      ...(minConfidence > 0 ? [`of confidence at least ${minConfidence}`] : []),
      ...(rels ? [`along ${rels.join(', ')}`] : [])
    ].join(' ')
    return pathsAnswer(
      matches,
      request,
      {
        description: `${this.describeSearch()} in scope "${this.scope}", each match followed ${reach} through its links`,
        assumptions: [
          'Matches are ranked by relevance: the best matches, not every match, and never a count.',
          `Each match keeps its best ${PATHS_PER_MATCH} paths, ranked by the product of their links' confidence ` +
            'and damped where they end at a well-connected node. The entities they reach are context, not matches.'
        ],
        nativeQuery: pathsQuery(this.schema, hops)
      },
      'postgres'
    )
  }

  private describeSearch(): string {
    const fulltext = `Postgres full-text search (${this.config.language}) over titles, types, tags and bodies${this.trigram ? ', titles lifted by trigram similarity' : ''}`
    const semantic = `cosine similarity of ${this.embedder?.model ?? ''} embeddings`
    return this.mode === 'lexical' ? fulltext : this.mode === 'semantic' ? `Postgres ${semantic}` : `${fulltext}, fused by reciprocal rank with ${semantic}`
  }

  /** The rows a search ranks first: full-text, embedding, or both fused by reciprocal rank. */
  private async ranked(query: string, limit: number): Promise<Row[]> {
    if (query.trim() === '' || limit < 1) return []
    if (this.mode === 'lexical') return this.lexical(query, limit)
    if (this.mode === 'semantic') return this.semantic(query, limit)
    return fuseRankings(await Promise.all([this.lexical(query, limit), this.semantic(query, limit)]), limit)
  }

  private async lexical(query: string, limit: number): Promise<Row[]> {
    const { rows } = await this.requirePool().query<Row>(lexicalQuery(this.schema, this.trigram), [
      this.scope,
      this.config.language,
      query,
      limit
    ])
    return rows.map((row) => ({ ...row, score: Number(row.score) }))
  }

  private async semantic(query: string, limit: number): Promise<Row[]> {
    const embedder = this.embedder
    if (!embedder) return []
    const [vector] = await embedder.embed([`${this.prefixes.query}${query}`])
    if (!vector) return []
    return this.transaction(async (client) => {
      // HNSW finds ef_search candidates before the scope and model filter: keep enough, and, where pgvector can, keep scanning.
      await client.query(`SELECT set_config('hnsw.ef_search', $1, true)`, [String(Math.max(40, Math.min(1000, limit * 4)))])
      if (this.iterativeScan) await client.query(`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true)`)
      const { rows } = await client.query<Row>(semanticQuery(this.schema, embedder.dimensions), [
        this.scope,
        embedder.model,
        vectorLiteral(vector),
        limit
      ])
      return rows.map((row) => ({ ...row, score: Number(row.score) }))
    })
  }

  /** The rows as matches, each with its best paths through the links. */
  private async matches(rows: readonly Row[]): Promise<Match[]> {
    if (rows.length === 0) return []
    const { hops } = this.traversal
    const { minConfidence, rels } = traversalParameters(this.traversal)
    const found = await this.requirePool().query<{ seed: string; nodes: string[]; edges: Record<string, unknown>[] }>(
      pathsQuery(this.schema, hops),
      [this.scope, rows.map((row) => row.id), minConfidence, PATHS_PER_MATCH * 2, rels]
    )
    const ids = [...new Set(found.rows.flatMap((row) => row.nodes))]
    const nodes = new Map(
      (
        await this.requirePool().query<{ id: string; title: string; type: string; revision: string; in_graph: boolean }>(
          `SELECT id, title, type, revision, in_graph FROM ${this.schema}.entities WHERE scope = $1 AND id = ANY($2::text[])`,
          [this.scope, ids]
        )
      ).rows.map((row) => [row.id, row])
    )
    // A target not projected, or projected out of the graph, is a stub: its id alone, as in Neo4j.
    const nodeOf = (id: string) => {
      const node = nodes.get(id)
      return node?.in_graph ? { id, title: node.title, type: node.type, hash: node.revision, stub: false } : { id, stub: true }
    }
    const paths = new Map<string, { nodes: unknown[]; edges: unknown[] }[]>()
    for (const row of found.rows) {
      paths.set(row.seed, [...(paths.get(row.seed) ?? []), { nodes: row.nodes.map(nodeOf), edges: row.edges }])
    }
    return matchesOf(
      rows.map((row) => ({ id: row.id, title: row.title, content: row.body, hash: row.revision, score: row.score, paths: paths.get(row.id) ?? [] }))
    )
  }

  private hitOf(row: Row, terms: readonly string[]): SearchHit {
    const body = row.body.trim() !== '' ? row.body : row.title
    const passage = relevantExcerpt(body, [...terms], PASSAGE_CHARS).text
    return { id: row.id, score: row.score, revision: row.revision, ...(passage ? { passage: { text: passage } } : {}) }
  }

  async close(): Promise<void> {
    const pool = this.pool
    this.pool = null
    await pool?.end()
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.requirePool().connect()
    try {
      await client.query('BEGIN')
      const result = await work(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private requirePool(): Pool {
    if (!this.pool) {
      throw new Error('postgres projection used before init() - call ProjectionManager.init() first')
    }
    return this.pool
  }
}

export interface PostgresProjectionDependencies {
  /** Replaces the configured embedder - for tests. */
  embedder?: Embedder
  /** A pool to use instead of one built from the config - for tests. Closed with the projection. */
  pool?: Pool
}

export function createPostgresProjection(
  config: PostgresConfig,
  dependencies: PostgresProjectionDependencies = {}
): EntityProjection {
  return new PostgresProjection(config, dependencies)
}
