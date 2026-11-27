// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, randomInt } from 'node:crypto'

import { enqueueRepoJob, receiveWebhook } from '@docket/platform-github'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { exportPr } from './export-pr.js'
import { repoJobLoop, requeueStale, type Logger, type RepoJobLoop } from './repo-jobs.js'
import { repoSync } from './repo-sync.js'
import { createRepoFixture, type RepoFixture } from './testing.js'

type JobRow = { id: string; kind: string; outcome: string | null; error: string | null; attempts: number; started_at: Date | null; finished_at: Date | null }

describe.skipIf(!TEST_PG_URL)('the repo job loop', () => {
  let f: RepoFixture
  let loop: RepoJobLoop
  let connectionId: string
  const lines: string[] = []
  const log: Logger = { info: (line) => lines.push(line), error: (line) => lines.push(`ERROR ${line}`) }
  const jobs = async () => (await f.org.db.admin.query<JobRow>('SELECT * FROM platform.repo_jobs ORDER BY id')).rows
  const deliver = (after: string) => {
    const body = Buffer.from(
      JSON.stringify({
        ref: 'refs/heads/main',
        after,
        deleted: false,
        repository: { id: f.repo.id, full_name: f.repo.fullName },
        installation: { id: f.installationId },
      }),
    )
    return receiveWebhook({
      secret: 'webhook-secret',
      delivery: { event: 'push', deliveryId: String(randomInt(1, 2 ** 31)), signature: `sha256=${createHmac('sha256', 'webhook-secret').update(body).digest('hex')}`, body },
      withPlatform: (fn) => f.org.router.withPlatform(fn),
      debounceMs: 0,
    })
  }
  const lastSync = () =>
    f.org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ last_sync_sha: string | null; last_sync_error: string | null }>(
        'SELECT last_sync_sha, last_sync_error FROM repo_connections WHERE id = $1',
        [connectionId],
      )
      return { sha: rows[0]?.last_sync_sha, error: rows[0]?.last_sync_error }
    })

  beforeAll(async () => {
    f = await createRepoFixture()
    const deps = { router: f.org.router, keyring: f.org.keyring, github: f.github }
    loop = repoJobLoop({ ...deps, pool: f.org.db.app, sync: repoSync(deps), exports: exportPr(deps), log })
    connectionId = await f.connect()
  })
  afterAll(async () => {
    await loop?.stop()
    await f?.close()
  })

  it('runs the initial import that connecting queued', async () => {
    expect(await loop.drain()).toBe(1)
    const [job] = await jobs()
    expect(job).toMatchObject({ kind: 'sync', outcome: 'ok', attempts: 1 })
    expect(lines.at(-1)).toMatch(/upserted=12 retired=0 exported=0/)
  })

  it('leaves a debounced push waiting until its time, then syncs it once', async () => {
    const pushes = []
    for (const n of [1, 2, 3]) pushes.push(await f.git.push(f.repo.fullName, { files: { 'README.md': `# ${n}\n` }, webhook: false }))
    for (let n = 0; n < pushes.length; n += 1) {
      await f.org.router.withPlatform((tx) =>
        enqueueRepoJob(tx, { orgId: f.org.orgId, connectionId, kind: 'sync', requestedBy: 'github:push', delayMs: 60_000 }),
      )
    }
    expect(await loop.drain()).toBe(0)
    await f.org.db.admin.query('UPDATE platform.repo_jobs SET run_after = now() WHERE started_at IS NULL')
    expect(await loop.drain()).toBe(1)
    expect(lines.at(-1)).toContain(`commit=${pushes[2]?.sha.slice(0, 7)}`)
    expect(lines.at(-1)).toContain('requests=3')
  })

  it('syncs the branch head whatever order the push deliveries arrive in, and never goes back to an older commit', async () => {
    const older = await f.git.push(f.repo.fullName, { files: { 'README.md': '# older\n' }, webhook: false })
    const newer = await f.git.push(f.repo.fullName, { files: { 'README.md': '# newer\n' }, webhook: false })
    await deliver(newer.sha)
    await deliver(older.sha)
    expect(await loop.drain()).toBe(1)
    expect(lines.at(-1)).toContain(`commit=${newer.sha.slice(0, 7)}`)
    expect(await lastSync()).toEqual({ sha: newer.sha, error: null })

    // An earlier attempt at the same head failed and left its error on the connection.
    await f.org.withOrg(({ tx }) => tx.query("UPDATE repo_connections SET last_sync_error = 'GitHub answered 502' WHERE id = $1", [connectionId]))
    await deliver(older.sha)
    expect(await loop.drain()).toBe(1)
    expect(lines.at(-1)).toContain('already synced at the branch head')
    expect(await lastSync()).toEqual({ sha: newer.sha, error: null })
  })

  it('retries a failing sync with backoff, and gives up on a connection that is gone', async () => {
    await f.org.db.admin.query("UPDATE platform.repo_routes SET branch = 'gone' WHERE connection_id = $1", [connectionId])
    await f.org.router.withPlatform((tx) => enqueueRepoJob(tx, { orgId: f.org.orgId, connectionId, kind: 'sync', requestedBy: 'test' }))
    await loop.drain()
    const failed = (await jobs()).at(-1)
    expect(failed).toMatchObject({ started_at: null, finished_at: null, attempts: 1 })
    expect(failed?.error).toMatch(/answered 404/)
    expect(lines.at(-1)).toMatch(/will retry/)

    await f.org.router.withTenant(f.org.orgId, (tx) => tx.query('UPDATE repo_connections SET disconnected_at = now() WHERE id = $1', [connectionId]))
    await f.org.db.admin.query('UPDATE platform.repo_jobs SET run_after = now() WHERE started_at IS NULL')
    await loop.drain()
    expect((await jobs()).at(-1)).toMatchObject({ outcome: 'error', attempts: 2 })
    await f.org.db.admin.query("UPDATE platform.repo_routes SET branch = 'main' WHERE connection_id = $1", [connectionId])
    await f.org.router.withTenant(f.org.orgId, (tx) => tx.query('UPDATE repo_connections SET disconnected_at = NULL WHERE id = $1', [connectionId]))
  })

  it('queues again a job a stopped worker left running', async () => {
    await f.org.router.withPlatform((tx) => enqueueRepoJob(tx, { orgId: f.org.orgId, connectionId, kind: 'sync', requestedBy: 'test' }))
    await f.org.db.admin.query("UPDATE platform.repo_jobs SET started_at = now() - interval '1 hour', attempts = 1 WHERE started_at IS NULL")
    expect(await requeueStale(f.org.router)).toBe(1)
    const [abandoned, again] = (await jobs()).slice(-2)
    expect(abandoned).toMatchObject({ outcome: 'abandoned' })
    expect(again).toMatchObject({ started_at: null, outcome: null })
  })

  it('joins an abandoned sync to the push waiting behind it', async () => {
    await f.org.db.admin.query("UPDATE platform.repo_jobs SET started_at = coalesce(started_at, now()), finished_at = now(), outcome = 'ok' WHERE finished_at IS NULL")
    const enqueue = () =>
      f.org.router.withPlatform((tx) => enqueueRepoJob(tx, { orgId: f.org.orgId, connectionId, kind: 'sync', requestedBy: 'github:push' }))
    await enqueue()
    await f.org.db.admin.query("UPDATE platform.repo_jobs SET started_at = now() - interval '1 hour', attempts = 1 WHERE started_at IS NULL")
    await enqueue()
    expect(await requeueStale(f.org.router)).toBe(1)
    const waiting = (await jobs()).filter((job) => job.started_at === null && job.finished_at === null)
    expect(waiting).toHaveLength(1)
  })
})
