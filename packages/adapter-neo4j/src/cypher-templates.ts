import type { Record as Neo4jRecord } from 'neo4j-driver'
import { z } from 'zod'

import type { Chat, ChatPrompt, SearchHit } from '@docket/adapter-kit'
import type { AdapterAnswer, AskRequest, Diagnostic } from '@docket/contracts'

import type { GraphSchema } from './cypher-prompt.js'
import { hitsOf, MAX_CYPHER_ROWS, RECORDED_ONLY, rowsResult, type CypherPort } from './cypher-search.js'
import { labelFor, relationshipTypeFor } from './graph-model.js'
import { FULLTEXT_INDEX } from './subgraph-search.js'

/*
 * Hand-written Cypher for the questions asked most: what depends on what, who
 * owns what, how two things connect, how many of a type are linked to
 * something, and what is weakly evidenced. A model only chooses a template
 * and fills in its parameters; the names it gives are looked up through the
 * full-text index, and nothing it writes reaches the query except as a
 * parameter. A question no template fits goes to a model-written query.
 */

/** How far `transitive` dependencies are followed. Reaching nothing this far means every one was found. */
export const TRANSITIVE_HOPS = 6
/** The longest connection `path` looks for. */
export const PATH_HOPS = 4
/** `low_confidence`'s threshold when the question names none. */
export const LOW_CONFIDENCE = 0.5
/** A full-text match scoring at least this share of the best is named as another reading of the name. */
const CLOSE_MATCH = 0.8
/** A full-text match scoring less is too weak to stand for a name: a word met once in a long body, say. */
export const MIN_SCORE = 0.5

// ---------------------------------------------------------------------------
// What the model may choose

const name = z.string().trim().min(1).max(200)
/** Optional, and a model's `null` read as left out. */
const optionalName = name.nullish().transform((value) => value ?? undefined)
const transitive = z.boolean().nullish().transform((value) => value ?? false)
const related = z.object({ entity: name, rel: name, direction: z.enum(['outgoing', 'incoming']), type: optionalName })

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
])

export type Selection = z.infer<typeof selectionSchema>
export type Intent = Exclude<Selection['intent'], 'none'>

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
{"intent": "none"}`

/** `DEPENDS_ON` → `depends_on`, the name a link is written with. */
const relName = (type: string): string => type.toLowerCase()

/** The prompt that has a model choose a template for `question` and fill in its parameters. */
export const buildTemplatePrompt = (question: string, schema: GraphSchema): ChatPrompt => ({
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
})

/** Not a template's fault: the question, as the model read it, has none that answers it. */
class Unfitted extends Error {}

/** The model's choice, or why it chose none that can run. */
export const parseSelection = (reply: string): Selection => {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end < start) throw new Unfitted(`The model chose no template: ${reply.trim().slice(0, 80)}`)
  let json: unknown
  try {
    json = JSON.parse(reply.slice(start, end + 1))
  } catch {
    throw new Unfitted(`The model's choice of template is not JSON: ${reply.trim().slice(0, 80)}`)
  }
  const parsed = selectionSchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue && issue.path.length > 0 ? ` at ${issue.path.join('.')}` : ''
    throw new Unfitted(`The model's choice of template does not fit one${where}: ${issue?.message ?? 'invalid'}`)
  }
  return parsed.data
}

// ---------------------------------------------------------------------------
// Names as entities

/** A name the model gave, as the entity it names. */
export interface Resolved {
  /** As the model gave it. */
  name: string
  id: string
  title?: string
  /** `fuzzy`: a full-text match another nearly equalled, so maybe not what was meant. */
  how: 'id' | 'title' | 'full-text' | 'fuzzy'
  /** Other entities the name could have meant, nearly as well. */
  alternatives: string[]
}

const EXACT_QUERY = `MATCH (n:Memory {scope: $scope}) WHERE n.id = $name OR toLower(n.title) = toLower($name)
RETURN n.id AS id, n.title AS title, n.id = $name AS byId
ORDER BY byId DESC, n.stub, id
LIMIT 5`

export const RESOLVE_QUERY = `CALL db.index.fulltext.queryNodes('${FULLTEXT_INDEX}', $lucene) YIELD node, score
WHERE node.scope = $scope
RETURN node.id AS id, node.title AS title, labels(node) AS labels, score
ORDER BY score DESC, id
LIMIT 5`

