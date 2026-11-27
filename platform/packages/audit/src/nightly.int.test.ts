// SPDX-License-Identifier: AGPL-3.0-only
import { webcrypto } from 'node:crypto'

import { platformKeyService } from '@docket/platform-keys'
import { postgresProvisioner } from '@docket/platform-provisioner'
import { insertOrg, newTenantId, tenantRouter, upsertGitHubUser, type TenantRouter } from '@docket/platform-tenancy'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { audit } from './audit.js'
import { chainCheckStatus, verifyAllChains } from './nightly.js'

describe.skipIf(!TEST_PG_URL)('the nightly chain check', () => {
  let db: TestDatabase
  let router: TenantRouter
  const orgId = newTenantId()

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
    const keys = await platformKeyService({ kek: webcrypto.getRandomValues(new Uint8Array(32)), kekId: 'k' })
    await router.withPlatform(async (tx) => {
      const owner = await upsertGitHubUser(tx, { id: Math.floor(Math.random() * 1e9), login: `o${orgId}`, name: null, avatarUrl: null, emails: [] })
      await insertOrg(tx, { id: orgId, slug: `s-${orgId}`, name: 'Org', ownerId: owner.id })
    })
    await postgresProvisioner({ admin: db.admin, keys, appRole: db.appRole }).provision({ orgId })
    const event = { actor: 'system:test' as const, action: 'test', outcome: 'ok' as const, latencyMs: 1, requestId: 'r' }
    await router.withPlatform((tx) => audit(tx, { ...event, orgId: null }))
    for (let i = 0; i < 3; i += 1) await router.withTenant(orgId, (tx) => audit(tx, { ...event, orgId }))
  })
  afterAll(() => db?.drop())

  it('records a passing verdict for the platform log and each org, and a failing one after tampering', async () => {
    expect(await verifyAllChains(router)).toEqual([
      { scope: 'platform', ok: true, events: 1 },
      { scope: orgId, ok: true, events: 3 },
    ])
    let status = await router.withPlatform(chainCheckStatus)
    expect(status.map(({ scope, ok, events }) => ({ scope, ok, events }))).toEqual([
      { scope: 'platform', ok: true, events: 1 },
      { scope: orgId, ok: true, events: 3 },
    ].sort((a, b) => (a.scope < b.scope ? -1 : 1)))

    await db.superuser.query(`UPDATE org_${orgId}.audit_event SET outcome = 'denied' WHERE seq = (SELECT min(seq) FROM org_${orgId}.audit_event)`)
    const verdicts = await verifyAllChains(router)
    expect(verdicts.find((verdict) => verdict.scope === orgId)).toMatchObject({ ok: false })
    status = await router.withPlatform(chainCheckStatus)
    expect(status.find((row) => row.scope === orgId)).toMatchObject({ ok: false, brokenAt: expect.any(String) })
    expect(status.find((row) => row.scope === 'platform')).toMatchObject({ ok: true })
  })
})
