import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { init } from '../commands/init.js'
import { search } from '../commands/search.js'
import { sync, type SyncOptions, type SyncResult } from '../commands/sync.js'
import { startUiServer, type UiServer } from './server.js'
import type { UiSyncRun, UiSyncStatus } from './types.js'

const PAYMENTS = '---\nid: team.payments\ntype: team\ntitle: Payments\n---\n\nThe payments team.\n'
const ORDERS = '---\nid: service.orders\ntype: service\ntitle: Orders\n---\n\nTakes orders.\n'

let root: string
let server: UiServer | undefined

const write = async (path: string, contents: string): Promise<void> => {
  await mkdir(join(root, path, '..'), { recursive: true })
  await writeFile(join(root, path), contents, 'utf8')
}

const start = (options: Partial<Parameters<typeof startUiServer>[0]> = {}): Promise<UiServer> =>
  startUiServer({ cwd: root, uiDir: join(root, 'ui'), port: 0, ...options })

const status = async (): Promise<UiSyncStatus> =>
  (await (await fetch(`${server?.url}api/sync`)).json()) as UiSyncStatus

const found = async (query: string): Promise<string[]> =>
  (await search(query, { cwd: root })).sources.flatMap((source) => source.hits.map((hit) => hit.id))

/** Polls until `check` holds, as the watcher's debounce makes a change land a moment later. */
const eventually = async (check: () => Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return
    await new Promise((done) => setTimeout(done, 50))
  }
  throw new Error('it never happened')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-open-watch-'))
  await init({ cwd: root })
  await write('.docket/resources/teams/payments.md', PAYMENTS)
  await write('ui/index.html', '<!doctype html><title>docket</title>')
})

afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(root, { recursive: true, force: true })
})

describe('docket open --watch', () => {
  it('builds a search index that was never built, so a fresh clone does not search an empty one', async () => {
    expect(await found('payments')).toEqual([])
    const runs: UiSyncRun[] = []
    server = await start({ watch: { onRun: (run) => runs.push(run) } })
    expect(server.watching).toBe(true)
    await server.idle()

    expect(await found('payments')).toContain('team.payments')
    const current = await status()
    expect(current.adapters).toEqual([expect.objectContaining({ id: 'local', state: 'current' })])
    expect(current.outOfDate).toBe(false)
    expect(runs.map((run) => [run.state, run.adapters])).toEqual([['succeeded', ['local']]])
  })

  it('keeps it current as the files change', async () => {
    server = await start({ watch: true })
    await server.idle()
    expect(await found('orders')).toEqual([])

    await write('.docket/resources/services/orders.md', ORDERS)
    await eventually(async () => (await found('orders')).includes('service.orders'))

    // Search hides a hit whose file is gone at once; the index drops it with the next sync.
    await rm(join(root, '.docket/resources/services/orders.md'))
    await eventually(async () => (await status()).run?.results.some((result) => result.removed === 1) ?? false)
    await server.idle()
    expect((await status()).outOfDate).toBe(false)
  })

  it('syncs only the instances that lag, and nothing when every one is current', async () => {
    await sync({ cwd: root })
    const calls: SyncOptions[] = []
    const runSync = (options: SyncOptions): Promise<SyncResult> => {
      calls.push(options)
      return sync(options)
    }
    server = await start({ watch: true, runSync })
    await server.idle()
    expect(calls).toEqual([])
    expect((await status()).run).toBeNull()

    await write('.docket/resources/services/orders.md', ORDERS)
    await eventually(async () => calls.length > 0)
    await server.idle()
    expect(calls.map((call) => call.adapters)).toEqual([['local']])
  })

  it('waits for a sync the page started rather than refusing or racing it', async () => {
    let release: (() => void) | undefined
    const calls: SyncOptions[] = []
    const runSync = async (options: SyncOptions): Promise<SyncResult> => {
      calls.push(options)
      if (calls.length === 1) await new Promise<void>((done) => (release = done))
      return sync(options)
    }
    server = await start({ watch: true, runSync })
    await eventually(async () => release !== undefined)

    // A change while the first sync is still running is caught up afterwards.
    await write('.docket/resources/services/orders.md', ORDERS)
    await new Promise((done) => setTimeout(done, 600))
    expect(calls).toHaveLength(1)
    release?.()
    await eventually(async () => (await found('orders')).includes('service.orders'))
    await server.idle()
    expect((await status()).outOfDate).toBe(false)
  })

  it('leaves the projections alone without --watch', async () => {
    server = await start()
    expect(server.watching).toBe(false)
    await server.idle()
    expect((await status()).run).toBeNull()
    expect(await found('payments')).toEqual([])
  })
})
