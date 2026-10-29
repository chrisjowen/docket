import { request, type IncomingHttpHeaders } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { init } from '../commands/init.js'
import { open } from '../commands/open.js'
import { allowedOrigin, HEALTH_SERVICE, SESSION_HEADER, startUiServer, type UiServer } from './server.js'
import type { UiHealth, UiSession, UiSyncStatus } from './types.js'

const PAYMENTS = '---\nid: team.payments\ntype: team\ntitle: Payments\n---\n\nThe payments team.\n'

/** Where Wheelhouse serves its pages by default. */
const WHEELHOUSE = 'http://127.0.0.1:4310'

let root: string
let server: UiServer | undefined

interface Sent {
  status: number
  headers: IncomingHttpHeaders
  body: unknown
}

/** fetch() will not send an arbitrary Host or Origin header, so this goes through node:http. */
const send = (method: string, path: string, headers: Record<string, string>, body?: string): Promise<Sent> =>
  new Promise((done, fail) => {
    const call = request({ host: '127.0.0.1', port: server?.port, method, path, headers }, (response) => {
      let text = ''
      response.on('data', (chunk: Buffer) => (text += chunk.toString()))
      response.on('end', () =>
        done({ status: response.statusCode ?? 0, headers: response.headers, body: text === '' ? null : JSON.parse(text) })
      )
    })
    call.on('error', fail)
    call.end(body)
  })

/** The headers a browser sends with a request from a page at `origin` to docket open. */
const from = (origin: string): Record<string, string> => ({
  host: `127.0.0.1:${server?.port}`,
  origin,
  'sec-fetch-site': 'same-site'
})

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-open-origins-'))
  await init({ cwd: root })
  await mkdir(join(root, '.docket/resources/teams'), { recursive: true })
  await writeFile(join(root, '.docket/resources/teams/payments.md'), PAYMENTS, 'utf8')
  await mkdir(join(root, 'ui'), { recursive: true })
  await writeFile(join(root, 'ui/index.html'), '<!doctype html><title>docket</title>', 'utf8')
})

afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(root, { recursive: true, force: true })
})

describe('allowedOrigin', () => {
  it('takes http(s) pages on this machine, as their origin', () => {
    expect(allowedOrigin('http://127.0.0.1:4310')).toEqual({ ok: true, origin: 'http://127.0.0.1:4310' })
    expect(allowedOrigin(' http://localhost:4310/ ')).toEqual({ ok: true, origin: 'http://localhost:4310' })
    expect(allowedOrigin('https://[::1]:8443')).toEqual({ ok: true, origin: 'https://[::1]:8443' })
  })

  it('refuses a page on another machine, another scheme, or more than an origin', () => {
    expect(allowedOrigin('http://wheelhouse.example:4310')).toMatchObject({ ok: false, reason: expect.stringContaining('not on this machine') })
    expect(allowedOrigin('http://192.168.1.20:4310')).toMatchObject({ ok: false })
    expect(allowedOrigin('file:///tmp/x.html')).toMatchObject({ ok: false, reason: expect.stringContaining('http or https') })
    expect(allowedOrigin('http://127.0.0.1:4310/plugins')).toMatchObject({ ok: false, reason: expect.stringContaining('more than an origin') })
    expect(allowedOrigin('wheelhouse')).toMatchObject({ ok: false })
  })

  it('stops docket open from starting with an origin it refuses', async () => {
    await expect(
      startUiServer({ cwd: root, uiDir: join(root, 'ui'), port: 0, allowOrigins: ['http://evil.example'] })
    ).rejects.toThrow(/not on this machine/)
  })
})

describe('GET /api/health', () => {
  it('names docket open, the repository it serves and the pages it allows', async () => {
    server = (await open({ cwd: root, uiDir: join(root, 'ui'), port: 0, allowOrigins: [`${WHEELHOUSE}/`] })) as UiServer
    expect(server.allowOrigins).toEqual([WHEELHOUSE])
    const { status, body } = await send('GET', '/api/health', { host: `127.0.0.1:${server.port}` })
    expect(status).toBe(200)
    expect(body).toEqual({ service: HEALTH_SERVICE, root: expect.any(String), allowOrigins: [WHEELHOUSE] } satisfies UiHealth)
    expect((body as UiHealth).root).toContain('docket-open-origins-')
  })
})

