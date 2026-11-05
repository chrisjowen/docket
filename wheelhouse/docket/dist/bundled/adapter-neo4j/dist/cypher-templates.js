import { z } from '../../../vendor/zod.js';
import { hitsOf, MAX_CYPHER_ROWS, RECORDED_ONLY, rowsResult } from './cypher-search.js';
import { labelFor, relationshipTypeFor } from './graph-model.js';
import { FULLTEXT_INDEX } from './subgraph-search.js';
/*
 * Hand-written Cypher for the questions asked most: what depends on what, who
 * owns what, how two things connect, how many of a type are linked to
 * something, and what is weakly evidenced. A model only chooses a template
 * and fills in its parameters; the names it gives are looked up through the
 * full-text index, and nothing it writes reaches the query except as a
 * parameter. A question no template fits goes to a model-written query.
 */
/** How far `transitive` dependencies are followed. Reaching nothing this far means every one was found. */
export const TRANSITIVE_HOPS = 6;
/** The longest connection `path` looks for. */
export const PATH_HOPS = 4;
/** `low_confidence`'s threshold when the question names none. */
export const LOW_CONFIDENCE = 0.5;
/** A full-text match scoring at least this share of the best is named as another reading of the name. */
const CLOSE_MATCH = 0.8;
/** A full-text match scoring less is too weak to stand for a name: a word met once in a long body, say. */
export const MIN_SCORE = 0.5;
// ---------------------------------------------------------------------------
// What the model may choose
const name = z.string().trim().min(1).max(200);
/** Optional, and a model's `null` read as left out. */
const optionalName = name.nullish().transform((value) => value ?? undefined);
const transitive = z.boolean().nullish().transform((value) => value ?? false);
const related = z.object({ entity: name, rel: name, direction: z.enum(['outgoing', 'incoming']), type: optionalName });
export const selectionSchema = z.discriminatedUnion('intent', [
    z.object({ intent: z.literal('none') }),
    z.object({ intent: z.literal('dependencies'), params: z.object({ entity: name, transitive }) }),
    z.object({ intent: z.literal('dependents'), params: z.object({ entity: name, transitive }) }),
    z.object({ intent: z.literal('owner'), params: z.object({ entity: name }) }),
    z.object({ intent: z.literal('path'), params: z.object({ from: name, to: name }) }),
    z.object({ intent: z.literal('count_related'), params: related }),
    z.object({ intent: z.literal('list_related'), params: related }),
    z.object({ intent: z.literal('count_of_type'), params: z.object({ type: name }) }),
    z.object({ intent: z.literal('list_of_type'), params: z.object({ type: name }) }),
    z.object({
        intent: z.literal('low_confidence'),
        params: z
            .object({ type: optionalName, below: z.number().gt(0).lte(1).nullish().transform((value) => value ?? LOW_CONFIDENCE) })
            .default({ type: undefined, below: LOW_CONFIDENCE })
    }),
    z.object({
        intent: z.literal('single_source'),
        params: z.object({ type: optionalName, source: optionalName }).default({ type: undefined, source: undefined })
    })
]);
const SYSTEM = `You route a question about a software project's knowledge graph to one of a fixed set of hand-written queries, and fill in its parameters. You never write a query yourself.

Answer with only one JSON object, no explanation and no code fences:
{"intent": "<template>", "params": {...}}
or, when no template asks exactly what the question asks:
{"intent": "none"}

A near fit gives a confidently wrong answer, so prefer "none" to stretching a template: the template must answer the whole question, with every condition in it.

Templates:
- dependencies {entity, transitive}: what entity depends on, along depends_on. transitive true also follows what those depend on.
- dependents {entity, transitive}: what depends on entity, along depends_on. transitive true also follows what depends on those.
- owner {entity}: who owns entity, along owned_by.
- path {from, to}: how from and to are connected: the shortest paths between them.
- count_related {entity, rel, direction, type}: how many things are linked to entity by rel. direction "outgoing" counts
  what entity points to (entity -rel-> thing), "incoming" what points to entity (thing -rel-> entity).
  type is optional: given, only things of that type count.
- list_related {entity, rel, direction, type}: the same things, listed.
- count_of_type {type}: how many resources of type are recorded.
- list_of_type {type}: the resources of type, listed.
- low_confidence {type, below}: resources whose confidence is below below (0 to 1, default 0.5), weakest first. Both optional.
- single_source {type, source}: resources corroborated by one kind of evidence only; given source, only that kind
  (e.g. "code" for seen only in code). Both optional.

Parameters:
- entity, from and to: the thing's name or id as the question gives it, e.g. "orders api". It is looked up in the graph.
- type: one of the types listed, exactly as listed.
- rel: one of the relationships listed, exactly as listed.

Examples:
Q: what does the orders service depend on?
{"intent": "dependencies", "params": {"entity": "orders service", "transitive": false}}
Q: what breaks if postgres goes down?
{"intent": "dependents", "params": {"entity": "postgres", "transitive": true}}
Q: who owns billing?
{"intent": "owner", "params": {"entity": "billing"}}
Q: how is checkout connected to the ledger?
{"intent": "path", "params": {"from": "checkout", "to": "ledger"}}
Q: how many services use redis?
{"intent": "count_related", "params": {"entity": "redis", "rel": "uses", "direction": "incoming", "type": "Service"}}
Q: which services does the payments team own?
{"intent": "list_related", "params": {"entity": "payments team", "rel": "owned_by", "direction": "incoming", "type": "Service"}}
Q: how many decisions are recorded?
{"intent": "count_of_type", "params": {"type": "Decision"}}
Q: which facts are poorly evidenced?
{"intent": "low_confidence", "params": {}}
Q: which pods have we only seen in code?
{"intent": "single_source", "params": {"type": "Pod", "source": "code"}}
Q: which services were deployed last week?
{"intent": "none"}
Q: summarise the architecture
{"intent": "none"}`;
/** `DEPENDS_ON` → `depends_on`, the name a link is written with. */
const relName = (type) => type.toLowerCase();
/** The prompt that has a model choose a template for `question` and fill in its parameters. */
export const buildTemplatePrompt = (question, schema) => ({
    system: SYSTEM,
    user: [
        'Types:',
        ...(schema.labels.length === 0 ? ['- (none yet)'] : schema.labels.map(({ label, count }) => `- ${label} (${count})`)),
        '',
        'Relationships:',
        ...(schema.patterns.length === 0
            ? ['- (none yet)']
            : schema.patterns.map(({ from, type, to, count }) => `- ${relName(type)}: ${from} -> ${to} (${count})`)),
        '',
        `Question: ${question}`
    ].join('\n')
});
/** Not a template's fault: the question, as the model read it, has none that answers it. */
class Unfitted extends Error {
}
/** The model's choice, or why it chose none that can run. */
export const parseSelection = (reply) => {
    const start = reply.indexOf('{');
    const end = reply.lastIndexOf('}');
    if (start === -1 || end < start)
        throw new Unfitted(`The model chose no template: ${reply.trim().slice(0, 80)}`);
    let json;
    try {
        json = JSON.parse(reply.slice(start, end + 1));
    }
    catch {
        throw new Unfitted(`The model's choice of template is not JSON: ${reply.trim().slice(0, 80)}`);
    }
    const parsed = selectionSchema.safeParse(json);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue && issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
        throw new Unfitted(`The model's choice of template does not fit one${where}: ${issue?.message ?? 'invalid'}`);
    }
    return parsed.data;
};
/** The one rule for every way a name resolves: a reading is sure only when no other entity matched as well or nearly. */
const unsure = (entity) => entity.alternatives.length > 0;
const EXACT_QUERY = `MATCH (n:Memory {scope: $scope}) WHERE n.id = $name OR toLower(n.title) = toLower($name)
RETURN n.id AS id, n.title AS title, labels(n) AS labels, n.id = $name AS byId
ORDER BY byId DESC, n.stub, id
LIMIT 5`;
export const RESOLVE_QUERY = `CALL db.index.fulltext.queryNodes('${FULLTEXT_INDEX}', $lucene) YIELD node, score
WHERE node.scope = $scope
RETURN node.id AS id, node.title AS title, labels(node) AS labels, score
ORDER BY score DESC, id
LIMIT 5`;
/** Words naming one of the graph's types, singular or plural, and the type each names: they say what kind of thing a name is, not which one. */
const typeWords = (schema) => new Map(schema.labels.flatMap(({ label }) => [[label.toLowerCase(), label], [`${label.toLowerCase()}s`, label]]));
/** The words the index's English analyzer drops, so requiring one requires nothing. */
const STOP_WORDS = new Set('a an and are as at be but by for if in into is it no not of on or such that the their then there these they this to was will with'.split(' '));
/** A name's words as the index splits them: at anything but a letter or digit. */
const wordsOf = (name) => name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '');
/**
 * A Lucene query whose every match has each word of a name but those naming
 * a type, which only rank. Undefined when no word is left to require.
 */
