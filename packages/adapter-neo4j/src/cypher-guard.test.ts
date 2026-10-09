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
    "MATCH (a:Memory {scope: $scope})<-[r:USES|:DEPENDS_ON {rel: 'uses'}]-(b) WHERE b.sources = ['code'] RETURN a, r, b",
    "MATCH (d:Memory:Deployment {scope: $scope}) WHERE d.title CONTAINS ',' RETURN count(d)",
    "MATCH (n:Memory) WHERE $scope = n.scope AND n.type = 'team' RETURN count(n)",
    'MATCH (s:Service {scope: $scope}) RETURN s.id AS id UNION MATCH (t:Team) WHERE t.scope = $scope RETURN t.id AS id',
    'MATCH (s:Memory {scope: $scope}) WITH DISTINCT s, count(*) AS n MATCH (s)-->(t) RETURN t, n',
    'MATCH (s:Memory {scope: $scope}) WITH * MATCH (s)-->(t) RETURN t',
    'MATCH (s:Memory {scope: $scope, type: $type}) WHERE (s)-[:USES]->(:Team) RETURN size([(s)-->(t) | t]) AS reach',
    'MATCH (s:Memory {scope: $scope}) WHERE EXISTS { MATCH (s)-->(t:Team) } RETURN COUNT { (s)-->() } AS links',
    'MATCH (n:Memory {scope: $scope}) WHERE n:Service OR n:Library RETURN count(n) + 1 AS score'
  ])('accepts a query anchored in scope: %s', (query) => {
    expect(scopeProblem(query)).toBeUndefined()
  })

  it.each([
    ['MATCH (s:Memory:Service) RETURN count(s)', /never binds \$scope/],
    ['MATCH (s:Memory {scope: $scope}), (d:Memory:Deployment) RETURN count(d)', /\(d:Memory:Deployment\) is not bound/],
    ['MATCH (s:Memory {scope: $scope}) MATCH (x)-[r]->(y) RETURN count(r)', /\(x\)-\[r\]->\(y\) is not bound/],
    ["MATCH (s:Memory) WHERE s.title = '$scope' RETURN s", /never binds \$scope/],
    ['MATCH (s:Service {scope: $scope}) RETURN s.id AS id UNION MATCH (s:Team) RETURN s.id AS id', /\(s:Team\) is not bound/],
    ["MATCH (n) WHERE n.scope = $scope OR n.type = 'team' RETURN count(n)", /\(n\) is not bound/],
    ['MATCH (n) WHERE NOT n.scope = $scope RETURN count(n)', /\(n\) is not bound/],
    ['MATCH (n) WITH count(n) AS total MATCH (m) WHERE m.scope = $scope RETURN total', /\(n\) is not bound/],
    ['MATCH (s:Memory {scope: $scope}) WITH count(s) AS mine MATCH (s:Team) RETURN count(s)', /\(s:Team\) is not bound/],
    ['MATCH (s:Memory {scope: $scope}) WITH 1 AS one MATCH (s) RETURN count(s)', /\(s\) is not bound/],
    ['MATCH (s:Memory {scope: $scope}) RETURN size([(t:Team) | t]) AS teams', /\(t:Team\) is not bound/],
    ['MATCH (s:Memory {scope: $scope}) RETURN COUNT { (t:Team) } AS teams', /\(t:Team\) is not bound/],
    ['MATCH (s:Memory {scope: $scope}) WHERE EXISTS { MATCH (t:Team) } RETURN s', /\(t:Team\).* is not bound/],
    ['MATCH (s:Memory {scope: $scope}) WHERE EXISTS { MATCH (s)-->(t) } MATCH (t) RETURN count(t)', /\(t\) is not bound/],
    ["MATCH (t:Team {scope: $scope + '-other'}) RETURN count(t)", /\(t:Team .*\) is not a plain node/],
    ['MATCH (s:Memory {scope: $scope}) RETURN COUNT { (t:Team|Service) } AS teams', /\(t:Team\|Service\) is not a plain node/],
    ['MATCH (s:Memory {scope: $scope}) RETURN size([(t:Memory|Team) | t.id]) AS ids', /\(t:Memory\|Team\) is not a plain node/],
    ["MATCH (s:Memory {scope: $scope}) RETURN COUNT { (t WHERE t.type = 'team') } AS n", /\(t WHERE .*is not a plain node/],
    ['MATCH (s:Memory {scope: $scope}) RETURN COUNT { (t:A&B) } AS n', /not a plain node/],
    ['MATCH (s:Memory {scope: $scope}) RETURN COUNT { (t:!Memory) } AS n', /not a plain node/],
    ['MATCH (s:Memory {scope: $scope}) RETURN COUNT { (t:%) } AS n', /not a plain node/],
    ['MATCH (s:Memory {scope: $scope}) RETURN COUNT { (t:`My Team`) } AS n', /backticked/],
    ['MATCH (s:Memory {scope: $scope}) MATCH (s)((a)-->(b)){1,3}(t) RETURN count(t)', /quantified pattern/],
    ['MATCH (s:Memory {scope: $scope}) RETURN COUNT { ((t:Team)-->(u)) } AS n', /not a plain node/],
    ['MATCH (s:Memory {scope: $scope}) RETURN COUNT { (t IS Team) } AS n', /\(t IS Team\) is not a plain node/],
    ['MATCH (s:Memory {scope: $scope}) RETURN size([(t IS Team) | t.id]) AS ids', /\(t IS Team\) is not a plain node/],
    ['MATCH (s:Memory {scope: $scope}) RETURN COUNT { (`t`:Team) } AS n', /backticked/],
    ['MATCH (s:Memory {scope: $scope}) RETURN COUNT { (/**/t:Team) } AS n', /comment/],
    ['MATCH (s:Memory {scope: $scope}) RETURN COUNT { (t /* x */ :Team) } AS n', /comment/],
    ['MATCH (t:Team) /* WHERE t.scope = $scope AND 1 = 1 */ RETURN count(t)', /comment/],
    ['MATCH (n:Memory {scope: $scope}) WHERE n.rank > 0 AND (n:Service OR n:Library) RETURN n', /\(n:Service OR n:Library\) is not a plain node/],
    ['MATCH (n:Memory {scope: $scope}) RETURN (count(n) + 1) * 2 AS score', /not a plain node/],
    ["MATCH (n:Memory) WHERE $scope = n.scope AND (n.type = 'team' OR n.type = 'service') RETURN count(n)", /not a plain node/],
    ["MATCH (t:Memory {type: coalesce('team', {scope: $scope})}) RETURN count(t)", /not a plain node/],
    ["MATCH (t:Memory {type: [(u {scope: $scope}) | 'team'][0]}) RETURN count(t)", /not a plain node/],
    ["MATCH (s:Memory {scope: $scope}) RETURN COUNT { (t:Memory {type: coalesce('team', {scope: $scope})}) } AS n", /not a plain node/],
    ['MATCH (t:Team)-[r {k: [(u {scope: $scope}) | 1][0]}]-(x) RETURN count(t)', /^\[r \{k: \[\(u \{scope: \$scope\}\) \| 1\] is not a plain relationship pattern$/],
    ['MATCH (t:Team)-[r:REL {k: size([(u {scope: $scope}) | 1])}]->() RETURN count(t)', /^\[r:REL \{k: size\(\[\(u \{scope: \$scope\}\) \| 1\] is not a plain relationship pattern$/]
  ])('rejects a pattern that could read another scope: %s', (query, reason) => {
    expect(scopeProblem(query)).toMatch(reason)
  })
})
