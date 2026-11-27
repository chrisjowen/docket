// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { AiCapReached, type AiDeps, type UsageRecord } from '@docket/platform-ai'
import { COGNEE, cogneeSettings, insertWorkspace, putDocument, saveCogneeSettings } from '@docket/platform-canonical-store'
import { createTestOrg, readFixture, type TestOrg } from '@docket/platform-canonical-store/testing'
import { hashContent } from '@chrisjowen/docket/source/hashing'
import { workspaceScope } from '@docket/platform-tenancy'
import { cogneeCognifying, cogneeDataset, openCognee } from '@docket/platform-projections'
import { serveFakeCognee, startFakeCognee, type FakeCognee } from '@docket/platform-projections/testing'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CognifyLeaseHeld, cogneeLeases, cogneeLoop, openCogneeToClear, type CogneeLoop, type CogneeLoopOptions } from './cognee.js'
import { gatewayCall, gatewayDeps } from './cognify-gateway.js'
import { currentLease, releaseStuckLease, takeLease } from './cognify-lease.js'

const TEAM = '.docket/resources/team/commerce.md'
const ORDERS = '.docket/resources/service/orders.md'
const PAYMENTS = '.docket/resources/service/payments.md'
const quiet = { info: () => undefined, error: () => undefined }

/**
 * The cognee pass against Postgres, docket's cognee adapter as 0.8.0 bundles
 * it, and docket's fake cognee behind HTTP: off by default, projecting a
 * workspace's entities into its own dataset once turned on, re-filing what
 * links to a retitled entity, refused at the AI cap, waiting while another
 * cognify holds the lease - and while one runs on in cognee after its pass,
 * still billed to its own workspace, until a platform operator releases one
 * stuck - renewing the lease through a long pass, and clearing what it filed
 * once turned off.
 */
