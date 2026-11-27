// SPDX-License-Identifier: AGPL-3.0-only
import { MODEL_ALLOWLIST, modelChoices, resolveAiSettings, type ModelUse } from '@docket/platform-ai'
import { insertSpace, insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import type { Neo4jPodProvisioner, Neo4jRef, QdrantProvisioner, QdrantRef } from '@docket/platform-provisioner'
import { ident, migratePlatform, transaction, type Tx } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import down0019 from '../../../packages/tenancy/migrations/platform/0019_place_settings_and_stores.down.sql?raw'
import { orgStores } from './stores.js'

/**
 * How a docket's AI and stores were decided before platform 0019, frozen
 * here as the oracle the migration is checked against: the account's model
 * for each use from `ai_caps.models` when the allowlist still has it, else the
 * allowlist's first; the account's key (`ai_keys`, or the platform's shared
 * one); and the account's Neo4j pod and shared Qdrant collection
 * (`org_stores`), whatever space the docket is in.
 */
type Before = {
  models: Record<ModelUse, string>
  capUsd: number
  key: { key_hash: string; ciphertext: string; dek_version: number } | null
  stores: Record<string, { status: string; target: string | null; credentials_secret: string | null }>
}

async function before(tx: Tx, orgId: string): Promise<Before> {
  const caps = await tx.query<{ models: Partial<Record<string, string>>; monthly_usd: string }>('SELECT models, monthly_usd FROM platform.ai_caps WHERE org_id = $1', [
    orgId,
  ])
  const chosen = caps.rows[0]?.models ?? {}
  const pick = (use: ModelUse) => {
    const choice = chosen[use]
    return choice && (MODEL_ALLOWLIST[use] as readonly string[]).includes(choice) ? choice : (MODEL_ALLOWLIST[use][0] as string)
  }
  const key = await tx.query<{ key_hash: string; ciphertext: Buffer; dek_version: number }>(
    'SELECT key_hash, ciphertext, dek_version FROM platform.ai_keys WHERE org_id = $1',
    [orgId],
  )
  const stores = await tx.query<{ store: string; status: string; target: string | null; credentials_secret: string | null }>(
    'SELECT store, status, target, credentials_secret FROM platform.org_stores WHERE org_id = $1',
    [orgId],
  )
  return {
    models: { cypher: pick('cypher'), synthesis: pick('synthesis') },
    capUsd: caps.rows[0] ? Number(caps.rows[0].monthly_usd) : 20,
    key: key.rows[0] ? { key_hash: key.rows[0].key_hash, ciphertext: key.rows[0].ciphertext.toString('hex'), dek_version: key.rows[0].dek_version } : null,
    stores: Object.fromEntries(stores.rows.map((row) => [row.store, { status: row.status, target: row.target, credentials_secret: row.credentials_secret }])),
  }
}

/** Provisioners that hand back where each instance is, and remember nothing else. */
function fakes() {
  const url = (ref: Neo4jRef) => `bolt+s://${ref.storeId ? `neo4j-${ref.storeId}` : `neo4j-org-${ref.orgId}`}:7687`
  const collection = (ref: QdrantRef) => (ref.docketId ? `org_${ref.orgId}__ws_${ref.docketId}` : `org_${ref.orgId}__mem0`)
  const neo4j: Neo4jPodProvisioner = {
    provision: async (ref) => ({ store: 'neo4j', target: url(ref), created: false }),
    bind: async (ref) => ({ store: 'neo4j', target: url(ref) }),
    credentials: async (ref) => ({ url: url(ref), username: 'neo4j', password: 'p' }),
    wake: async () => undefined,
    suspend: async () => undefined,
    deprovision: async () => undefined,
    health: async () => 'ok',
  }
  const qdrant: QdrantProvisioner = {
    provision: async (ref) => ({ store: 'qdrant', target: collection(ref), created: false }),
    bind: async (ref) => ({ store: 'qdrant', target: collection(ref) }),
    access: async (ref) => ({ url: 'https://q', collection: collection(ref), token: 't', dimension: 8 }),
    suspend: async () => undefined,
    deprovision: async () => undefined,
    health: async () => 'ok',
  }
  return { neo4j, qdrant }
}

// Platform 0019 against accounts as they stood before storage and AI per space: every docket keeps its models, key and stores.
describe.skipIf(!TEST_PG_URL)('storage and AI per space (platform 0019)', () => {
  let org: TestOrg
  const platform = <T>(fn: (tx: Tx) => Promise<T>) => org.router.withPlatform(fn)

  beforeAll(async () => {
    org = await createTestOrg()
  })
  afterAll(() => org?.drop())

  it("keeps every existing docket on the models, key and stores it had, and puts a new docket's vectors in a collection of its own", async () => {
    // Three accounts: one with chosen models, its own key and both stores provisioned; one whose choice left the list
    // and whose stores were never provisioned; one with no settings at all and a suspended Neo4j pod.
    const acme = org.orgId
    const globex = (await org.addOrg()).orgId
    const initech = (await org.addOrg()).orgId
    const dockets = new Map<string, string[]>()
    const docket = async (orgId: string, slug: string, options: { space?: string; deleted?: boolean } = {}) => {
      const id = await org.router.withTenant(orgId, async (tx) => {
        const made = await insertWorkspace(tx, { name: slug, slug, createdBy: org.userId, ...(options.space ? { spaceId: options.space } : {}) })
        if (options.deleted) await tx.query('UPDATE workspaces SET deleted_at = now() WHERE id = $1', [made.id])
        return made.id
      })
      dockets.set(orgId, [...(dockets.get(orgId) ?? []), id])
      return id
    }
    const engineering = await org.router.withTenant(acme, (tx) => insertSpace(tx, { name: 'Engineering', slug: 'engineering', createdBy: org.userId }))
    await docket(acme, 'handbook')
    await docket(acme, 'payments', { space: engineering.id })
    const deleted = await docket(acme, 'old', { deleted: true })
    await docket(globex, 'contracts')
    await docket(initech, 'tps')

    // Back to before 0019, and the settings and stores as that build kept them.
    await transaction(org.db.admin, (tx) => tx.query(down0019.replaceAll('{{app_role}}', ident(org.db.appRole))))
    await org.db.admin.query(
      `INSERT INTO platform.ai_caps (org_id, monthly_usd, models, updated_by) VALUES
         ($1, 35, '{"cypher": "openai/gpt-4.1-mini", "synthesis": "google/gemini-3.8-flash"}', $3),
         ($2, 20, '{"cypher": "retired/model"}', $3)`,
      [acme, globex, org.userId],
    )
    await org.db.admin.query(
      "INSERT INTO platform.ai_keys (org_id, key_hash, ciphertext, nonce, dek_version, limit_usd) VALUES ($1, 'or-hash', '\\x0102', '\\x03', 1, 35)",
      [acme],
    )
    await org.db.admin.query(
      `INSERT INTO platform.org_stores (org_id, store, status, target, credentials_secret, used_at) VALUES
         ($1, 'neo4j', 'ready', 'bolt+s://neo4j-org-${acme}:7687', 'neo4j-org-${acme}', now()),
         ($1, 'qdrant', 'ready', 'https://q/collections/org_${acme}__mem0', NULL, now()),
         ($2, 'neo4j', 'suspended', 'bolt+s://neo4j-org-${initech}:7687', 'neo4j-org-${initech}', now())`,
      [acme, initech],
    )
    const old = new Map<string, Before>()
    for (const orgId of [acme, globex, initech]) old.set(orgId, await platform((tx) => before(tx, orgId)))

    expect(await migratePlatform(org.db.admin, { appRole: org.db.appRole })).toBe(1)

    const stores = orgStores({ router: org.router, ...fakes(), embedder: { url: 'http://e', model: 'm', dimension: 8 }, log: { info: () => undefined, error: () => undefined } })
    for (const orgId of [acme, globex, initech]) {
      const was = old.get(orgId) as Before
      const key = await platform((tx) => tx.query<{ key_hash: string; ciphertext: Buffer; dek_version: number }>('SELECT key_hash, ciphertext, dek_version FROM platform.ai_keys WHERE org_id = $1', [orgId]))
      expect(key.rows[0] ? { key_hash: key.rows[0].key_hash, ciphertext: key.rows[0].ciphertext.toString('hex'), dek_version: key.rows[0].dek_version } : null).toEqual(was.key)
      const account = await platform(async (tx) => {
        const { rows } = await tx.query<{ id: string; kind: string; status: string; target: string | null; credentials_secret: string | null }>(
          'SELECT id, kind, status, target, credentials_secret FROM platform.stores WHERE org_id = $1 AND space_id IS NULL AND docket_id IS NULL',
          [orgId],
        )
        return new Map(rows.map((row) => [row.kind, row]))
      })
      for (const [kind, store] of Object.entries(was.stores)) {
        expect({ status: account.get(kind)?.status, target: account.get(kind)?.target, credentials_secret: account.get(kind)?.credentials_secret }).toEqual(store)
      }

      for (const docketId of dockets.get(orgId) ?? []) {
        // The same models, the account's key, the account's cap.
        expect(await platform((tx) => modelChoices(tx, orgId, docketId))).toEqual(was.models)
        const resolved = await platform((tx) => resolveAiSettings(tx, orgId, { docketId }))
        expect(resolved.key).toEqual({ from: 'account' })
        expect(resolved.caps).toEqual({ accountUsd: was.capUsd, spaceUsd: null })

        // Pinned to the account's Neo4j and its shared collection, deleted dockets too (their purge clears them there).
        const pinned = await platform((tx) =>
          tx.query<{ kind: string; store_id: string }>('SELECT kind, store_id FROM platform.docket_stores WHERE org_id = $1 AND docket_id = $2', [orgId, docketId]),
        )
        expect(Object.fromEntries(pinned.rows.map((row) => [row.kind, row.store_id]))).toEqual({ neo4j: account.get('neo4j')?.id, qdrant: account.get('qdrant')?.id })
        if (docketId === deleted) continue
        // And the worker opens exactly the stores it opened before.
        const access = await stores.access(orgId, docketId)
        expect(access.neo4j.url).toBe(`bolt+s://neo4j-org-${orgId}:7687`)
        expect(access.qdrant.collection).toBe(`org_${orgId}__mem0`)
      }
    }
    // A docket made from now on gets a collection of its own.
    const fresh = await docket(acme, 'incidents', { space: engineering.id })
    expect((await stores.access(acme, fresh)).qdrant.collection).toBe(`org_${acme}__ws_${fresh}`)

    // And back: the account's models and stores return to where the earlier build reads them.
    await transaction(org.db.admin, (tx) => tx.query(down0019.replaceAll('{{app_role}}', ident(org.db.appRole))))
    for (const orgId of [acme, globex, initech]) {
      const now = await platform((tx) => before(tx, orgId))
      const was = old.get(orgId) as Before
      expect(now.models).toEqual(was.models)
      expect(now.key).toEqual(was.key)
      // Where each store is; its status is whatever the worker last saw (the passes above woke a suspended pod).
      for (const [kind, store] of Object.entries(was.stores)) {
        expect({ target: now.stores[kind]?.target, credentials_secret: now.stores[kind]?.credentials_secret }).toEqual({
          target: store.target,
          credentials_secret: store.credentials_secret,
        })
      }
    }
    expect(await migratePlatform(org.db.admin, { appRole: org.db.appRole })).toBe(1)
  })
})
