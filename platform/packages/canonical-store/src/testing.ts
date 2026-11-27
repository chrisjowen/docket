// SPDX-License-Identifier: AGPL-3.0-only
import { randomInt, webcrypto } from 'node:crypto'

import { platformKeyService } from '@docket/platform-keys'
import { postgresProvisioner } from '@docket/platform-provisioner'
import { insertOrg, newTenantId, tenantRouter, upsertGitHubUser, type TenantRouter } from '@docket/platform-tenancy'
import { createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'

import type { StoreContext } from './documents.js'
import { keyring, type Keyring } from './keyring.js'

export { FIXTURE_ROOT, readFixture, type Fixture } from './fixture.js'

export interface TestOrg {
  db: TestDatabase
  router: TenantRouter
  keyring: Keyring
  orgId: string
  /** The owner, a GitHub user. */
  userId: string
  login: string
  /** Runs `fn` in one transaction as the org, with its data keys. */
  withOrg<T>(fn: (ctx: StoreContext) => Promise<T>): Promise<T>
  /** Provisions another org, with an owner of its own, in the same database and keyring: another account beside this one. */
  addOrg(): Promise<{ orgId: string; userId: string; login: string }>
  drop(): Promise<void>
}

/** A throwaway database with one provisioned org, shaped like production. Needs `DOCKET_TEST_PG_URL`. */
export async function createTestOrg(): Promise<TestOrg> {
  const db = await createTestDatabase()
  const router = tenantRouter(db.app)
  const keys = await platformKeyService({ kek: webcrypto.getRandomValues(new Uint8Array(32)), kekId: 'test' })
  const addOrg = async () => {
    const orgId = newTenantId()
    const login = `owner${orgId.slice(0, 6)}`
    const userId = await router.withPlatform(async (tx) => {
      const owner = await upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login, name: null, avatarUrl: null, emails: [] })
      await insertOrg(tx, { id: orgId, slug: `o-${orgId}`, name: 'Test org', ownerId: owner.id })
      return owner.id
    })
    await postgresProvisioner({ admin: db.admin, keys, appRole: db.appRole }).provision({ orgId })
    return { orgId, userId, login }
  }
  const { orgId, userId, login } = await addOrg()
  const ring = keyring({ keys, platform: (fn) => router.withPlatform(fn) })
  return {
    db,
    router,
    keyring: ring,
    orgId,
    userId,
    login,
    async withOrg(fn) {
      const orgKeys = await ring.forOrg(orgId)
      return router.withTenant(orgId, (tx) => fn({ tx, keys: orgKeys }))
    },
    addOrg,
    drop: () => db.drop(),
  }
}