const titleOf = (record: Neo4jRecord): string | undefined => {
  const title = record.get('title') as unknown
  return typeof title === 'string' && title !== '' ? title : undefined
}

/** Words naming one of the graph's types, singular or plural, and the type each names: they say what kind of thing a name is, not which one. */
const typeWords = (schema: GraphSchema): Map<string, string> =>
  new Map(schema.labels.flatMap(({ label }) => [[label.toLowerCase(), label] as const, [`${label.toLowerCase()}s`, label] as const]))

/** The words the index's English analyzer drops, so requiring one requires nothing. */
const STOP_WORDS = new Set(
  'a an and are as at be but by for if in into is it no not of on or such that the their then there these they this to was will with'.split(' ')
)

/** A name's words as the index splits them: at anything but a letter or digit. */
const wordsOf = (name: string): string[] => name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '')

/**
 * A Lucene query whose every match has each word of a name but those naming
 * a type, which only rank. Undefined when no word is left to require.
 */
const requiredQuery = (words: readonly string[], types: ReadonlyMap<string, string>): string | undefined => {
  const required = words.filter((word) => !types.has(word) && !STOP_WORDS.has(word))
  if (required.length === 0) return undefined
  return [...required.map((word) => `+${word}`), ...words.filter((word) => types.has(word))].join(' ')
}

/**
 * The entity `name` means: the one with that id, else the one with that
 * title, else the best full-text match that has every word of it but those
 * naming one of `types`, when it scores at least `MIN_SCORE`; one of a type
 * the name names first. A match another nearly equals is `fuzzy`. Undefined
 * when none is that sure.
 */
export const resolveEntity = async (
  port: CypherPort,
  name: string,
  types: ReadonlyMap<string, string>,
  timeoutMs?: number
): Promise<Resolved | undefined> => {
  const exact = await port.read(EXACT_QUERY, timeoutMs, { name })
  const [first, ...others] = exact
  if (first) {
    const title = titleOf(first)
    const byId = first.get('byId') === true
    return {
      name,
      id: String(first.get('id')),
      ...(title !== undefined ? { title } : {}),
      how: byId ? 'id' : 'title',
      alternatives: byId ? [] : others.map((record) => String(record.get('id')))
    }
  }

  const words = wordsOf(name)
  const lucene = requiredQuery(words, types)
  if (!lucene) return undefined
  const named = new Set(words.flatMap((word) => types.get(word) ?? []))
  const matches = (await port.read(RESOLVE_QUERY, timeoutMs, { lucene })).map((record) => ({
    record,
    score: Number(record.get('score')),
    typed: ((record.get('labels') as unknown[] | null) ?? []).some((label) => named.has(String(label)))
  }))
  const typed = matches.some((match) => match.typed)
  const [best, ...rest] = typed ? matches.filter((match) => match.typed) : matches
  if (!best || !(best.score >= MIN_SCORE)) return undefined
  const title = titleOf(best.record)
  const alternatives = rest.filter((match) => match.score >= best.score * CLOSE_MATCH).map((match) => String(match.record.get('id')))
  return {
    name,
    id: String(best.record.get('id')),
    ...(title !== undefined ? { title } : {}),
    how: alternatives.length > 0 ? 'fuzzy' : 'full-text',
    alternatives
  }
}

const reading = (resolved: Resolved): string => {
  const what = `${resolved.id}${resolved.title !== undefined && resolved.title !== resolved.id ? ` (${resolved.title})` : ''}`
  const how = {
    id: 'its id',
    title: 'its title',
    'full-text': 'the best full-text match of every word of it naming no type',
    fuzzy: 'a fuzzy full-text match, not a sure one'
  }[resolved.how]
  const others = resolved.alternatives.length > 0 ? `; ${resolved.alternatives.join(', ')} matched nearly as well` : ''
  return `"${resolved.name}" was read as ${what}, ${how}${others}.`
}

// ---------------------------------------------------------------------------
// The templates