const requiredQuery = (words, types) => {
    const required = words.filter((word) => !types.has(word) && !STOP_WORDS.has(word));
    if (required.length === 0)
        return undefined;
    return [...required.map((word) => `+${word}`), ...words.filter((word) => types.has(word))].join(' ');
};
const candidateOf = (record, score) => {
    const title = record.get('title');
    return {
        id: String(record.get('id')),
        ...(typeof title === 'string' && title !== '' ? { title } : {}),
        labels: (record.get('labels') ?? []).map(String),
        score
    };
};
/**
 * The candidate a name reads as: of those scoring nearly as well as the top
 * one, the first, after keeping of each set of types in `prefer` that any of
 * them has only those that have it. The others that score nearly as well are
 * its alternatives: on a title, those of the preferred types, since one the
 * template cannot use is not a rival; on a full-text match, every one, since
 * relevance and not type decides what a name says.
 */
const choose = (name, how, candidates, prefer) => {
    const [top] = candidates;
    if (!top)
        return undefined;
    const close = candidates.filter((candidate) => candidate.score >= top.score * CLOSE_MATCH);
    let pool = close;
    for (const types of prefer) {
        const fitting = pool.filter((candidate) => candidate.labels.some((label) => types.has(label)));
        if (fitting.length > 0)
            pool = fitting;
    }
    const best = pool[0];
    return {
        name,
        id: best.id,
        ...(best.title !== undefined ? { title: best.title } : {}),
        how,
        alternatives: (how === 'full-text' ? close : pool).filter((candidate) => candidate !== best).map((candidate) => candidate.id)
    };
};
/**
 * The entity a name means: the one with that id, else one with that title,
 * else the best full-text match that has every word of it but those naming
 * one of `types`, when it scores at least `MIN_SCORE`. Among several, one of
 * a type the template needs comes first, then one of a type the name names.
 * Undefined when nothing matches that surely.
 */
