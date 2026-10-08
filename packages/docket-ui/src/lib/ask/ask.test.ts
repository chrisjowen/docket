import { validateAdapterAnswer } from '@docket/contracts'
import { describe, expect, it } from 'vitest'

import type { UiAnswer, UiChatAnswer, UiGraph } from '$lib/types.js'
import { createAskClient, readAdapters } from './client.js'
import { casebookOf, referenceLocation, standingOf } from './evidence.js'
import { FIXTURE_ADAPTERS, FIXTURE_ANSWER, GRAPH_ANSWER, LOCAL_ANSWER, RECALL_ANSWER } from './fixtures.js'
import { fromLegacyAnswer, fromLegacyChat, LEGACY_LIMIT } from './legacy.js'
import { compareMetrics, evidenceIndex, RESULT_KINDS, showAnswer, showOutcome, type AnsweredResult } from './outcome.js'

const LEGACY: UiAnswer = {
  query: 'orders',
  sources: [
    { name: 'jsonl', hits: [{ id: 'service.orders', score: 3 }, { id: 'datasource.orders-db', detail: 'body' }], note: 'keyword match' },
    { name: 'neo4j', hits: [], error: 'connect ECONNREFUSED 127.0.0.1:7687' }
  ],
  documents: [
    { id: 'service.orders', type: 'service', title: 'Orders', path: '.docket/resources/services/orders.md', foundBy: ['jsonl'] },
    { id: 'datasource.orders-db', type: 'datasource', title: 'Orders DB', path: '.docket/resources/datasources/orders-db.md', foundBy: ['jsonl'] }
  ],
  paths: [{ nodes: ['service.orders', 'datasource.orders-db'], steps: [{ rel: 'stored_in', forward: true }] }],
  diagnostics: [],
  index: { synced: true, behind: 2 }
}

const answered = (result: unknown): AnsweredResult => {
  expect(result).toMatchObject({ state: 'answered' })
  return result as AnsweredResult
}

describe('fixtures', () => {
  it('pass the contracts validators, between them covering every result kind', () => {
    for (const answer of [LOCAL_ANSWER, GRAPH_ANSWER]) expect(() => validateAdapterAnswer(answer)).not.toThrow()
    const kinds = new Set(
      FIXTURE_ANSWER.results.flatMap((result) => (result.state === 'answered' ? result.answer.blocks.map((block) => block.kind) : []))
    )
    for (const kind of RESULT_KINDS) expect(kinds).toContain(kind)
  })

  it('show every adapter, and set a newer contract’s block aside for the fallback rather than failing the answer', () => {
    const outcome = showOutcome(FIXTURE_ANSWER, 'coordinator')
    expect(outcome.results.map((result) => [result.adapter, result.state])).toEqual([
      ['local', 'answered'],
      ['enterprise-graph', 'answered'],
      ['company-memory', 'answered'],
      ['team-mem0', 'failed']
    ])
    const recall = answered(outcome.results[2])
    expect(recall.blocks.map((shown) => [shown.known, shown.block.kind])).toEqual([
      [true, 'facts'],
      [true, 'metric'],
      [false, 'heatmap']
    ])
    expect(recall.blocks[2]?.block).toMatchObject({ id: 'company-memory:heatmap', evidenceIds: ['company-memory:fact-2'] })
  })
})

