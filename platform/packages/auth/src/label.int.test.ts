// SPDX-License-Identifier: AGPL-3.0-only
import { tenantRouter, type TenantRouter } from '@docket/platform-tenancy'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { actsFor, principalLabel } from './label.js'

describe.skipIf(!TEST_PG_URL)('principalLabel', () => {
  let db: TestDatabase
  let router: TenantRouter

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
    await db.admin.query(`
      INSERT INTO platform.users (id, kind, github_id, login) VALUES ('u-alice', 'human', 1, 'alice');
      INSERT INTO platform.oauth_store (model, id_hash, payload, client_id)
        VALUES ('Client', repeat('a', 64), '{"client_name": "Claude Code\\nINJECTED"}', 'dcr-client-1');
    `)
  }, 60_000)
  afterAll(() => db?.drop())

  const label = (principal: Parameters<typeof principalLabel>[1]) => router.withPlatform((tx) => principalLabel(tx, principal))

  it('names a token by its owner and a short token id', async () => {
    expect(await label({ userId: 'u-alice', via: 'token', tokenId: 'tok_8f3a9b2c1d0e' })).toBe('alice (token tok_8f3a…)')
  })

  it('names an OAuth client by its registered name, on one line, acting for the signed-in user', async () => {
    expect(await label({ userId: 'u-alice', via: 'oauth', clientId: 'dcr-client-1', tokenId: 'grant1' })).toBe('Claude Code INJECTED via alice (oauth)')
  })

  it('names a metadata-document client by its host', async () => {
    expect(await label({ userId: 'u-alice', via: 'oauth', clientId: 'https://tools.example.com/client.json', tokenId: 'grant2' })).toBe(
      'tools.example.com via alice (oauth)',
    )
  })
})

describe.skipIf(!TEST_PG_URL)('actsFor', () => {
  let db: TestDatabase
  let router: TenantRouter

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
    await db.admin.query(`
      INSERT INTO platform.users (id, kind, github_id, login) VALUES ('u-dana', 'human', 1, 'dana'), ('u-tom', 'human', 2, 'tom');
      INSERT INTO platform.orgs (id, slug, name, created_by) VALUES ('orga', 'acme', 'Acme', 'u-dana');
      INSERT INTO platform.memberships (org_id, user_id, role) VALUES ('orga', 'u-dana', 'owner');
      INSERT INTO platform.users (id, kind, login, service_org_id, created_by, accountable_user_id) VALUES
        ('s-ci', 'service', 'ci-bot', 'orga', 'u-dana', 'u-dana'),
        ('s-old', 'service', 'old-bot', 'orga', NULL, NULL),
        ('s-gone', 'service', 'gone-bot', 'orga', 'u-tom', 'u-tom');
    `)
  }, 60_000)
  afterAll(() => db?.drop())

  const acting = (userId: string) => router.withPlatform((tx) => actsFor(tx, userId))

  it('is a person for themselves, and a service account’s accountable person while they are a member', async () => {
    expect(await acting('u-dana')).toBe('dana')
    expect(await acting('s-ci')).toBe('dana')
    // No one named, or someone no longer in the org: it acts for no one.
    expect(await acting('s-old')).toBeUndefined()
    expect(await acting('s-gone')).toBeUndefined()
  })
})
