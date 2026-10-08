import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateAdapterAnswer, validateAdapterDescription, validateAdapterStatus, type MetricBlock, type TableBlock } from '@docket/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { init } from '../commands/init.js'
import { sync } from '../commands/sync.js'
import type { AdaptersResponse, CoordinatedAnswer, EvidenceResponse } from '../query/wire.js'
import { startUiServer, type UiServer } from './server.js'

const FAKE_GRAPH = fileURLToPath(new URL('../../test/fixtures/adapters/fake-graph.mjs', import.meta.url))

const ORDERS = `---
id: service.orders
type: service
title: Orders API
links:
  - rel: owned_by
    target: team.payments
---

Handles orders for checkout.
`

const PAYMENTS = `---
id: team.payments
type: team
title: Payments
---

The payments team owns checkout money movement.
`

let root: string
let server: UiServer | undefined

const write = async (path: string, contents: string): Promise<void> => {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

const configure = (graph: string, query = ''): Promise<void> =>
  write(
    join(root, '.docket.yaml'),
    `version: 2
adapters:
  - id: local
    module: "@docket/adapter-jsonl"
    config: { output: .docket/.index }
  - id: graph
    module: ./tools/fake-graph.mjs
    roles: [query]
    config: ${graph}
query:
  synthesis: false
${query}`
  )

const post = (path: string, body: unknown, init: RequestInit = {}): Promise<Response> =>
  fetch(new URL(path, server?.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...init
  })

const ask = async (body: unknown): Promise<CoordinatedAnswer> => {
  const response = await post('/api/ask', body)
  expect(response.status).toBe(200)
  return (await response.json()) as CoordinatedAnswer
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-api-'))
  await init({ cwd: root })
  await mkdir(join(root, 'tools'), { recursive: true })
  await copyFile(FAKE_GRAPH, join(root, 'tools', 'fake-graph.mjs'))
  await configure('{}')
  await write(join(root, '.docket/resources/services/orders.md'), ORDERS)
  await write(join(root, '.docket/resources/teams/payments.md'), PAYMENTS)
  await sync({ cwd: root })
  server = await startUiServer({ cwd: root, uiDir: join(root, 'ui'), port: 0 })
})

afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(root, { recursive: true, force: true })
})

describe('POST /api/ask', () => {
  it('answers through the coordinator: every adapter, its blocks kept, ids namespaced, evidence checked', async () => {
    const response = await post('/api/ask', { question: 'checkout', requestId: 'req-1', timezone: 'Asia/Singapore' })
    expect(response.headers.get('x-request-id')).toBe('req-1')
    const answer = (await response.json()) as CoordinatedAnswer

    expect(answer).toMatchObject({
      requestId: 'req-1',
      question: 'checkout',
      context: { scope: 'default', timezone: 'Asia/Singapore', now: expect.any(String), deadline: expect.any(String) },
      synthesis: null,
      notice: { reason: 'disabled' }
    })
    expect(answer.results.map((result) => [result.adapter, result.state])).toEqual([
      ['local', 'answered'],
      ['graph', 'answered']
    ])
    for (const result of answer.results) {
      if (result.state === 'answered') expect(validateAdapterAnswer(result.answer)).toEqual(result.answer)
    }

    const local = answer.results[0]
    if (local?.state !== 'answered') throw new Error('local did not answer')
    expect(local.answer.blocks.map((block) => block.kind)).toEqual(['entities', 'passages'])
    expect(local.answer.evidence.every((item) => item.id.startsWith('local:'))).toBe(true)
    expect(Object.values(local.references ?? {}).flat()).toEqual(['resolved', 'resolved'])
    expect(local.freshness).toMatchObject({ state: 'current', behind: 0 })

    const graph = answer.results[1]
    if (graph?.state !== 'answered') throw new Error('graph did not answer')
    // A count stays a count - it does not collapse into document hits.
    expect(graph.answer.blocks[0]).toEqual<MetricBlock>({
      kind: 'metric',
      id: 'graph:total',
      label: 'entities',
      value: 2,
      evidenceIds: ['graph:row-1', 'graph:row-2']
    })
    expect((graph.answer.blocks[1] as TableBlock).rows).toEqual([
      { cells: { type: 'service', count: 1 }, evidenceIds: ['graph:row-1'] },
      { cells: { type: 'team', count: 1 }, evidenceIds: ['graph:row-2'] }
    ])
    expect(graph.answer.coverage.mode).toBe('exhaustive')

    expect(answer.references?.map((reference) => [reference.id, reference.status, reference.foundBy.map((by) => by.adapter)])).toEqual([
      ['service.orders', 'resolved', ['local', 'graph']],
      ['team.payments', 'resolved', ['local', 'graph']]
    ])
    expect(answer.connections).toEqual([{ nodes: ['service.orders', 'team.payments'], steps: [{ rel: 'owned_by', forward: true }] }])
  })

  it('asks only the adapters named, and refuses one that is not configured for query', async () => {
    const answer = await ask({ question: 'checkout', adapters: ['graph'] })
    expect(answer.results.map((result) => result.adapter)).toEqual(['graph'])

    const unknown = await post('/api/ask', { question: 'checkout', adapters: ['nope'] })
    expect(unknown.status).toBe(400)
    expect(((await unknown.json()) as { error: string }).error).toContain('No adapter "nope"')
  })

  it('keeps every other answer when one adapter misses the shared deadline', async () => {
    await configure('{ delayMs: 5000 }', '  timeoutMs: 300\n')

    const started = Date.now()
    const answer = await ask({ question: 'checkout' })

    expect(Date.now() - started).toBeLessThan(4_000)
    expect(answer.results).toEqual([
      expect.objectContaining({ adapter: 'local', state: 'answered' }),
      expect.objectContaining({ adapter: 'graph', state: 'failed', error: expect.objectContaining({ code: 'timeout' }) })
    ])
  })

  it('cancels a question by its request id, closing the adapters still answering', async () => {
    await configure('{ delayMs: 5000 }')

    const pending = post('/api/ask', { question: 'checkout', requestId: 'slow-1' })
    await new Promise((resolve) => setTimeout(resolve, 200))
    const cancelled = await fetch(new URL('/api/ask/slow-1', server?.url), { method: 'DELETE' })
    expect(cancelled.status).toBe(200)

    const answer = (await (await pending).json()) as CoordinatedAnswer
    expect(answer.results.find((result) => result.adapter === 'graph')).toMatchObject({ state: 'failed', error: { code: 'cancelled' } })
    expect((await fetch(new URL('/api/ask/slow-1', server?.url), { method: 'DELETE' })).status).toBe(404)
  })

  it('warns when an adapter answers from an index behind the files', async () => {
    await write(join(root, '.docket/resources/teams/payments.md'), PAYMENTS.replace('owns', 'runs'))

    const answer = await ask({ question: 'checkout' })

    expect(answer.diagnostics).toEqual([expect.objectContaining({ code: 'adapter-behind', message: expect.stringContaining('local is') })])
    const local = answer.results[0]
    expect(local).toMatchObject({ state: 'answered', freshness: { state: 'behind' } })
    // Its hit for the changed file names the revision it projected, which the files no longer hold.
    expect(local?.state === 'answered' && Object.values(local.references ?? {}).flat()).toContain('stale')
  })

  it('rejects a body it cannot read, saying which field is wrong', async () => {
    expect((await post('/api/ask', { question: '  ' })).status).toBe(400)
    expect((await post('/api/ask', { question: 'x', adapters: 'local' })).status).toBe(400)
    expect((await post('/api/ask', { question: 'x', conversation: [{ role: 'system', content: 'x' }] })).status).toBe(400)
    expect((await post('/api/ask', { question: 'x', timezone: 'Mars/Olympus' })).status).toBe(400)
    expect((await post('/api/ask', { question: 'x', requestId: 'has spaces' })).status).toBe(400)
    const notJson = await fetch(new URL('/api/ask', server?.url), { method: 'POST', body: '{ nope' })
    expect(notJson.status).toBe(400)
  })
})

