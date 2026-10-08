import { describe, expect, it } from 'vitest'

import { guardCypher, scopeProblem, undirected } from './cypher-guard.js'

describe('guardCypher', () => {
  it('accepts a read query and caps its rows', () => {
    expect(guardCypher('MATCH (s:Memory {scope: $scope}) RETURN s', 20)).toBe(
      'MATCH (s:Memory {scope: $scope}) RETURN s\nLIMIT 20'
    )
  })

  it('keeps a smaller limit the query already has, and lowers a larger one', () => {
    expect(guardCypher('MATCH (s) RETURN s LIMIT 5', 20)).toBe('MATCH (s) RETURN s LIMIT 5')
    expect(guardCypher('MATCH (s) RETURN s LIMIT 500', 20)).toBe('MATCH (s) RETURN s LIMIT 20')
  })

  it('strips the code fences and trailing semicolon a model wraps it in', () => {
    expect(guardCypher('```cypher\nMATCH (s) RETURN s;\n```', 20)).toBe('MATCH (s) RETURN s\nLIMIT 20')
  })

  it.each([
    'MATCH (s) DETACH DELETE s',
    'CREATE (s:Memory) RETURN s',
    'MATCH (s) SET s.title = "x" RETURN s',
    'MATCH (s) REMOVE s.title RETURN s',
    'MERGE (s:Memory {id: "x"}) RETURN s',
    'CALL dbms.components()',
    'LOAD CSV FROM "file:///etc/passwd" AS row RETURN row',
    'MATCH (s) FOREACH (x IN [1] | SET s.a = x)',
    'DROP INDEX memory_text'
  ])('rejects anything that is not a plain read: %s', (query) => {
    expect(() => guardCypher(query, 20)).toThrow(/read-only/)
  })

  it('does not mistake a keyword inside a string for a clause', () => {
    expect(guardCypher("MATCH (s) WHERE s.title CONTAINS 'delete' RETURN s", 20)).toContain('CONTAINS')
  })

  it('rejects more than one statement, and an empty answer', () => {
    expect(() => guardCypher('MATCH (s) RETURN s; MATCH (t) RETURN t', 20)).toThrow(/one statement/)
    expect(() => guardCypher('  ', 20)).toThrow(/no query/)
  })

  it('rejects an answer that is not a query at all', () => {
    expect(() => guardCypher('I cannot answer that from the schema.', 20)).toThrow(/not a Cypher/)
  })

  it('makes every relationship undirected, for a retry when a model got the arrow backwards', () => {
    expect(undirected('MATCH (s)<-[:DEPLOYED_TO]-(e) RETURN s, e')).toBe('MATCH (s)-[:DEPLOYED_TO]-(e) RETURN s, e')
    expect(undirected('MATCH (a)-[r:USES]->(b)-->(c)<--(d) RETURN a')).toBe(
      'MATCH (a)-[r:USES]-(b)--(c)--(d) RETURN a'
    )
    expect(undirected("MATCH (s) WHERE s.title = 'a->b' RETURN s")).toBe("MATCH (s) WHERE s.title = 'a->b' RETURN s")
  })
})

describe('scopeProblem', () => {
  it.each([
    'MATCH (s:Memory:Service {scope: $scope})-[r:DEPENDS_ON]->(d:Memory) RETURN s, r, d',
    'MATCH (s:Memory {scope: $scope}) WITH s MATCH (s)-[r]->(t) RETURN count(t)',
    'MATCH (s:Memory) WHERE s.scope = $scope RETURN count(s) AS services',
    'MATCH (a:Memory {scope: $scope}), (b:Memory {scope: $scope}) RETURN a, b',
    'MATCH (s:Memory {scope: $scope}) WITH s AS service MATCH (service)-->(x) RETURN x',
    'MATCH p = (a:Memory {scope: $scope})-[*1..3]-(b) RETURN p',
    "MATCH (d:Memory:Deployment {scope: $scope}) WHERE d.title CONTAINS ',' RETURN count(d)"
  ])('accepts a query anchored in scope: %s', (query) => {
    expect(scopeProblem(query)).toBeUndefined()
  })

  it.each([
    ['MATCH (s:Memory:Service) RETURN count(s)', /never binds \$scope/],
    ['MATCH (s:Memory {scope: $scope}), (d:Memory:Deployment) RETURN count(d)', /\(d:Memory:Deployment\) is not bound/],
    ['MATCH (s:Memory {scope: $scope}) MATCH (x)-[r]->(y) RETURN count(r)', /\(x\)-\[r\]->\(y\) is not bound/],
    ["MATCH (s:Memory) WHERE s.title = '$scope' RETURN s", /never binds \$scope/]
  ])('rejects a pattern that could read another scope: %s', (query, reason) => {
    expect(scopeProblem(query)).toMatch(reason)
  })
})
