import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdapterServices, AskRequest, ChatMessage, ModelClient } from '@docket/contracts'

/** What the fake driver was asked to read, in order. */
const reads: string[] = []

vi.mock('neo4j-driver', async (importOriginal) => {
  const actual = (await importOriginal<typeof import('neo4j-driver')>()).default
  const row = new actual.types.Record(['id'], ['service.orders'])
  const driver = {
    verifyConnectivity: async () => undefined,
    executeQuery: async () => ({ records: [] }),
    session: () => ({
      executeRead: async (work: (tx: { run: (cypher: string) => Promise<{ records: unknown[] }> }) => Promise<unknown>) =>
        work({
          run: async (cypher) => {
            reads.push(cypher)
            return { records: [row] }
          }
        }),
      close: async () => undefined
    }),
    close: async () => undefined
  }
  return { default: { ...actual, driver: () => driver } }
})

const { default: neo4j } = await import('./index.js')

const WRITTEN = 'MATCH (s:Memory:Service {scope: $scope}) RETURN s.id AS id'

/** Chooses no template, so it is asked to write the query, and writes `WRITTEN`. */
const fakeModel = () => {
  const asked: ChatMessage[][] = []
  const model: ModelClient = {
    chat: async (messages) => {
      asked.push(messages)
      return messages[0]?.content.includes('hand-written queries') ? '{"intent": "none"}' : WRITTEN
    }
  }
  return { model, asked }
}

const services = (models?: AdapterServices['models']): AdapterServices => ({
  projectRoot: '/project',
  stateRoot: '/project/.docket/.index/adapters/graph',
  scope: 'default',
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  canonical: { get: async () => undefined, list: async () => [] },
  secrets: { getEnv: async () => undefined },
  ...(models ? { models } : {})
})

const request = (): AskRequest => ({
  requestId: 'request-1',
  question: 'Which services are there?',
  context: { scope: 'payments', now: '2026-11-03T00:00:00.000Z', timezone: 'UTC' },
  budget: { maxResults: 10, maxEvidenceBytes: 100_000, deadline: new Date(Date.now() + 60_000).toISOString() }
}) as AskRequest

beforeEach(() => {
  reads.length = 0
})

describe('neo4j models', () => {
  it('neo4j uses services.models.cypher when config.cypher is unset', async () => {
    const { model, asked } = fakeModel()
    const adapter = await neo4j.create(neo4j.validateConfig({ scope: 'payments' }), services({ cypher: model }))

    const answer = await adapter.query!.ask(request())

    // First to choose a template, then, as it chose none, to write the query.
    expect(asked).toHaveLength(2)
    for (const messages of asked) {
      expect(messages.map((message) => message.role)).toEqual(['system', 'user'])
      expect(messages[1]?.content).toContain('Which services are there?')
    }
    // The model's query ran as the guard left it: read-only, scoped, and limited to one more row than asked for.
    expect(reads).toEqual([`${WRITTEN}\nLIMIT 11`])
    expect(answer.interpretation.nativeQuery).toBe(`${WRITTEN}\nLIMIT 11`)
    expect(answer.coverage.unverifiedQuery).toEqual({ text: `${WRITTEN}\nLIMIT 11`, writtenBy: 'a model', undirectedRetry: false })
    expect(answer.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'template-unfitted' })]))
    expect(answer.diagnostics ?? []).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'cypher-fallback' })]))
    await adapter.close()
  })

  it('keeps its own configured model over the one docket offers', async () => {
    const { model, asked } = fakeModel()
    const config = neo4j.validateConfig({ scope: 'payments', cypher: { model: 'qwen2.5:7b', url: 'http://127.0.0.1:9', timeoutMs: 2_000 } })
    const adapter = await neo4j.create(config, services({ cypher: model }))

    const answer = await adapter.query!.ask(request())

    expect(asked).toEqual([])
    // Its own model is unreachable here, so it answers with full-text matches instead.
    expect(answer.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'cypher-fallback' })]))
    await adapter.close()
  })

  it('writes no Cypher when neither is there', async () => {
    const adapter = await neo4j.create(neo4j.validateConfig({ scope: 'payments' }), services())
    const answer = await adapter.query!.ask(request())

    expect(reads).toHaveLength(1)
    expect(reads[0]).not.toBe(`${WRITTEN}\nLIMIT 11`)
    expect(answer.diagnostics ?? []).toEqual([])
    await adapter.close()
  })
})
