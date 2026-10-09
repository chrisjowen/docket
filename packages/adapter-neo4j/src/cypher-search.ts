import type { Integer, Node, Path, Record as Neo4jRecord, Relationship } from 'neo4j-driver'

import type { Chat, SearchHit } from '@docket/adapter-kit'
import type {
  AdapterAnswer,
  AskRequest,
  CanonicalReference,
  ColumnType,
  Diagnostic,
  GraphBlock,
  ResultBlock,
  RetrievedEvidence,
  TableCell,
  TableColumn,
  TableRow
} from '@docket/contracts'

import { guardCypher, scopeProblem, undirected } from './cypher-guard.js'
import { buildCypherPrompt, type GraphSchema } from './cypher-prompt.js'

/** Rows a generated query may return. Enough to answer, not enough to dump the graph. */
export const MAX_CYPHER_ROWS = 50

/** What Cypher search needs from the graph, bound to one scope. */
export interface CypherPort {
  scope: string
  schema(): Promise<GraphSchema>
  /** Runs `cypher` in a read transaction with `$scope` bound, giving up after `timeoutMs`. */
  read(cypher: string, timeoutMs?: number): Promise<Neo4jRecord[]>
  /** Of `ids`, the documents (not stubs) in this scope, each with the revision it was projected at. */
  documents(ids: readonly string[]): Promise<Map<string, string | undefined>>
  isNode(value: unknown): value is Node
  isRelationship(value: unknown): value is Relationship
  isPath(value: unknown): value is Path
  isInteger(value: unknown): value is Integer
  /** A date or date-time value's ISO text, or undefined for anything else. */
  temporal(value: unknown): { type: 'date' | 'datetime'; text: string } | undefined
}

/** What the model wrote and what running it read. */
export interface CypherRun {
  /** The query that ran - the model's, or its undirected retry. */
  cypher: string
  records: Neo4jRecord[]
  /** The row cap the query ran under. */
  limit: number
  /** The query was retried with every relationship undirected, because as written it found nothing. */
  retried: boolean
}

export interface CypherAnswer {
  cypher: string
  hits: SearchHit[]
}

/**
 * Has the model write a query for `question` against this graph's schema,
 * checks it reads only and only in scope, and runs it. A query that finds
 * nothing is tried once more with its relationships undirected, since small
 * models often get an arrow backwards.
 */
export const runCypher = async (
  port: CypherPort,
  chat: Chat,
  question: string,
  options: { maxRows?: number; timeoutMs?: number } = {}
): Promise<CypherRun> => {
  const maxRows = options.maxRows ?? MAX_CYPHER_ROWS
  const written = guardCypher(await chat(buildCypherPrompt(question, await port.schema())), maxRows)
  const unscoped = scopeProblem(written)
  if (unscoped) throw new Error(`The model's query could read beyond this scope: ${unscoped}.`)
  const limit = Number(/\bLIMIT\s+(\d+)\s*$/i.exec(written)?.[1] ?? maxRows)
  let cypher = written
  let records = await port.read(cypher, options.timeoutMs)
  let retried = false
  if (records.length === 0 && undirected(written) !== written) {
    cypher = undirected(written)
    records = await port.read(cypher, options.timeoutMs)
    retried = true
  }
  return { cypher, records, limit, retried }
}

/** Row values flattened: paths into their nodes and relationships, lists into their items. */
const flatten = (port: CypherPort, value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap((item) => flatten(port, item))
  if (port.isPath(value)) {
    return value.segments.flatMap((segment) => [segment.start, segment.relationship, segment.end])
  }
  return [value]
}

/**
 * The documents the rows mention, as a node or as its id, in the order first
 * mentioned, each with up to three of the rows that mention it as its detail.
 * Nodes from other scopes are skipped, whatever the query matched.
 */