export const resolveEntity = async (port, { name, fits }, types, timeoutMs) => {
    const words = wordsOf(name);
    const prefer = [fits, new Set(words.flatMap((word) => types.get(word) ?? []))];
    const exact = await port.read(EXACT_QUERY, timeoutMs, { name });
    const byId = exact.filter((record) => record.get('byId') === true);
    if (byId.length > 0)
        return choose(name, 'id', byId.map((record) => candidateOf(record, 1)), []);
    if (exact.length > 0)
        return choose(name, 'title', exact.map((record) => candidateOf(record, 1)), prefer);
    const lucene = requiredQuery(words, types);
    if (!lucene)
        return undefined;
    const matches = (await port.read(RESOLVE_QUERY, timeoutMs, { lucene })).map((record) => candidateOf(record, Number(record.get('score'))));
    const resolved = choose(name, 'full-text', matches, prefer);
    const best = matches.find((match) => match.id === resolved?.id);
    return best && best.score >= MIN_SCORE ? resolved : undefined;
};
const reading = (resolved) => {
    const what = `${resolved.id}${resolved.title !== undefined && resolved.title !== resolved.id ? ` (${resolved.title})` : ''}`;
    const how = { id: 'its id', title: 'its title', 'full-text': 'the best full-text match of every word of it naming no type' }[resolved.how];
    const others = unsure(resolved) ? `; not a sure reading, since ${resolved.alternatives.join(', ')} matched as well or nearly` : '';
    return `"${resolved.name}" was read as ${what}, ${how}${others}.`;
};
const ALL = () => 'exhaustive';
/** A driver Integer or a number, as a number. */
const whole = (value) => typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function' ? Number(value.toNumber()) : Number(value);
/** The schema label a type names, ignoring case and a plural `s`. */
const labelIn = (schema, type) => {
    let wanted;
    try {
        wanted = labelFor(type).toLowerCase();
    }
    catch {
        throw new Unfitted(`"${type}" is not a type`);
    }
    const label = schema.labels.find((known) => known.label.toLowerCase() === wanted) ??
        (wanted.endsWith('s') ? schema.labels.find((known) => known.label.toLowerCase() === wanted.slice(0, -1)) : undefined);
    if (!label)
        throw new Unfitted(`"${type}" is not a type this graph has`);
    return label.label;
};
/** The relationship type a rel names, when the graph has it. */
const relIn = (schema, rel) => {
    let type;
    try {
        type = relationshipTypeFor(rel);
    }
    catch {
        throw new Unfitted(`"${rel}" is not a relationship`);
    }
    if (!schema.patterns.some((pattern) => pattern.type === type))
        throw new Unfitted(`"${rel}" is not a relationship this graph has`);
    return type;
};
const needs = (schema, type, intent) => {
    if (!schema.patterns.some((pattern) => pattern.type === type)) {
        throw new Unfitted(`${intent} follows ${relName(type)}, which this graph has none of`);
    }
};
/** The types at `end` of a `type` relationship, with one of `other` at its other end when given. */
const ends = (schema, type, end, other) => new Set(schema.patterns
    .filter((pattern) => pattern.type === type && (other === undefined || pattern[end === 'from' ? 'to' : 'from'] === other))
    .map((pattern) => pattern[end]));
