import { describe, expect, it } from 'vitest'

import { guardCypher, undirected } from './cypher-guard.js'

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
