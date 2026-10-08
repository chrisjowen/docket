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

/** Where a pattern clause ends: the next clause, or the end of the query. */
const CLAUSE = /\b(OPTIONAL\s+MATCH|MATCH|WHERE|WITH|RETURN|UNWIND|ORDER\s+BY|LIMIT|SKIP|UNION)\b/gi

/** A node pattern: `(n)`, `(:Label)`, `(n:A:B {scope: $scope})`. */
const NODE = /\(\s*([A-Za-z_]\w*)?\s*((?::\s*`?\w+`?\s*)*)(\{[^}]*\})?\s*\)/g

/** Splits on commas outside brackets, braces and parentheses. */
const topLevel = (text: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts.filter((part) => part.trim().length > 0)
}

/**
 * Why a query could read beyond `$scope`, or undefined when it cannot. Each
 * pattern a MATCH reads must be anchored in scope: one of its nodes carries
 * `{scope: $scope}`, is constrained by `n.scope = $scope`, or was bound by an
 * earlier anchored pattern. The projection never links nodes across scopes,
 * so everything an anchored pattern reaches is in scope too.
 *
 * Run before the query, because dropping foreign rows afterwards cannot
 * correct a count or another aggregate taken over them.
 */
export const scopeProblem = (cypher: string): string | undefined => {
  const code = withoutStrings(cypher)
  if (!/\$scope\b/.test(code)) return 'it never binds $scope'

  const scoped = new Set<string>()
  for (const match of code.matchAll(/\b([A-Za-z_]\w*)\.scope\s*=\s*\$scope\b|\$scope\s*=\s*([A-Za-z_]\w*)\.scope\b/g)) {
    scoped.add((match[1] ?? match[2]) as string)
  }

  const clauses = [...code.matchAll(CLAUSE)]
  for (const [position, clause] of clauses.entries()) {
    const keyword = (clause[1] ?? '').toUpperCase().replace(/\s+/g, ' ')
    const end = clauses[position + 1]?.index ?? code.length
    const body = code.slice((clause.index ?? 0) + clause[0].length, end)
    if (keyword === 'WITH' || keyword === 'RETURN') {
      // `WITH s AS service` carries s's scope over to the alias.
      for (const alias of body.matchAll(/\b([A-Za-z_]\w*)\s+AS\s+([A-Za-z_]\w*)/gi)) {
        if (scoped.has(alias[1] as string)) scoped.add(alias[2] as string)
      }
      continue
    }
    if (keyword !== 'MATCH' && keyword !== 'OPTIONAL MATCH') continue
    for (const pattern of topLevel(body)) {
      const nodes = [...pattern.matchAll(NODE)]
      const anchored = nodes.some(
        ([, variable, , properties]) =>
          (properties !== undefined && /\bscope\s*:\s*\$scope\b/.test(properties)) ||
          (variable !== undefined && scoped.has(variable))
      )
      if (!anchored) return `the pattern ${pattern.trim()} is not bound to $scope`
      for (const [, variable] of nodes) if (variable !== undefined) scoped.add(variable)
    }
  }
  return undefined
}