describe('a page docket open was started with --allow-origin for', () => {
  beforeEach(async () => {
    server = await startUiServer({ cwd: root, uiDir: join(root, 'ui'), port: 0, allowOrigins: [WHEELHOUSE] })
  })

  it('may read every answer, and the request id of a question', async () => {
    const graph = await send('GET', '/api/graph', from(WHEELHOUSE))
    expect(graph.status).toBe(200)
    expect(graph.headers['access-control-allow-origin']).toBe(WHEELHOUSE)
    expect(graph.headers['access-control-expose-headers']).toBe('x-request-id')
    expect(graph.headers.vary).toBe('Origin')

    // Errors too, so the page can say why.
    const missing = await send('GET', '/api/nothing', from(WHEELHOUSE))
    expect(missing.status).toBe(404)
    expect(missing.headers['access-control-allow-origin']).toBe(WHEELHOUSE)
  })

  it('gets its preflight answered for the methods and headers the UI sends', async () => {
    const preflight = await send('OPTIONS', '/api/sync', {
      ...from(WHEELHOUSE),
      'access-control-request-method': 'POST',
      'access-control-request-headers': `content-type, ${SESSION_HEADER}`
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe(WHEELHOUSE)
    expect(preflight.headers['access-control-allow-methods']).toBe('GET, HEAD, POST, DELETE')
    expect(preflight.headers['access-control-allow-headers']).toBe(`content-type, ${SESSION_HEADER}`)
  })

  it('gets the session token and starts a sync with it', async () => {
    const session = await send('GET', '/api/session', from(WHEELHOUSE))
    expect(session.status).toBe(200)
    const { token } = session.body as UiSession
    const started = await send(
      'POST',
      '/api/sync',
      { ...from(WHEELHOUSE), [SESSION_HEADER]: token, 'content-type': 'application/json' },
      '{}'
    )
    expect(started.status).toBe(202)
    expect(started.headers['access-control-allow-origin']).toBe(WHEELHOUSE)
    expect((started.body as UiSyncStatus).run).toMatchObject({ state: 'running' })
  })

  it('still needs the token to sync', async () => {
    const refused = await send('POST', '/api/sync', { ...from(WHEELHOUSE), [SESSION_HEADER]: 'not-the-token' })
    expect(refused.status).toBe(403)
    expect((refused.body as { error: string }).error).toMatch(/Reload the page/)
  })
})

describe('any other page', () => {
  beforeEach(async () => {
    server = await startUiServer({ cwd: root, uiDir: join(root, 'ui'), port: 0, allowOrigins: [WHEELHOUSE] })
  })

  it('gets no CORS headers, so the browser keeps the answers from it', async () => {
    const graph = await send('GET', '/api/graph', from('http://127.0.0.1:5173'))
    expect(graph.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('has its preflight refused', async () => {
    const preflight = await send('OPTIONS', '/api/sync', { ...from('http://evil.example'), 'access-control-request-method': 'POST' })
    expect(preflight.status).toBe(403)
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('gets neither the token nor a sync, even with the token', async () => {
    const other = 'http://localhost:5173'
    expect((await send('GET', '/api/session', from(other))).status).toBe(403)
    const token = ((await send('GET', '/api/session', { host: `127.0.0.1:${server?.port}` })).body as UiSession).token
    const refused = await send('POST', '/api/sync', { ...from(other), [SESSION_HEADER]: token })
    expect(refused.status).toBe(403)
  })

  it('is refused when docket open was started without --allow-origin, as before', async () => {
    await server?.close()
    server = await startUiServer({ cwd: root, uiDir: join(root, 'ui'), port: 0 })
    expect((await send('GET', '/api/session', from(WHEELHOUSE))).status).toBe(403)
    const graph = await send('GET', '/api/graph', from(WHEELHOUSE))
    expect(graph.headers['access-control-allow-origin']).toBeUndefined()
    expect(graph.headers.vary).toBeUndefined()
  })
})
