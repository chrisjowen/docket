import type {
  Driver,
  ManagedTransaction,
  Node,
  Path,
  Record as Neo4jRecord,
  Relationship
} from 'neo4j-driver'

import type { Neo4jProjectionConfig } from '../../config/config.js'
import type { MemoryEntity } from '../../model/index.js'
import type { MemoryProjection, ProjectionContext, SearchAnswer, SearchHit } from '../projection.js'
import { checkoutScope } from '../scope.js'
import type { GraphSchema } from './cypher-prompt.js'
import { cypherSearch, type CypherPort } from './cypher-search.js'
import {
  describeNeighbours,
  fulltextQuery,
  labelFor,
  NODE_PROPERTIES,
  nodeProperties,
  relationshipRows,
  type Neighbour
} from './graph-model.js'
import { ollamaChat, type Chat } from '../../llm/ollama-chat.js'

const FULLTEXT_INDEX = 'memory_text'
/** How long a generated query may run before it is abandoned. */
const CYPHER_TIMEOUT_MS = 10_000
/** Lucene's English analyzer: drops stop words and stems, so `ordering` finds `orders`. */
const FULLTEXT_ANALYZER = 'english'

/**
 * neo4j-driver is an optional dependency: only repositories that configure a
 * neo4j projection need it installed, so it is loaded on first use.
 */
const loadDriver = async () => {
  try {
    return (await import('neo4j-driver')).default
  } catch (cause) {
    throw new Error(
      'The neo4j projection needs the "neo4j-driver" package. Install it next to ' +
        `@chrisjowen/docket (e.g. \`pnpm add neo4j-driver\`). (${(cause as Error).message})`
    )
  }
}

type Neo4jApi = Awaited<ReturnType<typeof loadDriver>>

/** Labels this projection may remove are only ones it could have written. */
const isOwnLabel = (label: string): boolean => label !== 'Memory' && /^[A-Za-z][A-Za-z0-9]*$/.test(label)

/**
 * Projects entities into Neo4j as `(:Memory:<Type>)` nodes joined by typed
 * relationships - `depends_on` becomes `-[:DEPENDS_ON]->`. One node per id and
 * one relationship per (source, rel, target), however many files observed
 * them, each carrying its evidence count and aggregate confidence. A link to
 * a document not (yet) projected points at a stub node, which is filled in
 * when that document arrives and deleted once nothing links to it.
 *
 * Every node carries `scope` (one per checkout by default), so several
 * checkouts can share one database and `reset` only clears its own.
 */
class Neo4jProjection implements MemoryProjection {
  readonly name = 'neo4j'

  private driver: Driver | null = null
  private neo4j: Neo4jApi | null = null
  private scope = ''
  /** Writes Cypher from a question; absent unless `cypher` is configured. */
  private readonly chat: Chat | undefined

  constructor(
    private readonly config: Neo4jProjectionConfig,
    dependencies: Neo4jProjectionDependencies = {}
  ) {
    this.chat = dependencies.chat ?? (config.cypher ? ollamaChat(config.cypher) : undefined)
  }

  async init(context: ProjectionContext): Promise<void> {
    const neo4j = await loadDriver()
    const password = this.config.passwordEnv ? process.env[this.config.passwordEnv] : undefined
    if (this.config.passwordEnv && !password) {
      throw new Error(`The neo4j projection reads its password from ${this.config.passwordEnv}, which is not set.`)
    }

    this.neo4j = neo4j
    this.scope = this.config.scope ?? checkoutScope(context.projectRoot)
    // No token at all is what a server started with NEO4J_AUTH=none expects.
    this.driver = password
      ? neo4j.driver(this.config.url, neo4j.auth.basic(this.config.username, password))
      : neo4j.driver(this.config.url)
    await this.driver.verifyConnectivity()

    await this.run(
      'CREATE CONSTRAINT memory_scope_id IF NOT EXISTS FOR (n:Memory) REQUIRE (n.scope, n.id) IS UNIQUE'
    )
    await this.ensureFulltextIndex()
  }

  async upsert(entity: MemoryEntity): Promise<void> {
    if (!entity.index.graph) {
      await this.remove(entity.id)
      return
    }

    await this.write(async (tx) => {
      await tx.run(
        `MERGE (n:Memory {scope: $scope, id: $id})
         SET n += $properties, n.stub = false`,
        { scope: this.scope, id: entity.id, properties: nodeProperties(entity) }
      )
      await this.replaceTypeLabel(tx, entity.id, labelFor(entity.type))
      const previousTargets = await this.dropOutgoing(tx, entity.id)

      for (const row of relationshipRows(entity)) {
        await tx.run(
          `MATCH (n:Memory {scope: $scope, id: $id})
           MERGE (t:Memory {scope: $scope, id: $target})
             ON CREATE SET t.stub = true
           MERGE (n)-[r:\`${row.type}\` {rel: $rel}]->(t)
           SET r = $properties`,
          { scope: this.scope, id: entity.id, target: row.target, rel: row.rel, properties: row.properties }
        )
      }

      await this.deleteOrphanStubs(tx, previousTargets)
    })
  }