describe('GET /api/adapters', () => {
  it('describes every instance, its health and freshness, never its configuration', async () => {
    await configure('{ delayMs: 0, tokenEnv: SECRET_TOKEN }')
    const response = (await (await fetch(new URL('/api/adapters', server?.url))).json()) as AdaptersResponse

    expect(response.query).toEqual({ defaultAdapters: ['local', 'graph'], synthesis: false })
    expect(response.adapters.map((adapter) => [adapter.id, adapter.module, adapter.roles])).toEqual([
      ['local', '@docket/adapter-jsonl', ['projection', 'query']],
      ['graph', './tools/fake-graph.mjs', ['query']]
    ])
    for (const adapter of response.adapters) {
      expect(validateAdapterDescription(adapter.description)).toEqual(adapter.description)
      expect(validateAdapterStatus(adapter.status)).toEqual(adapter.status)
    }
    expect(response.adapters[0]?.freshness).toMatchObject({ state: 'current', behind: 0 })
    expect(response.adapters[1]).toMatchObject({ status: { state: 'connected', engineVersion: '5.0.0' }, freshness: { state: 'unknown' } })
    expect(JSON.stringify(response)).not.toContain('SECRET_TOKEN')
  })

  it('still lists every instance when one module cannot load, saying why', async () => {
    await write(join(root, 'tools', 'future.mjs'), 'export default { apiVersion: 99 }')
    await configure('{}')
    await write(join(root, '.docket.yaml'), (await readFile(join(root, '.docket.yaml'), 'utf8')).replace('./tools/fake-graph.mjs', './tools/future.mjs'))

    const response = (await (await fetch(new URL('/api/adapters', server?.url))).json()) as AdaptersResponse

    expect(response.adapters.map((adapter) => [adapter.id, adapter.module])).toEqual([
      ['local', '@docket/adapter-jsonl'],
      ['graph', './tools/future.mjs']
    ])
    expect(response.adapters[1]?.statusError).toContain('apiVersion 99')
    expect(response.diagnostics).toEqual([expect.objectContaining({ severity: 'error', code: 'adapters-not-loaded' })])
  })
})

describe('POST /api/evidence', () => {
  it('resolves references against the files, with the text there', async () => {
    const response = await post('/api/evidence', {
      references: [
        { kind: 'entity', id: 'service.orders' },
        { kind: 'entity', id: 'service.ghost' }
      ]
    })
    const body = (await response.json()) as EvidenceResponse

    expect(body.references).toEqual([
      {
        reference: { kind: 'entity', id: 'service.orders' },
        status: 'resolved',
        record: expect.objectContaining({ id: 'service.orders', title: 'Orders API', entity: 'service.orders' }),
        excerpt: { path: '.docket/resources/services/orders.md', text: 'Handles orders for checkout.', truncated: false }
      },
      { reference: { kind: 'entity', id: 'service.ghost' }, status: 'unresolved' }
    ])
  })

  it('is bounded, and refuses anything but canonical references', async () => {
    const many = Array.from({ length: 17 }, () => ({ kind: 'entity', id: 'service.orders' }))
    expect((await post('/api/evidence', { references: many })).status).toBe(400)
    expect((await post('/api/evidence', { references: [{ kind: 'file', id: 'x' }] })).status).toBe(400)
    expect((await fetch(new URL('/api/evidence', server?.url))).status).toBe(405)
  })
})
