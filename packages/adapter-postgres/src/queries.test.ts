import { describe, expect, it } from 'vitest'

import { pathsQuery, semanticQuery } from './queries.js'

describe('queries', () => {
  it('rejects a non-integer or non-positive embedding dimension count', () => {
    expect(() => semanticQuery('"docket_index"', 1.5)).toThrow()
    expect(() => semanticQuery('"docket_index"', 0)).toThrow()
    expect(() => semanticQuery('"docket_index"', -1)).toThrow()
  })

  it('rejects a hop count outside 1 to 2', () => {
    expect(() => pathsQuery('"docket_index"', 0)).toThrow(/1 to 2 hops/)
    expect(() => pathsQuery('"docket_index"', 3)).toThrow(/1 to 2 hops/)
  })
})
