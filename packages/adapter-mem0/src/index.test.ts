import { describe, expect, it } from 'vitest'

import mem0 from './index.js'

describe('mem0 adapter', () => {
  it('reads a hosted entry, with the key read from the environment', () => {
    expect(mem0.validateConfig({ type: 'mem0', mode: 'platform', scope: { userId: 'platform-team' } })).toEqual({
      type: 'mem0',
      mode: 'platform',
      apiKeyEnv: 'MEM0_API_KEY',
      scope: { userId: 'platform-team' }
    })
  })

  it("reads a self-hosted server entry, and passes an OSS entry's config through untouched", () => {
    expect(mem0.validateConfig({ type: 'mem0', mode: 'server', url: 'http://localhost:8888' })).toMatchObject({
      mode: 'server',
      apiKeyEnv: 'MEM0_API_KEY'
    })
    const config = { vectorStore: { provider: 'qdrant', config: { host: 'localhost', port: 6333 } } }
    expect(mem0.validateConfig({ type: 'mem0', mode: 'oss', config })).toEqual({ type: 'mem0', mode: 'oss', config })
  })

  it('rejects an entry without a mode or with an empty scope', () => {
    expect(() => mem0.validateConfig({ type: 'mem0' })).toThrow()
    expect(() => mem0.validateConfig({ type: 'mem0', mode: 'oss', scope: {} })).toThrow(
      /mem0 scope needs at least one of userId, agentId or runId/
    )
  })

  it('rejects an unfamiliar field in any mode rather than dropping it', () => {
    expect(() => mem0.validateConfig({ mode: 'platform', apiKey: 'secret' })).toThrow(/Unrecognized key: "apiKey"/)
    expect(() => mem0.validateConfig({ mode: 'server', url: 'http://localhost:8888', minscore: 0.2 })).toThrow(/Unrecognized key: "minscore"/)
    expect(() => mem0.validateConfig({ mode: 'oss', scope: { userId: 'u', user: 'v' } })).toThrow(/Unrecognized key: "user"/)
  })

  it('names itself and its contract major', () => {
    expect(mem0).toMatchObject({ apiVersion: 1, name: 'mem0' })
  })
})
