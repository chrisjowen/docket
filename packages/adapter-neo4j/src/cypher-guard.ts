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
const CLAUSE = /\b(OPTIONAL\s+MATCH|MATCH|WHERE|WITH|RETURN|UNWIND|ORDER\s+BY|LIMIT|SKIP)\b/gi

/** `UNION` starts a separate query, so each side is checked on its own. */
const UNION = /\bUNION(?:\s+ALL)?\b/i

/** A whole conjunct `n.scope = $scope` or `$scope = n.scope`. */
const SCOPE_EQUALITY = /^(?:([A-Za-z_]\w*)\.scope\s*=\s*\$scope|\$scope\s*=\s*([A-Za-z_]\w*)\.scope)$/

/** A value a node's property map may hold: a parameter, a (blanked) string, a number, true, false or null. */
const MAP_VALUE = String.raw`(?:\$\w+|''|-?\d+(?:\.\d+)?|true|false|null)`

/** A flat property map of `key: value` pairs; nothing nested, so its `}` is its own. */
const MAP = String.raw`\{\s*(?:\w+\s*:\s*${MAP_VALUE}\s*(?:,\s*\w+\s*:\s*${MAP_VALUE}\s*)*)?\}`

/** A node pattern: `(n)`, `(:Label)`, `(n:A:B {scope: $scope})`. */
const NODE = new RegExp(String.raw`\(\s*([A-Za-z_]\w*)?\s*((?::\s*\w+\s*)*)(${MAP})?\s*\)`, 'g')

/** A relationship's details: `[r:A|B*1..3 {map}]`, with no node or nested value inside. */
const RELATIONSHIP = String.raw`\[\s*(?:[A-Za-z_]\w*)?\s*(?::\s*\w+(?:\s*\|\s*:?\s*\w+)*)?\s*(?:\*\s*(?:\d+)?\s*(?:\.\.\s*(?:\d+)?)?)?\s*(?:${MAP})?\s*\]`

/** A quantified path or relationship: `{1,3}` or `+`/`*` after a pattern. */
const QUANTIFIER = /[->)]\s*\{\s*\d|[->]\s*[+*]/

/**
 * A pattern written as an expression - in a WHERE predicate, a pattern
 * comprehension or an EXISTS, COUNT or COLLECT subquery: nodes joined by
 * relationships, not following a name the way a function's arguments do.
 */
const PATTERN = new RegExp(`(?<![\\w$\`])${NODE.source}(?:\\s*<?-(?:${RELATIONSHIP})?->?\\s*${NODE.source})*`, 'g')

/** A property map that pins its node to exactly `$scope`. */
const SCOPE_PROPERTY = /[{,]\s*scope\s*:\s*\$scope\s*[,}]/

/** One projected item that carries a node through: `s` or `s AS alias`. */
const PROJECTED = /^([A-Za-z_]\w*)(?:\s+AS\s+([A-Za-z_]\w*))?$/i

/** Splits on `separator` outside brackets, braces and parentheses. */
const topLevel = (text: string, separator: RegExp = /,/y): string[] => {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') depth -= 1
    else if (depth === 0) {
      separator.lastIndex = index
      const found = separator.exec(text)
      if (found) {
        parts.push(text.slice(start, index))
        start = index + found[0].length
        index = start - 1
      }
    }
  }
  parts.push(text.slice(start))
  return parts.filter((part) => part.trim().length > 0)
}

/**
 * The variables a MATCH's WHERE pins to `$scope`. Only a top-level conjunct
 * counts: under OR, XOR or NOT the equality does not restrict every row.
 */
const scopedByWhere = (where: string): string[] => {
  const conjuncts = topLevel(where, /\bAND\b/iy)
  if (conjuncts.some((conjunct) => topLevel(conjunct, /\b(?:OR|XOR)\b/iy).length > 1)) return []
  return conjuncts.flatMap((conjunct) => {
    const match = SCOPE_EQUALITY.exec(conjunct.trim())
    return match ? [(match[1] ?? match[2]) as string] : []
  })
}

/**
 * A parenthesis the scope check cannot read, so it refuses rather than skip
 * it. Every `(` that does not call a function must be a plain
 * `(n:Label {map})` node: a label expression, `IS`, a backticked name, an
 * inline `(n WHERE ...)`, a parenthesised path or a parenthesised condition
 * is refused, as are comments and quantified paths. Every relationship's
 * `-[...]` must be plain too: a variable, types, a length and a flat map.
 */