const hitsOf = async (port: CypherPort, records: readonly Neo4jRecord[]): Promise<SearchHit[]> => {
  const rows = records.map((record) => record.keys.flatMap((key) => flatten(port, record.get(key))))

  const candidates = rows.flatMap((values) => values.filter((v): v is string => typeof v === 'string'))
  const documents = await port.documents([...new Set(candidates)])

  const order: string[] = []
  const evidence = new Map<string, string[]>()
  const revisions = new Map<string, string | undefined>()
  for (const values of rows) {
    const names = new Map<string, string>()
    const ids: string[] = []
    const parts: string[] = []
    for (const value of values) {
      if (port.isNode(value)) {
        if (value.properties.scope !== port.scope) continue
        const id = String(value.properties.id)
        names.set(value.elementId, id)
        if (value.properties.stub !== true) {
          ids.push(id)
          if (typeof value.properties.hash === 'string') revisions.set(id, value.properties.hash)
        }
        parts.push(id)
      } else if (typeof value === 'string') {
        if (documents.has(value)) {
          ids.push(value)
          if (!revisions.has(value)) revisions.set(value, documents.get(value))
        }
        parts.push(value)
      } else if (value !== null && !port.isRelationship(value)) {
        parts.push(port.isInteger(value) ? value.toString() : String(value))
      }
    }

    const links = values.flatMap((value) => {
      if (!port.isRelationship(value)) return []
      const start = names.get(value.startNodeElementId)
      const end = names.get(value.endNodeElementId)
      const rel = typeof value.properties.rel === 'string' ? value.properties.rel : value.type.toLowerCase()
      return start && end ? [`${start} ${rel} → ${end}`] : []
    })
    const row = links.length > 0 ? links.join('; ') : [...new Set(parts)].join(', ')

    for (const id of new Set(ids)) {
      if (!evidence.has(id)) {
        order.push(id)
        evidence.set(id, [])
      }
      const rowsFor = evidence.get(id) ?? []
      // A row that is just the document itself says nothing the id does not.
      if (row && row !== id && !rowsFor.includes(row) && rowsFor.length < 3) rowsFor.push(row)
    }
  }

  return order.map((id) => {
    const detail = (evidence.get(id) ?? []).join('; ')
    const revision = revisions.get(id)
    return { id, ...(detail ? { detail } : {}), ...(revision !== undefined ? { revision } : {}) }
  })
}

/**
 * The search form of a Cypher answer: every document a row mentions, with the
 * rows as the evidence. Used by `search`; `answer` keeps the rows themselves.
 */
export const cypherSearch = async (port: CypherPort, chat: Chat, question: string): Promise<CypherAnswer> => {
  const run = await runCypher(port, chat, question)
  return { cypher: run.cypher, hits: await hitsOf(port, run.records) }
}

// ---------------------------------------------------------------------------
// Rows as an answer

/** One row value as a cell: its column type, the cell, and what it shows of the graph. */
interface Cell {
  /** Undefined for null, which fits any column. */
  type?: ColumnType
  value: TableCell
  /** Shown in text: an id for a node, the value otherwise. */
  text: string
  refs: CanonicalReference[]
  nodes: Node[]
  relationships: Relationship[]
  paths: Path[]
}

const nodeId = (node: Node): string => String(node.properties.id)

const nodeRef = (node: Node): CanonicalReference => ({
  kind: 'entity',
  id: nodeId(node),
  ...(node.properties.stub !== true && typeof node.properties.hash === 'string' ? { revision: node.properties.hash } : {})
})

const empty = (type: ColumnType | undefined, value: TableCell, text: string): Cell => ({
  ...(type !== undefined ? { type } : {}),
  value,
  text,
  refs: [],
  nodes: [],
  relationships: [],
  paths: []
})

/** Plain JSON for a map value, every driver type inside it made plain. */
const plain = (port: CypherPort, value: unknown): unknown => {
  if (value === null || value === undefined) return null
  if (port.isInteger(value)) return value.inSafeRange() ? value.toNumber() : value.toString()
  if (typeof value === 'bigint') return value.toString()
  if (port.isNode(value)) return nodeId(value)
  const temporal = port.temporal(value)
  if (temporal) return temporal.text
  if (Array.isArray(value)) return value.map((item) => plain(port, item))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, plain(port, item)]))
  }
  return value
}

const relText = (relationship: Relationship, names: ReadonlyMap<string, string>): string => {
  const rel = typeof relationship.properties.rel === 'string' ? relationship.properties.rel : relationship.type.toLowerCase()
  const start = names.get(relationship.startNodeElementId) ?? '?'
  const end = names.get(relationship.endNodeElementId) ?? '?'
  return `${start} ${rel} → ${end}`
}

