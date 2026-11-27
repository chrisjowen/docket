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
      INSERT INTO platform.orgs (id, slug, name, created_by) VALUES ('orga', 'acme', 'Acme', 'u-alice');
      INSERT INTO platform.users (id, kind, login, service_org_id, created_by) VALUES ('s-sync', 'service', 'github-sync', 'orga', 'u-alice');
      INSERT INTO platform.memberships (org_id, user_id, role) VALUES ('orga', 'u-alice', 'owner'), ('orga', 's-sync', 'editor');
      INSERT INTO platform.oauth_store (model, id_hash, payload, client_id)
        VALUES ('Client', repeat('a', 64), '{"client_name": "Claude Code\\nINJECTED"}', 'dcr-client-1');
      INSERT INTO platform.api_tokens (id, token_hash, prefix, org_id, owner_id, dockets, description, created_by, expires_at)
        VALUES ('tok_actions00001', repeat('b', 64), 'dkt_sys_aaaaaaaa', 'orga', 's-sync', ARRAY['ws1'], 'actions', 'u-alice', now() + interval '1 day');
      INSERT INTO platform.oauth_connections (grant_id, org_id, user_id, client_id, name, dockets)
        VALUES ('grant-laptop', 'orga', 'u-alice', 'dcr-client-1', 'Claude Code — work laptop', ARRAY['ws1']);
    `)
  }, 60_000)
  afterAll(() => db?.drop())

  const label = (principal: Parameters<typeof principalLabel>[1]) => router.withPlatform((tx) => principalLabel(tx, principal))

  it('names a token by its owner and its name, or a short id when it has none', async () => {
    expect(await label({ userId: 's-sync', via: 'token', tokenId: 'tok_actions00001' })).toBe("github-sync with token 'actions'")
    expect(await label({ userId: 'u-alice', via: 'token', tokenId: 'tok_8f3a9b2c1d0e' })).toBe('alice with token tok_8f3a…')
  })

  it('names a connection by its owner and its name', async () => {
    expect(await label({ userId: 'u-alice', via: 'oauth', clientId: 'dcr-client-1', tokenId: 'grant-laptop' })).toBe("alice via 'Claude Code — work laptop'")
  })

  it('names a grant made before connections by its client’s registered name, on one line, acting for the signed-in user', async () => {
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
      INSERT INTO platform.users (id, kind, github_id, login) VALUES ('u-dana', 'human', 1, 'dana');
      INSERT INTO platform.orgs (id, slug, name, created_by) VALUES ('orga', 'acme', 'Acme', 'u-dana');
      INSERT INTO platform.memberships (org_id, user_id, role) VALUES ('orga', 'u-dana', 'owner');
      INSERT INTO platform.users (id, kind, login, service_org_id, created_by, accountable_user_id) VALUES
        ('s-ci', 'service', 'ci-bot', 'orga', 'u-dana', 'u-dana');
    `)
  }, 60_000)
  afterAll(() => db?.drop())

  const acting = (userId: string) => router.withPlatform((tx) => actsFor(tx, userId))

  it('is the person themselves, and no one for a system account, whatever an old record says', async () => {
    expect(await acting('u-dana')).toBe('dana')
    expect(await acting('s-ci')).toBeUndefined()
  })
})
