import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { init } from '../commands/init.js'
import type { SyncOptions, SyncResult } from '../commands/sync.js'
import { loadConfig } from '../config/loader.js'
import { lockFile, withLockFile } from '../mcp/local/files.js'
import { listProjectDocuments, pushToProject } from './documents.js'
import { ProjectIndexer } from './indexer.js'

const PAYMENTS = '---\nid: team.payments\ntype: team\ntitle: Payments\n---\n\nMoves money.\n'
const ORDERS = '---\nid: service.orders\ntype: service\ntitle: Orders\nlinks:\n  - rel: owned_by\n    target: team.payments\n---\n\nTakes orders.\n'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-host-'))
  await init({ cwd: root })
  await mkdir(join(root, '.docket/resources/teams'), { recursive: true })
  await writeFile(join(root, '.docket/resources/teams/payments.md'), PAYMENTS, 'utf8')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('the project lock file', () => {
  it('lets one holder in at a time, across callers that do not share a queue', async () => {
    const path = join(root, '.docket/.cache/test.lock')
    const order: string[] = []
    const hold = (name: string) =>
      withLockFile(path, async () => {
        order.push(`${name} in`)
        await new Promise((resolve) => setTimeout(resolve, 20))
        order.push(`${name} out`)
      })
    await Promise.all([hold('a'), hold('b'), hold('c')])
    for (let index = 0; index < order.length; index += 2) expect(order[index]?.replace(' in', '')).toBe(order[index + 1]?.replace(' out', ''))
    expect(existsSync(path)).toBe(false)
  })

  it('takes over a lock its holder died with, and gives up on one held too long', async () => {
    const resolved = await loadConfig(root)
    const path = lockFile(resolved)
    await mkdir(join(root, '.docket/.cache'), { recursive: true })
    // A process id no process has: its holder is gone.
    await writeFile(path, JSON.stringify({ pid: 2 ** 22 + 12345, host: (await import('node:os')).hostname(), at: new Date().toISOString() }))
    await expect(withLockFile(path, async () => 'taken')).resolves.toBe('taken')

    await writeFile(path, JSON.stringify({ pid: process.pid, host: (await import('node:os')).hostname(), at: new Date().toISOString() }))
    await expect(withLockFile(path, async () => 'never', { waitMs: 50 })).rejects.toThrow(/Another writer has held/)
    await rm(path)
  })
})

