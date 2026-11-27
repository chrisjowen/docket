// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import down0017 from '../migrations/platform/0017_capabilities_and_grants.down.sql?raw'
import { accessOf, listGrants } from './access.js'
import { ident, transaction, type Tx } from './db.js'
import { migrateBehindOrgs, migratePlatform } from './migrate.js'
import { ORG_MIGRATIONS } from './migrations.js'
import { insertOrg, upsertGitHubUser, type User } from './model.js'
import { newTenantId, orgRole, orgSchema } from './names.js'
import { ACCOUNT, capsAt, docketPlace, type Capability } from './roles.js'
import { tenantRouter, type TenantRouter } from './router.js'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from './testing.js'

/**
 * How access was decided before platform 0017, frozen here as the oracle the
 * backfill is checked against: an owner or admin is admin on every docket, a
 * provisioner on none, anyone else has their namespace grant; the org role
 * decides the rest; publishing needs admin, or write and a role the docket's
 * "ontology changes over MCP" setting names.
 */
type Old = { role: string; accountRole: string; grants: Map<string, string> }
const OLD_DOCKET: Record<string, Capability[]> = {
  read: ['read'],
  write: ['read', 'write', 'propose'],
  admin: ['read', 'write', 'propose', 'publish', 'decide', 'create', 'access', 'system', 'tokens', 'settings', 'delete', 'audit'],
}
function oldPermission(old: Old, docket: string): string | null {
  if (old.accountRole === 'owner' || old.accountRole === 'admin') return 'admin'
  if (old.accountRole === 'provisioner') return null
  return old.grants.get(docket) ?? null
}
function oldCaps(old: Old, docket: string, mcpRoles: readonly string[]): Capability[] {
  const permission = oldPermission(old, docket)
  if (!permission) return []
  const caps = new Set(OLD_DOCKET[permission])
  if (permission === 'write' && mcpRoles.includes(old.role)) caps.add('publish')
  return [...caps].sort()
}

