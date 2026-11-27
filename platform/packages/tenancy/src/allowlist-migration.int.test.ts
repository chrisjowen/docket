// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PLATFORM_MIGRATIONS } from './migrations.js'
import { isUserAllowlisted, mayEnterBeta, upsertGitHubUser, type GitHubIdentity } from './model.js'
import { tenantRouter, type TenantRouter } from './router.js'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from './testing.js'

const KEYED_BY_ID = PLATFORM_MIGRATIONS.find((migration) => migration.name === '0008_beta_allowlist_github_id')

describe.skipIf(!TEST_PG_URL)('keying the beta allowlist by GitHub id', () => {
  let db: TestDatabase
  let router: TenantRouter

  const identity = (id: number, login: string): GitHubIdentity => ({ id, login, name: null, avatarUrl: null, emails: [] })

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
    // The allowlist as it was before the migration: keyed by login alone.
    await db.admin.query(`
      DROP INDEX platform.beta_allowlist_pending_login;
      ALTER TABLE platform.beta_allowlist DROP COLUMN github_id;
      ALTER TABLE platform.beta_allowlist ADD PRIMARY KEY (github_login);
    `)
  })
  afterAll(() => db?.drop())

  it('keeps everyone already in, and admits no one new under their logins', async () => {
    const signedIn = await router.withPlatform((tx) => upsertGitHubUser(tx, identity(501, 'Signed-In')))
    const invited = identity(502, 'invited-new')
    const renamedInvitee = identity(503, 'moved')
    await router.withPlatform((tx) => upsertGitHubUser(tx, renamedInvitee))
    await db.admin.query(`
      INSERT INTO platform.waitlist (id, via, github_id, github_login, status, invited_at)
      VALUES ('w1', 'github', 502, 'invited-new', 'invited', now()), ('w2', 'github', 503, 'moved-was', 'invited', now());
      INSERT INTO platform.beta_allowlist (github_login) VALUES
        ('signed-in'), ('invited-new'), ('moved'), ('moved-was'), ('never-signed-in');
    `)

    await db.admin.query(KEYED_BY_ID?.sql ?? 'SELECT missing_migration')

    const { rows } = await db.admin.query<{ github_login: string; github_id: string | null }>(
      'SELECT github_login, github_id FROM platform.beta_allowlist ORDER BY github_login',
    )
    // 'moved-was' named the same account as 'moved', which keeps the grant.
    expect(rows).toEqual([
      { github_login: 'invited-new', github_id: '502' },
      { github_login: 'moved', github_id: '503' },
      { github_login: 'never-signed-in', github_id: null },
      { github_login: 'signed-in', github_id: '501' },
    ])

    // A session from before the migration still counts as allowlisted.
    expect(await router.withPlatform((tx) => isUserAllowlisted(tx, signedIn.id))).toBe(true)
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, invited))).toBe(true)
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, { ...renamedInvitee, login: 'moved-again' }))).toBe(true)
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, identity(506, 'moved-was')))).toBe(false)
    // A login no account has signed in under yet waits for the first one that does.
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, identity(504, 'never-signed-in')))).toBe(true)
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, identity(505, 'never-signed-in')))).toBe(false)
  })
})