describe('pushing a checkout into a project', () => {
  const push = async (checkout: string, upsert: { path: string; raw: string }[], remove: string[] = [], dryRun = false) =>
    pushToProject(await loadConfig(root), { label: 'ada via docket serve' }, { checkout, upsert, remove }, { dryRun, now: () => new Date('2026-11-18T00:00:00Z') })

  it('writes the checkout’s documents, records where they came from, and lists them by origin', async () => {
    const dry = await push('docket-co-1', [{ path: '.docket/resources/services/orders.md', raw: ORDERS }], [], true)
    expect(dry).toMatchObject({ ok: true, dryRun: true, created: ['.docket/resources/services/orders.md'] })
    expect(existsSync(join(root, '.docket/resources/services/orders.md'))).toBe(false)

    const pushed = await push('docket-co-1', [{ path: '.docket/resources/services/orders.md', raw: ORDERS }])
    expect(pushed).toMatchObject({ ok: true, created: ['.docket/resources/services/orders.md'] })
    expect(await readFile(join(root, '.docket/resources/services/orders.md'), 'utf8')).toBe(ORDERS)
    expect(await readFile(join(root, '.docket/pushed.yaml'), 'utf8')).toContain('checkout: docket-co-1')

    const resolved = await loadConfig(root)
    expect((await listProjectDocuments(resolved, { origin: 'cli', originRef: 'docket-co-1' })).map((document) => document.path)).toEqual(['.docket/resources/services/orders.md'])
    const own = await listProjectDocuments(resolved, { origin: 'cloud', raw: true })
    expect(own.map((document) => [document.path, document.raw])).toEqual([['.docket/resources/teams/payments.md', PAYMENTS]])

    const again = await push('docket-co-1', [{ path: '.docket/resources/services/orders.md', raw: ORDERS }])
    expect(again).toMatchObject({ ok: true, created: [], unchanged: ['.docket/resources/services/orders.md'] })
    const removed = await push('docket-co-1', [], ['.docket/resources/services/orders.md'])
    expect(removed).toMatchObject({ ok: true, removed: ['.docket/resources/services/orders.md'] })
    expect(existsSync(join(root, '.docket/resources/services/orders.md'))).toBe(false)
  })

  it("refuses a path the server's own document holds, and documents the ontology does not allow, writing nothing", async () => {
    const taken = await push('docket-co-1', [{ path: '.docket/resources/teams/payments.md', raw: PAYMENTS.replace('Moves money.', 'Other.') }])
    expect(taken).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: 'path-taken' })] })
    const same = await push('docket-co-1', [{ path: '.docket/resources/teams/payments.md', raw: PAYMENTS }])
    expect(same).toMatchObject({ ok: true, unchanged: ['.docket/resources/teams/payments.md'], diagnostics: [expect.objectContaining({ code: 'held-elsewhere', severity: 'warning' })] })

    const invalid = await push('docket-co-1', [
      { path: '.docket/resources/services/orders.md', raw: ORDERS },
      { path: '.docket/resources/services/bad.md', raw: '---\nid: service.bad\ntype: nonsense\ntitle: Bad\n---\n' }
    ])
    expect(invalid.ok).toBe(false)
    expect(existsSync(join(root, '.docket/resources/services/orders.md'))).toBe(false)

    const outside = await push('docket-co-1', [{ path: 'docs/orders.md', raw: ORDERS }])
    expect(outside).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: 'invalid-path' })] })
    const hidden = await push('docket-co-1', [{ path: '.docket/.index/orders.md', raw: ORDERS }])
    expect(hidden).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: 'invalid-path' })] })
  })

  it("removes only the checkout's own documents", async () => {
    await push('docket-co-1', [{ path: '.docket/resources/services/orders.md', raw: ORDERS }])
    const other = await push('docket-co-2', [], ['.docket/resources/services/orders.md', '.docket/resources/teams/payments.md'])
    expect(other).toMatchObject({ ok: true, removed: [] })
    expect(other.diagnostics.map((d) => d.code)).toEqual(['not-pushed', 'not-pushed'])
    expect(existsSync(join(root, '.docket/resources/services/orders.md'))).toBe(true)
  })
})

describe('keeping a project indexed', () => {
  const result = (): SyncResult => ({ diagnostics: [], upserted: [], removed: [], unchanged: 0, adapters: [] })

  it('runs one sync at a time, and one more for writes made while it ran', async () => {
    let release: () => void = () => undefined
    const runSync = vi.fn(
      (_options: SyncOptions) =>
        new Promise<SyncResult>((resolve) => {
          release = () => resolve(result())
        })
    )
    const indexer = new ProjectIndexer({ cwd: root, intervalMs: 0, runSync })
    indexer.kick()
    await vi.waitFor(() => expect(runSync).toHaveBeenCalledTimes(1))
    indexer.kick()
    indexer.kick()
    release()
    await vi.waitFor(() => expect(runSync).toHaveBeenCalledTimes(2))
    release()
    await indexer.idle()
    expect(runSync).toHaveBeenCalledTimes(2)
    await indexer.close()
  })

  it('rebuilds with a fresh projection', async () => {
    const runSync = vi.fn(async () => result())
    const runRebuild = vi.fn(async () => result())
    const indexer = new ProjectIndexer({ cwd: root, intervalMs: 0, runSync, runRebuild })
    await indexer.rebuild()
    expect(runRebuild).toHaveBeenCalledTimes(1)
    expect(runSync).not.toHaveBeenCalled()
    indexer.kick()
    await indexer.idle()
    expect(runSync).toHaveBeenCalledTimes(1)
    await indexer.close()
  })
})
