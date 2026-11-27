// SPDX-License-Identifier: AGPL-3.0-only
import { insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import type { Neo4jPodProvisioner, QdrantProvisioner, StoreBinding } from '@docket/platform-provisioner'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { orgStores } from './stores.js'

/** Provisioners that only remember what was asked of them. */
function fakes() {
  const state = { neo4jMade: false, qdrantMade: false, replicas: 1 }
  const neo4j: Neo4jPodProvisioner = {
    async provision(): Promise<StoreBinding> {
      const created = !state.neo4jMade
      state.neo4jMade = true
      return { store: 'neo4j', target: 'bolt+s://neo4j-org-x:7687', credentialsSecret: 'neo4j-org-x', created }
    },
    bind: async () => ({ store: 'neo4j', target: 'bolt+s://neo4j-org-x:7687' }),
    credentials: async () => ({ url: 'bolt+s://neo4j-org-x:7687', username: 'neo4j', password: 'p' }),
    wake: vi.fn(async () => {
      state.replicas = 1
    }),
    suspend: vi.fn(async () => {
      state.replicas = 0
    }),
    deprovision: async () => undefined,
    health: async () => (state.replicas > 0 ? 'ok' : 'degraded'),
  }
  const qdrant: QdrantProvisioner = {
    async provision(): Promise<StoreBinding> {
      const created = !state.qdrantMade
      state.qdrantMade = true
      return { store: 'qdrant', target: 'https://q/collections/org_x__mem0', created }
    },
    bind: async () => ({ store: 'qdrant', target: '' }),
    access: async () => ({ url: 'https://q', collection: 'org_x__mem0', token: 't', dimension: 8 }),
    suspend: async () => undefined,
    deprovision: async () => undefined,
    health: async () => 'ok',
  }
  return { state, neo4j, qdrant }
}

const log = { info: () => undefined, error: () => undefined }

describe.skipIf(!TEST_PG_URL)('orgStores', () => {
  let org: TestOrg
  let workspaceId: string
  const rows = () =>
    org.router.withPlatform(async (tx) => {
      const { rows } = await tx.query<{ store: string; status: string; used_at: Date | null }>(
        'SELECT store, status, used_at FROM platform.org_stores WHERE org_id = $1 ORDER BY store',
        [org.orgId],
      )
      return rows
    })
  const rebuilds = () =>
    org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ count: string }>("SELECT count(*) FROM outbox WHERE kind = 'rebuild' AND processed_at IS NULL")
      return Number(rows[0]?.count)
    })

  beforeAll(async () => {
    org = await createTestOrg()
    workspaceId = await org.withOrg((ctx) => insertWorkspace(ctx.tx, { name: 'Workspace', slug: 'ws', createdBy: org.userId }).then((w) => w.id))
  })
  afterAll(() => org?.drop())

  it('provisions both stores on first use and records them, without a rebuild', async () => {
    const { neo4j, qdrant } = fakes()
    const stores = orgStores({ router: org.router, neo4j, qdrant, embedder: { url: 'http://e', model: 'm', dimension: 8 }, log })
    const access = await stores.access(org.orgId)
    expect(access.neo4j.password).toBe('p')
    expect(access.qdrant.token).toBe('t')
    expect((await rows()).map(({ store, status }) => [store, status])).toEqual([
      ['neo4j', 'ready'],
      ['qdrant', 'ready'],
    ])
    expect((await rows()).every((row) => row.used_at !== null)).toBe(true)
    expect(await rebuilds()).toBe(0)
    expect(workspaceId).toMatch(/^[a-z0-9]+$/)
  })

  it('queues a rebuild of every workspace when a store had to be made anew', async () => {
    const { neo4j, qdrant } = fakes()
    // These fakes have made nothing yet: to them the org's stores are gone.
    const stores = orgStores({ router: org.router, neo4j, qdrant, embedder: { url: 'http://e', model: 'm', dimension: 8 }, log })
    await stores.ensure(org.orgId)
    expect(await rebuilds()).toBe(2)
  })

  it('suspends a Neo4j pod idle past the threshold, and wakes it on the next use', async () => {
    const { neo4j, qdrant, state } = fakes()
    let now = new Date(Date.now() + 2 * 3_600_000)
    const stores = orgStores({
      router: org.router,
      neo4j,
      qdrant,
      embedder: { url: 'http://e', model: 'm', dimension: 8 },
      log,
      idleMs: 3_600_000,
      now: () => now,
    })
    expect(await stores.sweepIdle()).toContain(org.orgId)
    expect(neo4j.suspend).toHaveBeenCalledWith({ orgId: org.orgId })
    expect(state.replicas).toBe(0)
    expect((await rows()).find((row) => row.store === 'neo4j')?.status).toBe('suspended')

    now = new Date()
    await stores.access(org.orgId)
    expect(neo4j.wake).toHaveBeenCalled()
    expect((await rows()).find((row) => row.store === 'neo4j')?.status).toBe('ready')
    // Just used: not idle.
    expect(await stores.sweepIdle()).not.toContain(org.orgId)
  })
})