  async remove(id: string): Promise<void> {
    await this.write(async (tx) => {
      const previousTargets = await this.dropOutgoing(tx, id)
      const linked = await tx.run(
        'MATCH (n:Memory {scope: $scope, id: $id}) RETURN EXISTS { (n)<--() } AS linked',
        { scope: this.scope, id }
      )
      const record = linked.records[0]
      if (record?.get('linked') === true) {
        // Others still link here: keep the node as a stub so their links survive.
        await this.replaceTypeLabel(tx, id, null)
        await tx.run(
          `MATCH (n:Memory {scope: $scope, id: $id})
           SET n.stub = true REMOVE ${NODE_PROPERTIES.map((p) => `n.${p}`).join(', ')}`,
          { scope: this.scope, id }
        )
      } else if (record) {
        await tx.run('MATCH (n:Memory {scope: $scope, id: $id}) DELETE n', { scope: this.scope, id })
      }
      await this.deleteOrphanStubs(tx, previousTargets)
    })
  }

  async reset(): Promise<void> {
    await this.run('MATCH (n:Memory {scope: $scope}) DETACH DELETE n', { scope: this.scope })
  }

  /**
   * With `cypher` configured, the model writes a query from the question and
   * its rows are the answer, with the query in the note. When it fails or finds
   * nothing - or without `cypher` - the answer is full-text search, and the
   * note says why.
   */
  async search(query: string, limit: number): Promise<SearchAnswer> {
    if (!this.chat) return { hits: await this.fulltextSearch(query, limit) }

    let reason: string
    try {
      const answer = await cypherSearch(this.cypherPort(), this.chat, query)
      if (answer.hits.length > 0) return { hits: answer.hits.slice(0, limit), note: `cypher: ${answer.cypher}` }
      reason = `cypher found nothing: ${answer.cypher}`
    } catch (cause) {
      reason = `cypher failed: ${cause instanceof Error ? cause.message : String(cause)}`
    }
    return { hits: await this.fulltextSearch(query, limit), note: `${reason}\nfell back to full-text` }
  }

  /**
   * Full-text matches, each with its links in `detail` - the neighbourhood is
   * what a graph adds to a search. Linked documents are not answers of their
   * own: the best-connected ones would otherwise come back for every query.
   */
  private async fulltextSearch(query: string, limit: number): Promise<SearchHit[]> {
    const lucene = fulltextQuery(query)
    if (!lucene) return []

    const matches = await this.run(
      `CALL db.index.fulltext.queryNodes('${FULLTEXT_INDEX}', $lucene) YIELD node, score
       WHERE node.scope = $scope AND node.stub = false
       RETURN node.id AS id, score ORDER BY score DESC, id LIMIT $limit`,
      { lucene, scope: this.scope, limit: this.requireNeo4j().int(limit) }
    )

    const hits: SearchHit[] = []
    for (const match of matches) {
      const id = match.id as string
      const detail = describeNeighbours(await this.neighbours(id))
      hits.push({ id, score: match.score as number, ...(detail ? { detail } : {}) })
    }
    return hits
  }

  private cypherPort(): CypherPort {
    const neo4j = this.requireNeo4j()
    return {
      scope: this.scope,
      schema: () => this.schema(),
      read: async (cypher) => {
        const session = this.requireDriver().session(this.sessionConfig())
        try {
          const result = await session.executeRead((tx) => tx.run(cypher, { scope: this.scope }), {
            timeout: CYPHER_TIMEOUT_MS
          })
          return result.records as Neo4jRecord[]
        } finally {
          await session.close()
        }
      },
      documentIds: async (ids) => {
        if (ids.length === 0) return new Set()
        const rows = await this.run(
          `MATCH (n:Memory {scope: $scope}) WHERE n.id IN $ids AND n.stub = false RETURN n.id AS id`,
          { scope: this.scope, ids }
        )
        return new Set(rows.map((row) => row.id as string))
      },
      isNode: (value): value is Node => neo4j.isNode(value as object),
      isRelationship: (value): value is Relationship => neo4j.isRelationship(value as object),
      isPath: (value): value is Path => neo4j.isPath(value as object)
    }
  }

  /** The labels and relationship patterns this scope actually has, for the model to write against. */
  private async schema(): Promise<GraphSchema> {
    const [labels, patterns] = await Promise.all([
      this.run(
        `MATCH (n:Memory {scope: $scope}) WHERE n.stub = false
         UNWIND [l IN labels(n) WHERE l <> 'Memory'] AS label
         RETURN label, count(*) AS count ORDER BY label`,
        { scope: this.scope }
      ),
      this.run(
        `MATCH (a:Memory {scope: $scope})-[r]->(b:Memory {scope: $scope})
         WITH [l IN labels(a) WHERE l <> 'Memory'][0] AS from, type(r) AS type,
              coalesce([l IN labels(b) WHERE l <> 'Memory'][0], 'Memory') AS to
         RETURN from, type, to, count(*) AS count ORDER BY from, type, to`,
        { scope: this.scope }
      )
    ])
    return {
      labels: labels.map((row) => ({ label: row.label as string, count: row.count as number })),
      patterns: patterns.map((row) => ({
        from: row.from as string,
        type: row.type as string,
        to: row.to as string,
        count: row.count as number
      }))
    }
  }

