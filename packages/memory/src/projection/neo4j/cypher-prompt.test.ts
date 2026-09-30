import { describe, expect, it } from 'vitest'

import { buildCypherPrompt } from './cypher-prompt.js'

const SCHEMA = {
  labels: [
    { label: 'Service', count: 2 },
    { label: 'Environment', count: 2 }
  ],
  patterns: [{ from: 'Service', type: 'DEPLOYED_TO', to: 'Environment', count: 4 }]
}

describe('buildCypherPrompt', () => {
  const prompt = buildCypherPrompt('what is actually deployed?', SCHEMA)

  it('describes the graph this repository actually has', () => {
    expect(prompt.user).toContain(':Memory:Service (2 nodes)')
    expect(prompt.user).toContain('(:Service)-[:DEPLOYED_TO]->(:Environment) (4)')
  })

  it('asks for one read-only query scoped with $scope', () => {
    expect(prompt.system).toMatch(/one read-only Cypher query/)
    expect(prompt.system).toContain('{scope: $scope}')
    expect(prompt.system).toMatch(/only the query/i)
  })

  it('tells the model to read past typos and map loose words onto the labels', () => {
    expect(prompt.system).toMatch(/spelling/i)
    expect(prompt.system).toMatch(/not a label[\s\S]*labels that fit/i)
  })

  it('tells the model that names in a question are partial', () => {
    expect(prompt.system).toMatch(/never match a title or id exactly/i)
  })

  it('ends with the question', () => {
    expect(prompt.user.trimEnd().endsWith('Question: what is actually deployed?')).toBe(true)
  })

  it('says so when the graph is empty rather than inventing a schema', () => {
    expect(buildCypherPrompt('x', { labels: [], patterns: [] }).user).toContain('(no nodes yet)')
  })
})
