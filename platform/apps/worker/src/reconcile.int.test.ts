// SPDX-License-Identifier: AGPL-3.0-only
import { enqueue } from '@docket/platform-canonical-store'
import { openProjections } from '@docket/platform-projections'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createHarness, fixtureDocument, HAVE_STACK, type Harness } from './testing.js'

const TEAM = '.docket/resources/team/commerce.md'
const LEDGER = '.docket/resources/datasource/ledger-db.md'
const DISCOVERY = '.docket/resources/team/discovery.md'

describe.skipIf(!HAVE_STACK)('reconcile', () => {
  let h: Harness

  beforeAll(async () => {
    h = await createHarness()
  })
  afterAll(() => h?.close())

  it("projects 3 documents into the org's Neo4j and mem0 in scope ws_<id>, and retiring one removes it from both", async () => {
    for (const path of [TEAM, LEDGER, DISCOVERY]) await h.write(path, await fixtureDocument(path))
    const first = await h.reconciler().reconcile(h.org.orgId, h.workspaceId)
    expect(first).toMatchObject({ applied: 6, failed: 0 })
    expect(h.scope).toBe(`ws_${h.workspaceId}`)
    const ids = ['datasource.ledger-db', 'team.commerce', 'team.discovery']
    expect(await h.nodes()).toEqual({ count: 3, ids })
    expect(await h.memories()).toEqual({ count: 3, ids })

    await h.retire(TEAM)
    const second = await h.reconciler().reconcile(h.org.orgId, h.workspaceId)
    expect(second).toMatchObject({ applied: 2, failed: 0 })
    expect(second.checkpoint).not.toBe(first.checkpoint)
    expect(await h.nodes()).toEqual({ count: 2, ids: ['datasource.ledger-db', 'team.discovery'] })
    expect(await h.memories()).toEqual({ count: 2, ids: ['datasource.ledger-db', 'team.discovery'] })
  })

  it('does nothing when nothing changed, and marks the outbox processed', async () => {
    const again = await h.reconciler().reconcile(h.org.orgId, h.workspaceId)
    expect(again).toMatchObject({ applied: 0, failed: 0 })
    const pending = await h.org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ count: string }>('SELECT count(*) FROM outbox WHERE processed_at IS NULL')
      return Number(rows[0]?.count)
    })
    expect(pending).toBe(0)
  })

  it('records each instance in sync, so the graph shows the index up to date', async () => {
    const rows = await h.org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ instance_id: string; failures: number; synced_at: Date | null }>(
        'SELECT instance_id, failures, synced_at FROM projection_status WHERE workspace_id = $1 ORDER BY instance_id',
        [h.workspaceId],
      )
      return rows
    })
    expect(rows.map((row) => [row.instance_id, row.failures, row.synced_at !== null])).toEqual([
      ['mem0', 0, true],
      ['neo4j', 0, true],
    ])
  })

  it('keeps one instance going when the other is down, and backs off the one that failed', async () => {
    await h.write(TEAM, await fixtureDocument(TEAM))
    const result = await h
      .reconciler({ storeAccess: async () => ({ ...h.access, neo4j: { ...h.access.neo4j, password: 'wrong' } }) })
      .reconcile(h.org.orgId, h.workspaceId)
    expect(result.instances.map(({ id, applied, error }) => ({ id, applied, failed: error !== undefined }))).toEqual([
      { id: 'neo4j', applied: 0, failed: true },
      { id: 'mem0', applied: 1, failed: false },
    ])
    expect((await h.memories()).count).toBe(3)
    const status = await h.org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ failures: number; last_error: string; retry_at: Date }>(
        "SELECT failures, last_error, retry_at FROM projection_status WHERE workspace_id = $1 AND instance_id = 'neo4j'",
        [h.workspaceId],
      )
      return rows[0]
    })
    expect(status?.failures).toBe(1)
    expect(status?.last_error).toMatch(/could not connect/)
    expect(status?.retry_at.getTime()).toBeGreaterThan(Date.now())

    // Its outbox row stays pending until neo4j catches up.
    const healed = await h.reconciler().reconcile(h.org.orgId, h.workspaceId)
    expect(healed.instances.map(({ id, applied }) => ({ id, applied }))).toEqual([
      { id: 'neo4j', applied: 1 },
      { id: 'mem0', applied: 0 },
    ])
    expect((await h.nodes()).count).toBe(3)
  })

  it('rebuilds: resets the scope and replays every document', async () => {
    const rebuilt = await h.reconciler().reconcile(h.org.orgId, h.workspaceId, { fresh: true })
    expect(rebuilt.instances.every((instance) => instance.reset)).toBe(true)
    expect(rebuilt).toMatchObject({ applied: 6, failed: 0 })
    expect((await h.nodes()).count).toBe(3)
    expect((await h.memories()).count).toBe(3)
  })

  it('resets each instance once for a queued rebuild, even while another keeps failing', async () => {
    await h.org.withOrg(({ tx }) => enqueue(tx, h.workspaceId, 'rebuild'))
    const down = h.reconciler({ storeAccess: async () => ({ ...h.access, embedder: { ...h.access.embedder, url: 'http://127.0.0.1:9' } }) })
    const first = await down.reconcile(h.org.orgId, h.workspaceId)
    expect(first.instances.find(({ id }) => id === 'neo4j')).toMatchObject({ reset: true, applied: 3, failed: 0 })
    expect(first.instances.find(({ id }) => id === 'mem0')?.error).toBeDefined()

    const retried = await down.reconcile(h.org.orgId, h.workspaceId)
    expect(retried.instances.find(({ id }) => id === 'neo4j')).toMatchObject({ reset: false, applied: 0 })
    expect((await h.nodes()).count).toBe(3)

    const healed = await h.reconciler().reconcile(h.org.orgId, h.workspaceId)
    expect(healed).toMatchObject({ failed: 0 })
    expect(healed.instances.find(({ id }) => id === 'neo4j')?.reset).toBe(false)
    expect((await h.memories()).count).toBe(3)

    const again = await h.reconciler().reconcile(h.org.orgId, h.workspaceId)
    expect(again.instances.every((instance) => !instance.reset)).toBe(true)
  })

  it('records a failed reset as that instance failing, with backoff, and still projects the other', async () => {
    await h.org.withOrg(({ tx }) => enqueue(tx, h.workspaceId, 'rebuild'))
    const failingReset = h.reconciler({
      open: async (id, options) => {
        const adapter = (await openProjections({ ...options, only: [id] }))[id]
        if (!adapter?.projection) throw new Error(`${id} did not open`)
        if (id !== 'neo4j') return adapter
        const projection = Object.assign(Object.create(adapter.projection), {
          reset: async () => {
            throw new Error('neo4j went away mid-pass')
          },
        })
        return Object.create(adapter, { projection: { value: projection } })
      },
    })
    const result = await failingReset.reconcile(h.org.orgId, h.workspaceId)
    expect(result.instances.find(({ id }) => id === 'neo4j')?.error).toBe('neo4j went away mid-pass')
    expect(result.instances.find(({ id }) => id === 'mem0')).toMatchObject({ reset: true, applied: 3, failed: 0 })
    const status = await h.org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ last_error: string; retry_at: Date | null }>(
        "SELECT last_error, retry_at FROM projection_status WHERE workspace_id = $1 AND instance_id = 'neo4j'",
        [h.workspaceId],
      )
      return rows[0]
    })
    expect(status?.last_error).toBe('neo4j went away mid-pass')
    expect(status?.retry_at?.getTime()).toBeGreaterThan(Date.now())

    const healed = await h.reconciler().reconcile(h.org.orgId, h.workspaceId)
    expect(healed).toMatchObject({ failed: 0 })
    expect(healed.instances.find(({ id }) => id === 'neo4j')?.reset).toBe(true)
    expect(healed.instances.find(({ id }) => id === 'mem0')?.reset).toBe(false)
    expect((await h.nodes()).count).toBe(3)
  })
})