/** One template filled in: the query, its parameters, and what its rows stand for. */
export interface TemplateQuery {
  intent: Intent
  cypher: string
  /** Bound alongside `$scope`. */
  parameters: Record<string, unknown>
  /** What it asks, in words. */
  asks: string
  assumptions: string[]
  /** What its rows cover when its row cap did not cut them short. */
  uncut: (records: readonly Neo4jRecord[]) => AdapterAnswer['coverage']['mode']
}

/** What a selection needs before it can run: the names to look up, and how to build its query from them. */
interface Prepared {
  names: Record<string, string>
  build: (entities: Record<string, Resolved>, maxRows: number) => TemplateQuery
}

const ALL: TemplateQuery['uncut'] = () => 'exhaustive'

/** A driver Integer or a number, as a number. */
const whole = (value: unknown): number =>
  typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function' ? Number(value.toNumber()) : Number(value)

/** The schema label a type names, ignoring case and a plural `s`. */
const labelIn = (schema: GraphSchema, type: string): string => {
  let wanted: string
  try {
    wanted = labelFor(type).toLowerCase()
  } catch {
    throw new Unfitted(`"${type}" is not a type`)
  }
  const label =
    schema.labels.find((known) => known.label.toLowerCase() === wanted) ??
    (wanted.endsWith('s') ? schema.labels.find((known) => known.label.toLowerCase() === wanted.slice(0, -1)) : undefined)
  if (!label) throw new Unfitted(`"${type}" is not a type this graph has`)
  return label.label
}

/** The relationship type a rel names, when the graph has it. */
const relIn = (schema: GraphSchema, rel: string): string => {
  let type: string
  try {
    type = relationshipTypeFor(rel)
  } catch {
    throw new Unfitted(`"${rel}" is not a relationship`)
  }
  if (!schema.patterns.some((pattern) => pattern.type === type)) throw new Unfitted(`"${rel}" is not a relationship this graph has`)
  return type
}

const needs = (schema: GraphSchema, type: string, intent: Intent): void => {
  if (!schema.patterns.some((pattern) => pattern.type === type)) {
    throw new Unfitted(`${intent} follows ${relName(type)}, which this graph has none of`)
  }
}

const labelled = (label: string | undefined): string => (label === undefined ? '' : ' AND $label IN labels(n)')

/** Every query ends with the row cap its answer can tell was reached, written as the integer it is. */
const limit = (maxRows: number): string => {
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new Error(`A template's row cap is a positive integer, not ${maxRows}`)
  return `LIMIT ${maxRows}`
}

const along = (intent: 'dependencies' | 'dependents', transitive: boolean): Prepared['build'] => (entities, maxRows) => {
  const entity = entities.entity as Resolved
  const hops = transitive ? TRANSITIVE_HOPS : 1
  const arrow = intent === 'dependencies' ? [`-[:DEPENDS_ON*1..${hops}]->`, 'dependency'] : [`<-[:DEPENDS_ON*1..${hops}]-`, 'dependent']
  const [pattern, column] = arrow as [string, string]
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
    asks:
      (intent === 'dependencies' ? `what ${entity.id} depends on` : `what depends on ${entity.id}`) +
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
  }
}

const relatedBuild =
  (intent: 'count_related' | 'list_related', params: { rel: string; direction: 'outgoing' | 'incoming' }, relType: string, label: string | undefined): Prepared['build'] =>
  (entities, maxRows) => {
    const entity = entities.entity as Resolved
    const pattern = params.direction === 'outgoing' ? '-[r]->' : '<-[r]-'
    const things = label === undefined ? 'things' : `${label} resources`
    const linked = params.direction === 'outgoing' ? `${things} ${entity.id} ${relName(relType)}` : `${things} that ${relName(relType)} ${entity.id}`
    const returns = intent === 'count_related' ? 'RETURN count(DISTINCT n) AS count' : 'RETURN x AS entity, r AS link, n AS related\nORDER BY related.id'
    return {
      intent,
      cypher: `MATCH (x:Memory {scope: $scope, id: $id})${pattern}(n:Memory {scope: $scope})
WHERE type(r) = $relType${labelled(label)}
${returns}
${limit(maxRows)}`,
      parameters: { id: entity.id, relType, ...(label !== undefined ? { label } : {}) },
      asks: `${intent === 'count_related' ? 'how many' : 'the'} ${linked}`,
      assumptions: [reading(entity), `Only direct ${relName(relType)} relationships ${params.direction === 'outgoing' ? 'from' : 'to'} ${entity.id} count.`],
      uncut: ALL
    }
  }

