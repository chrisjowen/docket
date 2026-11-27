// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, randomInt } from 'node:crypto'

import { insertOrg, newTenantId, tenantRouter, upsertGitHubUser, type TenantRouter } from '@docket/platform-tenancy'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { linkInstallation } from './connections.js'
import { receiveWebhook, type WebhookDelivery } from './webhooks.js'

const SECRET = 'webhook-secret-for-tests'

function delivery(event: string, payload: unknown, secret = SECRET): WebhookDelivery {
  const body = Buffer.from(JSON.stringify(payload))
  return {
    event,
    deliveryId: String(randomInt(1, 2 ** 31)),
    signature: `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    body,
  }
}

describe.skipIf(!TEST_PG_URL)('the webhook endpoint', () => {
  let db: TestDatabase
  let router: TenantRouter
  const orgId = newTenantId()
  const installationId = 31337
  const repo = { id: 9001, full_name: 'acme/platform' }
  const connectionId = newTenantId()

  const push = (branch: string, after: string) => ({
    ref: `refs/heads/${branch}`,
    before: '0'.repeat(40),
    after,
    deleted: false,
    repository: repo,
    installation: { id: installationId },
  })
  const receive = (d: WebhookDelivery, debounceMs?: number) =>
    receiveWebhook({
      secret: SECRET,
      delivery: d,
      withPlatform: (fn) => router.withPlatform(fn),
      ...(debounceMs === undefined ? {} : { debounceMs }),
    })
  const jobs = async () =>
    (
      await db.admin.query<{ id: string; requests: number; started_at: Date | null; run_after: Date; created_at: Date }>(
        'SELECT * FROM platform.repo_jobs ORDER BY id',
      )
    ).rows

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
    await router.withPlatform(async (tx) => {
      const owner = await upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login: 'alice', name: null, avatarUrl: null, emails: [] })
      await insertOrg(tx, { id: orgId, slug: `o-${orgId}`, name: 'Acme', ownerId: owner.id })
      await tx.query("UPDATE platform.orgs SET status = 'active' WHERE id = $1", [orgId])
      await linkInstallation(tx, { installationId, orgId, accountLogin: 'acme', accountType: 'Organization', linkedBy: owner.id })
      await tx.query(
        `INSERT INTO platform.repo_routes (connection_id, org_id, installation_id, repo_id, repo_full_name, branch)
         VALUES ($1, $2, $3, $4, $5, 'main')`,
        [connectionId, orgId, installationId, repo.id, repo.full_name],
      )
    })
  })
  afterAll(() => db?.drop())

  it('answers 401 to a bad X-Hub-Signature-256 and queues nothing', async () => {
    const forged = delivery('push', push('main', 'a'.repeat(40)), 'not-the-secret')
    expect((await receive(forged)).status).toBe(401)
    expect((await receive({ ...forged, signature: null })).status).toBe(401)
    expect(await jobs()).toEqual([])
  })

  it('ignores a push to a branch no connection tracks', async () => {
    const response = await receive(delivery('push', push('feature/x', 'b'.repeat(40))))
    expect(response).toMatchObject({ status: 200, result: { status: 'ignored', reason: 'no connection tracks acme/platform@feature/x' } })
    expect(await jobs()).toEqual([])
  })

  it('makes 3 pushes within 10 s one sync job', async () => {
    const shas = ['1', '2', '3'].map((digit) => digit.repeat(40))
    const responses = []
    for (const sha of shas) responses.push(await receive(delivery('push', push('main', sha))))
    expect(responses.map((response) => response.status)).toEqual([202, 202, 202])
    expect(responses.map((response) => response.result?.jobs[0]?.joined)).toEqual([false, true, true])
    const queued = await jobs()
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ requests: 3, started_at: null })
    // It waits out the debounce window from the first push.
    const wait = (queued[0]?.run_after.getTime() ?? 0) - (queued[0]?.created_at.getTime() ?? 0)
    expect(wait).toBeGreaterThanOrEqual(9_000)
    expect(wait).toBeLessThanOrEqual(10_500)
  })

  it('starts a new job once the queued one is running', async () => {
    await db.admin.query('UPDATE platform.repo_jobs SET started_at = now()')
    await receive(delivery('push', push('main', '4'.repeat(40))))
    expect((await jobs()).map((job) => job.started_at === null)).toEqual([false, true])
  })

  it('stops routing pushes for a repo the installation lost, and for an uninstalled app', async () => {
    await db.admin.query('DELETE FROM platform.repo_jobs')
    const removed = await receive(delivery('installation_repositories', { action: 'removed', installation: { id: installationId }, repositories_removed: [{ id: repo.id }] }))
    expect(removed.result).toMatchObject({ status: 'recorded', orgIds: [orgId] })
    expect((await receive(delivery('push', push('main', '5'.repeat(40))))).result?.status).toBe('ignored')

    await receive(delivery('installation_repositories', { action: 'added', installation: { id: installationId }, repositories_added: [{ id: repo.id }] }))
    expect((await receive(delivery('push', push('main', '6'.repeat(40))))).result?.status).toBe('queued')

    await receive(delivery('installation', { action: 'deleted', installation: { id: installationId } }))
    await db.admin.query('DELETE FROM platform.repo_jobs')
    expect((await receive(delivery('push', push('main', '7'.repeat(40))))).result?.status).toBe('ignored')
    expect(await jobs()).toEqual([])
  })

  it('answers 400 to a signed body that is not JSON, and ignores events it does not handle', async () => {
    const body = Buffer.from('not json')
    const signature = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
    expect((await receive({ event: 'push', deliveryId: '1', signature, body })).status).toBe(400)
    expect((await receive(delivery('issues', { action: 'opened' }))).result).toMatchObject({ status: 'ignored' })
    expect((await receive(delivery('ping', { zen: 'hi' }))).status).toBe(200)
  })
})
