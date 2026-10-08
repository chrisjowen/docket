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

  it("takes the connection URI as uri, the driver's name for it, or url, as v1 did - not both", () => {
    expect(neo4j.validateConfig({ uri: 'neo4j+s://graph.example', database: 'project-memory', passwordEnv: 'P' })).toEqual({
      type: 'neo4j',
      url: 'neo4j+s://graph.example',
      database: 'project-memory',
      username: 'neo4j',
      passwordEnv: 'P'
    })
    expect(() => neo4j.validateConfig({ uri: 'bolt://a', url: 'bolt://b' })).toThrow(/set uri or url, not both/)
  })

  it('rejects an unfamiliar field rather than dropping it, naming the field but never echoing its value', () => {
    expect(() => neo4j.validateConfig({ uri: 'bolt://graph', password: 'hunter2' })).toThrow(/Unrecognized key: "password"/)
    expect(() => neo4j.validateConfig({ uri: 'bolt://graph', password: 'hunter2' })).not.toThrow(/hunter2/)
    expect(() => neo4j.validateConfig({ cypher: { model: 'm', modle: 'n' } })).toThrow(/Unrecognized key: "modle"/)
  })

  it('names itself and its contract major', () => {
    expect(neo4j).toMatchObject({ apiVersion: 1, name: 'neo4j' })
  })
})