/** What a selection needs before it runs, after checking its types and relationships against the graph's schema. */
const prepare = (selection: Exclude<Selection, { intent: 'none' }>, schema: GraphSchema): Prepared => {
  switch (selection.intent) {
    case 'dependencies':
    case 'dependents':
      needs(schema, 'DEPENDS_ON', selection.intent)
      return { names: { entity: selection.params.entity }, build: along(selection.intent, selection.params.transitive) }
    case 'owner':
      needs(schema, 'OWNED_BY', selection.intent)
      return {
        names: { entity: selection.params.entity },
        build: (entities, maxRows) => {
          const entity = entities.entity as Resolved
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
          }
        }
      }
    case 'path':
      return {
        names: { from: selection.params.from, to: selection.params.to },
        build: (entities, maxRows) => {
          const [from, to] = [entities.from as Resolved, entities.to as Resolved]
          if (from.id === to.id) throw new Unfitted(`"${from.name}" and "${to.name}" are both ${from.id}`)
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
          }
        }
      }
    case 'count_related':
    case 'list_related': {
      const relType = relIn(schema, selection.params.rel)
      const label = selection.params.type === undefined ? undefined : labelIn(schema, selection.params.type)
      return { names: { entity: selection.params.entity }, build: relatedBuild(selection.intent, selection.params, relType, label) }
    }
    case 'count_of_type':
    case 'list_of_type': {
      const label = labelIn(schema, selection.params.type)
      const count = selection.intent === 'count_of_type'
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
      }
    }
    case 'low_confidence': {
      const label = selection.params.type === undefined ? undefined : labelIn(schema, selection.params.type)
      const { below } = selection.params
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
      }
    }
    case 'single_source': {
      const label = selection.params.type === undefined ? undefined : labelIn(schema, selection.params.type)
      const source = selection.params.source?.toLowerCase()
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
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Choosing and running one

/** A template that ran, with the rows it read. */
export interface TemplateRun {
  selection: Exclude<Selection, { intent: 'none' }>
  query: TemplateQuery
  entities: Resolved[]
  records: Neo4jRecord[]
  limit: number
}

/** Why no template ran, for the fallback to say. */
export interface NoTemplate {
  reason: string
}

/**
 * Has the model choose a template for `question` and fill in its
 * parameters, looks up the names it gave, and runs the template. A choice
 * of none, one that does not parse or fit the schema, or a name nothing
 * matches surely enough, or nothing found for a name only fuzzily matched, is
 * `NoTemplate`; anything else that goes wrong throws.
 */
export const runTemplate = async (
  port: CypherPort,
  chat: Chat,
  question: string,
  options: { maxRows?: number; timeoutMs?: number } = {}
): Promise<TemplateRun | NoTemplate> => {
  const maxRows = options.maxRows ?? MAX_CYPHER_ROWS
  try {
    const schema = await port.schema()
    const selection = parseSelection(await chat(buildTemplatePrompt(question, schema)))
    if (selection.intent === 'none') return { reason: 'No query template fits the question' }
    const prepared = prepare(selection, schema)
    const entities: Record<string, Resolved> = {}
    const types = typeWords(schema)
    for (const [key, value] of Object.entries(prepared.names)) {
      const resolved = await resolveEntity(port, value, types, options.timeoutMs)
      if (!resolved) {
        throw new Unfitted(
          `"${value}" is unresolved: no id or title is it, and no full-text match has every word of it naming no type with a score of at least ${MIN_SCORE}`
        )
      }
      entities[key] = resolved
    }
    const query = prepared.build(entities, maxRows)
    const records = await port.read(query.cypher, options.timeoutMs, query.parameters)
    const fuzzy = Object.values(entities).find((entity) => entity.how === 'fuzzy')
    if (records.length === 0 && fuzzy) {
      throw new Unfitted(
        `"${fuzzy.name}" only fuzzily matched ${fuzzy.id}, with ${fuzzy.alternatives.join(', ')} nearly as close, and the template found nothing for it`
      )
    }
    return { selection, query, entities: Object.values(entities), records, limit: maxRows }
  } catch (cause) {
    if (cause instanceof Unfitted) return { reason: `No query template ran: ${cause.message}` }
    throw cause
  }
}

/** The template and its parameters as one readable query. */
export const templateQueryText = (query: TemplateQuery): string =>
  [query.cypher, ...Object.entries(query.parameters).map(([key, value]) => `// $${key}: ${JSON.stringify(value)}`)].join('\n')

/** The documents a run is about: the entities its names resolved to, then those its rows mention. */
const templateHits = async (port: CypherPort, run: TemplateRun): Promise<SearchHit[]> => {
  const named = await port.documents(run.entities.map((entity) => entity.id))
  const hits: SearchHit[] = run.entities
    .filter((entity) => named.has(entity.id))
    .map((entity) => {
      const revision = named.get(entity.id)
      return { id: entity.id, ...(revision !== undefined ? { revision } : {}) }
    })
  for (const hit of await hitsOf(port, run.records)) {
    const known = hits.findIndex((existing) => existing.id === hit.id)
    if (known === -1) hits.push(hit)
    else hits[known] = hit
  }
  return hits
}

/** A run's rows as an answer, interpreted as the template it ran. */
export const templateRowsAnswer = (
  port: CypherPort,
  request: Pick<AskRequest, 'context' | 'budget'>,
  run: TemplateRun,
  hits: readonly SearchHit[]
): AdapterAnswer => {
  const { capped, dropped, ...result } = rowsResult(port, { request, run, hits })
  const uncut = run.query.uncut(run.records)
  // A template asks what was meant, so only a cut, a row from another scope or a name it may have misread changes what its rows cover.
  const fuzzy = run.entities.some((entity) => entity.how === 'fuzzy')
  const mode = dropped > 0 || fuzzy ? 'unknown' : capped && uncut === 'exhaustive' ? 'top-k' : uncut
  const ambiguous: Diagnostic[] = run.entities
    .filter((entity) => entity.alternatives.length > 0)
    .map((entity) => ({
      severity: 'warning',
      code: 'template-ambiguous-name',
      message: `"${entity.name}" could mean ${[entity.id, ...entity.alternatives].join(' or ')}; the template read it as ${entity.id}.`
    }))
  return {
    interpretation: {
      description:
        `Hand-written Cypher template ${run.query.intent}: ${run.query.asks}, run in scope "${request.context.scope}". ` +
        'A model chose the template and its parameters; it wrote none of the query',
      assumptions: [...run.query.assumptions, RECORDED_ONLY],
      nativeQuery: templateQueryText(run.query)
    },
    ...result,
    coverage: { mode, truncated: capped, scope: request.context.scope },
    diagnostics: [...ambiguous, ...result.diagnostics]
  }
}

/**
 * The question answered by a template, or why none could: the rows kept as
 * the values they are, coverage exhaustive only where the template
 * enumerates every match and every name was surely read. A template that
 * finds nothing for names it read surely still answers: it
 * asked exactly what was meant, so nothing recorded is the answer.
 */
export const templateAnswer = async (
  port: CypherPort,
  chat: Chat,
  request: Pick<AskRequest, 'question' | 'context' | 'budget'>,
  options: { timeoutMs?: number } = {}
): Promise<{ run: TemplateRun; answer: AdapterAnswer } | NoTemplate> => {
  const run = await runTemplate(port, chat, request.question, {
    maxRows: Math.min(MAX_CYPHER_ROWS, request.budget.maxResults + 1),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  })
  if ('reason' in run) return run
  return { run, answer: templateRowsAnswer(port, request, run, await templateHits(port, run)) }
}

/** The search form of a template's answer: the documents it is about, with the rows as their evidence. */
export const templateSearch = async (
  port: CypherPort,
  chat: Chat,
  query: string
): Promise<{ query: string; hits: SearchHit[] } | NoTemplate> => {
  const run = await runTemplate(port, chat, query)
  if ('reason' in run) return run
  return { query: `${run.query.intent}: ${templateQueryText(run.query)}`, hits: await templateHits(port, run) }
}
