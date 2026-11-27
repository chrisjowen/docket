// SPDX-License-Identifier: AGPL-3.0-only
import { listSyncRuns, requestRecheck } from '@docket/platform-canonical-store'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dueWorkspaces } from './outbox.js'
import { createHarness, fixtureDocument, HAVE_STACK, type Harness } from './testing.js'

const TEAM = '.docket/resources/team/commerce.md'
const LEDGER = '.docket/resources/datasource/ledger-db.md'

describe.skipIf(!HAVE_STACK)('the sync history', () => {
  let h: Harness
  const runs = () => h.org.withOrg(({ tx }) => listSyncRuns(tx, h.workspaceId))

  beforeAll(async () => {
    h = await createHarness()
  })
  afterAll(() => h?.close())

  it('records each pass: what woke it, and what each store wrote and removed, by id', async () => {
    for (const path of [TEAM, LEDGER]) await h.write(path, await fixtureDocument(path))
    await h.reconciler().reconcile(h.org.orgId, h.workspaceId)
    const [first] = await runs()
    expect(first).toMatchObject({ ok: true, triggers: ['documents'] })
    expect(first?.finishedAt.getTime()).toBeGreaterThanOrEqual(first?.startedAt.getTime() ?? Infinity)
    for (const id of ['neo4j', 'mem0']) {
      const instance = first?.instances.find((candidate) => candidate.id === id)
      expect(instance).toMatchObject({ applied: 2, failed: 0, upserts: 2, deletes: 0 })
      expect(instance?.changes.map((change) => `${change.operation} ${change.kind} ${change.id}`).sort()).toEqual([
        'upsert entity datasource.ledger-db',
        'upsert entity team.commerce',
      ])
    }

    await h.retire(TEAM)
    await h.reconciler().reconcile(h.org.orgId, h.workspaceId)
    const [second] = await runs()
    expect(second?.instances.find((instance) => instance.id === 'neo4j')).toMatchObject({
      upserts: 0,
      deletes: 1,
      changes: [{ operation: 'delete', kind: 'entity', id: 'team.commerce' }],
    })
    // No text of any document is kept, only kinds and ids.
    expect(JSON.stringify(second)).not.toContain('Commerce team')
  })

  it('records a failing store with its error, and a re-check runs a pass at once, past the backoff', async () => {
    await h.write(TEAM, await fixtureDocument(TEAM))
    const failing = h.reconciler({ storeAccess: () => Promise.reject(new Error('pod asleep')) })
    await failing.reconcile(h.org.orgId, h.workspaceId)
    const [failed] = await runs()
    expect(failed?.ok).toBe(false)
    expect(failed?.instances.map((instance) => instance.error)).toEqual([
      "the org's stores are not reachable: pod asleep",
      "the org's stores are not reachable: pod asleep",
    ])
    // Backing off: the outbox loop leaves it alone for now.
    expect(await dueWorkspaces(h.org.router, h.org.orgId, new Date())).not.toContain(h.workspaceId)

    await h.org.withOrg(({ tx }) => requestRecheck(tx, h.workspaceId))
    expect(await dueWorkspaces(h.org.router, h.org.orgId, new Date())).toContain(h.workspaceId)
    await h.reconciler().reconcile(h.org.orgId, h.workspaceId)
    const [rechecked] = await runs()
    expect(rechecked).toMatchObject({ ok: true, triggers: ['documents', 'recheck'] })
    expect(rechecked?.instances.find((instance) => instance.id === 'mem0')).toMatchObject({ upserts: 1, changes: [{ id: 'team.commerce' }] })

    // A re-check with nothing missing writes nothing.
    await h.org.withOrg(({ tx }) => requestRecheck(tx, h.workspaceId))
    await h.reconciler().reconcile(h.org.orgId, h.workspaceId)
    const [quiet] = await runs()
    expect(quiet).toMatchObject({ ok: true, triggers: ['recheck'] })
    expect(quiet?.instances.map((instance) => instance.applied)).toEqual([0, 0])
  })

  it('records a workspace that cannot be projected as a failed pass', async () => {
    await h.org.withOrg(({ tx }) => tx.query("UPDATE ontology_versions SET status = 'discarded', number = NULL WHERE workspace_id = $1", [h.workspaceId]))
    await expect(h.reconciler().reconcile(h.org.orgId, h.workspaceId)).rejects.toThrow(/cannot be projected/)
    const [failed] = await runs()
    expect(failed?.ok).toBe(false)
    expect(failed?.instances[0]?.error).toMatch(/cannot be projected/)
  })
})