/**
 * A row value exactly as it came back, as a typed cell: integers stay
 * integers (a decimal string past the safe range), dates stay dates, a node
 * is a reference to its canonical entity, and anything without a column type
 * of its own - a relationship, a path, a list, a map - is its text.
 */
const toCell = (port: CypherPort, value: unknown, names: ReadonlyMap<string, string>): Cell => {
  if (value === null || value === undefined) return empty(undefined, null, '')
  if (typeof value === 'boolean') return empty('boolean', value, String(value))
  if (typeof value === 'string') return empty('string', value, value)
  if (typeof value === 'number') return Number.isFinite(value) ? empty('number', value, String(value)) : empty('string', String(value), String(value))
  if (typeof value === 'bigint') {
    return Number.isSafeInteger(Number(value)) ? empty('integer', Number(value), value.toString()) : empty('decimal', value.toString(), value.toString())
  }
  if (port.isInteger(value)) {
    return value.inSafeRange() ? empty('integer', value.toNumber(), value.toString()) : empty('decimal', value.toString(), value.toString())
  }
  const temporal = port.temporal(value)
  if (temporal) return empty(temporal.type, temporal.text, temporal.text)
  if (port.isNode(value)) {
    const ref = nodeRef(value)
    return { ...empty('reference', ref, nodeId(value)), refs: [ref], nodes: [value] }
  }
  if (port.isRelationship(value)) return { ...empty('string', relText(value, names), relText(value, names)), relationships: [value] }
  if (port.isPath(value)) {
    const nodes = [value.start, ...value.segments.map((segment) => segment.end)]
    const text = value.segments.reduce((line, segment) => {
      const rel = typeof segment.relationship.properties.rel === 'string' ? segment.relationship.properties.rel : segment.relationship.type.toLowerCase()
      const forward = segment.relationship.startNodeElementId === segment.start.elementId
      return `${line} ${forward ? `-${rel}->` : `<-${rel}-`} ${nodeId(segment.end)}`
    }, nodeId(value.start))
    return {
      ...empty('string', text, text),
      refs: nodes.map(nodeRef),
      nodes,
      relationships: value.segments.map((segment) => segment.relationship),
      paths: [value]
    }
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => toCell(port, item, names))
    const text = items.map((item) => item.text).join(', ')
    return {
      ...empty('string', text, text),
      refs: items.flatMap((item) => item.refs),
      nodes: items.flatMap((item) => item.nodes),
      relationships: items.flatMap((item) => item.relationships),
      paths: items.flatMap((item) => item.paths)
    }
  }
  const text = typeof value === 'object' ? JSON.stringify(plain(port, value)) : String(value)
  return empty('string', text, text)
}

/** The one type a column's cells share, widening integers to numbers or decimals, and anything else mixed to text. */
const columnType = (types: ReadonlySet<ColumnType>): ColumnType => {
  if (types.size === 0) return 'string'
  if (types.size === 1) return [...types][0] as ColumnType
  if ([...types].every((type) => type === 'integer' || type === 'number')) return 'number'
  if ([...types].every((type) => type === 'integer' || type === 'decimal')) return 'decimal'
  return 'string'
}

/** A cell made to fit its column's type: an integer as a decimal string, anything else as its text. */
const fit = (cell: Cell, type: ColumnType): TableCell => {
  if (cell.value === null || cell.type === type) return cell.value
  if (type === 'number') return cell.value
  if (type === 'decimal') return typeof cell.value === 'number' ? String(cell.value) : cell.value
  return cell.text
}

const bytes = (text: string): number => Buffer.byteLength(text, 'utf8')

const NUMERIC: ReadonlySet<ColumnType> = new Set(['integer', 'number'])

export interface RowsAnswerOptions {
  request: Pick<AskRequest, 'context' | 'budget'>
  run: CypherRun
  /** Who wrote the query, for the interpretation. */
  writtenBy: string
  /** The documents the rows mention, for the entities block. */
  hits: readonly SearchHit[]
}

