/**
 * Checks a model-written Cypher query before it runs. It is also run in a read
 * transaction, which Neo4j itself refuses to write in; this is the first line,
 * so a bad answer fails with a clear reason instead of a database error.
 */

/** Clauses that write, reach outside the graph, or call procedures. */
const FORBIDDEN =
  /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|LOAD|FOREACH|CALL|ALTER|GRANT|DENY|REVOKE|USE|TERMINATE|START|STOP)\b/i

/** A query has to begin with a reading clause. */
const READING_START = /^(MATCH|OPTIONAL\s+MATCH|WITH|UNWIND|RETURN)\b/i

const STRING_LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g

/** String literals are data, not clauses: blank them before looking for keywords. */
const withoutStrings = (cypher: string): string => cypher.replace(STRING_LITERAL, "''")

/**
 * The same query with every relationship undirected. Small models often get
 * an arrow backwards; a retry that ignores direction still only reads what
 * the model asked about. String literals are left as they are.
 */
export const undirected = (cypher: string): string => {
  let result = ''
  let last = 0
  const relax = (code: string) =>
    code.replace(/<-\[/g, '-[').replace(/\]->/g, ']-').replace(/-->/g, '--').replace(/<--/g, '--')
  for (const literal of cypher.matchAll(STRING_LITERAL)) {
    result += relax(cypher.slice(last, literal.index)) + literal[0]
    last = (literal.index ?? 0) + literal[0].length
  }
  return result + relax(cypher.slice(last))
}

/** Returns the query, cleaned and with its rows capped at `maxRows`, or throws why it cannot run. */
export const guardCypher = (answer: string, maxRows: number): string => {
  const cypher = answer
    .replace(/^\s*```[a-z]*\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
    .replace(/;\s*$/, '')
    .trim()
  if (!cypher) throw new Error('The model returned no query.')

  const code = withoutStrings(cypher)
  if (code.includes(';')) throw new Error('The model returned more than one statement; one statement is allowed.')
  const forbidden = FORBIDDEN.exec(code)
  if (forbidden) throw new Error(`The model's query uses ${forbidden[1]?.toUpperCase()}; only read-only queries run.`)
  if (!READING_START.test(code)) throw new Error(`The model's answer is not a Cypher read query: ${cypher.slice(0, 80)}`)

  const limit = /\bLIMIT\s+(\d+)\s*$/i.exec(cypher)
  if (!limit) return `${cypher}\nLIMIT ${maxRows}`
  return Number(limit[1]) > maxRows ? cypher.replace(/\bLIMIT\s+\d+\s*$/i, `LIMIT ${maxRows}`) : cypher
}