const anything = new Set();
const labelled = (label) => (label === undefined ? '' : ' AND $label IN labels(n)');
/** Every query ends with the row cap its answer can tell was reached, written as the integer it is. */
const limit = (maxRows) => {
    if (!Number.isInteger(maxRows) || maxRows < 1)
        throw new Error(`A template's row cap is a positive integer, not ${maxRows}`);
    return `LIMIT ${maxRows}`;
};
const along = (intent, transitive) => (entities, maxRows) => {
    const entity = entities.entity;
    const hops = transitive ? TRANSITIVE_HOPS : 1;
    const arrow = intent === 'dependencies' ? [`-[:DEPENDS_ON*1..${hops}]->`, 'dependency'] : [`<-[:DEPENDS_ON*1..${hops}]-`, 'dependent'];
    const [pattern, column] = arrow;
    return {
        intent,
        cypher: `MATCH p = (x:Memory {scope: $scope, id: $id})${pattern}(n:Memory {scope: $scope})
WHERE n <> x
WITH n, p ORDER BY length(p), n.id
WITH n, collect(p)[0] AS via
RETURN n AS ${column}, length(via) AS hops, via
ORDER BY hops, ${column}.id
${limit(maxRows)}`,
        parameters: { id: entity.id },
        asks: (intent === 'dependencies' ? `what ${entity.id} depends on` : `what depends on ${entity.id}`) +
            (transitive ? `, directly or through others, up to ${TRANSITIVE_HOPS} depends_on hops` : ', directly'),
        assumptions: [
            reading(entity),
            transitive
                ? `Dependencies are depends_on relationships, followed up to ${TRANSITIVE_HOPS} hops; each row is reached by its shortest chain.`
                : 'Dependencies are depends_on relationships, direct ones only.'
        ],
        // Nothing at the furthest hop means the chains ended before it, so every one was followed to its end.
        uncut: transitive
            ? (records) => (records.some((record) => whole(record.get('hops')) >= TRANSITIVE_HOPS) ? 'top-k' : 'exhaustive')
            : ALL
    };
};
const relatedBuild = (intent, params, relType, label) => (entities, maxRows) => {
    const entity = entities.entity;
    const pattern = params.direction === 'outgoing' ? '-[r]->' : '<-[r]-';
    const things = label === undefined ? 'things' : `${label} resources`;
    const linked = params.direction === 'outgoing' ? `${things} ${entity.id} ${relName(relType)}` : `${things} that ${relName(relType)} ${entity.id}`;
    const returns = intent === 'count_related' ? 'RETURN count(DISTINCT n) AS count' : 'RETURN x AS entity, r AS link, n AS related\nORDER BY related.id';
    return {
        intent,
        cypher: `MATCH (x:Memory {scope: $scope, id: $id})${pattern}(n:Memory {scope: $scope})
WHERE type(r) = $relType${labelled(label)}
${returns}
${limit(maxRows)}`,
        parameters: { id: entity.id, relType, ...(label !== undefined ? { label } : {}) },
        asks: `${intent === 'count_related' ? 'how many' : 'the'} ${linked}`,
        assumptions: [reading(entity), `Only direct ${relName(relType)} relationships ${params.direction === 'outgoing' ? 'from' : 'to'} ${entity.id} count.`],
        uncut: ALL,
        ...(intent === 'count_related' ? { found: (records) => whole(records[0]?.get('count')) > 0 } : {})
    };
};
/** What a selection needs before it runs, after checking its types and relationships against the graph's schema. */
const prepare = (selection, schema) => {
    switch (selection.intent) {
        case 'dependencies':
        case 'dependents':
            needs(schema, 'DEPENDS_ON', selection.intent);
            return {
                names: { entity: { name: selection.params.entity, fits: ends(schema, 'DEPENDS_ON', selection.intent === 'dependencies' ? 'from' : 'to') } },
                build: along(selection.intent, selection.params.transitive)
            };
        case 'owner':
            needs(schema, 'OWNED_BY', selection.intent);
            return {
                names: { entity: { name: selection.params.entity, fits: ends(schema, 'OWNED_BY', 'from') } },
                build: (entities, maxRows) => {
                    const entity = entities.entity;
                    return {
                        intent: 'owner',
                        cypher: `MATCH (x:Memory {scope: $scope, id: $id})-[r:OWNED_BY]->(o:Memory {scope: $scope})
RETURN x AS resource, r AS link, o AS owner
ORDER BY owner.id
${limit(maxRows)}`,
                        parameters: { id: entity.id },
                        asks: `who owns ${entity.id}`,
                        assumptions: [reading(entity), `Ownership is ${entity.id}'s owned_by relationships.`],
                        uncut: ALL
                    };
                }
            };
        case 'path':
            return {
                names: { from: { name: selection.params.from, fits: anything }, to: { name: selection.params.to, fits: anything } },
                build: (entities, maxRows) => {
                    const [from, to] = [entities.from, entities.to];
                    if (from.id === to.id)
                        throw new Unfitted(`"${from.name}" and "${to.name}" are both ${from.id}`);
                    return {
                        intent: 'path',
                        cypher: `MATCH (a:Memory {scope: $scope, id: $from}), (b:Memory {scope: $scope, id: $to})
MATCH p = allShortestPaths((a)-[*..${PATH_HOPS}]-(b))
RETURN p AS path, length(p) AS hops
ORDER BY [n IN nodes(p) | n.id]
${limit(maxRows)}`,
                        parameters: { from: from.id, to: to.id },
                        asks: `how ${from.id} and ${to.id} are connected`,
                        assumptions: [
                            reading(from),
                            reading(to),
                            `Only the shortest paths, of up to ${PATH_HOPS} relationships in either direction: not every way they are connected.`
                        ],
                        uncut: () => 'top-k'
                    };
                }
            };
        case 'count_related':
        case 'list_related': {
            const relType = relIn(schema, selection.params.rel);
            const label = selection.params.type === undefined ? undefined : labelIn(schema, selection.params.type);
            const fits = ends(schema, relType, selection.params.direction === 'outgoing' ? 'from' : 'to', label);
            return { names: { entity: { name: selection.params.entity, fits } }, build: relatedBuild(selection.intent, selection.params, relType, label) };
        }
        case 'count_of_type':
        case 'list_of_type': {
            const label = labelIn(schema, selection.params.type);
            const count = selection.intent === 'count_of_type';
            return {
                names: {},
                build: (_entities, maxRows) => ({
                    intent: selection.intent,
                    cypher: `MATCH (n:Memory {scope: $scope})
WHERE n.stub = false AND $label IN labels(n)
${count ? 'RETURN count(n) AS count' : 'RETURN n AS resource\nORDER BY resource.id'}
${limit(maxRows)}`,
                    parameters: { label },
                    asks: `${count ? 'how many' : 'the'} ${label} resources are recorded`,
                    assumptions: [`Every recorded resource of type ${label}; links to ones without a file of their own are left out.`],
                    uncut: ALL
                })
            };
        }
        case 'low_confidence': {
            const label = selection.params.type === undefined ? undefined : labelIn(schema, selection.params.type);
            const { below } = selection.params;
            return {
                names: {},
                build: (_entities, maxRows) => ({
                    intent: 'low_confidence',
                    cypher: `MATCH (n:Memory {scope: $scope})
WHERE n.stub = false AND n.confidence < $below${labelled(label)}
RETURN n AS resource, n.confidence AS confidence, n.confidenceBasis AS basis, n.sources AS sources
ORDER BY confidence, resource.id
${limit(maxRows)}`,
                    parameters: { below, ...(label !== undefined ? { label } : {}) },
                    asks: `the ${label === undefined ? '' : `${label} `}resources with confidence below ${below}`,
                    assumptions: ['Confidence is computed from each resource\'s recorded evidence; unevidenced resources get the ontology\'s default.'],
                    uncut: ALL
                })
            };
        }
        case 'single_source': {
            const label = selection.params.type === undefined ? undefined : labelIn(schema, selection.params.type);
            const source = selection.params.source?.toLowerCase();
            return {
                names: {},
                build: (_entities, maxRows) => ({
                    intent: 'single_source',
                    cypher: `MATCH (n:Memory {scope: $scope})
WHERE n.stub = false AND size(n.sources) = 1${source === undefined ? '' : ' AND $source IN n.sources'}${labelled(label)}
RETURN n AS resource, n.sources AS sources, toInteger(n.evidenceCount) AS observations, n.confidence AS confidence
ORDER BY resource.id
${limit(maxRows)}`,
                    parameters: { ...(source !== undefined ? { source } : {}), ...(label !== undefined ? { label } : {}) },
                    asks: `the ${label === undefined ? '' : `${label} `}resources corroborated only by ${source === undefined ? 'one kind of evidence' : `${source} evidence`}`,
                    assumptions: ['A source is a kind of evidence (code, manifest, runtime, ...): one kind, however many observations of it.'],
                    uncut: ALL
                })
            };
        }
    }
};
/**
 * Has the model choose a template for `question` and fill in its
 * parameters, looks up the names it gave, and runs the template. A choice
 * of none, one that does not parse or fit the schema, or a name nothing
 * matches surely enough, or nothing found for a name not surely read, is
 * `NoTemplate`; anything else that goes wrong throws.
 */