describe('showAnswer', () => {
  it('fails only the adapter whose answer breaks the contract, naming the block it sent', () => {
    const broken = {
      ...RECALL_ANSWER,
      blocks: [{ kind: 'heatmap', id: 'h' }, { kind: 'passages', id: 'p', evidenceIds: ['nowhere'] }]
    }
    const result = showAnswer('company-memory', broken)
    expect(result).toMatchObject({ state: 'failed', error: { code: 'invalid-answer' } })
    expect(result.state === 'failed' && result.issues?.join('\n')).toContain('blocks.1.evidenceIds.0: no evidence has id "nowhere"')

    const outcome = showOutcome(
      { ...FIXTURE_ANSWER, results: [{ adapter: 'bad', state: 'answered', answer: broken }, FIXTURE_ANSWER.results[0]] },
      'coordinator'
    )
    expect(outcome.results.map((item) => item.state)).toEqual(['failed', 'answered'])
  })

  it('fails an answer whose unknown-kind block reuses another block’s id', () => {
    const [known] = RECALL_ANSWER.blocks
    const result = showAnswer('company-memory', { ...RECALL_ANSWER, blocks: [known, { kind: 'heatmap', id: known?.id }] })
    expect(result).toMatchObject({ state: 'failed', error: { code: 'invalid-answer' } })
    expect(result.state === 'failed' && result.issues).toEqual([`blocks: block id "${known?.id}" is used more than once`])
  })

  it('rejects values that are not plain JSON', () => {
    const result = showAnswer('local', { ...LOCAL_ANSWER, evidence: [{ ...LOCAL_ANSWER.evidence[0], observedAt: new Date() }] })
    expect(result.state).toBe('failed')
  })

  it('sets metrics that adapters disagree on side by side, with each one’s coverage', () => {
    const [comparison] = compareMetrics(showOutcome(FIXTURE_ANSWER, 'coordinator'))
    expect(comparison).toMatchObject({ label: 'Production deployments of service.orders', agree: false })
    expect(comparison?.readings.map((reading) => [reading.adapter, reading.value, reading.coverage])).toEqual([
      ['enterprise-graph', 3, 'exhaustive'],
      ['company-memory', 2, 'top-k']
    ])
  })

  it('indexes evidence across adapters by its namespaced id', () => {
    const index = evidenceIndex(showOutcome(FIXTURE_ANSWER, 'coordinator'))
    expect(index.get('enterprise-graph:ev-d2')?.adapter).toBe('enterprise-graph')
    expect(index.get('company-memory:fact-1')?.evidence.kind).toBe('derived-fact')
  })
})

describe('legacy answers', () => {
  it('become one entity block per source, keeping scores, details, failures and connecting paths', () => {
    const coordinated = fromLegacyAnswer(LEGACY, 'r1')
    const outcome = showOutcome(coordinated, 'legacy-ask')
    const jsonl = answered(outcome.results[0])
    expect(jsonl.answer.interpretation.description).toBe('keyword match')
    expect(jsonl.answer.coverage).toEqual({ mode: 'top-k', truncated: false, scope: 'default' })
    expect(jsonl.blocks[0]?.block).toMatchObject({
      kind: 'entities',
      entities: [{ ref: { kind: 'entity', id: 'service.orders' }, score: 3 }, { ref: { id: 'datasource.orders-db' }, detail: 'body' }]
    })
    expect(outcome.results[1]).toMatchObject({ adapter: 'neo4j', state: 'failed', error: { message: 'connect ECONNREFUSED 127.0.0.1:7687' } })
    expect(outcome.connections).toEqual(LEGACY.paths)
    expect(outcome.diagnostics[0]).toMatchObject({ code: 'index-behind' })
  })

  it('say a full page of hits may have been cut short', () => {
    const hits = Array.from({ length: LEGACY_LIMIT }, (_, index) => ({ id: `service.s${index}` }))
    const coordinated = fromLegacyAnswer({ ...LEGACY, sources: [{ name: 'jsonl', hits }] }, 'r')
    const result = coordinated.results[0]
    expect(result?.state === 'answered' && result.answer.coverage.truncated).toBe(true)
  })

  it('carry a chat summary as the synthesis, and a missing one as the notice', () => {
    const reply: UiChatAnswer = {
      query: 'orders',
      answer: LEGACY,
      summary: { text: 'See [service.orders].', cited: ['service.orders'], model: 'claude', cached: true, createdAt: '2026-10-01T00:00:00Z' },
      notice: undefined
    }
    expect(fromLegacyChat(reply, 'r').synthesis).toMatchObject({ citedEntities: ['service.orders'], model: 'claude', cached: true })
    const failed = fromLegacyChat({ ...reply, summary: null, notice: { reason: 'failed', message: 'model down' } }, 'r')
    expect(failed).toMatchObject({ synthesis: null, notice: { reason: 'failed' } })
  })
})