const uncheckedNode = (code: string): string | undefined => {
  if (/\/\*|\/\/|`/.test(code)) return 'it has a comment or a backticked name'
  const quantified = QUANTIFIER.exec(code)
  if (quantified) return `the quantified pattern near ${code.slice(quantified.index, quantified.index + 20).trim()} cannot be checked`
  const node = new RegExp(NODE.source, 'y')
  for (let index = code.indexOf('('); index !== -1; index = code.indexOf('(', index + 1)) {
    if (/\w/.test(code[index - 1] ?? '')) continue
    node.lastIndex = index
    if (!node.test(code)) return `${code.slice(index, index + 40).split(')')[0]}) is not a plain node pattern`
  }
  const relationship = new RegExp(RELATIONSHIP, 'y')
  for (const arrow of code.matchAll(/-\s*\[/g)) {
    relationship.lastIndex = (arrow.index ?? 0) + arrow[0].length - 1
    if (!relationship.test(code)) {
      return `${code.slice(relationship.lastIndex, relationship.lastIndex + 40).split(']')[0]}] is not a plain relationship pattern`
    }
  }
  return undefined
}

/**
 * Why a query could read beyond `$scope`, or undefined when it cannot. Each
 * pattern a MATCH reads must be anchored in scope: one of its nodes carries
 * `{scope: $scope}`, is constrained by `n.scope = $scope` in that MATCH's
 * WHERE, or was bound by an earlier anchored pattern and carried through
 * every WITH since, in the same side of any UNION. Patterns written as
 * expressions, outside MATCH, must be anchored the same way. The projection
 * never links nodes across scopes, so everything an anchored pattern reaches
 * is in scope too.
 *
 * Run before the query, because dropping foreign rows afterwards cannot
 * correct a count or another aggregate taken over them.
 */
export const scopeProblem = (cypher: string): string | undefined => {
  const code = withoutStrings(cypher)
  if (!/\$scope\b/.test(code)) return 'it never binds $scope'
  const unchecked = uncheckedNode(code)
  if (unchecked) return unchecked
  for (const branch of code.split(UNION)) {
    const problem = branchScopeProblem(branch)
    if (problem) return problem
  }
  return undefined
}

/** Whether one of the pattern's nodes is pinned to `$scope` or already known to be in scope. */
const anchored = (pattern: string, scoped: Set<string>): boolean =>
  [...pattern.matchAll(NODE)].some(
    ([, variable, , properties]) =>
      (properties !== undefined && SCOPE_PROPERTY.test(properties)) || (variable !== undefined && scoped.has(variable))
  )

/** How many subquery braces enclose `index`; property maps open and close before it. */
const braceDepth = (code: string, index: number): number =>
  [...code.slice(0, index)].reduce((depth, char) => depth + (char === '{' ? 1 : char === '}' ? -1 : 0), 0)

/** The scoped variables a WITH or RETURN passes on; Cypher forgets the rest. */
const projected = (body: string, scoped: Set<string>): Set<string> => {
  const kept = new Set<string>()
  for (const item of topLevel(body.replace(/^\s*DISTINCT\b/i, ''))) {
    if (item.trim() === '*') return new Set(scoped)
    const match = PROJECTED.exec(item.trim())
    if (match && scoped.has(match[1] as string)) kept.add((match[2] ?? match[1]) as string)
  }
  return kept
}

const branchScopeProblem = (code: string): string | undefined => {
  let scoped = new Set<string>()
  const clauses = [...code.matchAll(CLAUSE)].map((clause, position, all) => ({
    keyword: (clause[1] ?? '').toUpperCase().replace(/\s+/g, ' '),
    body: code.slice((clause.index ?? 0) + clause[0].length, all[position + 1]?.index ?? code.length),
    nested: braceDepth(code, clause.index ?? 0) > 0
  }))
  for (const [position, { keyword, body, nested }] of clauses.entries()) {
    if (keyword !== 'MATCH' && keyword !== 'OPTIONAL MATCH') {
      for (const [pattern] of body.matchAll(PATTERN)) {
        if (!anchored(pattern, scoped)) return `the pattern ${pattern.trim()} is not bound to $scope`
      }
      if (!nested && (keyword === 'WITH' || keyword === 'RETURN')) scoped = projected(body, scoped)
      continue
    }
    const next = clauses[position + 1]
    const pinned = new Set([...scoped, ...(next?.keyword === 'WHERE' ? scopedByWhere(next.body) : [])])
    for (const pattern of topLevel(body)) {
      if (!anchored(pattern, pinned)) return `the pattern ${pattern.trim()} is not bound to $scope`
      for (const [, variable] of pattern.matchAll(NODE)) {
        if (variable === undefined) continue
        pinned.add(variable)
        if (!nested) scoped.add(variable)
      }
    }
  }
  return undefined
}