export const runTemplate = async (port, chat, question, options = {}) => {
    const maxRows = options.maxRows ?? MAX_CYPHER_ROWS;
    try {
        const schema = await port.schema();
        const selection = parseSelection(await chat(buildTemplatePrompt(question, schema)));
        if (selection.intent === 'none')
            return { reason: 'No query template fits the question' };
        const prepared = prepare(selection, schema);
        const entities = {};
        const types = typeWords(schema);
        for (const [key, value] of Object.entries(prepared.names)) {
            const resolved = await resolveEntity(port, value, types, options.timeoutMs);
            if (!resolved) {
                throw new Unfitted(`"${value.name}" is unresolved: no id or title is it, and no full-text match has every word of it naming no type with a score of at least ${MIN_SCORE}`);
            }
            entities[key] = resolved;
        }
        const query = prepared.build(entities, maxRows);
        const records = await port.read(query.cypher, options.timeoutMs, query.parameters);
        const doubt = Object.values(entities).find(unsure);
        if (doubt && !(query.found ?? ((rows) => rows.length > 0))(records)) {
            throw new Unfitted(`"${doubt.name}" is not a sure reading of ${doubt.id}, since ${doubt.alternatives.join(', ')} matched as well or nearly, and the template found nothing for it`);
        }
        return { selection, query, entities: Object.values(entities), records, limit: maxRows };
    }
    catch (cause) {
        if (cause instanceof Unfitted)
            return { reason: `No query template ran: ${cause.message}` };
        throw cause;
    }
};
/** The template and its parameters as one readable query. */
export const templateQueryText = (query) => [query.cypher, ...Object.entries(query.parameters).map(([key, value]) => `// $${key}: ${JSON.stringify(value)}`)].join('\n');
/** The documents a run is about: the entities its names resolved to, then those its rows mention. */
const templateHits = async (port, run) => {
    const named = await port.documents(run.entities.map((entity) => entity.id));
    const hits = run.entities
        .filter((entity) => named.has(entity.id))
        .map((entity) => {
        const revision = named.get(entity.id);
        return { id: entity.id, ...(revision !== undefined ? { revision } : {}) };
    });
    for (const hit of await hitsOf(port, run.records)) {
        const known = hits.findIndex((existing) => existing.id === hit.id);
        if (known === -1)
            hits.push(hit);
        else
            hits[known] = hit;
    }
    return hits;
};
/** A run's rows as an answer, interpreted as the template it ran. */
export const templateRowsAnswer = (port, request, run, hits) => {
    const { capped, dropped, ...result } = rowsResult(port, { request, run, hits });
    const uncut = run.query.uncut(run.records);
    // A template asks what was meant, so only a cut, a row from another scope or a name it may have misread changes what its rows cover.
    const mode = dropped > 0 || run.entities.some(unsure) ? 'unknown' : capped && uncut === 'exhaustive' ? 'top-k' : uncut;
    const ambiguous = run.entities
        .filter(unsure)
        .map((entity) => ({
        severity: 'warning',
        code: 'template-ambiguous-name',
        message: `"${entity.name}" could mean ${[entity.id, ...entity.alternatives].join(' or ')}; the template read it as ${entity.id}.`
    }));
    return {
        interpretation: {
            description: `Hand-written Cypher template ${run.query.intent}: ${run.query.asks}, run in scope "${request.context.scope}". ` +
                'A model chose the template and its parameters; it wrote none of the query',
            assumptions: [...run.query.assumptions, RECORDED_ONLY],
            nativeQuery: templateQueryText(run.query)
        },
        ...result,
        coverage: { mode, truncated: capped, scope: request.context.scope },
        diagnostics: [...ambiguous, ...result.diagnostics]
    };
};
/**
 * The question answered by a template, or why none could: the rows kept as
 * the values they are, coverage exhaustive only where the template
 * enumerates every match and every name was surely read. A template that
 * finds nothing for names it read surely still answers: it
 * asked exactly what was meant, so nothing recorded is the answer.
 */
export const templateAnswer = async (port, chat, request, options = {}) => {
    const run = await runTemplate(port, chat, request.question, {
        maxRows: Math.min(MAX_CYPHER_ROWS, request.budget.maxResults + 1),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
    if ('reason' in run)
        return run;
    return { run, answer: templateRowsAnswer(port, request, run, await templateHits(port, run)) };
};
/** The search form of a template's answer: the documents it is about, with the rows as their evidence. */
export const templateSearch = async (port, chat, query) => {
    const run = await runTemplate(port, chat, query);
    if ('reason' in run)
        return run;
    return { query: `${run.query.intent}: ${templateQueryText(run.query)}`, hits: await templateHits(port, run) };
};
