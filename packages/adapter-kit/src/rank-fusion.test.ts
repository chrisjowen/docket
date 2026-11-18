import { describe, expect, it } from 'vitest'

import { fuseRankings, RRF_K } from './rank-fusion.js'

describe('fuseRankings', () => {
  it('ranks what both lists found above what one found, keeping the first list\'s fields', () => {
    const lexical = [
      { id: 'a', score: 9, from: 'lexical' },
      { id: 'b', score: 5, from: 'lexical' }
    ]
    const semantic = [
      { id: 'b', score: 0.9, from: 'semantic' },
      { id: 'c', score: 0.8, from: 'semantic' }
    ]
    expect(fuseRankings([lexical, semantic], 10)).toEqual([
      { id: 'b', score: 1 / (RRF_K + 2) + 1 / (RRF_K + 1), from: 'lexical' },
      { id: 'a', score: 1 / (RRF_K + 1), from: 'lexical' },
      { id: 'c', score: 1 / (RRF_K + 2), from: 'semantic' }
    ])
  })

  it('breaks ties by id and keeps at most the limit', () => {
    expect(fuseRankings([[{ id: 'z', score: 1 }], [{ id: 'y', score: 1 }]], 1)).toEqual([{ id: 'y', score: 1 / (RRF_K + 1) }])
  })
})
