import { describe, expect, it } from 'vitest'

import { lexicalQuery, pathsQuery, semanticQuery } from './queries.js'

describe('queries', () => {
  it('write only a validated schema and integers into SQL; every other value is a parameter', () => {
    expect(lexicalQuery('"docket_index"', true)).toContain('websearch_to_tsquery($2::regconfig, $3)')
    expect(lexicalQuery('"docket_index"', false)).not.toContain('%')
    // Inlined, the idfs would be counted again for every entity they score.
    expect(lexicalQuery('"docket_index"', true)).toContain('terms AS MATERIALIZED')
    expect(semanticQuery('"docket_index"', 768)).toContain('vector(768)')
    expect(() => semanticQuery('"docket_index"', 1.5)).toThrow()
    expect(pathsQuery('"docket_index"', 2)).toContain('cardinality(w.nodes) <= 2')
    expect(() => pathsQuery('"docket_index"', 3)).toThrow(/1 to 2 hops/)
  })
})
