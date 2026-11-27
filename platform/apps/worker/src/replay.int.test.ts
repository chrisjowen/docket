// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createHarness, fixtureDocument, HAVE_STACK, type Harness } from './testing.js'

class Killed extends Error {}

describe.skipIf(!HAVE_STACK)('replay', () => {
  let h: Harness

  beforeAll(async () => {
    h = await createHarness()
    for (const path of [
      '.docket/resources/team/commerce.md',
      '.docket/resources/datasource/ledger-db.md',
      '.docket/resources/service/orders.md',
    ]) {
      await h.write(path, await fixtureDocument(path))
    }
  })
  afterAll(() => h?.close())

  it('crash after apply before checkpoint: the batch replays without duplicates and the checkpoint advances', async () => {
    const manifest = (instance: string) =>
      h.org.withOrg(async ({ tx }) => {
        const { rows } = await tx.query<{ checkpoint: string; fingerprint: string }>(
          `SELECT manifest->>'checkpoint' AS checkpoint, manifest->>'fingerprint' AS fingerprint
             FROM adapter_manifests WHERE workspace_id = $1 AND instance_id = $2`,
          [h.workspaceId, instance],
        )
        return rows[0] ?? null
      })

    // The worker dies once neo4j has applied the batch, before its manifest is written.
    const crashing = h.reconciler({
      hooks: {
        afterApply: (instance) => {
          if (instance === 'neo4j') throw new Killed('worker killed between apply and the checkpoint write')
        },
      },
    })
    await expect(crashing.reconcile(h.org.orgId, h.workspaceId)).rejects.toBeInstanceOf(Killed)
    // The store has the nodes; its manifest still vouches for nothing (an unfinished first pass).
    expect((await h.nodes()).count).toBe(3)
    const crashed = await manifest('neo4j')
    expect(crashed?.fingerprint).toMatch(/^reset-pending:/)
    expect(crashed?.checkpoint).toBe(`records:${'0'.repeat(64)}`)
    const pending = await h.org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ count: string }>('SELECT count(*) FROM outbox WHERE processed_at IS NULL')
      return Number(rows[0]?.count)
    })
    expect(pending).toBeGreaterThan(0)

    // The restarted worker replays the whole batch: idempotent upserts, no duplicates.
    const replayed = await h.reconciler().reconcile(h.org.orgId, h.workspaceId)
    expect(replayed.failed).toBe(0)
    const nodes = await h.nodes()
    const memories = await h.memories()
    expect(nodes.count).toBe(nodes.ids.length)
    expect(nodes.ids).toEqual(['datasource.ledger-db', 'service.orders', 'team.commerce'])
    expect(memories.count).toBe(memories.ids.length)
    expect(memories.ids).toEqual(['datasource.ledger-db', 'service.orders', 'team.commerce'])
    expect(replayed.checkpoint).not.toBe(crashed?.checkpoint)
    expect(await manifest('neo4j')).toEqual({ checkpoint: replayed.checkpoint, fingerprint: expect.stringMatching(/^sha256:/) })
    expect((await manifest('mem0'))?.checkpoint).toBe(replayed.checkpoint)
  })

  it('crash mid-replay a second time still converges', async () => {
    await h.write('.docket/resources/team/discovery.md', await fixtureDocument('.docket/resources/team/discovery.md'))
    const crashing = h.reconciler({
      hooks: {
        afterApply: (instance) => {
          if (instance === 'mem0') throw new Killed('killed after mem0 applied')
        },
      },
    })
    await expect(crashing.reconcile(h.org.orgId, h.workspaceId)).rejects.toBeInstanceOf(Killed)
    const result = await h.reconciler().reconcile(h.org.orgId, h.workspaceId)
    expect(result.failed).toBe(0)
    // neo4j recorded its pass before the crash, so only mem0 replays.
    expect(result.instances.map(({ id, applied }) => ({ id, applied }))).toEqual([
      { id: 'neo4j', applied: 0 },
      { id: 'mem0', applied: 1 },
    ])
    expect((await h.memories()).count).toBe(4)
    expect((await h.nodes()).count).toBe(4)
  })
})
