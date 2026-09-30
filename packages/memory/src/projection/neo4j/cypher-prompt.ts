/** What the graph holds for one scope, read from Neo4j itself so the prompt never goes stale. */
export interface GraphSchema {
  labels: { label: string; count: number }[]
  patterns: { from: string; type: string; to: string; count: number }[]
}

export interface CypherPrompt {
  system: string
  user: string
}

const SYSTEM = `You translate questions about a software project's knowledge graph into one read-only Cypher query for Neo4j 5.

Rules:
- Answer with only the query: no explanation, no code fences.
- Every node pattern must carry {scope: $scope}, e.g. (s:Memory:Service {scope: $scope}).
- Use only MATCH, OPTIONAL MATCH, WHERE, WITH, UNWIND, RETURN, ORDER BY and LIMIT.
- Return whole nodes and relationships (RETURN s, r, e), not just their properties.
- Nodes with stub = true are links to documents that do not exist yet; leave them out unless asked.
- Labels and relationship types are case-sensitive: use them exactly as the schema lists them.
- Relationships point the way the schema lists them: (:From)-[:TYPE]->(:To).
- The question may have spelling mistakes: read it as the words it was meant to be.
- If the question names a kind of thing that is not a label (e.g. "technologies", "tools"),
  match the labels that fit it best, together: (n:Memory {scope: $scope}) WHERE n:Service OR n:Library.
- For words that are not a label or relationship, match text:
  WHERE toLower(n.title) CONTAINS 'word' OR toLower(n.content) CONTAINS 'word'.
- Never match a title or id exactly ({title: 'api'} finds nothing): names in a question are
  partial, so use WHERE toLower(n.id) CONTAINS 'api' OR toLower(n.title) CONTAINS 'api'.

Properties on every node: id, type, title, path, content, tags (space-separated), attributes (JSON string), stub.
Properties on every relationship: rel (its name as written, e.g. depends_on) plus its attributes.

Examples:
Q: which services depend on a datasource?
MATCH (s:Memory:Service {scope: $scope})-[r:DEPENDS_ON]->(d:Memory:Datasource {scope: $scope}) RETURN s, r, d
Q: list the decisions
MATCH (d:Memory:Decision {scope: $scope}) RETURN d
Q: what does the orders api depend on?
MATCH (s:Memory {scope: $scope})-[r:DEPENDS_ON]->(d:Memory {scope: $scope}) WHERE toLower(s.id) CONTAINS 'api' OR toLower(s.title) CONTAINS 'api' RETURN s, r, d
Q: what uses the object storage?
MATCH (n:Memory {scope: $scope})-[r:USES]->(o:Memory {scope: $scope}) WHERE toLower(o.title) CONTAINS 'object storage' RETURN n, r, o`

/** The prompt that turns `question` into Cypher against this graph's schema. */
export const buildCypherPrompt = (question: string, schema: GraphSchema): CypherPrompt => {
  const labels =
    schema.labels.length === 0
      ? ['(no nodes yet)']
      : schema.labels.map(({ label, count }) => `:Memory:${label} (${count} nodes)`)
  const patterns = schema.patterns.map(
    ({ from, type, to, count }) => `(:${from})-[:${type}]->(:${to}) (${count})`
  )

  return {
    system: SYSTEM,
    user: [
      'Node labels (every node also has :Memory):',
      ...labels.map((line) => `- ${line}`),
      '',
      'Relationships:',
      ...(patterns.length === 0 ? ['- (none yet)'] : patterns.map((line) => `- ${line}`)),
      '',
      `Question: ${question}`
    ].join('\n')
  }
}
