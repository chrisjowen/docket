import { request } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { init } from '../commands/init.js'
import { sync, SyncError, type SyncOptions, type SyncResult } from '../commands/sync.js'
import { SESSION_HEADER, startUiServer, type UiServer } from './server.js'
import { SyncRunner } from './sync-run.js'
import type { UiSession, UiSyncStatus } from './types.js'

const PAYMENTS = '---\nid: team.payments\ntype: team\ntitle: Payments\n---\n\nThe payments team.\n'
const ORDERS = '---\nid: service.orders\ntype: service\ntitle: Orders\n---\n\nTakes orders.\n'

let root: string
let server: UiServer | undefined

const write = async (path: string, contents: string): Promise<void> => {
  await mkdir(join(root, path, '..'), { recursive: true })
  await writeFile(join(root, path), contents, 'utf8')
}

interface Sent {
  status: number
  body: unknown
}

/** fetch() will not send an arbitrary Host or Origin header, so this goes through node:http. */
const send = (
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
  address = '127.0.0.1'
): Promise<Sent> =>
  new Promise((done, fail) => {
    const call = request({ host: address, port: server?.port, method, path, headers }, (response) => {
      let text = ''
      response.on('data', (chunk: Buffer) => (text += chunk.toString()))
      response.on('end', () => done({ status: response.statusCode ?? 0, body: text === '' ? null : JSON.parse(text) }))
    })
    call.on('error', fail)
    call.end(body)
  })

/** The headers the page itself sends from http://127.0.0.1:<port>. */
const own = (): Record<string, string> => ({ host: `127.0.0.1:${server?.port}`, origin: `http://127.0.0.1:${server?.port}` })

const session = async (): Promise<string> => {
  const { status, body } = await send('GET', '/api/session', own())
  expect(status).toBe(200)
  return (body as UiSession).token
}

const startSync = async (body?: unknown): Promise<Sent> =>
  send(
    'POST',
    '/api/sync',
    { ...own(), [SESSION_HEADER]: await session(), 'content-type': 'application/json' },
    body === undefined ? undefined : JSON.stringify(body)
  )

const status = async (): Promise<UiSyncStatus> => (await send('GET', '/api/sync', own())).body as UiSyncStatus

/** Polls until the run started from the page has finished. */
const finished = async (): Promise<UiSyncStatus> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const current = await status()
    if (current.run && current.run.state !== 'running') return current
    await new Promise((done) => setTimeout(done, 25))
  }
  throw new Error('the sync never finished')
}

/** A sync that waits to be told to finish, reporting progress like the real one - and failing for one adapter, as it does. */
const deferredSync = () => {
  let release: (() => void) | undefined
  const calls: SyncOptions[] = []
  const run = (options: SyncOptions): Promise<SyncResult> => {
    calls.push(options)
    options.onProgress?.({ stage: 'validating' })
    options.onProgress?.({ stage: 'projecting', adapters: ['local', 'graph'] })
    options.onProgress?.({
      stage: 'synced',
      report: { id: 'local', upserted: [{ kind: 'entity', id: 'team.payments' }], removed: [], unchanged: 0, held: [], failed: [] }
    })
    return new Promise((_done, fail) => {
      release = () =>
        fail(new SyncError({
          diagnostics: [],
          upserted: ['team.payments'],
          removed: [],
          unchanged: 0,
          adapters: [
            {
              id: 'local',
              upserted: [{ kind: 'entity', id: 'team.payments' }],
              removed: [],
              unchanged: 0,
              held: [],
              failed: [],
              inputs: ['entity'],
              origin: 'current',
              reset: false
            },
            {
              id: 'graph',
              upserted: [],
              removed: [],
              unchanged: 0,
              held: [],
              failed: [],
              error: 'connect ECONNREFUSED 127.0.0.1:7687',
              inputs: ['entity'],
              origin: 'current',
              reset: false
            }
          ]
        }))
    })
  }
  return { run, calls, release: () => release?.() }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-open-sync-'))
  await init({ cwd: root })
  await write('.docket/resources/teams/payments.md', PAYMENTS)
  await write('ui/index.html', '<!doctype html><title>docket</title>')
})

afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(root, { recursive: true, force: true })
})

describe('starting a sync from the UI', () => {
  beforeEach(async () => {
    server = await startUiServer({ cwd: root, uiDir: join(root, 'ui'), port: 0 })
  })

  it('hands the session token only to the page on this machine', async () => {
    expect(await session()).toMatch(/^[0-9a-f-]{36}$/)
    expect((await send('GET', '/api/session', { host: `192.168.1.20:${server?.port}` })).status).toBe(403)
    expect((await send('GET', '/api/session', { host: `rebound.example:${server?.port}` })).status).toBe(403)
    expect((await send('GET', '/api/session', { ...own(), 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  })

  it('refuses a sync without the session token, from another origin or another host', async () => {
    const token = await session()
    const refused = [
      own(),
      { ...own(), [SESSION_HEADER]: 'not-the-token' },
      { host: `127.0.0.1:${server?.port}`, [SESSION_HEADER]: token },
      { ...own(), origin: 'http://evil.example', [SESSION_HEADER]: token },
      { host: `evil.example:${server?.port}`, origin: `http://evil.example:${server?.port}`, [SESSION_HEADER]: token },
      { ...own(), 'sec-fetch-site': 'cross-site', [SESSION_HEADER]: token }
    ]
    for (const headers of refused) {
      const { status, body } = await send('POST', '/api/sync', headers)
      expect(status).toBe(403)
      expect((body as { error: string }).error).toMatch(/page docket open serves|machine running docket open|Reload the page/)
    }
    expect((await status()).run).toBeNull()
  })

  // Only a machine with a network address can reach its own server other than through loopback.
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === 'IPv4' && !address.internal)?.address
  it.skipIf(lan === undefined)('refuses a sync from another machine, even with the token', async () => {
    // Listening on every interface is the only way another machine reaches it.
    await server?.close()
    server = await startUiServer({ cwd: root, uiDir: join(root, 'ui'), port: 0, host: '0.0.0.0' })
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/`)
    const token = await session()
    const { status, body } = await send(
      'POST',
      '/api/sync',
      { host: `${lan}:${server?.port}`, origin: `http://${lan}:${server?.port}`, [SESSION_HEADER]: token },
      undefined,
      lan
    )
    expect(status).toBe(403)
    expect((body as { error: string }).error).toContain('machine running docket open')
  })

  it.skipIf(lan === undefined)('listens on this machine only unless told otherwise', async () => {
    expect(server?.host).toBe('127.0.0.1')
    await expect(send('GET', '/api/sync', own(), undefined, lan)).rejects.toThrow(/ECONNREFUSED/)
  })

  it('runs docket sync, then says the projections are current and when they synced', async () => {
    const before = await status()
    expect(before.run).toBeNull()
    expect(before.outOfDate).toBe(true)
    expect(before.adapters).toEqual([{ id: 'local', state: 'unsynced' }])

    const started = await startSync()
    expect(started.status).toBe(202)
    expect((started.body as UiSyncStatus).run).toMatchObject({ state: 'running', adapters: null })

    const after = await finished()
    expect(after.run).toMatchObject({
      state: 'succeeded',
      results: [{ id: 'local', state: 'synced', failed: 0 }],
      fileErrors: 0
    })
    expect(after.run?.results[0]?.projected).toBeGreaterThan(0)
    expect(after.run?.finishedAt).toBeDefined()
    expect(after.outOfDate).toBe(false)
    expect(after.adapters).toEqual([{ id: 'local', state: 'current', lastSyncedAt: expect.any(String) }])
    expect(after.lastSyncedAt).toBe(after.adapters[0]?.lastSyncedAt)

    // An edit puts the projections behind the files again.
    await write('.docket/resources/services/orders.md', ORDERS)
    const edited = await status()
    expect(edited.outOfDate).toBe(true)
    expect(edited.adapters[0]).toMatchObject({ id: 'local', state: 'behind', behind: expect.any(Number) })
    expect(edited.lastSyncedAt).toBe(after.lastSyncedAt)
  })

  it('syncs only the adapter asked for, and says plainly when it does not exist', async () => {
    expect((await startSync({ adapters: ['local'] })).status).toBe(202)
    expect((await finished()).run).toMatchObject({ state: 'succeeded', adapters: ['local'] })

    expect((await startSync({ adapters: ['nowhere'] })).status).toBe(202)
    const failed = (await finished()).run
    expect(failed).toMatchObject({ state: 'failed', adapters: ['nowhere'] })
    expect(failed?.error).toContain('No adapter instance "nowhere" is configured')
  })

  it('refuses a body that is not a list of adapter ids', async () => {
    for (const body of [{ adapters: 'local' }, { adapters: [] }, { adapters: [3] }, ['local']]) {
      expect((await startSync(body)).status).toBe(400)
    }
  })

  it('only starts a sync with POST', async () => {
    expect((await send('PUT', '/api/sync', own())).status).toBe(405)
    expect((await send('POST', '/api/session', own())).status).toBe(405)
  })
})

describe('one sync at a time', () => {
  it('refuses a second sync while one runs, and reports each adapter as it finishes', async () => {
    const deferred = deferredSync()
    server = await startUiServer({ cwd: root, uiDir: join(root, 'ui'), port: 0, runSync: deferred.run })

    expect((await startSync({ adapters: ['local', 'graph'] })).status).toBe(202)
    const busy = await startSync()
    expect(busy.status).toBe(409)
    expect((busy.body as { error: string }).error).toContain('A sync is already running')
    expect(deferred.calls).toHaveLength(1)
    expect(deferred.calls[0]).toMatchObject({ cwd: root, adapters: ['local', 'graph'] })

    const running = (await status()).run
    expect(running).toMatchObject({
      state: 'running',
      stage: 'projecting',
      results: [
        { id: 'local', state: 'synced', projected: 1 },
        { id: 'graph', state: 'waiting' }
      ]
    })

    deferred.release()
    const done = (await finished()).run
    expect(done).toMatchObject({
      state: 'failed',
      error: 'graph did not fully sync; the others did.',
      results: [
        { id: 'local', state: 'synced' },
        { id: 'graph', state: 'failed', error: 'connect ECONNREFUSED 127.0.0.1:7687' }
      ]
    })
    expect(done?.stage).toBeUndefined()

    // Finished, so another may start.
    expect((await startSync()).status).toBe(202)
    deferred.release()
  })
})

describe('SyncRunner', () => {
  it('reports a sync that threw in its own words', async () => {
    const runner = new SyncRunner(root, () => Promise.reject(new Error('The ontology at .docket/entities.yaml is not valid YAML.')))
    runner.start(null)
    await runner.settled()
    expect(runner.current).toMatchObject({ state: 'failed', error: 'The ontology at .docket/entities.yaml is not valid YAML.' })
  })

  it('hands out copies, so a caller cannot change the run', async () => {
    const runner = new SyncRunner(root)
    const run = runner.start(null)
    run.state = 'failed'
    expect(runner.current?.state).toBe('running')
    await runner.settled()
    expect(runner.current?.state).toBe('succeeded')
  })
})

describe('sync history', () => {
  it('records when each adapter last synced in full, in the disposable cache', async () => {
    await sync({ cwd: root })
    const history = JSON.parse(await readFile(join(root, '.docket/.cache/sync.json'), 'utf8')) as {
      adapters: Record<string, { syncedAt: string }>
    }
    expect(Object.keys(history.adapters)).toEqual(['local'])
    expect(Date.parse(history.adapters.local?.syncedAt ?? '')).toBeGreaterThan(Date.now() - 60_000)
  })
})