  /** Creates the full-text index, or recreates it if an earlier version built it with another analyzer. */
  private async ensureFulltextIndex(): Promise<void> {
    const existing = await this.run(
      `SHOW FULLTEXT INDEXES YIELD name, options WHERE name = $name
       RETURN options.indexConfig['fulltext.analyzer'] AS analyzer`,
      { name: FULLTEXT_INDEX }
    )
    if (existing.length > 0 && existing[0]?.analyzer !== FULLTEXT_ANALYZER) {
      await this.run(`DROP INDEX ${FULLTEXT_INDEX}`)
    }
    await this.run(
      `CREATE FULLTEXT INDEX ${FULLTEXT_INDEX} IF NOT EXISTS
       FOR (n:Memory) ON EACH [n.title, n.content, n.id, n.tags]
       OPTIONS { indexConfig: { \`fulltext.analyzer\`: '${FULLTEXT_ANALYZER}' } }`
    )
    await this.run('CALL db.awaitIndexes()')
  }

  async close(): Promise<void> {
    await this.driver?.close()
    this.driver = null
  }

  private async neighbours(id: string): Promise<Neighbour[]> {
    const rows = await this.run(
      `MATCH (n:Memory {scope: $scope, id: $id})-[r]-(m:Memory {scope: $scope})
       RETURN startNode(r) = n AS out, r.rel AS rel, m.id AS id
       ORDER BY out DESC, rel, id`,
      { scope: this.scope, id }
    )
    return rows.map((row) => ({
      direction: row.out ? 'out' : 'in',
      rel: row.rel as string,
      id: row.id as string
    }))
  }

  /** Swaps the node's type label for `label`, or just removes it when `label` is null. */
  private async replaceTypeLabel(tx: ManagedTransaction, id: string, label: string | null): Promise<void> {
    const result = await tx.run('MATCH (n:Memory {scope: $scope, id: $id}) RETURN labels(n) AS labels', {
      scope: this.scope,
      id
    })
    const current = (result.records[0]?.get('labels') as string[] | undefined) ?? []
    const stale = current.filter((existing) => isOwnLabel(existing) && existing !== label)
    const changes = [
      ...stale.map((existing) => `REMOVE n:\`${existing}\``),
      ...(label && !current.includes(label) ? [`SET n:\`${label}\``] : [])
    ]
    if (changes.length === 0) return
    await tx.run(`MATCH (n:Memory {scope: $scope, id: $id}) ${changes.join(' ')}`, { scope: this.scope, id })
  }

  /** A document owns its outgoing links: they are rewritten whole on every upsert. Returns their old targets. */
  private async dropOutgoing(tx: ManagedTransaction, id: string): Promise<string[]> {
    const result = await tx.run(
      `MATCH (n:Memory {scope: $scope, id: $id})-[r]->(t:Memory)
       DELETE r RETURN collect(DISTINCT t.id) AS targets`,
      { scope: this.scope, id }
    )
    return (result.records[0]?.get('targets') as string[] | undefined) ?? []
  }

  private async deleteOrphanStubs(tx: ManagedTransaction, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    await tx.run(
      `MATCH (t:Memory {scope: $scope}) WHERE t.id IN $ids AND t.stub = true AND NOT EXISTS { (t)--() }
       DELETE t`,
      { scope: this.scope, ids }
    )
  }

  private async write(work: (tx: ManagedTransaction) => Promise<void>): Promise<void> {
    const session = this.requireDriver().session(this.sessionConfig())
    try {
      await session.executeWrite(work)
    } finally {
      await session.close()
    }
  }

  private async run(cypher: string, parameters: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
    const result = await this.requireDriver().executeQuery(cypher, parameters, this.sessionConfig())
    return result.records.map((record) => {
      const row = record.toObject() as Record<string, unknown>
      return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, this.requireNeo4j().isInt(value) ? Number(value) : value])
      )
    })
  }

  private sessionConfig(): { database?: string } {
    return this.config.database ? { database: this.config.database } : {}
  }

  private requireDriver(): Driver {
    if (!this.driver) {
      throw new Error('neo4j projection used before init() - call ProjectionManager.init() first')
    }
    return this.driver
  }

  private requireNeo4j(): Neo4jApi {
    if (!this.neo4j) {
      throw new Error('neo4j projection used before init() - call ProjectionManager.init() first')
    }
    return this.neo4j
  }
}

export interface Neo4jProjectionDependencies {
  /** Replaces the configured model - for tests. */
  chat?: Chat
}

export function createNeo4jProjection(
  config: Neo4jProjectionConfig,
  dependencies: Neo4jProjectionDependencies = {}
): MemoryProjection {
  return new Neo4jProjection(config, dependencies)
}
