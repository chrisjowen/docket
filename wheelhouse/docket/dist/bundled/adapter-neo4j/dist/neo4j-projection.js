import { checkoutScope, ollamaChat, questionTerms } from '../../adapter-kit/dist/index.js';
import { cypherAnswer, cypherSearch } from './cypher-search.js';
import { fulltextQuery, labelFor, NODE_PROPERTIES, nodeProperties, relationshipRows } from './graph-model.js';
import { DEFAULT_TRAVERSAL, FULLTEXT_INDEX, hitOf, matchesOf, PATHS_PER_MATCH, subgraphAnswer, subgraphQuery } from './subgraph-search.js';
/** How long a generated query may run before it is abandoned. */
const CYPHER_TIMEOUT_MS = 10_000;
/** Lucene's English analyzer: drops stop words and stems, so `ordering` finds `orders`. */
const FULLTEXT_ANALYZER = 'english';
/**
 * neo4j-driver is an optional dependency: only repositories that configure a
 * neo4j projection need it installed, so it is loaded on first use.
 */
const loadDriver = async () => {
    try {
        return (await import('neo4j-driver')).default;
    }
    catch (cause) {
        throw new Error('The neo4j projection needs the "neo4j-driver" package. Install it next to ' +
            `@chrisjowen/docket (e.g. \`pnpm add neo4j-driver\`). (${cause.message})`);
    }
};
/** Labels this projection may remove are only ones it could have written. */
const isOwnLabel = (label) => label !== 'Memory' && /^[A-Za-z][A-Za-z0-9]*$/.test(label);
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
class Neo4jProjection {
    config;
    name = 'neo4j';
    resultKinds = ['entities', 'passages', 'table', 'metric', 'graph'];
    driver = null;
    neo4j = null;
    scope = '';
    /** Writes Cypher from a question; absent unless `cypher` is configured. */
    chat;
    traversal;
    constructor(config, dependencies = {}) {
        this.config = config;
        this.chat = dependencies.chat ?? (config.cypher ? ollamaChat(config.cypher) : undefined);
        this.traversal = { ...DEFAULT_TRAVERSAL, ...config.traverse };
    }
    async init(context) {
        const neo4j = await loadDriver();
        const password = this.config.passwordEnv ? process.env[this.config.passwordEnv] : undefined;
        if (this.config.passwordEnv && !password) {
            throw new Error(`The neo4j projection reads its password from ${this.config.passwordEnv}, which is not set.`);
        }
        this.neo4j = neo4j;
        this.scope = this.config.scope ?? checkoutScope(context.projectRoot);
        // No token at all is what a server started with NEO4J_AUTH=none expects.
        this.driver = password
            ? neo4j.driver(this.config.url, neo4j.auth.basic(this.config.username, password))
            : neo4j.driver(this.config.url);
        await this.driver.verifyConnectivity();
        await this.run('CREATE CONSTRAINT memory_scope_id IF NOT EXISTS FOR (n:Memory) REQUIRE (n.scope, n.id) IS UNIQUE');
        await this.ensureFulltextIndex();
    }
    async upsert(entity) {
        if (!entity.index.graph) {
            await this.remove(entity.id);
            return;
        }
        await this.write(async (tx) => {
            await tx.run(`MERGE (n:Memory {scope: $scope, id: $id})
         SET n += $properties, n.stub = false`, { scope: this.scope, id: entity.id, properties: nodeProperties(entity) });
            await this.replaceTypeLabel(tx, entity.id, labelFor(entity.type));
            const previousTargets = await this.dropOutgoing(tx, entity.id);
            for (const row of relationshipRows(entity)) {
                await tx.run(`MATCH (n:Memory {scope: $scope, id: $id})
           MERGE (t:Memory {scope: $scope, id: $target})
             ON CREATE SET t.stub = true
           MERGE (n)-[r:\`${row.type}\` {rel: $rel}]->(t)
           SET r = $properties`, { scope: this.scope, id: entity.id, target: row.target, rel: row.rel, properties: row.properties });
            }
            await this.deleteOrphanStubs(tx, previousTargets);
        });
    }
    async remove(id) {
        await this.write(async (tx) => {
            const previousTargets = await this.dropOutgoing(tx, id);
            const linked = await tx.run('MATCH (n:Memory {scope: $scope, id: $id}) RETURN EXISTS { (n)<--() } AS linked', { scope: this.scope, id });
            const record = linked.records[0];
            if (record?.get('linked') === true) {
                // Others still link here: keep the node as a stub so their links survive.
                await this.replaceTypeLabel(tx, id, null);
                await tx.run(`MATCH (n:Memory {scope: $scope, id: $id})
           SET n.stub = true REMOVE ${NODE_PROPERTIES.map((p) => `n.${p}`).join(', ')}`, { scope: this.scope, id });
            }
            else if (record) {
                await tx.run('MATCH (n:Memory {scope: $scope, id: $id}) DELETE n', { scope: this.scope, id });
            }
            await this.deleteOrphanStubs(tx, previousTargets);
        });
    }
    async reset() {
        await this.run('MATCH (n:Memory {scope: $scope}) DETACH DELETE n', { scope: this.scope });
    }
    /**
     * With `cypher` configured, the model writes a query from the question and
     * its rows are the answer, with the query in the note. When it fails or finds
     * nothing - or without `cypher` - the answer is full-text matches, each with
     * its paths as the detail, and the note says why.
     */
    async search(query, limit) {
        if (!this.chat)
            return { hits: await this.subgraphHits(query, limit, CYPHER_TIMEOUT_MS) };
        let reason;
        try {
            const answer = await cypherSearch(this.cypherPort(), this.chat, query);
            if (answer.hits.length > 0)
                return { hits: answer.hits.slice(0, limit), note: `cypher: ${answer.cypher}` };
            reason = `cypher found nothing: ${answer.cypher}`;
        }
        catch (cause) {
            reason = `cypher failed: ${cause instanceof Error ? cause.message : String(cause)}`;
        }
        return { hits: await this.subgraphHits(query, limit, CYPHER_TIMEOUT_MS), note: `${reason}\nfell back to full-text` };
    }
    /**
     * With `cypher` configured, the model writes a query from the question and
     * the rows are the answer, kept as the values they are: a count is a
     * metric, a list a typed table, relationships a graph (docs/adapter-spec.md
     * §9, §15 step 5). When it fails or finds nothing - or without `cypher` -
     * the answer is the full-text matches and the paths from them, saying why.
     */
    async answer(request) {
        const deadline = Date.parse(request.budget.deadline);
        const timeLeft = () => {
            const remaining = deadline - Date.now();
            if (!(remaining > 0))
                throw new Error('neo4j adapter: the question\'s deadline has already passed');
            return Math.min(remaining, CYPHER_TIMEOUT_MS);
        };
        const timeoutMs = timeLeft();
        const diagnostics = [];
        if (this.chat) {
            let reason;
            try {
                const { run, answer } = await cypherAnswer(this.cypherPort(), this.chat, request, {
                    writtenBy: this.config.cypher ? `Ollama ${this.config.cypher.model}` : 'a model',
                    timeoutMs
                });
                if (run.records.length > 0)
                    return answer;
                reason = `The Cypher query found nothing: ${run.cypher}`;
            }
            catch (cause) {
                reason = `The Cypher query failed: ${cause instanceof Error ? cause.message : String(cause)}`;
            }
            diagnostics.push({ severity: 'info', code: 'cypher-fallback', message: `${reason}\nAnswered with full-text matches and the paths from them instead.` });
        }
        const { hops, minConfidence, rels } = this.traversal;
        const reach = [
            `up to ${hops} hop${hops === 1 ? '' : 's'}`,
            ...(minConfidence > 0 ? [`of confidence at least ${minConfidence}`] : []),
            ...(rels ? [`along ${rels.join(', ')}`] : [])
        ].join(' ');
        const matches = await this.subgraphSearch(request.question, request.budget.maxResults, timeLeft());
        const answer = subgraphAnswer(matches, request, {
            description: `Neo4j full-text search (English analyzer) over titles, bodies, ids and tags in scope "${this.scope}", ` +
                `each match followed ${reach} through the graph`,
            assumptions: [
                'Matches are ranked by Lucene relevance: the best matches, not every match, and never a count.',
                `Each match keeps its best ${PATHS_PER_MATCH} paths, ranked by the product of their relationships' confidence ` +
                    'and damped where they end at a well-connected node. The nodes they reach are context, not matches.'
            ],
            nativeQuery: `${subgraphQuery(hops)}\n// $lucene: ${fulltextQuery(request.question)}`
        });
        return { ...answer, diagnostics: [...diagnostics, ...answer.diagnostics] };
    }
    async subgraphHits(query, limit, timeoutMs) {
        const terms = questionTerms(query);
        return (await this.subgraphSearch(query, limit, timeoutMs)).map((match) => hitOf(match, terms));
    }
    /**
     * The full-text matches for `query` and the best paths from each, in one
     * query (subgraph-search.ts). The documents a path reaches are not matches
     * of their own: the best-connected ones would otherwise come back for every
     * query.
     */
    async subgraphSearch(query, limit, timeoutMs) {
        const lucene = fulltextQuery(query);
        if (!lucene)
            return [];
        const neo4j = this.requireNeo4j();
        const { hops, minConfidence, rels } = this.traversal;
        const records = await this.read(subgraphQuery(hops), {
            lucene,
            scope: this.scope,
            matches: neo4j.int(limit),
            paths: neo4j.int(PATHS_PER_MATCH * 2),
            minConfidence,
            rels: rels ? [...rels] : null
        }, timeoutMs);
        return matchesOf(this.rowsOf(records));
    }
    cypherPort() {
        const neo4j = this.requireNeo4j();
        return {
            scope: this.scope,
            schema: () => this.schema(),
            read: (cypher, timeoutMs = CYPHER_TIMEOUT_MS) => this.read(cypher, { scope: this.scope }, timeoutMs),
            documents: async (ids) => {
                if (ids.length === 0)
                    return new Map();
                const rows = await this.run(`MATCH (n:Memory {scope: $scope}) WHERE n.id IN $ids AND n.stub = false RETURN n.id AS id, n.hash AS hash`, { scope: this.scope, ids });
                return new Map(rows.map((row) => [row.id, typeof row.hash === 'string' ? row.hash : undefined]));
            },
            ...neo4jValues(neo4j)
        };
    }
    /** The labels and relationship patterns this scope actually has, for the model to write against. */
    async schema() {
        const [labels, patterns] = await Promise.all([
            this.run(`MATCH (n:Memory {scope: $scope}) WHERE n.stub = false
         UNWIND [l IN labels(n) WHERE l <> 'Memory'] AS label
         RETURN label, count(*) AS count ORDER BY label`, { scope: this.scope }),
            this.run(`MATCH (a:Memory {scope: $scope})-[r]->(b:Memory {scope: $scope})
         WITH [l IN labels(a) WHERE l <> 'Memory'][0] AS from, type(r) AS type,
              coalesce([l IN labels(b) WHERE l <> 'Memory'][0], 'Memory') AS to
         RETURN from, type, to, count(*) AS count ORDER BY from, type, to`, { scope: this.scope })
        ]);
        return {
            labels: labels.map((row) => ({ label: row.label, count: row.count })),
            patterns: patterns.map((row) => ({
                from: row.from,
                type: row.type,
                to: row.to,
                count: row.count
            }))
        };
    }
    /** Creates the full-text index, or recreates it if an earlier version built it with another analyzer. */
    async ensureFulltextIndex() {
        const existing = await this.run(`SHOW FULLTEXT INDEXES YIELD name, options WHERE name = $name
       RETURN options.indexConfig['fulltext.analyzer'] AS analyzer`, { name: FULLTEXT_INDEX });
        if (existing.length > 0 && existing[0]?.analyzer !== FULLTEXT_ANALYZER) {
            await this.run(`DROP INDEX ${FULLTEXT_INDEX}`);
        }
        await this.run(`CREATE FULLTEXT INDEX ${FULLTEXT_INDEX} IF NOT EXISTS
       FOR (n:Memory) ON EACH [n.title, n.content, n.id, n.tags]
       OPTIONS { indexConfig: { \`fulltext.analyzer\`: '${FULLTEXT_ANALYZER}' } }`);
        await this.run('CALL db.awaitIndexes()');
    }
    async close() {
        await this.driver?.close();
        this.driver = null;
    }
    /** Swaps the node's type label for `label`, or just removes it when `label` is null. */
    async replaceTypeLabel(tx, id, label) {
        const result = await tx.run('MATCH (n:Memory {scope: $scope, id: $id}) RETURN labels(n) AS labels', {
            scope: this.scope,
            id
        });
        const current = result.records[0]?.get('labels') ?? [];
        const stale = current.filter((existing) => isOwnLabel(existing) && existing !== label);
        const changes = [
            ...stale.map((existing) => `REMOVE n:\`${existing}\``),
            ...(label && !current.includes(label) ? [`SET n:\`${label}\``] : [])
        ];
        if (changes.length === 0)
            return;
        await tx.run(`MATCH (n:Memory {scope: $scope, id: $id}) ${changes.join(' ')}`, { scope: this.scope, id });
    }
    /** A document owns its outgoing links: they are rewritten whole on every upsert. Returns their old targets. */
    async dropOutgoing(tx, id) {
        const result = await tx.run(`MATCH (n:Memory {scope: $scope, id: $id})-[r]->(t:Memory)
       DELETE r RETURN collect(DISTINCT t.id) AS targets`, { scope: this.scope, id });
        return result.records[0]?.get('targets') ?? [];
    }
    async deleteOrphanStubs(tx, ids) {
        if (ids.length === 0)
            return;
        await tx.run(`MATCH (t:Memory {scope: $scope}) WHERE t.id IN $ids AND t.stub = true AND NOT EXISTS { (t)--() }
       DELETE t`, { scope: this.scope, ids });
    }
    async write(work) {
        const session = this.requireDriver().session(this.sessionConfig());
        try {
            await session.executeWrite(work);
        }
        finally {
            await session.close();
        }
    }
    /** Runs `cypher` in a read transaction the server abandons after `timeoutMs`. */
    async read(cypher, parameters, timeoutMs) {
        const session = this.requireDriver().session(this.sessionConfig());
        try {
            const result = await session.executeRead((tx) => tx.run(cypher, parameters), { timeout: timeoutMs });
            return result.records;
        }
        finally {
            await session.close();
        }
    }
    async run(cypher, parameters = {}) {
        const result = await this.requireDriver().executeQuery(cypher, parameters, this.sessionConfig());
        return this.rowsOf(result.records);
    }
    rowsOf(records) {
        return records.map((record) => {
            const row = record.toObject();
            return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, this.requireNeo4j().isInt(value) ? Number(value) : value]));
        });
    }
    sessionConfig() {
        return this.config.database ? { database: this.config.database } : {};
    }
    requireDriver() {
        if (!this.driver) {
            throw new Error('neo4j projection used before init() - call ProjectionManager.init() first');
        }
        return this.driver;
    }
    requireNeo4j() {
        if (!this.neo4j) {
            throw new Error('neo4j projection used before init() - call ProjectionManager.init() first');
        }
        return this.neo4j;
    }
}
/** How the driver's own values are told apart: the type guards Cypher answers read rows with. */
export const neo4jValues = (neo4j) => ({
    isNode: (value) => typeof value === 'object' && value !== null && neo4j.isNode(value),
    isRelationship: (value) => typeof value === 'object' && value !== null && neo4j.isRelationship(value),
    isPath: (value) => typeof value === 'object' && value !== null && neo4j.isPath(value),
    isInteger: (value) => neo4j.isInt(value),
    temporal: (value) => {
        if (typeof value !== 'object' || value === null)
            return undefined;
        if (neo4j.isDate(value))
            return { type: 'date', text: value.toString() };
        if (neo4j.isDateTime(value) || neo4j.isLocalDateTime(value))
            return { type: 'datetime', text: value.toString() };
        return undefined;
    }
});
export function createNeo4jProjection(config, dependencies = {}) {
    return new Neo4jProjection(config, dependencies);
}
