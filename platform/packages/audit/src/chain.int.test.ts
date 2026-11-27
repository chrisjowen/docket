// SPDX-License-Identifier: AGPL-3.0-only
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'
import { tenantRouter, type TenantRouter } from '@docket/platform-tenancy'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { audit, listAudit, verifyChain, verifyChainIn, type AuditEventInput } from './audit.js'
import { argsDigest } from './chain.js'

const event = (overrides: Partial<AuditEventInput> = {}): AuditEventInput => ({
  orgId: null,
  actor: 'user:u1',
  ip: '127.0.0.1',
  userAgent: 'vitest',
  action: 'auth.signin',
  outcome: 'ok',
  latencyMs: 12,
  requestId: 'req-1',
  ...overrides,
})

describe.skipIf(!TEST_PG_URL)('the audit log in Postgres', () => {
  let db: TestDatabase
  let router: TenantRouter

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
  })
  afterAll(() => db?.drop())

  it('verifyChain passes on an untouched log and reports brokenAt after a row is updated in SQL', async () => {
    const written = []
    for (let i = 0; i < 3; i += 1) {
      written.push(await router.withPlatform((tx) => audit(tx, event({ requestId: `req-${i}`, args: { i } }))))
    }
    expect(await router.withPlatform(verifyChainIn)).toEqual({ ok: true, events: 3 })

    const tampered = written[1]?.id
    await db.superuser.query("UPDATE platform.audit_event SET outcome = 'denied' WHERE id = $1", [tampered])
    expect(await router.withPlatform(verifyChainIn)).toEqual({ ok: false, brokenAt: tampered, events: 2 })
  })

  it('is append-only for the request role', async () => {
    await router.withPlatform((tx) => audit(tx, event()))
    await expect(
      router.withPlatform((tx) => tx.query("UPDATE audit_event SET outcome = 'denied'")),
    ).rejects.toThrow(/permission denied/)
    await expect(router.withPlatform((tx) => tx.query('DELETE FROM audit_event'))).rejects.toThrow(
      /permission denied/,
    )
  })

  it('keeps arguments only as a digest', async () => {
    const written = await router.withPlatform((tx) =>
      audit(tx, event({ action: 'members.invite', args: { who: 'secret-login' } })),
    )
    const { rows } = await db.superuser.query('SELECT * FROM platform.audit_event WHERE id = $1', [written.id])
    expect(JSON.stringify(rows[0])).not.toContain('secret-login')
    expect(rows[0].args_digest).toBe(argsDigest({ who: 'secret-login' }))
    const listed = await router.withPlatform((tx) => listAudit(tx, { actor: 'user:u1', limit: 1 }))
    expect(listed[0]?.id).toBe(written.id)
  })

  it('exposes verifyChain(orgId) over the tenant router', async () => {
    await expect(verifyChain(router, 'nosuchorg')).rejects.toThrow(/unavailable/)
  })
})