/**
 * The rows a Cypher query returned, kept as the values they are: one row of
 * numbers is a metric each, any other result a typed table, with the
 * relationships and paths among them as a graph and the documents they
 * mention as entities. Each row is a derived fact of its own, citing the
 * entities it holds at the revisions the graph has them.
 *
 * Coverage is exhaustive only when the query ran to completion in scope: no
 * cap or `LIMIT` of its own cut it short, and no `SKIP` or inner `LIMIT` fed an
 * aggregate a sample. A capped result is a top-k.
 */
export const rowsAnswer = (port: CypherPort, options: RowsAnswerOptions): AdapterAnswer => {
  const { request, run } = options
  const diagnostics: Diagnostic[] = []

  const all = run.records.map((record) => ({
    keys: record.keys.map(String),
    values: record.keys.map((key) => record.get(key) as unknown)
  }))
  const foreign = (value: unknown): boolean => flatten(port, value).some((item) => port.isNode(item) && item.properties.scope !== port.scope)
  const inScope = all.filter((row) => !row.values.some(foreign))
  const dropped = all.length - inScope.length
  if (dropped > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'foreign-rows',
      message: `${dropped} row${dropped === 1 ? '' : 's'} held nodes from another scope and ${dropped === 1 ? 'was' : 'were'} left out.`
    })
  }

  const shown = inScope.slice(0, request.budget.maxResults)
  const keys = all[0]?.keys ?? []

  const code = run.cypher.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''")
  const sampled = /\bSKIP\b/i.test(code) || (code.match(/\bLIMIT\b/gi)?.length ?? 0) > 1
  const capped = all.length >= run.limit || inScope.length > shown.length
  const mode = dropped > 0 || sampled ? 'unknown' : capped ? 'top-k' : 'exhaustive'

  const rows = shown.map((row) => {
    const names = new Map<string, string>()
    for (const value of row.values) {
      for (const item of flatten(port, value)) if (port.isNode(item)) names.set(item.elementId, nodeId(item))
    }
    return row.values.map((value) => toCell(port, value, names))
  })

  const columns: TableColumn[] = keys.map((key, index) => ({
    key,
    label: key,
    type: columnType(new Set(rows.flatMap((cells) => (cells[index]?.type !== undefined ? [cells[index].type] : []))))
  }))

  const evidence: RetrievedEvidence[] = []
  let used = 0
  const rowEvidence = rows.map((cells, index) => {
    const text = columns.map((column, at) => `${column.key}: ${cells[at]?.value === null ? 'null' : (cells[at]?.text ?? '')}`).join('; ')
    const size = bytes(text)
    if (used + size > request.budget.maxEvidenceBytes) return undefined
    used += size
    const refs = new Map<string, CanonicalReference>()
    for (const ref of cells.flatMap((cell) => cell.refs)) refs.set(`${ref.id}\u0000${ref.revision ?? ''}`, ref)
    const id = `row-${index + 1}`
    evidence.push({
      id,
      kind: 'derived-fact',
      text,
      canonicalRefs: [...refs.values()],
      derivation: { engine: 'neo4j' }
    })
    return id
  })

  const blocks: ResultBlock[] = []
  const metrics = rows.length === 1 && columns.length > 0 && columns.every((column) => NUMERIC.has(column.type)) && rows[0]?.every((cell) => typeof cell.value === 'number')
  if (metrics) {
    const evidenceIds = rowEvidence[0] === undefined ? [] : [rowEvidence[0]]
    columns.forEach((column, index) => {
      blocks.push({ kind: 'metric', id: `metric-${index + 1}`, label: column.label, value: rows[0]?.[index]?.value as number, evidenceIds })
    })
  } else if (rows.length > 0) {
    const tableRows: TableRow[] = rows.map((cells, index) => ({
      cells: Object.fromEntries(columns.map((column, at) => [column.key, fit(cells[at] as Cell, column.type)])),
      ...(rowEvidence[index] !== undefined ? { evidenceIds: [rowEvidence[index]] } : {})
    }))
    blocks.push({ kind: 'table', id: 'rows', title: 'Query results', columns, rows: tableRows, evidenceIds: [] })
  }

  const graph = graphOf(rows, rowEvidence)
  if (graph) blocks.push(graph)

  const shownHits = options.hits.slice(0, request.budget.maxResults)
  if (shownHits.length > 0) {
    blocks.push({
      kind: 'entities',
      id: 'entities',
      title: 'Exhibits the rows mention',
      evidenceIds: [],
      entities: shownHits.map((hit) => ({
        ref: { kind: 'entity', id: hit.id, ...(hit.revision !== undefined ? { revision: hit.revision } : {}) },
        ...(hit.detail !== undefined ? { detail: hit.detail } : {})
      }))
    })
  }

  if (run.retried) {
    diagnostics.push({
      severity: 'info',
      code: 'cypher-undirected',
      message: 'The query found nothing as written, so it was run again with every relationship undirected.'
    })
  }

  return {
    interpretation: {
      description: `Read-only Cypher written by ${options.writtenBy} from the graph's schema and run in scope "${request.context.scope}"`,
      assumptions: [
        'A model wrote the query from the question: check that it asks what was meant.',
        'Rows, lists and counts cover what the graph holds for this scope - records captured in the canonical files - not anything never recorded.'
      ],
      nativeQuery: run.cypher
    },
    blocks,
    evidence,
    coverage: { mode, truncated: capped, scope: request.context.scope },
    diagnostics
  }
}

