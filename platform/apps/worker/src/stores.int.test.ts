// SPDX-License-Identifier: AGPL-3.0-only
import { insertSpace, insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import type { Neo4jPodProvisioner, Neo4jRef, QdrantProvisioner, QdrantRef, StoreBinding } from '@docket/platform-provisioner'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { newStoreId, orgStores } from './stores.js'

const neo4jUrl = (ref: Neo4jRef) => `bolt+s://${ref.storeId ? `neo4j-${ref.storeId}` : `neo4j-org-${ref.orgId}`}:7687`
const collection = (ref: QdrantRef) => (ref.docketId ? `org_${ref.orgId}__ws_${ref.docketId}` : `org_${ref.orgId}__mem0`)

/** Provisioners that only remember what was asked of them, instance by instance. */
function fakes() {
  const made = new Set<string>()
  const replicas = new Map<string, number>()
  const key = (ref: Neo4jRef) => ref.storeId ?? ref.orgId
  const neo4j: Neo4jPodProvisioner = {
    async provision(ref): Promise<StoreBinding> {
      const created = !made.has(`neo4j:${key(ref)}`)
      made.add(`neo4j:${key(ref)}`)
      if (!replicas.has(key(ref))) replicas.set(key(ref), 1)
      return { store: 'neo4j', target: neo4jUrl(ref), credentialsSecret: `neo4j-${key(ref)}`, created }
    },
    bind: async (ref) => ({ store: 'neo4j', target: neo4jUrl(ref) }),
    credentials: async (ref) => ({ url: neo4jUrl(ref), username: 'neo4j', password: `p-${key(ref)}` }),
    wake: vi.fn(async (ref: Neo4jRef) => {
      replicas.set(key(ref), 1)
    }),
    suspend: vi.fn(async (ref: Neo4jRef) => {
      replicas.set(key(ref), 0)
    }),
    deprovision: vi.fn(async (ref: Neo4jRef) => {
      made.delete(`neo4j:${key(ref)}`)
      replicas.delete(key(ref))
    }),
    health: async (ref) => ((replicas.get(key(ref)) ?? 0) > 0 ? 'ok' : 'degraded'),
  }
  const qdrant: QdrantProvisioner = {
    async provision(ref): Promise<StoreBinding> {
      const created = !made.has(`qdrant:${collection(ref)}`)
      made.add(`qdrant:${collection(ref)}`)
      return { store: 'qdrant', target: `https://q/collections/${collection(ref)}`, created }
    },
    bind: async (ref) => ({ store: 'qdrant', target: `https://q/collections/${collection(ref)}` }),
    access: async (ref) => ({ url: 'https://q', collection: collection(ref), token: `t-${collection(ref)}`, dimension: 8 }),
    suspend: async () => undefined,
    deprovision: vi.fn(async (ref: QdrantRef) => {
      made.delete(`qdrant:${collection(ref)}`)
    }),
    health: async () => 'ok',
  }
  return { made, replicas, neo4j, qdrant }
}

const log = { info: () => undefined, error: () => undefined }
const embedder = { url: 'http://e', model: 'm', dimension: 8 }

describe.skipIf(!TEST_PG_URL)('orgStores: each docket on its stores (tenancy v2 §5)', () => {
  let org: TestOrg
  let generalDocket: string
  let engineering: string
  let engineeringDocket: string

  type StoreView = { id: string; kind: string; space_id: string | null; docket_id: string | null; status: string; used_at: Date | null }
  const storeRows = () =>
    org.router.withPlatform(async (tx) => {
      const { rows } = await tx.query<StoreView>(
        'SELECT id, kind, space_id, docket_id, status, used_at FROM platform.stores WHERE org_id = $1 ORDER BY kind, created_at',
        [org.orgId],
      )
      return rows
    })
  const assigned = (docketId: string, kind: 'neo4j' | 'qdrant') =>
    org.router.withPlatform(async (tx) => {
      const { rows } = await tx.query<{ store_id: string }>('SELECT store_id FROM platform.docket_stores WHERE org_id = $1 AND docket_id = $2 AND kind = $3', [
        org.orgId,
        docketId,
        kind,
      ])
      return rows[0]?.store_id ?? null
    })
  const rebuilds = (docketId: string) =>
    org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ count: string }>("SELECT count(*) FROM outbox WHERE workspace_id = $1 AND kind = 'rebuild' AND processed_at IS NULL", [
        docketId,
      ])
      return Number(rows[0]?.count)
    })
  const clearRebuilds = () => org.withOrg(({ tx }) => tx.query("UPDATE outbox SET processed_at = now() WHERE kind = 'rebuild'"))

  beforeAll(async () => {
    org = await createTestOrg()
    await org.withOrg(async ({ tx }) => {
      generalDocket = (await insertWorkspace(tx, { name: 'Handbook', slug: 'handbook', createdBy: org.userId })).id
      engineering = (await insertSpace(tx, { name: 'Engineering', slug: 'engineering', createdBy: org.userId })).id
      engineeringDocket = (await insertWorkspace(tx, { name: 'Payments', slug: 'payments', createdBy: org.userId, spaceId: engineering })).id
    })
  })
  afterAll(() => org?.drop())

  it("gives a new docket the account's Neo4j and a Qdrant collection of its own on first use, without a rebuild", async () => {
    const { neo4j, qdrant } = fakes()
    const stores = orgStores({ router: org.router, neo4j, qdrant, embedder, log })
    const access = await stores.access(org.orgId, generalDocket)
    expect(access.neo4j.url).toBe(`bolt+s://neo4j-org-${org.orgId}:7687`)
    expect(access.qdrant.collection).toBe(`org_${org.orgId}__ws_${generalDocket}`)
    expect(access.qdrant.token).toBe(`t-org_${org.orgId}__ws_${generalDocket}`)
    const rows = await storeRows()
    expect(rows.map(({ kind, space_id, docket_id, status }) => [kind, space_id, docket_id, status])).toEqual([
      ['neo4j', null, null, 'ready'],
      ['qdrant', null, generalDocket, 'ready'],
    ])
    expect(rows.every((row) => row.used_at !== null)).toBe(true)
    expect(await rebuilds(generalDocket)).toBe(0)
  })

  it("keeps a docket that was pinned to the account's shared collection there", async () => {
    const { neo4j, qdrant } = fakes()
    const stores = orgStores({ router: org.router, neo4j, qdrant, embedder, log })
    const shared = newStoreId()
    await org.router.withPlatform(async (tx) => {
      await tx.query("INSERT INTO platform.stores (id, org_id, kind, status) VALUES ($1, $2, 'qdrant', 'ready')", [shared, org.orgId])
      await tx.query("INSERT INTO platform.docket_stores (org_id, docket_id, kind, store_id) VALUES ($1, $2, 'qdrant', $3)", [org.orgId, engineeringDocket, shared])
    })
    const access = await stores.access(org.orgId, engineeringDocket)
    expect(access.qdrant.collection).toBe(`org_${org.orgId}__mem0`)
    expect(await assigned(engineeringDocket, 'qdrant')).toBe(shared)
  })

  it('queues a rebuild of the dockets on a store that had to be made anew', async () => {
    await clearRebuilds()
    // These fakes have made nothing yet: to them every store is gone.
    const { neo4j, qdrant } = fakes()
    await orgStores({ router: org.router, neo4j, qdrant, embedder, log }).ensure(org.orgId)
    expect(await rebuilds(generalDocket)).toBeGreaterThan(0)
    expect(await rebuilds(engineeringDocket)).toBeGreaterThan(0)
  })

  it("moves a space's dockets to its own Neo4j once it is up, clears them from the account's, and back when it retires", async () => {
    await clearRebuilds()
    const { neo4j, qdrant } = fakes()
    const cleared: { url: string; workspaceId: string }[] = []
    const stores = orgStores({
      router: org.router,
      neo4j,
      qdrant,
      embedder,
      log,
      clearScope: async (credentials, workspaceId) => {
        cleared.push({ url: credentials.url, workspaceId })
      },
    })
    await stores.ensure(org.orgId)
    const accountNeo4j = await assigned(generalDocket, 'neo4j')
    expect(await assigned(engineeringDocket, 'neo4j')).toBe(accountNeo4j)

    // Engineering asks for its own instance from its Settings.
    const own = newStoreId()
    await org.router.withPlatform((tx) =>
      tx.query("INSERT INTO platform.stores (id, org_id, kind, space_id, status) VALUES ($1, $2, 'neo4j', $3, 'requested')", [own, org.orgId, engineering]),
    )
    await clearRebuilds()
    await stores.ensure(org.orgId)
    expect((await storeRows()).find((row) => row.id === own)?.status).toBe('ready')
    expect(await assigned(engineeringDocket, 'neo4j')).toBe(own)
    expect(await assigned(generalDocket, 'neo4j')).toBe(accountNeo4j)
    expect(await rebuilds(engineeringDocket)).toBe(1)
    expect(await rebuilds(generalDocket)).toBe(0)
    expect(cleared).toEqual([{ url: `bolt+s://neo4j-org-${org.orgId}:7687`, workspaceId: engineeringDocket }])
    expect((await stores.access(org.orgId, engineeringDocket)).neo4j.url).toBe(`bolt+s://neo4j-${own}:7687`)

    // A docket made in Engineering from now on goes straight to its instance.
    const later = await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Incidents', slug: 'incidents', createdBy: org.userId, spaceId: engineering }))
    expect((await stores.access(org.orgId, later.id)).neo4j.url).toBe(`bolt+s://neo4j-${own}:7687`)

    // Engineering goes back to the account's instance: its dockets move back, and the pod is removed.
    await org.router.withPlatform((tx) => tx.query("UPDATE platform.stores SET status = 'retiring' WHERE id = $1", [own]))
    await clearRebuilds()
    await stores.ensure(org.orgId)
    expect(await assigned(engineeringDocket, 'neo4j')).toBe(accountNeo4j)
    expect(await assigned(later.id, 'neo4j')).toBe(accountNeo4j)
    expect(await rebuilds(engineeringDocket)).toBe(1)
    expect(neo4j.deprovision).toHaveBeenCalledWith({ orgId: org.orgId, storeId: own }, 'shred')
    expect((await storeRows()).some((row) => row.id === own)).toBe(false)
    // Nothing is cleared from an instance that is removed whole.
    expect(cleared).toHaveLength(1)
  })

  it("keeps a space's request to go back to the account's Neo4j when a use or provisioning of its instance ends after it", async () => {
    const fake = fakes()
    let retireDuring: string | null = null
    const retire = async (ref: Neo4jRef) => {
      if (ref.storeId && ref.storeId === retireDuring) {
        await org.router.withPlatform((tx) => tx.query("UPDATE platform.stores SET status = 'retiring' WHERE id = $1", [ref.storeId]))
      }
    }
    const neo4j: Neo4jPodProvisioner = {
      ...fake.neo4j,
      async provision(ref) {
        const binding = await fake.neo4j.provision(ref)
        await retire(ref)
        return binding
      },
      async credentials(ref) {
        await retire(ref)
        return fake.neo4j.credentials(ref)
      },
    }
    const stores = orgStores({ router: org.router, neo4j, qdrant: fake.qdrant, embedder, log })
    await stores.ensure(org.orgId)
    const accountNeo4j = await assigned(generalDocket, 'neo4j')

    // Engineering's instance is in use when its lead asks to go back: the use ending does not undo that.
    const own = newStoreId()
    await org.router.withPlatform((tx) =>
      tx.query("INSERT INTO platform.stores (id, org_id, kind, space_id, status) VALUES ($1, $2, 'neo4j', $3, 'requested')", [own, org.orgId, engineering]),
    )
    await stores.ensure(org.orgId)
    expect(await assigned(engineeringDocket, 'neo4j')).toBe(own)
    retireDuring = own
    await stores.access(org.orgId, engineeringDocket)
    expect((await storeRows()).find((row) => row.id === own)?.status).toBe('retiring')
    await stores.ensure(org.orgId)
    expect(await assigned(engineeringDocket, 'neo4j')).toBe(accountNeo4j)
    expect((await storeRows()).some((row) => row.id === own)).toBe(false)

    // Asked for again, and given back while it is still being made: it is not recorded as ready, and is removed.
    const again = newStoreId()
    await org.router.withPlatform((tx) =>
      tx.query("INSERT INTO platform.stores (id, org_id, kind, space_id, status) VALUES ($1, $2, 'neo4j', $3, 'requested')", [again, org.orgId, engineering]),
    )
    retireDuring = again
    await stores.ensure(org.orgId)
    expect(await assigned(engineeringDocket, 'neo4j')).toBe(accountNeo4j)
    expect((await storeRows()).some((row) => row.id === again)).toBe(false)
    expect(fake.neo4j.deprovision).toHaveBeenCalledWith({ orgId: org.orgId, storeId: again }, 'shred')
  })

  it('suspends a Neo4j pod idle past the threshold, and wakes it on the next use', async () => {
    const { neo4j, qdrant, replicas } = fakes()
    let now = new Date(Date.now() + 2 * 3_600_000)
    const stores = orgStores({ router: org.router, neo4j, qdrant, embedder, log, idleMs: 3_600_000, now: () => now })
    await stores.ensure(org.orgId)
    const accountNeo4j = (await assigned(generalDocket, 'neo4j')) as string
    expect(await stores.sweepIdle()).toContain(`${org.orgId}/${accountNeo4j}`)
    expect(neo4j.suspend).toHaveBeenCalledWith({ orgId: org.orgId })
    expect(replicas.get(org.orgId)).toBe(0)
    expect((await storeRows()).find((row) => row.id === accountNeo4j)?.status).toBe('suspended')

    now = new Date()
    await stores.access(org.orgId, generalDocket)
    expect(neo4j.wake).toHaveBeenCalled()
    expect((await storeRows()).find((row) => row.id === accountNeo4j)?.status).toBe('ready')
    // Just used: not idle.
    expect(await stores.sweepIdle()).not.toContain(`${org.orgId}/${accountNeo4j}`)
  })

  it("drops a deleted docket's own collection once it is purged, and forgets its stores", async () => {
    const { neo4j, qdrant } = fakes()
    const stores = orgStores({ router: org.router, neo4j, qdrant, embedder, log })
    await stores.release(org.orgId, generalDocket)
    expect(qdrant.deprovision).toHaveBeenCalledWith({ orgId: org.orgId, docketId: generalDocket }, 'shred')
    expect(await assigned(generalDocket, 'neo4j')).toBeNull()
    expect(await assigned(generalDocket, 'qdrant')).toBeNull()
    expect((await storeRows()).some((row) => row.docket_id === generalDocket)).toBe(false)
    // The account's shared collection is never dropped for one docket.
    await stores.release(org.orgId, engineeringDocket)
    expect(qdrant.deprovision).toHaveBeenCalledTimes(1)
  })
})