describe.skipIf(!TEST_PG_URL)('the cognee pass', () => {
  let org: TestOrg
  let workspaceId: string
  let fake: FakeCognee
  let server: Awaited<ReturnType<typeof serveFakeCognee>>
  let capped = false
  let clock = new Date('2026-11-13T10:00:00Z')
  const ai = { caps: { assertWithinCap: async (orgId: string) => {
    if (capped) throw new AiCapReached(orgId, 20, 20)
  } } } as unknown as AiDeps
  const access = () => ({ url: server.url, apiKey: 'test-key' })
  const loop = (options: Partial<CogneeLoopOptions> = {}): CogneeLoop =>
    cogneeLoop({ router: org.router, keyring: org.keyring, access: access(), ai, log: quiet, now: () => clock, ...options })
  const later = (minutes: number) => (clock = new Date(clock.getTime() + minutes * 60_000))
  const fixture = async (path: string) => (await readFixture()).documents.find((document) => document.path === path)?.raw ?? ''
  const writeIn = (ws: string, path: string, raw: string) => org.withOrg((ctx) => putDocument(ctx, { workspaceId: ws, path, raw, origin: 'cloud', actor: `user:${org.userId}` }))
  const write = (path: string, raw: string) => writeIn(workspaceId, path, raw)
  const turnOn = (ws: string) => org.withOrg(({ tx }) => saveCogneeSettings(tx, ws, { enabled: true, floor: 0.58, monthlyLimitUsd: 2, capUsd: 20, by: `user:${org.userId}` }))
  const dataset = (ws = workspaceId) => fake.datasets.get(cogneeDataset(org.orgId, ws))
  const items = () => [...(dataset()?.items.values() ?? [])].map((item) => ({ id: item.externalMetadata?.docket_id, revision: item.externalMetadata?.docket_revision, text: item.text, cognified: item.cognified }))
  const status = (ws = workspaceId) =>
    org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ failures: number; last_error: string | null; synced_at: Date | null }>(
        'SELECT failures, last_error, synced_at FROM projection_status WHERE workspace_id = $1 AND instance_id = $2',
        [ws, COGNEE],
      )
      return rows[0] ?? null
    })
  const lease = () => org.router.withPlatform((tx) => currentLease(tx))
  /** Opens docket's cognee adapter, whose cognify cognee runs on after each batch, as one the adapter stopped waiting for. */
  const runsOn: CogneeLoopOptions['open'] = async (options) => {
    const adapter = await openCognee(options)
    const port = adapter.projection
    if (!port) throw new Error('cognee does not project')
    return {
      ...adapter,
      projection: {
        ...port,
        apply: async (batch, signal) => {
          const receipt = await port.apply(batch, signal)
          fake.cognifying.add(cogneeDataset(options.orgId, options.workspaceId))
          return receipt
        },
      },
    }
  }
  const newWorkspace = async (name: string) => {
    const { ontology } = await readFixture()
    return org.withOrg(async (ctx) => {
      const workspace = await insertWorkspace(ctx.tx, { name, slug: `p-${randomUUID().slice(0, 8)}`, createdBy: org.userId })
      await ctx.tx.query(
        `INSERT INTO ontology_versions (workspace_id, number, status, yaml, yaml_hash, source, author, published_at, published_by)
         VALUES ($1, 1, 'published', $2, $3, 'import', $4, now(), $4)`,
        [workspace.id, ontology, hashContent(ontology), org.userId],
      )
      return workspace.id
    })
  }

  beforeAll(async () => {
    org = await createTestOrg()
    workspaceId = await newWorkspace('Platform')
    fake = startFakeCognee({ apiKey: 'test-key' })
    server = await serveFakeCognee(fake)
    await write(TEAM, await fixture(TEAM))
    await write(ORDERS, await fixture(ORDERS))
  })
  afterAll(async () => {
    await server?.close()
    await org?.drop()
  })

  it('is off by default: nothing is filed, cognee is never called', async () => {
    expect(await org.withOrg(({ tx }) => cogneeSettings(tx, workspaceId))).toMatchObject({ enabled: false, floor: 0.58 })
    expect(await loop().tick()).toEqual([])
    expect(fake.requests).toEqual([])
    expect(await status()).toBeNull()
  })

  it("once turned on, files each entity into the workspace's own dataset, cognified, and records the pass", async () => {
    await turnOn(workspaceId)
    const [pass] = await loop().tick()
    expect(pass).toMatchObject({ outcome: 'ok', report: { applied: 2, failed: 0, reset: true } })
    expect(items().map((item) => [item.id, item.cognified]).sort()).toEqual([
      ['service.orders', true],
      ['team.commerce', true],
    ])
    expect(items().find((item) => item.id === 'service.orders')?.text).toContain('owned by: Commerce')
    expect(await status()).toMatchObject({ failures: 0, last_error: null })
    expect((await status())?.synced_at).not.toBeNull()
    const { projectedThrough } = await org.withOrg(({ tx }) => cogneeSettings(tx, workspaceId))
    expect(projectedThrough).toBeGreaterThan(0)
    expect(await lease()).toBeNull()
    // Nothing new: no pass.
    expect(await loop().tick()).toEqual([])
  })

  it("re-files an entity whose link names a retitled entity, under the same revision, though only the target's document changed", async () => {
    const before = items().find((item) => item.id === 'service.orders')
    await write(TEAM, (await fixture(TEAM)).replace('title: Commerce', 'title: Checkout'))
    later(1)
    const [pass] = await loop().tick()
    expect(pass).toMatchObject({ outcome: 'ok' })
    const after = items().find((item) => item.id === 'service.orders')
    expect(after?.revision).toBe(before?.revision)
    expect(after?.text).toContain('owned by: Checkout')
    expect(after?.text).not.toContain('owned by: Commerce')
    expect(items().filter((item) => item.id === 'service.orders')).toHaveLength(1)
  })

  it("waits, without failing, while another workspace's cognify holds the lease", async () => {
    await write(PAYMENTS, await fixture(PAYMENTS))
    later(1)
    await org.router.withPlatform((tx) => takeLease(tx, { orgId: org.orgId, workspaceId: 'wsother', monthlyLimitUsd: 2, now: clock, forMs: 60_000 }))
    expect(await loop().tick()).toEqual([expect.objectContaining({ outcome: 'skipped' })])
    expect(items().some((item) => item.id === 'service.payments')).toBe(false)
    expect(await status()).toMatchObject({ failures: 0 })
    later(2)
  })

  it("is refused at the org's AI cap, retried with backoff and shown with why, never silently; it catches up once the cap allows", async () => {
    capped = true
    const calls = fake.requests.length
    const [refused] = await loop().tick()
    expect(refused).toMatchObject({ outcome: 'failed' })
    expect(fake.requests.length).toBe(calls)
    expect(await status()).toMatchObject({ failures: 1, last_error: expect.stringContaining('AI budget for this month is spent') })
    const runs = await org.withOrg(async ({ tx }) => (await tx.query<{ ok: boolean; instances: { id: string; error?: string }[] }>('SELECT ok, instances FROM sync_runs WHERE workspace_id = $1 ORDER BY id DESC LIMIT 1', [workspaceId])).rows)
    expect(runs[0]).toMatchObject({ ok: false, instances: [{ id: 'cognee', error: expect.stringContaining('AI budget') }] })
    // Backing off: not retried at once.
    expect(await loop().tick()).toEqual([])
    capped = false
    later(5)
    const [retried] = await loop().tick()
    expect(retried).toMatchObject({ outcome: 'ok' })
    expect(items().some((item) => item.id === 'service.payments')).toBe(true)
    expect(await status()).toMatchObject({ failures: 0, last_error: null })
  })

  it("keeps the lease for a cognify that runs on in cognee after its pass, billed to its own workspace, and starts no other while it runs; once it is stuck, every workspace waiting says cognee is halted", async () => {
    const other = await newWorkspace('Other')
    await writeIn(other, ORDERS, await fixture(ORDERS))
    await write(TEAM, (await fixture(TEAM)).replace('title: Commerce', 'title: Storefront'))
    later(1)
    expect(await loop({ open: runsOn }).tick()).toEqual([expect.objectContaining({ workspaceId, outcome: 'ok' })])
    expect(await lease()).toMatchObject({ orgId: org.orgId, workspaceId })

    // cognee's model calls go on being billed to this workspace, and only while it is cognifying.
    const recorded: UsageRecord[] = []
    const upstream = (async () =>
      new Response(JSON.stringify({ id: 'gen-1', model: 'm', choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.001 } }))) as unknown as typeof fetch
    const gateway = {
      ...gatewayDeps(org.router, null, 'gateway-key', { platformKey: 'platform-key' }),
      ai: { assertWithinCap: async () => undefined, spent: async () => 0, apiKey: 'platform-key', model: async () => 'm', record: async (usage: UsageRecord) => void recorded.push(usage) },
      fetch: upstream,
    }
    const call = { method: 'POST', path: '/v1/chat/completions', authorization: 'Bearer gateway-key', body: JSON.stringify({ messages: [] }) }
    expect((await gatewayCall(gateway, call)).status).toBe(200)
    expect(recorded).toEqual([expect.objectContaining({ orgId: org.orgId, workspaceId, actor: `cognee:${workspaceId}` })])

    // Another workspace turned on waits, past the old lease's length, without failing.
    await turnOn(other)
    later(90)
    expect(await loop().tick()).toEqual([expect.objectContaining({ workspaceId: other, outcome: 'skipped' })])
    expect(dataset(other)).toBeUndefined()
    expect(await lease()).toMatchObject({ workspaceId })

    // Hours on, the workspace is shown stuck; still no other cognify starts, and the one waiting says cognee is halted.
    later(6 * 60)
    expect(await loop().tick()).toEqual([expect.objectContaining({ workspaceId: other, outcome: 'failed' })])
    expect(await status()).toMatchObject({ last_error: expect.stringContaining('still cognifying this workspace 6 h after its pass ended') })
    expect(await status(other)).toMatchObject({ last_error: expect.stringContaining('cognee is halted for every workspace') })
    expect(await lease()).toMatchObject({ workspaceId, stuckAt: expect.any(Date) })
    expect(dataset(other)).toBeUndefined()
  })

  it("lets a platform operator release a stuck lease only while cognee cannot say whether its run is over, audited; the stuck workspace then fails without the lease until cognee ends its run, and the others cognify", async () => {
    const auditedIn = async (tx: { query: <R>(sql: string) => Promise<{ rows: R[] }> }) =>
      (await tx.query<{ actor: string; workspace_id: string }>("SELECT actor, workspace_id FROM audit_event WHERE action = 'cognee.lease.release'")).rows
    const release = () => releaseStuckLease(org.router, { by: 'alice', now: clock, cognifying: (orgId, ws) => cogneeCognifying(access(), orgId, ws) })
    expect((await lease())?.stuckAt).toBeInstanceOf(Date)

    // While cognee says the run goes on, or that it is over, the operator is refused: the run is ended in cognee first.
    expect(await release()).toEqual({ refused: expect.stringContaining('still cognifying: end that run in cognee first') })
    fake.cognifying.clear()
    expect(await release()).toEqual({ refused: expect.stringContaining('the next cognee pass gives the lease up on its own') })
    fake.cognifying.add(cogneeDataset(org.orgId, workspaceId))
    expect(await lease()).toMatchObject({ workspaceId })

    // cognee cannot be reached: the release goes ahead.
    fake.down = true
    expect(await release()).toEqual({ released: expect.objectContaining({ orgId: org.orgId, workspaceId, stuckAt: expect.any(Date) }) })
    fake.down = false
    expect(await lease()).toBeNull()
    expect(await status()).toMatchObject({ last_error: expect.stringContaining('A platform operator released') })
    expect((await org.withOrg(({ tx }) => cogneeSettings(tx, workspaceId))).projectedThrough).toBeNull()
    expect(await org.router.withPlatform((tx) => auditedIn(tx))).toEqual([{ actor: 'system:operator:alice', workspace_id: workspaceId }])
    expect(await org.withOrg(({ tx }) => auditedIn(tx))).toEqual([{ actor: 'system:operator:alice', workspace_id: workspaceId }])
    // Nothing is held now: a second release refuses.
    expect(await release()).toEqual({ refused: 'no cognify lease is held' })

    // cognee still reports the stuck run: that workspace's pass fails without holding the lease, and the other cognifies.
    later(1)
    const passes = await loop().tick()
    expect(passes).toHaveLength(2)
    expect(passes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workspaceId, outcome: 'failed', report: expect.objectContaining({ error: expect.stringContaining('from a run no pass holds') }) }),
        expect.objectContaining({ outcome: 'ok' }),
      ]),
    )
    expect(await lease()).toBeNull()

    // Once cognee's run is ended, the workspace cognifies again.
    fake.cognifying.clear()
    later(5)
    expect(await loop().tick()).toEqual([expect.objectContaining({ workspaceId, outcome: 'ok' })])
    expect(await lease()).toBeNull()
  })

  it('renews the lease before each batch, so a pass longer than the lease completes and no other cognify takes over meanwhile', async () => {
    const big = await newWorkspace('Big')
    const services = Array.from({ length: 150 }, (_, at) => String(at).padStart(3, '0'))
    for (const n of services) {
      await writeIn(big, `.docket/resources/service/s${n}.md`, `---\nid: service.s${n}\ntype: service\ntitle: Service ${n}\nattributes:\n  tier: critical\nevidence:\n  - source: human\n    observedBy: alice\n---\nService ${n}.\n`)
    }
    await turnOn(big)
    later(10)
    const leases = cogneeLeases({ router: org.router, access: access(), now: () => clock, leaseMs: 60_000 })
    const rivals: (object | null)[] = []
    let batches = 0
    const open: CogneeLoopOptions['open'] = async (options) => {
      const adapter = await openCognee(options)
      const port = adapter.projection
      if (!port) throw new Error('cognee does not project')
      return {
        ...adapter,
        projection: {
          ...port,
          apply: async (batch, signal) => {
            batches += 1
            later(0.9)
            rivals.push(await leases.take({ orgId: org.orgId, workspaceId: 'wsrival', monthlyLimitUsd: 2 }))
            return port.apply(batch, signal)
          },
        },
      }
    }
    expect(await loop({ leases, open }).tick()).toEqual([expect.objectContaining({ workspaceId: big, outcome: 'ok', report: expect.objectContaining({ applied: 150, failed: 0 }) })])
    expect(batches).toBeGreaterThan(1)
    expect(rivals).toEqual(Array.from({ length: batches }, () => null))
    expect(await lease()).toBeNull()
  })

  it("purges a deleted workspace's cognee only once its cognify is over, so nothing it was filing is left behind", async () => {
    await write(TEAM, (await fixture(TEAM)).replace('title: Commerce', 'title: Basket'))
    later(1)
    expect(await loop({ open: runsOn }).tick()).toEqual([expect.objectContaining({ workspaceId, outcome: 'ok' })])
    const purging = () =>
      openCogneeToClear(cogneeLeases({ router: org.router, access: access(), now: () => clock }), { router: org.router, orgId: org.orgId, workspaceId, access: access() })
    await expect(purging()).rejects.toBeInstanceOf(CognifyLeaseHeld)
    expect(items().length).toBeGreaterThan(0)

    fake.cognifying.clear()
    later(1)
    const adapter = await purging()
    expect(await lease()).toMatchObject({ workspaceId, monthlyLimitUsd: 0 })
    await adapter.projection?.reset(workspaceScope(workspaceId))
    await adapter.close()
    expect(items()).toEqual([])
    expect(await lease()).toBeNull()
  })

  it('clears what it filed once turned off, and forgets its manifest and standing; a failed clear backs off', async () => {
    await org.withOrg(({ tx }) => saveCogneeSettings(tx, workspaceId, { enabled: false, floor: 0.58, monthlyLimitUsd: 2, capUsd: 20, by: `user:${org.userId}` }))
    fake.down = true
    expect(await loop().tick()).toEqual([expect.objectContaining({ outcome: 'failed' })])
    expect(await status()).toMatchObject({ failures: 1, last_error: expect.stringContaining('clearing cognee after it was turned off') })
    fake.down = false
    expect(await loop().tick()).toEqual([])
    later(1)
    expect(await loop().tick()).toEqual([expect.objectContaining({ outcome: 'cleared' })])
    expect(items()).toEqual([])
    expect(await status()).toBeNull()
    const manifests = await org.withOrg(async ({ tx }) => (await tx.query('SELECT 1 FROM adapter_manifests WHERE workspace_id = $1 AND instance_id = $2', [workspaceId, COGNEE])).rowCount)
    expect(manifests).toBe(0)
    expect(await loop().tick()).toEqual([])
  })
})
