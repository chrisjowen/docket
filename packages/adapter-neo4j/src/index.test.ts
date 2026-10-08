import { describe, expect, it } from 'vitest'

import neo4j from './index.js'

describe('neo4j adapter', () => {
  it('reads every v1 neo4j projection entry, filling in its defaults', () => {
    expect(neo4j.validateConfig({ type: 'neo4j', url: 'neo4j+s://graph.example', scope: 'payments' })).toEqual({
      type: 'neo4j',
      url: 'neo4j+s://graph.example',
      username: 'neo4j',
      scope: 'payments'
    })
    expect(neo4j.validateConfig({ cypher: { model: 'qwen2.5:7b' } })).toEqual({
      type: 'neo4j',
      url: 'bolt://localhost:7687',
      username: 'neo4j',
      cypher: { provider: 'ollama', url: 'http://localhost:11434', model: 'qwen2.5:7b', timeoutMs: 60_000 }
    })
  })

  it('rejects another projection type and an invalid setting', () => {
    expect(() => neo4j.validateConfig({ type: 'jsonl' })).toThrow()
    expect(() => neo4j.validateConfig({ type: 'neo4j', scope: '' })).toThrow()
  })

  it('names itself and its contract major', () => {
    expect(neo4j).toMatchObject({ apiVersion: 1, name: 'neo4j' })
  })
})
