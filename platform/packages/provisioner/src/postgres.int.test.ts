// SPDX-License-Identifier: AGPL-3.0-only
import { webcrypto } from 'node:crypto'

import { audit, verifyChain } from '@docket/platform-audit'
import { platformKeyService, type KeyService } from '@docket/platform-keys'
import {
  ORG_SCHEMA_VERSION,
  insertOrg,
  newTenantId,
  tenantRouter,
  upsertGitHubUser,
  type TenantRouter,
} from '@docket/platform-tenancy'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { postgresProvisioner } from './postgres.js'
import type { TenantProvisioner } from './port.js'

describe.skipIf(!TEST_PG_URL)('postgresProvisioner', () => {
  let db: TestDatabase
  let router: TenantRouter
  let keys: KeyService
  let provisioner: TenantProvisioner
  const orgA = newTenantId()
  const orgB = newTenantId()

  async function recordOrg(id: string, slug: string) {
    await router.withPlatform(async (tx) => {
      const owner = await upsertGitHubUser(tx, {
        id: Math.floor(Math.random() * 1e9),
        login: `owner-${slug}`,
        name: null,
        avatarUrl: null,
        emails: [],
      })
      await insertOrg(tx, { id, slug, name: slug, ownerId: owner.id })
    })
  }

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
    keys = await platformKeyService({ kek: webcrypto.getRandomValues(new Uint8Array(32)), kekId: 'k1' })
    provisioner = postgresProvisioner({ admin: db.admin, keys, appRole: db.appRole })
    await recordOrg(orgA, `a-${orgA}`)
    await recordOrg(orgB, `b-${orgB}`)
  })
  afterAll(() => db?.drop())

  it('creates the schema and role, runs the org migrations and wraps a data key', async () => {
    expect(await provisioner.provision({ orgId: orgA })).toEqual({ store: 'postgres', target: `org_${orgA}` })
    await provisioner.provision({ orgId: orgB })
    // Repeating it changes nothing.
    await provisioner.provision({ orgId: orgA })

    const { rows } = await db.admin.query('SELECT org_id, version, kek_id, wrapped FROM platform.org_keys WHERE org_id = $1', [
      orgA,
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].kek_id).toBe('k1')
    await expect(keys.unwrap(orgA, new Uint8Array(rows[0].wrapped), 'k1')).resolves.toBeDefined()

    const status = await db.admin.query('SELECT status, schema_version FROM platform.orgs WHERE id = $1', [orgA])
    expect(status.rows[0]).toEqual({ status: 'active', schema_version: ORG_SCHEMA_VERSION })
    expect(await provisioner.health({ orgId: orgA })).toBe('ok')
  })

  it("lets a tenant transaction use its own schema and audit log", async () => {
    await router.withTenant(orgA, async (tx) => {
      await tx.query("INSERT INTO workspaces (id, slug, name, created_by) VALUES ('w1', 'platform', 'Platform', 'u')")
      await audit(tx, {
        orgId: orgA,
        actor: 'user:u',
        action: 'test.write',
        outcome: 'ok',
        latencyMs: 1,
        requestId: 'r1',
        target: ['w1'],
      })
    })
    expect(await verifyChain(router, orgA)).toEqual({ ok: true, events: 1 })
    const stream = await db.admin.query('SELECT org_id, action FROM platform.audit_stream WHERE org_id = $1', [orgA])
    expect(stream.rows).toEqual([{ org_id: orgA, action: 'test.write' }])
  })

  it("refuses org A's role on org B's documents", async () => {
    await expect(
      router.withTenant(orgA, (tx) => tx.query(`SELECT * FROM org_${orgB}.documents`)),
    ).rejects.toThrow(/permission denied/)
    await expect(router.withTenant(orgA, (tx) => tx.query('SELECT * FROM platform.sessions'))).rejects.toThrow(
      /permission denied/,
    )
  })

  it('gives the request role nothing in an org schema without SET ROLE', async () => {
    await expect(db.app.query(`SELECT * FROM org_${orgA}.documents`)).rejects.toThrow(/permission denied/)
  })

  it('keeps the org audit log append-only for the org role', async () => {
    await expect(router.withTenant(orgA, (tx) => tx.query('DELETE FROM audit_event'))).rejects.toThrow(
      /permission denied/,
    )
  })

  it('stops serving a soft-deprovisioned org and shreds a deleted one', async () => {
    await provisioner.deprovision({ orgId: orgB }, 'soft')
    await expect(router.withTenant(orgB, async () => 1)).rejects.toThrow(/unavailable/)
    expect(await provisioner.health({ orgId: orgB })).toBe('down')

    await provisioner.deprovision({ orgId: orgB }, 'shred')
    const keysLeft = await db.admin.query('SELECT 1 FROM platform.org_keys WHERE org_id = $1', [orgB])
    expect(keysLeft.rowCount).toBe(0)
    const schema = await db.admin.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [`org_${orgB}`])
    expect(schema.rowCount).toBe(0)
    const role = await db.admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [`org_${orgB}`])
    expect(role.rowCount).toBe(0)
  })
})