/** The relationships and paths among the rows, when they hold any, as a graph. */
const graphOf = (rows: readonly Cell[][], rowEvidence: readonly (string | undefined)[]): GraphBlock | undefined => {
  if (!rows.some((cells) => cells.some((cell) => cell.relationships.length > 0))) return undefined
  const nodes = new Map<string, GraphBlock['nodes'][number]>()
  const byElement = new Map<string, string>()
  const edges = new Map<string, GraphBlock['edges'][number]>()
  const paths: string[][] = []
  rows.forEach((cells, index) => {
    for (const node of cells.flatMap((cell) => cell.nodes)) {
      const id = nodeId(node)
      byElement.set(node.elementId, id)
      if (nodes.has(id)) continue
      const title = typeof node.properties.title === 'string' && node.properties.title !== '' ? node.properties.title : id
      nodes.set(id, {
        id,
        label: title,
        ...(typeof node.properties.type === 'string' ? { type: node.properties.type } : {}),
        ...(node.properties.stub === true ? {} : { ref: nodeRef(node) })
      })
    }
    for (const relationship of cells.flatMap((cell) => cell.relationships)) {
      const source = byElement.get(relationship.startNodeElementId)
      const target = byElement.get(relationship.endNodeElementId)
      if (source === undefined || target === undefined) continue
      const rel = typeof relationship.properties.rel === 'string' ? relationship.properties.rel : relationship.type.toLowerCase()
      const key = `${source}\u0000${rel}\u0000${target}`
      const evidenceId = rowEvidence[index]
      const known = edges.get(key)
      if (known) {
        if (evidenceId !== undefined && !known.evidenceIds?.includes(evidenceId)) known.evidenceIds = [...(known.evidenceIds ?? []), evidenceId]
      } else {
        edges.set(key, { source, target, rel, ...(evidenceId !== undefined ? { evidenceIds: [evidenceId] } : {}) })
      }
    }
    for (const path of cells.flatMap((cell) => cell.paths)) {
      paths.push([nodeId(path.start), ...path.segments.map((segment) => nodeId(segment.end))])
    }
  })
  if (edges.size === 0) return undefined
  return {
    kind: 'graph',
    id: 'graph',
    title: 'Relationships in the rows',
    evidenceIds: [],
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    ...(paths.length > 0 ? { paths } : {})
  }
}

/** Rows as an answer, with the documents they mention found first. */
export const cypherAnswer = async (
  port: CypherPort,
  chat: Chat,
  request: Pick<AskRequest, 'question' | 'context' | 'budget'>,
  options: { writtenBy: string; timeoutMs?: number }
): Promise<{ run: CypherRun; answer: AdapterAnswer }> => {
  const run = await runCypher(port, chat, request.question, {
    maxRows: Math.min(MAX_CYPHER_ROWS, request.budget.maxResults + 1),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  })
  const hits = await hitsOf(port, run.records)
  return { run, answer: rowsAnswer(port, { request, run, writtenBy: options.writtenBy, hits }) }
}
