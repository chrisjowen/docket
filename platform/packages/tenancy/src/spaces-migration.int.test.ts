// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import down0018 from '../migrations/platform/0018_spaces.down.sql?raw'
import { accessOf, listGrants } from './access.js'
import { ident, transaction, type Tx } from './db.js'
import { migrateBehindOrgs, migratePlatform } from './migrate.js'
import { ORG_MIGRATIONS } from './migrations.js'
import { upsertGitHubUser, type User } from './model.js'
import { newTenantId, orgRole, orgSchema } from './names.js'
import { ACCOUNT, GENERAL_SPACE_ID, appliesTo, capsAt, docketPlace, spacePlace, type Access, type Place } from './roles.js'
import { tenantRouter, type TenantRouter } from './router.js'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from './testing.js'

const GENERAL = spacePlace(GENERAL_SPACE_ID)
const sorted = (caps: ReadonlySet<string>) => [...caps].sort()

describe.skipIf(!TEST_PG_URL)('spaces (platform 0018, org 0020)', () => {
  let db: TestDatabase
  let router: TenantRouter
  let seq = 19000

  const human = (login: string) =>
    router.withPlatform((tx) => upsertGitHubUser(tx, { id: (seq += 1), login, name: null, avatarUrl: null, emails: [] }))

  /** Org migrations as a build before spaces ran them: through 0019, superseded ones recorded only. */
  async function migrateOrgBeforeSpaces(tx: Tx, orgId: string): Promise<void> {
    const values: Record<string, string> = { schema: ident(orgSchema(orgId)), org_role: ident(orgRole(orgId)), org_id: orgId, app_role: ident(db.appRole) }
    for (const migration of ORG_MIGRATIONS.filter((each) => each.version <= 19)) {
      if (!migration.supersededBy) await tx.query(migration.sql.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] as string))
      await tx.query('INSERT INTO platform.schema_migrations (schema_name, version, name, checksum) VALUES ($1, $2, $3, $4)', [
        orgSchema(orgId),
        migration.version,
        migration.name,
        createHash('sha256').update(migration.sql).digest('hex'),
      ])
    }
    await tx.query('UPDATE platform.orgs SET schema_version = 19 WHERE id = $1', [orgId])
  }

  /** An active org with its schema and role, as a build before spaces provisioned one. */
  async function provisioned(owner: User, slug: string): Promise<string> {
    const id = newTenantId()
    await db.admin.query('INSERT INTO platform.orgs (id, slug, name, created_by) VALUES ($1, $2, $3, $4)', [id, `${slug}-${id}`, slug, owner.id])
    await db.admin.query('INSERT INTO platform.memberships (org_id, user_id, owner) VALUES ($1, $2, true)', [id, owner.id])
    await transaction(db.admin, async (tx) => {
      await tx.query(`CREATE ROLE ${ident(orgRole(id))} NOLOGIN NOINHERIT`)
      await tx.query(`CREATE SCHEMA ${ident(orgSchema(id))}`)
      await migrateOrgBeforeSpaces(tx, id)
      await tx.query(`GRANT ${ident(orgRole(id))} TO ${ident(db.appRole)} WITH INHERIT FALSE, SET TRUE`)
      await tx.query("UPDATE platform.orgs SET status = 'active' WHERE id = $1", [id])
    })
    return id
  }

  const join = (orgId: string, userId: string, options: { guest?: boolean } = {}) =>
    db.admin.query('INSERT INTO platform.memberships (org_id, user_id, guest) VALUES ($1, $2, $3)', [orgId, userId, options.guest ?? false])

  async function grant(orgId: string, who: string | null, place: Place, roleId: string, add: string[] = []): Promise<void> {
    await db.admin.query(
      'INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id, add_caps) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [`g_${randomUUID()}`, orgId, who, place.kind, place.kind === 'account' ? null : place.id, roleId, add],
    )
  }

  async function workspace(orgId: string, slug: string, options: { deleted?: boolean } = {}): Promise<string> {
    const id = newTenantId()
    await db.admin.query(`INSERT INTO ${ident(orgSchema(orgId))}.workspaces (id, slug, name, created_by, deleted_at) VALUES ($1, $2, $2, 'seed', $3)`, [
      id,
      slug,
      options.deleted ? new Date() : null,
    ])
    return id
  }

  async function invite(orgId: string, login: string, roleId: string, invitedBy: string, options: { owner?: boolean } = {}): Promise<void> {
    await db.admin.query(
      `INSERT INTO platform.invites (id, org_id, github_login, role_id, place_kind, owner, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, 'account', $5, $6, now() + interval '7 days')`,
      [randomUUID(), orgId, login, roleId, options.owner ?? false, invitedBy],
    )
  }

  const accessIn = (orgId: string, userId: string) => router.withPlatform((tx) => accessOf(tx, orgId, userId))
  const members = async (orgId: string) =>
    (await db.admin.query<{ user_id: string }>('SELECT user_id FROM platform.memberships WHERE org_id = $1 ORDER BY user_id', [orgId])).rows.map(
      (row) => row.user_id,
    )

  /** A member's access as a build before spaces resolved it: their flags and grants, with no space to cover anything. */
  async function accessBeforeSpaces(orgId: string, userId: string): Promise<Access> {
    const { rows } = await db.admin.query<{ owner: boolean; guest: boolean; kind: 'human' | 'service' }>(
      'SELECT m.owner, m.guest, u.kind FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id WHERE m.org_id = $1 AND m.user_id = $2',
      [orgId, userId],
    )
    const row = rows[0] as { owner: boolean; guest: boolean; kind: 'human' | 'service' }
    const principal = { userId, kind: row.kind, guest: row.guest }
    const grants = await router.withPlatform((tx) => listGrants(tx, orgId))
    return { ...principal, owner: row.owner, grants: grants.filter((each) => appliesTo(each, principal)) }
  }

  /** Each member's capabilities on every live docket and on the whole account. */
  async function snapshot(
    orgId: string,
    dockets: readonly string[],
    resolve: (orgId: string, userId: string) => Promise<Access | null> = accessIn,
  ): Promise<Map<string, { account: string[]; dockets: Record<string, string[]> }>> {
    const out = new Map<string, { account: string[]; dockets: Record<string, string[]> }>()
    for (const userId of await members(orgId)) {
      const access = (await resolve(orgId, userId)) as Access
      out.set(userId, {
        account: sorted(capsAt(access, ACCOUNT)),
        dockets: Object.fromEntries(dockets.map((docket) => [docket, sorted(capsAt(access, docketPlace(docket)))])),
      })
    }
    return out
  }

  /** The platform and org schemas' shape, to check the down migration restores it. */
  async function catalog(): Promise<string[]> {
    const ours = (column: string) => `(${column} = 'platform' OR ${column} LIKE 'org\\_%')`
    const { rows } = await db.admin.query<{ entry: string }>(`
      SELECT concat_ws(' ', 'column', table_schema, table_name, column_name, data_type, is_nullable, column_default) AS entry
        FROM information_schema.columns WHERE ${ours('table_schema')}
      UNION ALL
      SELECT concat_ws(' ', 'constraint', n.nspname, c.conname, pg_get_constraintdef(c.oid))
        FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE ${ours('n.nspname')}
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

  const down = () => transaction(db.admin, (tx) => tx.query(down0018.replaceAll('{{app_role}}', ident(db.appRole))))
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

  it("moves account-wide Writer and Reader grants to General and changes no one's access to any docket", async () => {
    await down()

    const owner = await human('sp-owner')
    const admin = await human('sp-admin')
    const writer = await human('sp-writer')
    const publisher = await human('sp-publisher')
    const reader = await human('sp-reader')
    const auditor = await human('sp-auditor')
    const editor = await human('sp-editor')
    const narrow = await human('sp-narrow')
    const guest = await human('sp-guest')
    const acme = await provisioned(owner, 'acme')
    const platformWs = await workspace(acme, 'platform')
    const payments = await workspace(acme, 'payments')
    const legal = await workspace(acme, 'legal')
    await workspace(acme, 'gone', { deleted: true })
    const acmeDockets = [platformWs, payments, legal]

    for (const user of [admin, writer, publisher, reader, auditor, editor, narrow]) await join(acme, user.id)
    await join(acme, guest.id, { guest: true })
    const bot = randomUUID()
    await db.admin.query("INSERT INTO platform.users (id, kind, login, service_org_id) VALUES ($1, 'service', 'sp-ci', $2)", [bot, acme])
    await join(acme, bot)
    const schemaEditor = `r_${newTenantId()}`
    await db.admin.query("INSERT INTO platform.roles (id, org_id, name, caps) VALUES ($1, $2, 'Schema editor', ARRAY['read', 'write', 'propose', 'publish'])", [
      schemaEditor,
      acme,
    ])

    await grant(acme, admin.id, ACCOUNT, 'admin')
    await grant(acme, writer.id, ACCOUNT, 'writer')
    await grant(acme, publisher.id, ACCOUNT, 'writer', ['publish'])
    await grant(acme, publisher.id, docketPlace(payments), 'writer', ['publish', 'decide'])
    await grant(acme, reader.id, ACCOUNT, 'reader')
    // A managing capability means something on the account: this grant stays there.
    await grant(acme, auditor.id, ACCOUNT, 'reader', ['audit'])
    // The account's own role: only the built-in Writer and Reader move.
    await grant(acme, editor.id, ACCOUNT, schemaEditor)
    // A member who is not a guest but reads only Legal: Reader for everyone on General would widen them.
    await grant(acme, narrow.id, docketPlace(legal), 'reader')
    await grant(acme, guest.id, docketPlace(legal), 'writer')
    await grant(acme, bot, docketPlace(payments), 'writer')
    await invite(acme, 'sp-inv-reader', 'reader', owner.id)
    await invite(acme, 'sp-inv-admin', 'admin', owner.id)
    await invite(acme, 'sp-inv-owner', 'admin', owner.id, { owner: true })

    // A second account: everyone already reads it all, and a grant for everyone is on the account.
    const globexOwner = await human('sp-globex-owner')
    const globexWriter = await human('sp-globex-writer')
    const globex = await provisioned(globexOwner, 'globex')
    const research = await workspace(globex, 'research')
    await join(globex, globexWriter.id)
    await grant(globex, globexWriter.id, ACCOUNT, 'writer')
    await grant(globex, null, ACCOUNT, 'reader')

    // A third: nobody but its owner, and no grant for everyone yet.
    const initechOwner = await human('sp-initech-owner')
    const initechMember = await human('sp-initech-member')
    const initech = await provisioned(initechOwner, 'initech')
    const tps = await workspace(initech, 'tps')
    await join(initech, initechMember.id)
    await grant(initech, initechMember.id, ACCOUNT, 'writer')

    const live = new Map([
      [acme, acmeDockets],
      [globex, [research]],
      [initech, [tps]],
    ])
    const before = new Map<string, Awaited<ReturnType<typeof snapshot>>>()
    for (const [orgId, dockets] of live) before.set(orgId, await snapshot(orgId, dockets, accessBeforeSpaces))

    const seventeen = await catalog()
    expect(await up()).toBe(1)
    const eighteen = await catalog()

    // Every live docket is in General, and every account has it.
    for (const [orgId, dockets] of live) {
      const { rows } = await db.admin.query<{ id: string; space_id: string }>(`SELECT id, space_id FROM ${ident(orgSchema(orgId))}.workspaces WHERE deleted_at IS NULL`)
      expect(new Set(rows.map((row) => row.id))).toEqual(new Set(dockets))
      expect(rows.every((row) => row.space_id === GENERAL_SPACE_ID)).toBe(true)
      const { rows: spaces } = await db.admin.query(`SELECT id, slug, name, general FROM ${ident(orgSchema(orgId))}.spaces`)
      expect(spaces).toEqual([{ id: 'general', slug: 'general', name: 'General', general: true }])
    }

    // No one's access to any docket changed; on the account, only the moved grants' holders lost what they now hold on General.
    const moved = new Set([writer.id, publisher.id, reader.id, globexWriter.id, initechMember.id])
    for (const [orgId, dockets] of live) {
      const after = await snapshot(orgId, dockets)
      for (const [userId, was] of before.get(orgId) ?? []) {
        const now = after.get(userId)
        expect(now?.dockets, `${userId} in ${orgId}`).toEqual(was.dockets)
        if (moved.has(userId)) {
          expect(now?.account, `${userId} on the account`).toEqual([])
          expect(sorted(capsAt(await accessIn(orgId, userId), GENERAL)), `${userId} on General`).toEqual(was.account)
        } else {
          expect(now?.account, `${userId} on the account`).toEqual(was.account)
        }
      }
    }

    // In the model's own words.
    const placesOf = async (orgId: string, userId: string) =>
      (await router.withPlatform((tx) => listGrants(tx, orgId, { userId }))).map((each) => [each.place, each.role.id, [...each.add]])
    expect(await placesOf(acme, writer.id)).toEqual([[GENERAL, 'writer', []]])
    expect(await placesOf(acme, publisher.id)).toEqual([
      [GENERAL, 'writer', ['publish']],
      [docketPlace(payments), 'writer', ['publish', 'decide']],
    ])
    expect(await placesOf(acme, auditor.id)).toEqual([[ACCOUNT, 'reader', ['audit']]])
    expect(await placesOf(acme, editor.id)).toEqual([[ACCOUNT, schemaEditor, []]])
    expect(await placesOf(acme, admin.id)).toEqual([[ACCOUNT, 'admin', []]])

    // Reader for everyone on General: not in acme (it would let sp-narrow read Platform and Payments), moved in globex, new in initech.
    const everyone = async (orgId: string) =>
      (await router.withPlatform((tx) => listGrants(tx, orgId))).filter((each) => each.who.kind === 'everyone').map((each) => [each.place, each.role.id])
    expect(await everyone(acme)).toEqual([])
    expect(await everyone(globex)).toEqual([[GENERAL, 'reader']])
    expect(await everyone(initech)).toEqual([[GENERAL, 'reader']])

    // Open invites to Writer or Reader on the account now invite to General; Admin and owner invites stay.
    const { rows: invites } = await db.admin.query('SELECT github_login, place_kind, place_id FROM platform.invites WHERE org_id = $1 ORDER BY github_login', [acme])
    expect(invites).toEqual([
      { github_login: 'sp-inv-admin', place_kind: 'account', place_id: null },
      { github_login: 'sp-inv-owner', place_kind: 'account', place_id: null },
      { github_login: 'sp-inv-reader', place_kind: 'space', place_id: 'general' },
    ])

    // From now on a docket in another space is not covered by General: sp-writer has nothing on it, a grant on its space does.
    const legalSpace = 'legalteam'
    await db.admin.query(`INSERT INTO ${ident(orgSchema(acme))}.spaces (id, slug, name, created_by) VALUES ($1, 'legal-team', 'Legal team', 'seed')`, [legalSpace])
    const contracts = await workspace(acme, 'contracts')
    await db.admin.query(`UPDATE ${ident(orgSchema(acme))}.workspaces SET space_id = $2 WHERE id = $1`, [contracts, legalSpace])
    await grant(acme, reader.id, spacePlace(legalSpace), 'writer')
    expect(sorted(capsAt(await accessIn(acme, writer.id), docketPlace(contracts)))).toEqual([])
    expect(sorted(capsAt(await accessIn(acme, reader.id), docketPlace(contracts)))).toEqual(['propose', 'read', 'write'])
    expect(sorted(capsAt(await accessIn(acme, admin.id), docketPlace(contracts))).length).toBe(12)
    // Deleting a space takes its grants.
    await db.admin.query(`UPDATE ${ident(orgSchema(acme))}.workspaces SET space_id = 'general' WHERE id = $1`, [contracts])
    await db.admin.query(`DELETE FROM ${ident(orgSchema(acme))}.spaces WHERE id = $1`, [legalSpace])
    expect(await placesOf(acme, reader.id)).toEqual([[GENERAL, 'reader', []]])

    // The down migration brings the old shape back, and nobody gains anything.
    await db.admin.query(`DELETE FROM ${ident(orgSchema(acme))}.workspaces WHERE id = $1`, [contracts])
    await down()
    expect(await catalog()).toEqual(seventeen)
    for (const [orgId, dockets] of live) {
      const after = await snapshot(orgId, dockets, accessBeforeSpaces)
      for (const [userId, was] of before.get(orgId) ?? []) expect(after.get(userId)?.dockets, `${userId} in ${orgId} after down`).toEqual(was.dockets)
    }
    expect(await placesOf(acme, writer.id)).toEqual([[ACCOUNT, 'writer', []]])
    await up()
    expect(await catalog()).toEqual(eighteen)
  })

  it('makes a new account with General, where everyone reads', async () => {
    const owner = await human('sp-new-owner')
    const orgId = await provisioned(owner, 'fresh')
    await migrateBehindOrgs(db.admin, { appRole: db.appRole })
    const { rows } = await db.admin.query(`SELECT id, general FROM ${ident(orgSchema(orgId))}.spaces`)
    expect(rows).toEqual([{ id: 'general', general: true }])
    const grants = await router.withPlatform((tx) => listGrants(tx, orgId))
    expect(grants.map((each) => [each.who, each.place, each.role.id])).toEqual([[{ kind: 'everyone' }, GENERAL, 'reader']])
    // A docket made without naming a space goes to General.
    const id = await router.withTenant(orgId, async (tx) => {
      const docket = newTenantId()
      await tx.query("INSERT INTO workspaces (id, slug, name, created_by) VALUES ($1, 'main', 'Main', 'seed')", [docket])
      return docket
    })
    const member = await human('sp-new-member')
    await join(orgId, member.id)
    expect(sorted(capsAt(await accessIn(orgId, member.id), docketPlace(id)))).toEqual(['read'])
  })
})