const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('createAskClient', () => {
  it('asks the coordinator with the question, adapters and synthesis choice', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const client = createAskClient(async (url, init) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) })
      return reply(200, FIXTURE_ANSWER)
    })
    const outcome = await client.ask({ question: 'how many?', adapters: ['local'], synthesis: false, requestId: 'r9' })
    expect(outcome.via).toBe('coordinator')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ requestId: 'r9', question: 'how many?', adapters: ['local'], synthesis: false })
  })

  it('falls back to the legacy endpoints when there is no coordinator, and stops trying it', async () => {
    const urls: string[] = []
    const client = createAskClient(async (url, init) => {
      urls.push(`${init?.method ?? 'GET'} ${String(url)}`)
      if (init?.method === 'POST') return new Response(null, { status: 405 })
      if (String(url).startsWith('/api/chat')) return reply(200, { query: 'orders', answer: LEGACY, summary: null, notice: { reason: 'unconfigured', message: 'no model' } })
      return reply(200, LEGACY)
    })
    expect((await client.ask({ question: 'orders', synthesis: false })).via).toBe('legacy-ask')
    expect((await client.ask({ question: 'orders', synthesis: true })).via).toBe('legacy-chat')
    expect(urls).toEqual([
      'POST /api/ask',
      `GET /api/ask?q=orders&limit=${LEGACY_LIMIT}`,
      `GET /api/chat?q=orders&limit=${LEGACY_LIMIT}`
    ])
  })

  it('surfaces the server’s error message', async () => {
    const client = createAskClient(async () => reply(500, { error: 'coordinator exploded' }))
    await expect(client.ask({ question: 'x', synthesis: false })).rejects.toThrow('coordinator exploded')
  })

  it('reports adapters as unavailable when the server has no adapter API', async () => {
    const client = createAskClient(async () => reply(404, { error: 'No API at /api/adapters' }))
    expect(await client.adapters()).toMatchObject({ state: 'unavailable' })
  })

  it('keeps adapter status only when it passes the contract', async () => {
    const response = readAdapters({
      ...FIXTURE_ADAPTERS,
      adapters: [{ ...FIXTURE_ADAPTERS.adapters[0], status: { state: 'fine', message: 'ok' } }]
    })
    expect(response.adapters[0]?.status).toBeUndefined()
    expect(response.adapters[0]?.statusError).toContain('status')
    expect(readAdapters(FIXTURE_ADAPTERS).adapters.map((item) => item.status?.state)).toEqual(['ready', 'connected', 'degraded', 'unavailable'])
  })
})

describe('evidence standing', () => {
  const graph = {
    entities: [{ id: 'decision.orders-on-postgres', paths: ['.docket/decisions/orders-on-postgres.md'] }]
  } as unknown as UiGraph
  const casebook = casebookOf(graph)
  const index = evidenceIndex(showOutcome(FIXTURE_ANSWER, 'coordinator'))
  const standing = (id: string) => {
    const item = index.get(id)
    if (!item) throw new Error(`no ${id}`)
    return standingOf(item.evidence, casebook)
  }

  it('tells canonical evidence from derived, and resolved from unresolved', () => {
    expect(standing('local:ev-decision')).toBe('canonical')
    expect(standing('company-memory:fact-1')).toBe('derived')
    expect(standing('company-memory:fact-2')).toBe('derived-unresolved')
    expect(standing('enterprise-graph:ev-d1')).toBe('unresolved')
  })

  it('writes a location with its lines and revision', () => {
    expect(
      referenceLocation({ kind: 'entity', id: 'x', revision: 'r1', span: { path: 'a.md', startLine: 3, endLine: 9 } })
    ).toBe('a.md:3-9 @ r1')
    expect(referenceLocation({ kind: 'entity', id: 'service.orders' })).toBe('service.orders')
  })
})
