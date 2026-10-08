import type { Node, Path, Record as Neo4jRecord, Relationship } from 'neo4j-driver'

import type { Chat, SearchHit } from '@docket/adapter-kit'

import { guardCypher, undirected } from './cypher-guard.js'
import { buildCypherPrompt, type GraphSchema } from './cypher-prompt.js'

/** Rows a generated query may return. Enough to answer, not enough to dump the graph. */
export const MAX_CYPHER_ROWS = 50

/** What Cypher search needs from the graph, bound to one scope. */
export interface CypherPort {
  scope: string
  schema(): Promise<GraphSchema>
  /** Runs `cypher` in a read transaction with `$scope` bound. */
  read(cypher: string): Promise<Neo4jRecord[]>
  /** Which of `ids` are documents (not stubs) in this scope. */
  documentIds(ids: readonly string[]): Promise<Set<string>>
  isNode(value: unknown): value is Node
  isRelationship(value: unknown): value is Relationship
  isPath(value: unknown): value is Path
}

export interface CypherAnswer {
  cypher: string
  hits: SearchHit[]
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
 * Has the model write a query for `question` against this graph's schema,
 * runs it read-only, and turns the rows into hits: every document a row
 * mentions, as a node or as its id, with the rows as the evidence.
 *
 * Nodes from other scopes are dropped whatever the query matched, so a model
 * that forgets `$scope` can over-fetch but never leak another repository.
 */
export const cypherSearch = async (
  port: CypherPort,
  chat: Chat,
  question: string
): Promise<CypherAnswer> => {
  const written = guardCypher(await chat(buildCypherPrompt(question, await port.schema())), MAX_CYPHER_ROWS)
  let cypher = written
  let records = await port.read(cypher)
  if (records.length === 0 && undirected(written) !== written) {
    cypher = undirected(written)
    records = await port.read(cypher)
  }
  const rows = records.map((record) => record.keys.flatMap((key) => flatten(port, record.get(key))))

  const candidates = rows.flatMap((values) => values.filter((v): v is string => typeof v === 'string'))
  const documents = await port.documentIds([...new Set(candidates)])

  const order: string[] = []
  const evidence = new Map<string, string[]>()
  for (const values of rows) {
    const names = new Map<string, string>()
    const ids: string[] = []
    const parts: string[] = []
    for (const value of values) {
      if (port.isNode(value)) {
        if (value.properties.scope !== port.scope) continue
        const id = String(value.properties.id)
        names.set(value.elementId, id)
        if (value.properties.stub !== true) ids.push(id)
        parts.push(id)
      } else if (typeof value === 'string') {
        if (documents.has(value)) ids.push(value)
        parts.push(value)
      } else if (value !== null && !port.isRelationship(value)) {
        parts.push(String(value))
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

  return {
    cypher,
    hits: order.map((id) => {
      const detail = (evidence.get(id) ?? []).join('; ')
      return detail ? { id, detail } : { id }
    })
  }
}
