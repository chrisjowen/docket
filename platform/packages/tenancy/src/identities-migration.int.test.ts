// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import down0015 from '../migrations/platform/0015_identities.down.sql?raw'
import { ident } from './db.js'
import { identitiesOf, resolveIdentity } from './identity.js'
import { PLATFORM_MIGRATIONS } from './migrations.js'
import { tenantRouter, type TenantRouter } from './router.js'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from './testing.js'

const IDENTITIES = PLATFORM_MIGRATIONS.find((migration) => migration.name === '0015_identities')

describe.skipIf(!TEST_PG_URL)('identities beside GitHub (platform 0015)', () => {
  let db: TestDatabase
  let router: TenantRouter

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
  })
  afterAll(() => db?.drop())

  const up = () => db.admin.query((IDENTITIES?.sql ?? 'SELECT missing_migration').replaceAll('{{app_role}}', ident(db.appRole)))

  it('gives every GitHub user already here their GitHub identity, and lets a person without GitHub in', async () => {
    await db.admin.query(down0015)
    // A user as a build before 0015 made them: GitHub only.
    await db.admin.query(`INSERT INTO platform.users (id, kind, github_id, login) VALUES ('u-old', 'human', 4242, 'old-timer')`)
    await expect(db.admin.query(`INSERT INTO platform.users (id, kind, login) VALUES ('u-none', 'human', 'no.github')`)).rejects.toThrow(/check constraint/)

    await up()
    expect(await router.withPlatform((tx) => identitiesOf(tx, 'u-old'))).toMatchObject([{ provider: 'github', issuer: 'github', subject: '4242' }])
    const person = await router.withPlatform((tx) =>
      resolveIdentity(tx, { provider: 'oidc', issuer: 'https://idp.example.com', subject: 's', login: 'no.github', name: null, avatarUrl: null, emails: [] }),
    )
    expect(person).toMatchObject({ kind: 'human', login: 'no.github' })
    // A service account still has no GitHub account.
    await expect(db.admin.query(`INSERT INTO platform.users (id, kind, github_id, login, service_org_id) VALUES ('svc', 'service', 1, 'bot', 'nowhere')`)).rejects.toThrow(/users_service_without_github|foreign key/)
  })

  it('refuses to revert while anyone signs in without GitHub', async () => {
    await expect(db.admin.query(down0015)).rejects.toThrow(/people without a GitHub identity exist/)
  })
})
