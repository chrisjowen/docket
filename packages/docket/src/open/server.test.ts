import { request } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { init } from '../commands/init.js'
import { open } from '../commands/open.js'
import { sync } from '../commands/sync.js'
import { startUiServer, type UiServer } from './server.js'
import type { UiAnswer, UiGraph } from './types.js'

const ORDERS = `---
id: service.orders
type: service
title: Orders API
tags: [core]
attributes:
  language: typescript
links:
  - rel: owned_by
    target: team.payments
  - rel: depends_on
    target: datasource.ledger
    attributes:
      criticality: high
provenance:
  authority: code
  capturedBy: claude
evidence:
  - source: code
    path: src/orders/handler.ts
    lines: 40-88
    urls: https://example.com/orders/handler.ts#L40
    observedAt: 2026-10-01
reviewed_by: ops
---

Handles orders for checkout. See [[team.payments]].
`

const PAYMENTS = `---
id: team.payments
type: team
title: Payments
---

The payments team owns checkout money movement.
`

let root: string
let uiDir: string
let server: UiServer | undefined

const write = async (path: string, contents: string): Promise<void> => {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

const get = async (path: string): Promise<Response> => {
  if (!server) throw new Error('server not started')
  return fetch(new URL(path, server.url))
}

const getJson = async <T>(path: string): Promise<T> => (await get(path)).json() as Promise<T>

/** fetch() will not send an arbitrary Host header, so this goes through node:http. */
const statusWithHost = (host: string): Promise<number> =>
  new Promise((done, fail) => {
    const call = request(
      { host: '127.0.0.1', port: server?.port, path: '/api/graph', headers: { host } },
      (response) => {
        response.resume()
        done(response.statusCode ?? 0)
      }
    )
    call.on('error', fail)
    call.end()
  })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-open-'))
  await init({ cwd: root })
  await write(join(root, '.docket/resources/services/orders.md'), ORDERS)
  await write(join(root, '.docket/resources/teams/payments.md'), PAYMENTS)
  await sync({ cwd: root })

  uiDir = join(root, 'ui')
  await write(join(uiDir, 'index.html'), '<!doctype html><title>docket</title>')
  await write(join(uiDir, '_app/immutable/app.js'), 'export {}')
  await writeFile(join(root, 'secret.txt'), 'not for the browser', 'utf8')

  server = await startUiServer({ cwd: root, uiDir, port: 0 })
})

afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(root, { recursive: true, force: true })
})

describe('the graph API', () => {
  it('serves every entity and relationship from the canonical files', async () => {
    const graph = await getJson<UiGraph>('/api/graph')

    expect(graph.entities.map((entity) => entity.id)).toEqual(['service.orders', 'team.payments'])
    expect(graph.edges).toEqual([
      {
        source: 'service.orders',
        rel: 'owned_by',
        target: 'team.payments',
        evidence: [],
        assessment: expect.objectContaining({ basis: 'unevidenced' }),
        dangling: false
      },
      {
        source: 'service.orders',
        rel: 'depends_on',
        target: 'datasource.ledger',
        attributes: { criticality: 'high' },
        evidence: [],
        assessment: expect.objectContaining({ basis: 'unevidenced' }),
        dangling: true
      }
    ])
    expect(graph.types.map((type) => type.name)).toContain('service')
    expect(graph.types.find((type) => type.name === 'service')?.icon).toBe('server')
    expect(graph.relationships.map((relationship) => relationship.name)).toContain('owned_by')
    expect(graph.index).toEqual({ synced: true, behind: 0 })
  })

  it('carries provenance and the whole frontmatter, including fields docket does not model', async () => {
    const graph = await getJson<UiGraph>('/api/graph')
    const orders = graph.entities.find((entity) => entity.id === 'service.orders')

    expect(orders).toMatchObject({
      title: 'Orders API',
      path: '.docket/resources/services/orders.md',
      tags: ['core'],
      mentions: ['team.payments'],
      provenance: { authority: 'code', capturedBy: 'claude' },
      evidence: [
        {
          source: 'code',
          path: 'src/orders/handler.ts',
          lines: '40-88',
          urls: ['https://example.com/orders/handler.ts#L40'],
          observedAt: '2026-10-01'
        }
      ],
      assessment: { basis: 'evidence', evidenceCount: 1, sources: ['code'], confidence: expect.any(Number) }
    })
    expect(orders?.content).toContain('Handles orders for checkout.')
    expect(orders?.frontmatter.reviewed_by).toBe('ops')
    expect(orders?.links.find((link) => link.rel === 'owned_by')?.assessment).toMatchObject({ basis: 'unevidenced' })
  })

  it('shows an id declared by several files as the one entity docket merges them into', async () => {
    await write(
      join(root, '.docket/notes/orders-seen-again.md'),
      '---\nid: service.orders\ntype: service\ntitle: Orders API\nlinks:\n  - rel: owned_by\n    target: team.payments\n' +
        '    evidence:\n      - source: config\n        path: CODEOWNERS\n        key: /services/orders\n---\n'
    )

    const graph = await getJson<UiGraph>('/api/graph')
    const orders = graph.entities.filter((entity) => entity.id === 'service.orders')

    expect(orders).toHaveLength(1)
    expect(orders[0]?.paths).toEqual(['.docket/notes/orders-seen-again.md', '.docket/resources/services/orders.md'])
    expect(graph.edges.filter((edge) => edge.source === 'service.orders' && edge.rel === 'owned_by')).toEqual([
      expect.objectContaining({
        evidence: [{ source: 'config', path: 'CODEOWNERS', key: '/services/orders' }],
        assessment: expect.objectContaining({ basis: 'evidence', sources: ['config'] })
      })
    ])
  })

  it('reads the files on every request, and says how far the index lags', async () => {
    await write(
      join(root, '.docket/resources/datasources/ledger.md'),
      '---\nid: datasource.ledger\ntype: datasource\ntitle: Ledger\n---\n'
    )

    const graph = await getJson<UiGraph>('/api/graph')

    expect(graph.entities.map((entity) => entity.id)).toContain('datasource.ledger')
    expect(graph.edges.find((edge) => edge.target === 'datasource.ledger')?.dangling).toBe(false)
    expect(graph.index).toEqual({ synced: true, behind: 1 })
  })
})

