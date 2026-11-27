// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import down0012 from '../migrations/platform/0012_namespace_grants.down.sql?raw'
import down0013 from '../migrations/platform/0013_namespace_access.down.sql?raw'
import { ident, transaction } from './db.js'
import { migrateBehindOrgs, migrateOrg, migratePlatform } from './migrate.js'
import {
  changeRole,
  createServiceAccount,
  insertOrg,
  namespaceAccess,
  removeMember,
  upsertGitHubUser,
  type User,
} from './model.js'
import { newTenantId, orgRole, orgSchema } from './names.js'
import { tenantRouter, type TenantRouter } from './router.js'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from './testing.js'

describe.skipIf(!TEST_PG_URL)('accounts and namespaces, the model (platform 0012, org 0016)', () => {
  let db: TestDatabase
  let router: TenantRouter
  let seq = 7000

  const human = (login: string) =>
    router.withPlatform((tx) => upsertGitHubUser(tx, { id: (seq += 1), login, name: null, avatarUrl: null, emails: [] }))

  /** An active org with its schema and role, the way the Postgres provisioner makes one. */
  async function provisioned(owner: User): Promise<string> {
    const id = newTenantId()
    await router.withPlatform((tx) => insertOrg(tx, { id, slug: `o-${id}`, name: 'Acme', ownerId: owner.id }))
    await transaction(db.admin, async (tx) => {
      await tx.query(`CREATE ROLE ${ident(orgRole(id))} NOLOGIN NOINHERIT`)
      await tx.query(`CREATE SCHEMA ${ident(orgSchema(id))}`)
      await migrateOrg(tx, id, { appRole: db.appRole })
      await tx.query(`GRANT ${ident(orgRole(id))} TO ${ident(db.appRole)} WITH INHERIT FALSE, SET TRUE`)
      await tx.query("UPDATE platform.orgs SET status = 'active' WHERE id = $1", [id])
    })
    return id
  }

  const join = (orgId: string, user: User, role: string) =>
    db.app.query('INSERT INTO platform.memberships (org_id, user_id, role) VALUES ($1, $2, $3)', [orgId, user.id, role])

  async function workspace(orgId: string, slug: string, options: { deleted?: boolean } = {}): Promise<string> {
    const id = newTenantId()
    await db.admin.query(
      `INSERT INTO ${ident(orgSchema(orgId))}.workspaces (id, slug, name, created_by, deleted_at) VALUES ($1, $2, $2, 'seed', $3)`,
      [id, slug, options.deleted ? new Date() : null],
    )
    return id
  }

  /** The platform and org schemas' shape: columns, constraints, indexes, triggers, functions and table privileges. */
  async function catalog(): Promise<string[]> {
    const ours = (column: string) => `(${column} = 'platform' OR ${column} LIKE 'org\\_%')`
    const { rows } = await db.admin.query<{ entry: string }>(`
      SELECT concat_ws(' ', 'column', table_schema, table_name, column_name, data_type, is_nullable, column_default) AS entry
        FROM information_schema.columns WHERE ${ours('table_schema')}
      UNION ALL
      SELECT concat_ws(' ', 'constraint', c.conrelid::regclass, c.conname, pg_get_constraintdef(c.oid))
        FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE ${ours('n.nspname')}
      UNION ALL
      SELECT concat_ws(' ', 'index', indexdef) FROM pg_indexes WHERE ${ours('schemaname')}
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

  async function grants(orgId: string): Promise<{ namespace_id: string; principal_id: string; permission: string }[]> {
    const { rows } = await db.admin.query<{ namespace_id: string; principal_id: string; permission: string }>(
      'SELECT namespace_id, principal_id, permission FROM platform.namespace_grants WHERE org_id = $1',
      [orgId],
    )
    return rows
  }

  async function accountRoles(orgId: string): Promise<Record<string, string>> {
    const { rows } = await db.admin.query<{ user_id: string; account_role: string }>(
      'SELECT user_id, account_role FROM platform.memberships WHERE org_id = $1',
      [orgId],
    )
    return Object.fromEntries(rows.map((row) => [row.user_id, row.account_role]))
  }

  /** Back to the schema before 0012/0016: 0013/0017, which build on them, first. */
  const down = async () => {
    await transaction(db.admin, async (tx) => {
      await tx.query(down0013.replaceAll('{{app_role}}', ident(db.appRole)))
      await tx.query(down0012)
    })
  }

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
  })
  afterAll(() => db?.drop())

  it('backfills account roles and grants that keep every member exactly the access they have, and reverts cleanly', async () => {
    const ownerA = await human('owner-a')
    const ownerB = await human('owner-b')
    const admin = await human('admin-a')
    const editor = await human('editor-a')
    const viewer = await human('viewer-a')
    const both = await human('in-both')
    const acme = await provisioned(ownerA)
    const globex = await provisioned(ownerB)
    const migrated = await catalog()

    // Back to the schema before 0012/0016, where today's orgs are.
    await down()
    const before = await catalog()
    expect(before.filter((entry) => !migrated.includes(entry))).toEqual([])
    const added = migrated.filter((entry) => !before.includes(entry))
    expect(added.length).toBeGreaterThan(0)
    expect(added.filter((entry) => !/namespace|account_role|derived_grant|grant_members/.test(entry))).toEqual([])
    expect(added).toEqual(expect.arrayContaining([expect.stringMatching(/^column platform memberships account_role text NO/)]))
    expect(added.filter((entry) => entry.startsWith('trigger') && entry.includes('workspaces_namespace_grants'))).toHaveLength(2)
    const { rows: versions } = await db.admin.query<{ schema_version: number }>(
      'SELECT schema_version FROM platform.orgs WHERE id = ANY($1)',
      [[acme, globex]],
    )
    expect(versions).toEqual([{ schema_version: 15 }, { schema_version: 15 }])

    // Today's members and workspaces, as the app makes them.
    await join(acme, admin, 'admin')
    await join(acme, editor, 'editor')
    await join(acme, viewer, 'viewer')
    await join(acme, both, 'viewer')
    await join(globex, both, 'editor')
    const bot = await router.withPlatform((tx) =>
      createServiceAccount(tx, { orgId: acme, name: 'ci-bot', description: null, role: 'viewer', actorId: ownerA.id, actorRole: 'owner' }),
    )
    // The org-admin account as a master-key mint made it before platform 0014: an editor.
    const orgAdminId = randomUUID()
    await db.admin.query("INSERT INTO platform.users (id, kind, login, service_org_id) VALUES ($1, 'service', 'org-admin', $2)", [orgAdminId, acme])
    await join(acme, { id: orgAdminId } as User, 'editor')
    await db.admin.query('UPDATE platform.orgs SET org_admin_id = $2 WHERE id = $1', [acme, orgAdminId])
    const handbook = await workspace(acme, 'handbook')
    const runbooks = await workspace(acme, 'runbooks')
    await workspace(acme, 'retired', { deleted: true })
    const wiki = await workspace(globex, 'wiki')

    // The runner applies them as a deploy would: the platform first, then each org behind it.
    expect(await migratePlatform(db.admin, { appRole: db.appRole })).toBe(2)
    expect((await migrateBehindOrgs(db.admin, { appRole: db.appRole })).sort()).toEqual([acme, globex].sort())
    expect(await catalog()).toEqual(migrated)

    expect(await accountRoles(acme)).toEqual({
      [ownerA.id]: 'owner',
      [admin.id]: 'admin',
      [editor.id]: 'developer',
      [viewer.id]: 'read_only',
      [both.id]: 'read_only',
      [bot.id]: 'read_only',
      [orgAdminId]: 'developer',
    })
    expect(await accountRoles(globex)).toEqual({ [ownerB.id]: 'owner', [both.id]: 'developer' })

    // Owners and admins hold every namespace through their account role; everyone
    // else gets each live workspace at their role. Nothing for the deleted one.
    const each = (principal: string, permission: string) =>
      [handbook, runbooks].map((namespace) => ({ namespace_id: namespace, principal_id: principal, permission }))
    expect(await grants(acme)).toHaveLength(10)
    expect(await grants(acme)).toEqual(
      expect.arrayContaining([
        ...each(editor.id, 'write'),
        ...each(viewer.id, 'read'),
        ...each(both.id, 'read'),
        ...each(bot.id, 'read'),
        ...each(orgAdminId, 'write'),
      ]),
    )
    expect(await grants(globex)).toEqual([{ namespace_id: wiki, principal_id: both.id, permission: 'write' }])

    // Requests read them (platform 0013) but never write them: only the migration owner's triggers do.
    await db.app.query('SELECT 1 FROM platform.namespace_grants')
    await expect(
      db.app.query("INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission) VALUES ($1, $2, $3, 'admin')", [acme, handbook, viewer.id]),
    ).rejects.toMatchObject({ code: '42501' })

    // Reverting again leaves the data as it was and the schema as before.
    await down()
    expect(await catalog()).toEqual(before)
    const { rows: members } = await db.admin.query('SELECT count(*)::int AS count FROM platform.memberships')
    expect(members).toEqual([{ count: 9 }])
    expect(await migratePlatform(db.admin, { appRole: db.appRole })).toBe(2)
    expect(await migrateBehindOrgs(db.admin, { appRole: db.appRole })).toHaveLength(2)
    expect(await grants(acme)).toHaveLength(10)
  })

  it('keeps the account role in step with the role, and drops grants with their member or workspace', async () => {
    const owner = await human('owner-c')
    const editor = await human('editor-c')
    const viewer = await human('viewer-c')
    const initech = await provisioned(owner)
    await join(initech, editor, 'editor')
    await join(initech, viewer, 'viewer')
    expect(await accountRoles(initech)).toEqual({ [owner.id]: 'owner', [editor.id]: 'developer', [viewer.id]: 'read_only' })

    await router.withPlatform((tx) => changeRole(tx, { orgId: initech, userId: editor.id, role: 'viewer', actorRole: 'owner' }))
    await router.withPlatform((tx) => changeRole(tx, { orgId: initech, userId: viewer.id, role: 'admin', actorRole: 'owner' }))
    expect(await accountRoles(initech)).toMatchObject({ [editor.id]: 'read_only', [viewer.id]: 'admin' })

    // An account role set outright is kept, for the roles `role` cannot express.
    const guest = await human('guest-c')
    await db.app.query("INSERT INTO platform.memberships (org_id, user_id, role, account_role) VALUES ($1, $2, 'viewer', 'guest')", [
      initech,
      guest.id,
    ])
    expect(await accountRoles(initech)).toMatchObject({ [guest.id]: 'guest' })
    await expect(
      db.app.query("UPDATE platform.memberships SET account_role = 'auditor' WHERE user_id = $1", [guest.id]),
    ).rejects.toMatchObject({ code: '23514' })

    const kept = await workspace(initech, 'kept')
    const gone = await workspace(initech, 'gone')
    for (const namespace of [kept, gone]) {
      for (const user of [editor, guest]) {
        // The editor, a read-only member by now, already holds them (platform 0013); the guest gets them by hand.
        await db.admin.query(
          "INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission) VALUES ($1, $2, $3, 'read') ON CONFLICT DO NOTHING",
          [initech, namespace, user.id],
        )
      }
    }

    // A soft delete keeps the grants until the workspace row goes, as the org role deletes it.
    await db.admin.query(`UPDATE ${ident(orgSchema(initech))}.workspaces SET deleted_at = now() WHERE id = $1`, [gone])
    expect(await grants(initech)).toHaveLength(4)
    await router.withTenant(initech, (tx) => tx.query('DELETE FROM workspaces WHERE id = $1', [gone]))
    expect((await grants(initech)).map((grant) => grant.namespace_id)).toEqual([kept, kept])

    await router.withPlatform((tx) => removeMember(tx, { orgId: initech, userId: editor.id, actorRole: 'owner' }))
    expect(await grants(initech)).toEqual([{ namespace_id: kept, principal_id: guest.id, permission: 'read' }])

    // A grant names a member of the org it is in.
    const outsider = await human('outsider-c')
    await expect(
      db.admin.query(
        "INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission) VALUES ($1, $2, $3, 'read')",
        [initech, kept, outsider.id],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })
  it('keeps grants equal to today\'s roles for members, workspaces and role changes made after the backfill (platform 0013, org 0017)', async () => {
    const owner = await human('owner-d')
    const admin = await human('admin-d')
    const editor = await human('editor-d')
    const viewer = await human('viewer-d')
    const guest = await human('guest-d')
    const hooli = await provisioned(owner)
    const docs = await workspace(hooli, 'docs')
    await workspace(hooli, 'archived', { deleted: true })
    const level = async (userId: string) =>
      Object.fromEntries((await grants(hooli)).filter((grant) => grant.principal_id === userId).map((grant) => [grant.namespace_id, grant.permission]))

    // A member who joins holds every live workspace at their role; owners, admins and guests are given none.
    await join(hooli, admin, 'admin')
    await join(hooli, editor, 'editor')
    await join(hooli, viewer, 'viewer')
    await db.app.query("INSERT INTO platform.memberships (org_id, user_id, role, account_role) VALUES ($1, $2, 'viewer', 'guest')", [hooli, guest.id])
    expect(await level(editor.id)).toEqual({ [docs]: 'write' })
    expect(await level(viewer.id)).toEqual({ [docs]: 'read' })
    for (const user of [owner, admin, guest]) expect(await level(user.id)).toEqual({})

    // A workspace the org makes, as its own role, is granted the same way.
    const made = newTenantId()
    await router.withTenant(hooli, (tx) => tx.query("INSERT INTO workspaces (id, slug, name, created_by) VALUES ($1, 'made', 'Made', 'test')", [made]))
    expect(await level(editor.id)).toEqual({ [docs]: 'write', [made]: 'write' })
    expect(await level(viewer.id)).toEqual({ [docs]: 'read', [made]: 'read' })
    for (const user of [owner, admin, guest]) expect(await level(user.id)).toEqual({})

    // A role change moves every grant with it: a demotion lowers them, and an admin made an editor gets them.
    await router.withPlatform((tx) => changeRole(tx, { orgId: hooli, userId: editor.id, role: 'viewer', actorRole: 'owner' }))
    await router.withPlatform((tx) => changeRole(tx, { orgId: hooli, userId: viewer.id, role: 'editor', actorRole: 'owner' }))
    await router.withPlatform((tx) => changeRole(tx, { orgId: hooli, userId: admin.id, role: 'editor', actorRole: 'owner' }))
    expect(await level(editor.id)).toEqual({ [docs]: 'read', [made]: 'read' })
    expect(await level(viewer.id)).toEqual({ [docs]: 'write', [made]: 'write' })
    expect(await level(admin.id)).toEqual({ [docs]: 'write', [made]: 'write' })

    // What each now reaches in a workspace: the account role, then the grant there.
    const access = (userId: string, namespace = docs) => router.withPlatform((tx) => namespaceAccess(tx, hooli, namespace, userId))
    expect(await access(owner.id)).toEqual({ role: 'owner', accountRole: 'owner', permission: 'admin' })
    expect(await access(admin.id)).toEqual({ role: 'editor', accountRole: 'developer', permission: 'write' })
    expect(await access(editor.id)).toEqual({ role: 'viewer', accountRole: 'read_only', permission: 'read' })
    expect(await access(guest.id)).toEqual({ role: 'viewer', accountRole: 'guest', permission: null })
    expect(await access((await human('stranger-d')).id)).toBeNull()

    // A demotion straight to an account role with no derived grant (set by hand, since `role` alone cannot express it) drops every grant held.
    const demoted = await human('demoted-d')
    await join(hooli, demoted, 'editor')
    expect(await level(demoted.id)).toEqual({ [docs]: 'write', [made]: 'write' })
    await db.app.query('UPDATE platform.memberships SET account_role = $3 WHERE org_id = $1 AND user_id = $2', [hooli, demoted.id, 'guest'])
    expect(await level(demoted.id)).toEqual({})
    expect(await access(demoted.id)).toEqual({ role: 'editor', accountRole: 'guest', permission: null })

    // Without the triggers (a build before 0013), members, workspaces and role changes drift; 0017 catches them up.
    await transaction(db.admin, (tx) => tx.query(down0013.replaceAll('{{app_role}}', ident(db.appRole))))
    const late = await human('late-d')
    await join(hooli, late, 'viewer')
    const later = await workspace(hooli, 'later')
    await router.withPlatform((tx) => changeRole(tx, { orgId: hooli, userId: editor.id, role: 'editor', actorRole: 'owner' }))
    expect(await level(late.id)).toEqual({})
    expect(await level(editor.id)).toEqual({ [docs]: 'read', [made]: 'read' })
    expect(await migratePlatform(db.admin, { appRole: db.appRole })).toBe(1)
    expect(await migrateBehindOrgs(db.admin, { appRole: db.appRole })).toContain(hooli)
    expect(await level(late.id)).toEqual({ [docs]: 'read', [made]: 'read', [later]: 'read' })
    expect(await level(editor.id)).toEqual({ [docs]: 'write', [made]: 'write', [later]: 'write' })
    expect(await level(viewer.id)).toEqual({ [docs]: 'write', [made]: 'write', [later]: 'write' })
    for (const user of [owner, guest]) expect(await level(user.id)).toEqual({})
  })
})
