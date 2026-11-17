import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { readFixture, type Fixture } from '../../test/fixture.js'
import { STORE_KINDS, TEST_PG_URL, createTestStore, seedWorkspace, type TestStore } from '../../test/postgres.js'
import { memoryProjections, type MemoryProjections } from '../../test/projections.js'
import type { StoreScope } from '../ports.js'
import { deleteWorkspace, enqueue, insertWorkspace, listSyncRuns, pendingDeletions, putDocument, requestRecheck, retireDocument, syncStanding } from '../postgres/index.js'
import { reconciler } from './reconcile.js'

const TEAM = '.docket/resources/team/commerce.md'
const LEDGER = '.docket/resources/datasource/ledger-db.md'
const DISCOVERY = '.docket/resources/team/discovery.md'

describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('reconciling a workspace over $name', (kind) => {
  let test: TestStore
  let fixture: Fixture
  let scope: StoreScope
  let workspaceId: string
  let projections: MemoryProjections

  const raw = (path: string) => fixture.documents.find((document) => document.path === path)?.raw as string
  const write = (path: string) => test.as((ctx) => putDocument(ctx, { workspaceId, path, raw: raw(path), origin: 'cloud', actor: 'user:owner' }))
  const ids = (instance: string) => [...projections.held(instance, workspaceId).keys()].sort()
  const status = () =>
    test.as(async ({ tx }) => {
      const { rows } = await tx.query<{ instance_id: string; failures: number; last_error: string | null; retry_at: Date | null; synced_at: Date | null }>(
        'SELECT instance_id, failures, last_error, retry_at, synced_at FROM projection_status WHERE workspace_id = $1 ORDER BY instance_id',
        [workspaceId]
      )
      return new Map(rows.map((row) => [row.instance_id, row]))
    })

  beforeAll(async () => {
    test = await createTestStore(kind)
    fixture = await readFixture()
    scope = { id: 'store', store: test.store }
    workspaceId = await test.as((ctx) => seedWorkspace(ctx, { slug: 'platform', ontology: fixture.ontology }))
    projections = memoryProjections()
  })
  afterAll(() => test?.drop())
  beforeEach(() => {
    projections.fail('graph', {})
    projections.fail('memories', {})
  })

  it('projects 3 documents into every instance in the workspace’s scope, and retiring one removes it from each', async () => {
    for (const path of [TEAM, LEDGER, DISCOVERY]) await write(path)
    const first = await reconciler({ projections }).reconcile(scope, workspaceId)
    expect(first).toMatchObject({ applied: 6, failed: 0 })
    expect(ids('graph')).toEqual(['datasource.ledger-db', 'team.commerce', 'team.discovery'])
    expect(ids('memories')).toEqual(ids('graph'))
    const manifest = await test.as(({ tx }) => tx.query<{ manifest: { scope: string } }>("SELECT manifest FROM adapter_manifests WHERE workspace_id = $1 AND instance_id = 'graph'", [workspaceId]))
    expect(manifest.rows[0]?.manifest.scope).toBe(`ws_${workspaceId}`)

    await test.as(({ tx }) => retireDocument(tx, { workspaceId, path: TEAM }))
    const second = await reconciler({ projections }).reconcile(scope, workspaceId)
    expect(second).toMatchObject({ applied: 2, failed: 0 })
    expect(second.checkpoint).not.toBe(first.checkpoint)
    expect(ids('graph')).toEqual(['datasource.ledger-db', 'team.discovery'])
    expect(ids('memories')).toEqual(['datasource.ledger-db', 'team.discovery'])
  })

  it('does nothing when nothing changed, marks the outbox processed, and records each instance in sync', async () => {
    expect(await reconciler({ projections }).reconcile(scope, workspaceId)).toMatchObject({ applied: 0, failed: 0 })
    const pending = await test.as(({ tx }) => tx.query<{ n: number }>('SELECT count(*)::int AS n FROM outbox WHERE workspace_id = $1 AND processed_at IS NULL', [workspaceId]))
    expect(pending.rows[0]?.n).toBe(0)
    expect([...(await status()).values()].map((row) => [row.instance_id, row.failures, row.synced_at !== null])).toEqual([
      ['graph', 0, true],
      ['memories', 0, true]
    ])
  })

  it('keeps one instance going when another is down, backs off the one that failed, and catches it up after', async () => {
    await write(TEAM)
    projections.fail('graph', { connect: 'connection refused' })
    const result = await reconciler({ projections }).reconcile(scope, workspaceId)
    expect(result.instances.map(({ id, applied, error }) => ({ id, applied, failed: error !== undefined }))).toEqual([
      { id: 'graph', applied: 0, failed: true },
      { id: 'memories', applied: 1, failed: false }
    ])
    const graph = (await status()).get('graph')
    expect(graph).toMatchObject({ failures: 1, last_error: 'could not connect: connection refused' })
    expect(graph?.retry_at?.getTime()).toBeGreaterThan(Date.now())
    // Its outbox row stays pending until the graph catches up.
    const pending = await test.as(({ tx }) => tx.query<{ n: number }>('SELECT count(*)::int AS n FROM outbox WHERE workspace_id = $1 AND processed_at IS NULL', [workspaceId]))
    expect(pending.rows[0]?.n).toBeGreaterThan(0)

    projections.fail('graph', {})
    const healed = await reconciler({ projections }).reconcile(scope, workspaceId)
    expect(healed.instances.map(({ id, applied }) => ({ id, applied }))).toEqual([
      { id: 'graph', applied: 1 },
      { id: 'memories', applied: 0 }
    ])
    expect(ids('graph')).toEqual(['datasource.ledger-db', 'team.commerce', 'team.discovery'])
  })

  it('fails every instance when the stores cannot be reached at all', async () => {
    const unreachable = { ...projections, connect: async () => Promise.reject(new Error('dns failure')) }
    const result = await reconciler({ projections: unreachable }).reconcile(scope, workspaceId)
    expect(result.instances.map((instance) => instance.error)).toEqual(['the stores are not reachable: dns failure', 'the stores are not reachable: dns failure'])
  })

  it('rebuilds: resets the scope and replays every document', async () => {
    const rebuilt = await reconciler({ projections }).reconcile(scope, workspaceId, { fresh: true })
    expect(rebuilt.instances.every((instance) => instance.reset)).toBe(true)
    expect(rebuilt).toMatchObject({ applied: 6, failed: 0 })
    expect(ids('graph')).toHaveLength(3)
    expect(ids('memories')).toHaveLength(3)
  })

  it('resets each instance once for a queued rebuild, even while another keeps failing', async () => {
    await test.as(({ tx }) => enqueue(tx, workspaceId, 'rebuild'))
    projections.fail('memories', { apply: 'embedder unreachable' })
    const first = await reconciler({ projections }).reconcile(scope, workspaceId)
    expect(first.instances.find(({ id }) => id === 'graph')).toMatchObject({ reset: true, applied: 3, failed: 0 })
    expect(first.instances.find(({ id }) => id === 'memories')?.error).toBe('embedder unreachable')

    const retried = await reconciler({ projections }).reconcile(scope, workspaceId)
    expect(retried.instances.find(({ id }) => id === 'graph')).toMatchObject({ reset: false, applied: 0 })

    projections.fail('memories', {})
    const healed = await reconciler({ projections }).reconcile(scope, workspaceId)
    expect(healed).toMatchObject({ failed: 0 })
    expect(healed.instances.find(({ id }) => id === 'graph')?.reset).toBe(false)
    expect(ids('memories')).toHaveLength(3)
    expect((await reconciler({ projections }).reconcile(scope, workspaceId)).instances.every((instance) => !instance.reset)).toBe(true)
  })

  it('records a failed reset as that instance failing, with backoff, and resets it again on the next pass', async () => {
    await test.as(({ tx }) => enqueue(tx, workspaceId, 'rebuild'))
    projections.fail('graph', { reset: 'graph went away mid-pass' })
    const result = await reconciler({ projections }).reconcile(scope, workspaceId)
    expect(result.instances.find(({ id }) => id === 'graph')?.error).toBe('graph went away mid-pass')
    expect(result.instances.find(({ id }) => id === 'memories')).toMatchObject({ reset: true, applied: 3, failed: 0 })
    expect((await status()).get('graph')).toMatchObject({ last_error: 'graph went away mid-pass' })

    projections.fail('graph', {})
    const healed = await reconciler({ projections }).reconcile(scope, workspaceId)
    expect(healed).toMatchObject({ failed: 0 })
    expect(healed.instances.find(({ id }) => id === 'graph')?.reset).toBe(true)
    expect(healed.instances.find(({ id }) => id === 'memories')?.reset).toBe(false)
  })

  it('replays a pass that crashed after applying and before its manifest was written, without duplicates', async () => {
    await test.as(({ tx }) => retireDocument(tx, { workspaceId, path: LEDGER }))
    const crashing = reconciler({
      projections,
      hooks: {
        afterApply: (instance) => {
          if (instance === 'graph') throw new Error('killed')
        }
      }
    })
    await expect(crashing.reconcile(scope, workspaceId)).rejects.toThrow('killed')
    expect(ids('graph')).toEqual(['team.commerce', 'team.discovery'])
    const replayed = await reconciler({ projections }).reconcile(scope, workspaceId)
    expect(replayed).toMatchObject({ failed: 0 })
    expect(ids('graph')).toEqual(['team.commerce', 'team.discovery'])
    expect(ids('memories')).toEqual(['team.commerce', 'team.discovery'])
  })

  it('records each pass in the sync history, with what woke it and each store’s changes by id, and a re-check lifts the backoff', async () => {
    await write(LEDGER)
    projections.fail('memories', { apply: 'qdrant: 503 for api_key=sekret' })
    await reconciler({ projections }).reconcile(scope, workspaceId)
    const [latest] = await test.as(({ tx }) => listSyncRuns(tx, workspaceId, 1))
    expect(latest).toMatchObject({ ok: false, triggers: ['documents'] })
    expect(latest?.instances.find((instance) => instance.id === 'graph')).toMatchObject({ applied: 1, upserts: 1, changes: [{ operation: 'upsert', kind: 'entity', id: 'datasource.ledger-db' }] })
    // An error is kept with any secret it quotes redacted.
    expect(latest?.instances.find((instance) => instance.id === 'memories')?.error).toBe('qdrant: 503 for api_key=[redacted]')

    const standing = await test.as(({ tx }) => syncStanding(tx, workspaceId, projections.instances))
    expect(standing.instances.find((instance) => instance.instanceId === 'memories')).toMatchObject({ failures: 1, optional: false })
    expect(standing.outbox.pending).toBeGreaterThan(0)
    await test.as(({ tx }) => requestRecheck(tx, workspaceId))
    expect((await status()).get('memories')?.retry_at).toBeNull()
    projections.fail('memories', {})
    await reconciler({ projections }).reconcile(scope, workspaceId)
    const [healed] = await test.as(({ tx }) => listSyncRuns(tx, workspaceId, 1))
    expect(healed).toMatchObject({ ok: true, triggers: ['documents', 'recheck'] })
  })

  it('records a workspace that cannot be projected as a failed pass of every instance', async () => {
    const empty = await test.as(async (ctx) => (await insertWorkspace(ctx.tx, { name: 'Empty', slug: 'empty', createdBy: 'user:owner' })).id)
    await expect(reconciler({ projections }).reconcile(scope, empty)).rejects.toThrow(/cannot be projected/)
    const [run] = await test.as(({ tx }) => listSyncRuns(tx, empty, 1))
    expect(run).toMatchObject({ ok: false })
    expect(run?.instances.map((instance) => instance.id)).toEqual(['graph', 'memories'])
  })

  it('purges a deleted workspace from every instance, and backs off a purge that fails', async () => {
    const doomed = await test.as((ctx) => seedWorkspace(ctx, { slug: 'doomed', ontology: fixture.ontology }))
    await test.as((ctx) => putDocument(ctx, { workspaceId: doomed, path: TEAM, raw: raw(TEAM), origin: 'cloud', actor: 'user:owner' }))
    await reconciler({ projections }).reconcile(scope, doomed)
    expect([...projections.held('graph', doomed).keys()]).toEqual(['team.commerce'])
    await test.as(({ tx }) => deleteWorkspace(tx, { workspaceId: doomed, deletedBy: 'user:owner' }))

    projections.fail('graph', { reset: 'neo4j unreachable' })
    expect(await reconciler({ projections }).purge(scope, { workspaceId: doomed, failures: 0 })).toEqual({ error: 'graph: neo4j unreachable' })
    expect(await test.as(({ tx }) => pendingDeletions(tx, new Date()))).toEqual([])
    projections.fail('graph', {})
    expect(await reconciler({ projections }).purge(scope, { workspaceId: doomed, failures: 1 })).toEqual({})
    expect(projections.held('graph', doomed).size).toBe(0)
    expect(projections.held('memories', doomed).size).toBe(0)
  })
})
