// SPDX-License-Identifier: AGPL-3.0-only
import { webcrypto } from 'node:crypto'

import { platformKeyService } from '@docket/platform-keys'
import { insertOrg, newTenantId, tenantRouter, upsertGitHubUser } from '@docket/platform-tenancy'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { postgresProvisioner } from './postgres.js'
import { rewrapOrgKeys } from './rotate-kek.js'

const kek = () => webcrypto.getRandomValues(new Uint8Array(32))

describe.skipIf(!TEST_PG_URL)('rewrapOrgKeys', () => {
  let db: TestDatabase
  const orgs = [newTenantId(), newTenantId()]
  const v1 = { kek: kek(), kekId: 'platform-v1' }

  beforeAll(async () => {
    db = await createTestDatabase()
    const router = tenantRouter(db.app)
    const keys = await platformKeyService(v1)
    for (const orgId of orgs) {
      await router.withPlatform(async (tx) => {
        const owner = await upsertGitHubUser(tx, { id: Math.floor(Math.random() * 1e9), login: `o${orgId}`, name: null, avatarUrl: null, emails: [] })
        await insertOrg(tx, { id: orgId, slug: `s-${orgId}`, name: 'Org', ownerId: owner.id })
      })
      await postgresProvisioner({ admin: db.admin, keys, appRole: db.appRole }).provision({ orgId })
    }
  })
  afterAll(() => db?.drop())

  it('moves every data key under the new KEK without changing it, and is a no-op once done', async () => {
    const before = await platformKeyService(v1)
    const iv = webcrypto.getRandomValues(new Uint8Array(12))
    const { rows: original } = await db.admin.query('SELECT org_id, wrapped, kek_id FROM platform.org_keys ORDER BY org_id')
    const sealed = await Promise.all(
      original.map(async (row) =>
        webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, await before.unwrap(row.org_id, new Uint8Array(row.wrapped), row.kek_id), new TextEncoder().encode(row.org_id)),
      ),
    )

    const v2 = { kek: kek(), kekId: 'platform-v2' }
    const during = await platformKeyService({ ...v2, others: [v1] })
    expect(await rewrapOrgKeys(db.admin, during)).toEqual({ rewrapped: 2, remaining: {} })
    expect(await rewrapOrgKeys(db.admin, during)).toEqual({ rewrapped: 0, remaining: {} })

    // Only the new KEK is needed from now on, and every org's data still opens.
    const after = await platformKeyService(v2)
    const { rows } = await db.admin.query('SELECT org_id, wrapped, kek_id FROM platform.org_keys ORDER BY org_id')
    expect(rows.map((row) => row.kek_id)).toEqual(['platform-v2', 'platform-v2'])
    for (const [i, row] of rows.entries()) {
      const dek = await after.unwrap(row.org_id, new Uint8Array(row.wrapped), row.kek_id)
      const opened = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, sealed[i] as ArrayBuffer)
      expect(new TextDecoder().decode(opened)).toBe(row.org_id)
    }
  })
})