describe('the ask API', () => {
  it('answers with docket search, and the paths joining what it found', async () => {
    const answer = await getJson<UiAnswer>('/api/ask?q=checkout')

    expect(answer.query).toBe('checkout')
    expect(answer.sources.map((source) => source.name)).toEqual(['local'])
    expect(answer.documents.map((document) => document.id).sort()).toEqual([
      'service.orders',
      'team.payments'
    ])
    expect(answer.paths).toEqual([
      {
        nodes: [expect.any(String), expect.any(String)],
        steps: [{ rel: 'owned_by', forward: expect.any(Boolean) }]
      }
    ])
  })

  it('rejects an empty question and a bad limit', async () => {
    expect((await get('/api/ask?q=%20')).status).toBe(400)
    expect((await get('/api/ask?q=orders&limit=0')).status).toBe(400)
    expect((await get('/api/nothing')).status).toBe(404)
  })

  it('reports a repository it cannot read as a server error, not a crash', async () => {
    await rm(join(root, '.docket.yaml'))

    const response = await get('/api/graph')

    expect(response.status).toBe(500)
    expect(((await response.json()) as { error: string }).error).toContain('docket init')
  })
})

describe('the web UI', () => {
  it('serves the built app, with every route that is not an asset falling back to it', async () => {
    const index = await get('/')
    expect(index.status).toBe(200)
    expect(index.headers.get('content-type')).toContain('text/html')
    expect(await index.text()).toContain('<title>docket</title>')

    expect(await (await get('/entity/service.orders')).text()).toContain('<title>docket</title>')

    const asset = await get('/_app/immutable/app.js')
    expect(asset.headers.get('content-type')).toContain('text/javascript')
    expect(asset.headers.get('cache-control')).toContain('immutable')

    expect((await get('/_app/missing.js')).status).toBe(404)
  })

  it('never serves a file outside the UI directory', async () => {
    expect((await get('/..%2fsecret.txt')).status).toBe(404)
    expect((await get('/%2e%2e/secret.txt')).status).toBe(404)
  })

  it('answers requests addressed to any host, and only reads', async () => {
    expect(await statusWithHost(`localhost:${server?.port}`)).toBe(200)
    expect(await statusWithHost(`192.168.1.20:${server?.port}`)).toBe(200)
    expect(await statusWithHost('docket.example')).toBe(200)

    const post = await fetch(new URL('/api/graph', server?.url), { method: 'POST' })
    expect(post.status).toBe(405)
  })
})

describe('docket open', () => {
  it('refuses to start without a built UI or outside a repository', async () => {
    await expect(open({ cwd: root, uiDir: join(root, 'nowhere'), port: 0 })).rejects.toThrow(
      'web UI is missing'
    )
    await expect(open({ cwd: tmpdir(), uiDir, port: 0 })).rejects.toThrow('docket init')
  })

  it('falls back to a free port when the default one is taken', async () => {
    const first = await open({ cwd: root, uiDir })
    const second = await open({ cwd: root, uiDir })
    try {
      expect(second.port).not.toBe(first.port)
      expect((await fetch(new URL('/api/graph', second.url))).status).toBe(200)
    } finally {
      await Promise.all([first.close(), second.close()])
    }
  })

  it('fails on an explicit port that is taken', async () => {
    await expect(open({ cwd: root, uiDir, port: server?.port })).rejects.toThrow(/EADDRINUSE/)
  })
})
