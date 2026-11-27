// SPDX-License-Identifier: AGPL-3.0-only

import { tenantRouter, upsertGitHubUser, type TenantRouter } from '@docket/platform-tenancy'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SESSION_IDLE_MS, createSession, hashSecret, readSession, revokeSession } from './session.js'

describe.skipIf(!TEST_PG_URL)('sessions', () => {
  let db: TestDatabase
  let router: TenantRouter
  let userId: string

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
    userId = (
      await router.withPlatform((tx) =>
        upsertGitHubUser(tx, { id: 1, login: 'alice', name: null, avatarUrl: null, emails: [] }),
      )
    ).id
  })
  afterAll(() => db?.drop())

  it('stores only the hash of the session id', async () => {
    const { id } = await router.withPlatform((tx) => createSession(tx, { userId, ip: null, userAgent: null }))
    const { rows } = await db.superuser.query('SELECT id_hash FROM platform.sessions')
    expect(rows.map((row) => row.id_hash)).toContain(hashSecret(id))
    expect(JSON.stringify(rows)).not.toContain(id)
    expect(await router.withPlatform((tx) => readSession(tx, id))).toMatchObject({ userId })
  })

  it('ends a session after 7 idle days, after 30 days in all, and on revoke', async () => {
    const start = new Date('2026-11-01T00:00:00Z')
    const at = (ms: number) => new Date(start.getTime() + ms)
    const { id } = await router.withPlatform((tx) =>
      createSession(tx, { userId, ip: '127.0.0.1', userAgent: 'vitest', now: start }),
    )
    expect(await router.withPlatform((tx) => readSession(tx, id, at(SESSION_IDLE_MS - 1000)))).not.toBeNull()
    // Each read inside the idle window keeps it alive, up to the absolute limit.
    for (let day = 12; day < 30; day += 6) {
      expect(await router.withPlatform((tx) => readSession(tx, id, at(day * 86_400_000)))).not.toBeNull()
    }
    expect(await router.withPlatform((tx) => readSession(tx, id, at(30 * 86_400_000)))).toBeNull()

    const second = await router.withPlatform((tx) => createSession(tx, { userId, ip: null, userAgent: null, now: start }))
    expect(await router.withPlatform((tx) => readSession(tx, second.id, at(SESSION_IDLE_MS)))).toBeNull()

    const third = await router.withPlatform((tx) => createSession(tx, { userId, ip: null, userAgent: null }))
    await router.withPlatform((tx) => revokeSession(tx, third.id))
    expect(await router.withPlatform((tx) => readSession(tx, third.id))).toBeNull()
  })

  it('ignores a malformed cookie without a query', async () => {
    expect(await router.withPlatform((tx) => readSession(tx, "x' OR 1=1 --"))).toBeNull()
  })
})
