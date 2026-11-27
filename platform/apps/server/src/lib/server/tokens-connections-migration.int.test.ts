// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'

import { effectiveScopes, impliedScopes, listConnections, namespaceScopes, principalLabel, tokenResolver, type McpResource, type Scope } from '@docket/platform-auth'
import { insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { migratePlatform, namespaceAccess, transaction, type Tx } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import down0016 from '../../../../../packages/tenancy/migrations/platform/0016_tokens_and_connections.down.sql?raw'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
/** A `dkt_live_` token as the server issued them before personal and system tokens. */
const legacyToken = (seed: string) => {
  const body = seed.padEnd(43, '0').slice(0, 43)
  return `dkt_live_${body}_${crc32(`dkt_live_${body}`).toString(16).padStart(8, '0')}`
}

// Platform 0016 against the tokens and OAuth grants made before it: each keeps exactly what it could do.
describe.skipIf(!TEST_PG_URL)('tokens and grants become narrowed credentials and named connections (platform 0016)', () => {
  let org: TestOrg
  const platform = <T>(fn: (tx: Tx) => Promise<T>) => org.router.withPlatform(fn)
  const origin = 'https://docket.example'

  beforeAll(async () => {
    org = await createTestOrg()
  })
  afterAll(() => org?.drop())

  it('keeps every token and grant to what it could do, and names every grant after its client', async () => {
    const alpha = await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Alpha', slug: 'alpha', createdBy: org.userId }))
    const beta = await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Beta', slug: 'beta', createdBy: org.userId }))
    const resource = (workspaceId: string, slug: string): McpResource => ({ orgId: org.orgId, workspaceId, url: `${origin}/mcp/o-${org.orgId}/${slug}` })
    const at = { alpha: resource(alpha.id, 'alpha'), beta: resource(beta.id, 'beta') }

    // Back to before 0016: tokens bound to one workspace with scopes, grants with theirs, a service account that acts for a person.
    await transaction(org.db.admin, (tx) => tx.query(down0016))
    await org.db.admin.query(
      "INSERT INTO platform.users (id, kind, login, service_org_id, created_by, accountable_user_id) VALUES ('svc-1', 'service', 'ci-bot', $1, $2, $2)",
      [org.orgId, org.userId],
    )
    await org.db.admin.query("INSERT INTO platform.memberships (org_id, user_id, role) VALUES ($1, 'svc-1', 'editor')", [org.orgId])
    const tokens: { raw: string; scopes: Scope[]; workspace: McpResource; owner: string }[] = [
      { raw: legacyToken('read'), scopes: ['docket:read'], workspace: at.alpha, owner: org.userId },
      { raw: legacyToken('write'), scopes: ['docket:read', 'docket:write'], workspace: at.alpha, owner: org.userId },
      { raw: legacyToken('every'), scopes: ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write'], workspace: at.beta, owner: org.userId },
      { raw: legacyToken('onto'), scopes: ['ontology:read'], workspace: at.beta, owner: 'svc-1' },
    ]
    for (const [i, token] of tokens.entries()) {
      await org.db.admin.query(
        `INSERT INTO platform.api_tokens (id, token_hash, prefix, org_id, workspace_id, owner_id, scopes, description, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + interval '30 days')`,
        [`tok_legacy00000${i}`, sha256(token.raw), token.raw.slice(0, 17), org.orgId, token.workspace.workspaceId, token.owner, impliedScopes(token.scopes), i === 1 ? 'CI' : null, org.userId],
      )
    }
    const grants: { id: string; access: string; scopes: Scope[]; workspace: McpResource }[] = [
      { id: 'grant-read', access: 'a'.repeat(43), scopes: ['docket:read', 'ontology:read'], workspace: at.alpha },
      { id: 'grant-write', access: 'b'.repeat(43), scopes: ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose'], workspace: at.beta },
    ]
    const exp = Math.floor(Date.now() / 1000) + 900
    await org.db.admin.query(
      `INSERT INTO platform.oauth_store (model, id_hash, payload, client_id) VALUES ('Client', $1, '{"client_name": "Claude Code"}', 'client-cc')`,
      [sha256('client-cc')],
    )
    for (const grant of grants) {
      await org.db.admin.query(
        `INSERT INTO platform.oauth_store (model, id_hash, payload, grant_id, account_id, client_id, resource, expires_at)
         VALUES ('Grant', $1, $2, $3, $4, 'client-cc', $5, now() + interval '30 days'),
                ('AccessToken', $6, $7, $3, $4, 'client-cc', $5, now() + interval '15 minutes')`,
        [
          sha256(grant.id),
          { resources: { [grant.workspace.url]: grant.scopes.join(' ') }, iat: Math.floor(Date.now() / 1000) },
          grant.id,
          org.userId,
          grant.workspace.url,
          sha256(grant.access),
          { accountId: org.userId, clientId: 'client-cc', aud: grant.workspace.url, scope: grant.scopes.join(' '), grantId: grant.id, exp, extra: { org_id: org.orgId, workspace_id: grant.workspace.workspaceId } },
        ],
      )
    }

    // What each could do before: its scopes, cut to its owner's permission on its workspace (the old effectiveScopes).
    const before = async (scopes: Scope[], owner: string, workspace: McpResource) => {
      const access = await platform((tx) => namespaceAccess(tx, org.orgId, workspace.workspaceId, owner))
      const allowed = new Set(namespaceScopes(access, []))
      return impliedScopes(scopes).filter((scope) => allowed.has(scope))
    }
    const expected = [
      ...(await Promise.all(tokens.map((token) => before(token.scopes, token.owner, token.workspace)))),
      ...(await Promise.all(grants.map((grant) => before(grant.scopes, org.userId, grant.workspace)))),
    ]

    expect(await migratePlatform(org.db.admin, { appRole: org.db.appRole })).toBe(1)

    const resolver = tokenResolver({ platform, ttlMs: 0 })
    const now = async (raw: string, workspace: McpResource) => {
      const principal = await resolver.resolveBearer(raw, workspace)
      return principal ? effectiveScopes(principal, { platform }) : null
    }
    const after = [
      ...(await Promise.all(tokens.map((token) => now(token.raw, token.workspace)))),
      ...(await Promise.all(grants.map((grant) => now(grant.access, grant.workspace)))),
    ]
    expect(after).toEqual(expected)
    // Each still reaches its one docket only.
    for (const token of tokens) expect(await resolver.resolveBearer(token.raw, token.workspace === at.alpha ? at.beta : at.alpha)).toBeNull()
    for (const grant of grants) expect(await resolver.resolveBearer(grant.access, grant.workspace === at.alpha ? at.beta : at.alpha)).toBeNull()

    const { rows } = await org.db.admin.query('SELECT id, read_only, dockets, legacy_scopes FROM platform.api_tokens ORDER BY id')
    expect(rows).toEqual([
      { id: 'tok_legacy000000', read_only: true, dockets: [alpha.id], legacy_scopes: null },
      { id: 'tok_legacy000001', read_only: false, dockets: [alpha.id], legacy_scopes: ['docket:read', 'docket:write', 'ontology:read'] },
      { id: 'tok_legacy000002', read_only: false, dockets: [beta.id], legacy_scopes: null },
      { id: 'tok_legacy000003', read_only: true, dockets: [beta.id], legacy_scopes: ['ontology:read'] },
    ])
    const resources = new Map([[at.alpha.url, alpha.id], [at.beta.url, beta.id]])
    const connections = await platform((tx) => listConnections(tx, { orgId: org.orgId, resources }))
    expect(connections.map(({ id, name, readOnly, dockets, legacy }) => ({ id, name, readOnly, dockets, legacy })).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'grant-read', name: 'Claude Code', readOnly: true, dockets: [alpha.id], legacy: false },
      { id: 'grant-write', name: 'Claude Code', readOnly: false, dockets: [beta.id], legacy: false },
    ])

    // Provenance names the token and the connection; no person acts for the service account any more.
    const ci = await resolver.resolveBearer(tokens[1]!.raw, at.alpha)
    expect(await platform((tx) => principalLabel(tx, ci!))).toBe(`${org.login} with token 'CI'`)
    const connection = await resolver.resolveBearer(grants[0]!.access, at.alpha)
    expect(connection?.actor).toBe(`oauth:client-cc/conn:grant-read/user:${org.userId}`)
    expect(await platform((tx) => principalLabel(tx, connection!))).toBe(`${org.login} via 'Claude Code'`)
    const { rows: services } = await org.db.admin.query("SELECT accountable_user_id FROM platform.users WHERE id = 'svc-1'")
    expect(services).toEqual([{ accountable_user_id: null }])

    // The rollback is clean, and gives nothing back that 0016 took away.
    await transaction(org.db.admin, (tx) => tx.query(down0016))
    const { rows: rolled } = await org.db.admin.query('SELECT id, scopes FROM platform.api_tokens ORDER BY id')
    expect(rolled.map((row) => row.scopes)).toEqual(tokens.map((token) => impliedScopes(token.scopes)))
    expect(await migratePlatform(org.db.admin, { appRole: org.db.appRole })).toBe(1)
  })
})
