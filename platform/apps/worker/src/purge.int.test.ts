// SPDX-License-Identifier: AGPL-3.0-only
import { deleteWorkspace, pendingDeletions } from '@docket/platform-canonical-store'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createHarness, fixtureDocument, HAVE_STACK, type Harness } from './testing.js'

const TEAM = '.docket/resources/team/commerce.md'
const LEDGER = '.docket/resources/datasource/ledger-db.md'

describe.skipIf(!HAVE_STACK)('purging a deleted workspace', () => {
  let h: Harness

  beforeAll(async () => {
    h = await createHarness()
  })
  afterAll(() => h?.close())

  const pending = () => h.org.withOrg(({ tx }) => pendingDeletions(tx, new Date(Date.now() + 3_600_000)))

  it("clears its scope from the org's Neo4j and mem0, and records it purged", async () => {
    for (const path of [TEAM, LEDGER]) await h.write(path, await fixtureDocument(path))
    expect(await h.reconciler().reconcile(h.org.orgId, h.workspaceId)).toMatchObject({ applied: 4, failed: 0 })
    expect((await h.nodes()).count).toBe(2)
    expect((await h.memories()).count).toBe(2)

    await h.org.withOrg((ctx) => deleteWorkspace(ctx, { workspaceId: h.workspaceId, deletedBy: `user:${h.org.userId}` }))
    const [deletion] = await pending()
    expect(deletion).toMatchObject({ workspaceId: h.workspaceId, failures: 0 })

    // The stores are down at first: the purge waits and tries again.
    const down = await h.reconciler({ storeAccess: () => Promise.reject(new Error('connection refused')) }).purge(h.org.orgId, deletion!)
    expect(down.error).toContain('connection refused')
    expect((await h.nodes()).count).toBe(2)
    expect(await pending()).toEqual([expect.objectContaining({ workspaceId: h.workspaceId, failures: 1 })])

    expect(await h.reconciler().purge(h.org.orgId, { workspaceId: h.workspaceId, failures: 1 })).toEqual({})
    expect(await h.nodes()).toEqual({ count: 0, ids: [] })
    expect(await h.memories()).toEqual({ count: 0, ids: [] })
    expect(await pending()).toEqual([])
  })
})