describe.skipIf(!TEST_PG_URL)('capabilities and grants (platform 0017)', () => {
  let db: TestDatabase
  let router: TenantRouter
  let seq = 9000

  const human = (login: string) =>
    router.withPlatform((tx) => upsertGitHubUser(tx, { id: (seq += 1), login, name: null, avatarUrl: null, emails: [] }))

  /** Org migrations as a build before platform 0017 ran them: through 0018, superseded ones included. */
  async function migrateOrgBefore0017(tx: Tx, orgId: string): Promise<void> {
    const values: Record<string, string> = { schema: ident(orgSchema(orgId)), org_role: ident(orgRole(orgId)), org_id: orgId, app_role: ident(db.appRole) }
    for (const migration of ORG_MIGRATIONS.filter((each) => each.version <= 18)) {
      await tx.query(migration.sql.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] as string))
      await tx.query('INSERT INTO platform.schema_migrations (schema_name, version, name, checksum) VALUES ($1, $2, $3, $4)', [
        orgSchema(orgId),
        migration.version,
        migration.name,
        createHash('sha256').update(migration.sql).digest('hex'),
      ])
    }
    await tx.query('UPDATE platform.orgs SET schema_version = 18 WHERE id = $1', [orgId])
  }

  /** An active org with its schema and role, the way the Postgres provisioner made one before platform 0017. */
  async function provisioned(owner: User): Promise<string> {
    const id = newTenantId()
    await db.admin.query('INSERT INTO platform.orgs (id, slug, name, created_by) VALUES ($1, $2, $3, $4)', [id, `o-${id}`, 'Acme', owner.id])
    await db.admin.query("INSERT INTO platform.memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')", [id, owner.id])
    await transaction(db.admin, async (tx) => {
      await tx.query(`CREATE ROLE ${ident(orgRole(id))} NOLOGIN NOINHERIT`)
      await tx.query(`CREATE SCHEMA ${ident(orgSchema(id))}`)
      await migrateOrgBefore0017(tx, id)
      await tx.query(`GRANT ${ident(orgRole(id))} TO ${ident(db.appRole)} WITH INHERIT FALSE, SET TRUE`)
      await tx.query("UPDATE platform.orgs SET status = 'active' WHERE id = $1", [id])
    })
    return id
  }

  const join = (orgId: string, user: { id: string }, role: string) =>
    db.admin.query('INSERT INTO platform.memberships (org_id, user_id, role) VALUES ($1, $2, $3)', [orgId, user.id, role])

  async function workspace(orgId: string, slug: string, options: { deleted?: boolean; mcpRoles?: string[] } = {}): Promise<string> {
    const id = newTenantId()
    await db.admin.query(
      `INSERT INTO ${ident(orgSchema(orgId))}.workspaces (id, slug, name, created_by, deleted_at, ontology_mcp_roles) VALUES ($1, $2, $2, 'seed', $3, $4)`,
      [id, slug, options.deleted ? new Date() : null, options.mcpRoles ?? []],
    )
    return id
  }

  async function oldState(orgId: string): Promise<Map<string, Old>> {
    const { rows } = await db.admin.query<{ user_id: string; role: string; account_role: string }>(
      'SELECT user_id, role, account_role FROM platform.memberships WHERE org_id = $1',
      [orgId],
    )
    const { rows: grants } = await db.admin.query<{ principal_id: string; namespace_id: string; permission: string }>(
      'SELECT principal_id, namespace_id, permission FROM platform.namespace_grants WHERE org_id = $1',
      [orgId],
    )
    return new Map(
      rows.map((row) => [
        row.user_id,
        {
          role: row.role,
          accountRole: row.account_role,
          grants: new Map(grants.filter((grant) => grant.principal_id === row.user_id).map((grant) => [grant.namespace_id, grant.permission])),
        },
      ]),
    )
  }

  /** The platform and org schemas' shape, to check the down migration restores it. */
  async function catalog(): Promise<string[]> {
    const ours = (column: string) => `(${column} = 'platform' OR ${column} LIKE 'org\\_%')`
    const { rows } = await db.admin.query<{ entry: string }>(`
      SELECT concat_ws(' ', 'column', table_schema, table_name, column_name, data_type, is_nullable, column_default) AS entry
        FROM information_schema.columns WHERE ${ours('table_schema')}
      UNION ALL
      SELECT concat_ws(' ', 'trigger', pg_get_triggerdef(t.oid))
        FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE NOT t.tgisinternal AND ${ours('n.nspname')}
      UNION ALL
      SELECT concat_ws(' ', 'function', p.oid::regprocedure) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'platform'
      UNION ALL
      SELECT concat_ws(' ', 'grant', grantee, privilege_type, table_schema, table_name)
        FROM information_schema.role_table_grants WHERE ${ours('table_schema')}
      ORDER BY 1`)
    return rows.map((row) => row.entry)
  }

  const down = () => transaction(db.admin, (tx) => tx.query(down0017.replaceAll('{{app_role}}', ident(db.appRole))))
  /** What a server start does: the platform, then every org behind it. */
  const up = async () => {
    const applied = await migratePlatform(db.admin, { appRole: db.appRole })
    await migrateBehindOrgs(db.admin, { appRole: db.appRole })
    return applied
  }

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
  })
  afterAll(() => db?.drop())

  it("backfills grants that keep every member's access to every docket and to the account exactly, and reverts cleanly", async () => {
    await down()

    const owner = await human('mig-owner')
    const admin = await human('mig-admin')
    const editor = await human('mig-editor')
    const publisher = await human('mig-publisher')
    const viewer = await human('mig-viewer')
    const elsewhere = await human('mig-elsewhere')
    const acme = await provisioned(owner)
    const globex = await provisioned(elsewhere)
    const platformWs = await workspace(acme, 'platform')
    const payments = await workspace(acme, 'payments', { mcpRoles: ['editor'] })
    const legal = await workspace(acme, 'legal', { mcpRoles: ['owner', 'admin'] })
    await workspace(acme, 'gone', { deleted: true, mcpRoles: ['editor'] })
    await join(acme, admin, 'admin')
    await join(acme, editor, 'editor')
    await join(acme, publisher, 'editor')
    await join(acme, viewer, 'viewer')
    await join(globex, viewer, 'editor')
    const globexWs = await workspace(globex, 'research', { mcpRoles: ['editor'] })
    // A system account made in Settings, the org admin API's account, and a database account per level.
    const bot = randomUUID()
    await db.admin.query("INSERT INTO platform.users (id, kind, login, service_org_id) VALUES ($1, 'service', 'ci-bot', $2)", [bot, acme])
    await join(acme, { id: bot }, 'viewer')
    const orgAdmin = randomUUID()
    await db.admin.query("INSERT INTO platform.users (id, kind, login, service_org_id) VALUES ($1, 'service', 'org-admin', $2)", [orgAdmin, acme])
    await db.admin.query("INSERT INTO platform.memberships (org_id, user_id, role, account_role) VALUES ($1, $2, 'editor', 'provisioner')", [acme, orgAdmin])
    await db.admin.query('UPDATE platform.orgs SET org_admin_id = $2 WHERE id = $1', [acme, orgAdmin])
    const dbWriter = (await db.admin.query<{ id: string }>("SELECT platform.database_account($1, $2, 'write') AS id", [acme, payments])).rows[0]!.id
    const dbReader = (await db.admin.query<{ id: string }>("SELECT platform.database_account($1, $2, 'read') AS id", [acme, legal])).rows[0]!.id
    // An open invite of each kind.
    for (const [who, role] of [['inv-owner', 'owner'], ['inv-editor', 'editor']]) {
      await db.admin.query(
        "INSERT INTO platform.invites (id, org_id, github_login, role, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, now() + interval '7 days')",
        [randomUUID(), acme, who, role, owner.id],
      )
    }

    const mcp = new Map([[payments, ['editor']], [legal, ['owner', 'admin']], [platformWs, []], [globexWs, ['editor']]])
    const before = new Map([[acme, await oldState(acme)], [globex, await oldState(globex)]])
    const live = new Map([[acme, [platformWs, payments, legal]], [globex, [globexWs]]])

    const sixteen = await catalog()
    expect(await up()).toBe(1)
    const seventeen = await catalog()

    for (const [orgId, members] of before) {
      for (const [userId, old] of members) {
        const access = await router.withPlatform((tx) => accessOf(tx, orgId, userId))
        expect(access, userId).not.toBeNull()
        for (const docket of live.get(orgId) ?? []) {
          expect([...capsAt(access, docketPlace(docket))].sort(), `${userId} on ${docket}`).toEqual(oldCaps(old, docket, mcp.get(docket) ?? []))
        }
        expect(access?.owner).toBe(old.role === 'owner')
        expect(access?.guest).toBe(old.accountRole === 'guest')
      }
    }
    // Spot checks in the model's own words.
    const publisherGrants = await router.withPlatform((tx) => listGrants(tx, acme, { userId: publisher.id }))
    expect(publisherGrants.map((grant) => [grant.place, grant.role.id, grant.add])).toEqual([
      [ACCOUNT, 'writer', []],
      [docketPlace(payments), 'writer', ['publish']],
    ])
    expect((await router.withPlatform((tx) => listGrants(tx, acme, { userId: dbWriter }))).map((grant) => [grant.place, grant.role.id])).toEqual([
      [docketPlace(payments), 'writer'],
    ])
    expect(await router.withPlatform((tx) => listGrants(tx, acme, { userId: orgAdmin }))).toEqual([])
    expect([...capsAt(await router.withPlatform((tx) => accessOf(tx, acme, dbReader)), docketPlace(legal))]).toEqual(['read'])
    const { rows: invites } = await db.admin.query<{ github_login: string; role_id: string; owner: boolean; place_kind: string }>(
      'SELECT github_login, role_id, owner, place_kind FROM platform.invites WHERE org_id = $1 ORDER BY github_login',
      [acme],
    )
    expect(invites).toEqual([
      { github_login: 'inv-editor', role_id: 'writer', owner: false, place_kind: 'account' },
      { github_login: 'inv-owner', role_id: 'admin', owner: true, place_kind: 'account' },
    ])

    // A new docket's grants come with nothing derived; deleting a docket takes its grants.
    await db.admin.query(`DELETE FROM ${ident(orgSchema(acme))}.workspaces WHERE id = $1`, [payments])
    expect((await router.withPlatform((tx) => listGrants(tx, acme, { place: docketPlace(payments) })))).toEqual([])

    // The down migration brings the old shape back, and nobody gains anything.
    await down()
    expect(await catalog()).toEqual(sixteen)
    const restored = await oldState(acme)
    expect(restored.get(publisher.id)).toMatchObject({ role: 'editor', accountRole: 'developer' })
    expect(restored.get(owner.id)).toMatchObject({ role: 'owner', accountRole: 'owner' })
    expect(restored.get(dbReader)).toMatchObject({ accountRole: 'guest', grants: new Map([[legal, 'read']]) })
    expect(restored.get(orgAdmin)).toMatchObject({ role: 'editor', accountRole: 'provisioner', grants: new Map() })
    expect(restored.get(viewer.id)?.grants.get(platformWs)).toBe('read')
    await up()
    expect(await catalog()).toEqual(seventeen)
  })

  it('stops before dropping anything when the old and new evaluation disagree', async () => {
    await down()
    const owner = await human('guard-owner')
    const odd = await human('guard-odd')
    const acme = await provisioned(owner)
    await workspace(acme, 'main')
    // An account role that no per-org role derives: the backfill cannot say it the same way.
    await db.admin.query("INSERT INTO platform.memberships (org_id, user_id, role, account_role) VALUES ($1, $2, 'viewer', 'owner')", [acme, odd.id])
    await expect(up()).rejects.toThrow(/grants backfill would change \d+ access decisions/)
    const { rows } = await db.admin.query<{ exists: boolean }>("SELECT to_regclass('platform.namespace_grants') IS NOT NULL AS exists")
    expect(rows).toEqual([{ exists: true }])
    await db.admin.query('DELETE FROM platform.memberships WHERE org_id = $1 AND user_id = $2', [acme, odd.id])
    expect(await up()).toBe(1)
    await router.withPlatform((tx) => insertOrg(tx, { id: newTenantId(), slug: `after-${newTenantId()}`, name: 'After', ownerId: owner.id }))
  })
})
