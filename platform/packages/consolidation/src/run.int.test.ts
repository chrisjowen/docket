// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatMessage } from '@docket/platform-ai'
import { countDocuments, putDocument, readDocument, retireDocument, summaryPath, workspaceById, workspaceGraph } from '@docket/platform-canonical-store'
import { createTestOrg, readFixture, type Fixture, type TestOrg } from '@docket/platform-canonical-store/testing'
import {
  EnrichmentLimitReached,
  finishRun as finishEnrichment,
  requestRun,
  saveSettings,
  startRun as startEnrichment,
} from '@docket/platform-enrichment'
import { createWorkspace } from '@docket/platform-ontology-service'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runConsolidation, type RunOutcome, type Summarizer } from './run.js'
import { CONSOLIDATION_LIMITS, checkpoints, dueWorkspaces, recentRuns, startRun } from './runs.js'

const ORDERS = '.docket/resources/service/orders.md'
const PAYMENTS = '.docket/resources/service/payments.md'
const GATEWAY = '.docket/resources/service/payments-gateway.md'
const NARRATIVE = 'Orders takes and tracks customer orders for the Commerce team, and leans on Payments to charge every card it sees.'

describe.skipIf(!TEST_PG_URL)('runConsolidation', () => {
  let org: TestOrg
  let fixture: Fixture
  let workspaceId: string
  let clock = new Date('2026-11-05T09:00:00.000Z')
  const prompts: ChatMessage[][] = []

  const scripted = (answer: (prompt: string) => string = () => NARRATIVE, beforeCall = async () => {}): Summarizer => ({
    beforeCall,
    model: {
      async chat(messages) {
        prompts.push(messages)
        return { text: answer(messages.map((message) => message.content).join('\n')), model: 'test/cheap-model' }
      },
    },
  })

  /** A bag of words, as a stand-in for the in-cluster embedder: the same words embed the same. */
  const embed = async (texts: string[]) =>
    texts.map((text) => {
      const vector = new Array<number>(256).fill(0)
      for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        const slot = [...word].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 256, 7)
        vector[slot] = (vector[slot] ?? 0) + 1
      }
      return vector
    })

  /** An enrichment run finishes, and a consolidation run follows it. */
  const run = async (summarizer: Summarizer | null, embedWith: typeof embed = embed): Promise<RunOutcome> => {
    clock = new Date(clock.getTime() + 60_000)
    const started = await org.withOrg(async (ctx) => {
      await requestRun(ctx.tx, workspaceId, `user:${org.userId}`, clock)
      const enrichment = await startEnrichment(ctx.tx, workspaceId, clock)
      if (!enrichment) throw new Error('no enrichment run started')
      await finishEnrichment(ctx.tx, enrichment.id, { status: 'ok', at: clock })
      expect(await dueWorkspaces(ctx.tx)).toEqual([workspaceId])
      return startRun(ctx.tx, workspaceId, clock)
    })
    if (!started) throw new Error('no consolidation run started')
    return runConsolidation({ withOrg: (fn) => org.withOrg(fn), summarizer, embed: embedWith, now: () => clock }, { id: started.id, orgId: org.orgId, workspaceId })
  }
  const graph = () =>
    org.withOrg(async (ctx) => {
      const workspace = await workspaceById(ctx.tx, workspaceId)
      if (!workspace) throw new Error('no workspace')
      return workspaceGraph(ctx, workspace, { root: '.' })
    })
  const seen = () => org.withOrg((ctx) => checkpoints(ctx.tx, workspaceId))
  const isFor = (id: string) => (prompt: ChatMessage[]) => prompt.some((message) => message.content.startsWith(`Entity: ${id} `))
  const promptFor = (id: string) => prompts.findLast(isFor(id))
  const repoWrite = (path: string, raw: string) =>
    org.withOrg((ctx) => putDocument(ctx, { workspaceId, path, raw, origin: 'repo', originRef: 'conn1:.docket', actor: 'system:repo-sync' }))

  beforeAll(async () => {
    org = await createTestOrg()
    fixture = await readFixture()
    workspaceId = await org.withOrg(async (ctx) => {
      const { workspace } = await createWorkspace(ctx, {
        name: 'Platform',
        slug: 'platform',
        start: { importYaml: fixture.ontology },
        publisher: { actor: `user:${org.userId}`, login: org.login },
      })
      for (const document of fixture.documents) {
        await putDocument(ctx, { workspaceId: workspace.id, ...document, origin: 'repo', originRef: 'conn1:.docket', actor: 'system:repo-sync' })
      }
      await saveSettings(ctx.tx, workspace.id, { enabled: true, schedule: 'nightly', monthlyLimitUsd: 2, capUsd: 20, by: `user:${org.userId}`, now: clock })
      return workspace.id
    })
  })
  afterAll(() => org?.drop())

  it('runs nothing until an enrichment run has finished, and summarizes nothing while AI is off', async () => {
    expect(await org.withOrg((ctx) => dueWorkspaces(ctx.tx))).toEqual([])
    expect(await org.withOrg((ctx) => startRun(ctx.tx, workspaceId, clock))).toBeNull()
    const outcome = await run(null)
    expect(outcome).toEqual(expect.objectContaining({ status: 'ok', costUsd: 0 }))
    expect(outcome.summary).toEqual(expect.objectContaining({ summarized: 0, aiCalls: 0, aiStopped: 'off' }))
    expect(await org.withOrg((ctx) => dueWorkspaces(ctx.tx))).toEqual([])
  })

  it('writes a narrative summary onto each linked node from its neighbourhood, leaving every document people wrote as it was', async () => {
    const outcome = await run(scripted())
    expect(outcome.status).toBe('ok')
    expect(outcome.summary?.failed).toBe(0)
    expect(outcome.summary?.summarized).toBe(prompts.length)
    expect(outcome.summary?.summarized).toBeGreaterThan(5)

    // The model sees the relationships and the evidence, not just the node.
    const prompt = promptFor('service.orders')?.map((message) => message.content).join('\n') ?? ''
    expect(prompt).toContain('depends_on → service.payments (service) "Payments"')
    expect(prompt).toContain('owned_by → team.commerce (team) "Commerce"')
    expect(prompt).toContain('src/db.ts')

    const orders = (await graph()).entities.find((entity) => entity.id === 'service.orders')
    expect(orders?.frontmatter).toEqual(
      expect.objectContaining({
        id: 'service.orders',
        summary: NARRATIVE,
        summary_model: 'test/cheap-model',
        summary_generated_at: clock.toISOString(),
        summary_run: (await org.withOrg((ctx) => recentRuns(ctx.tx, workspaceId, 1)))[0]?.id,
        summary_checkpoint: (await seen()).get('service.orders'),
      }),
    )
    expect(orders?.paths).toEqual([ORDERS, summaryPath('service.orders')])

    // One link is no neighbourhood to summarize.
    expect(outcome.summary?.skipped.isolated).toBeGreaterThan(0)
    expect(promptFor('datasource.ledger-db')).toBeUndefined()
    expect((await graph()).entities.find((entity) => entity.id === 'datasource.ledger-db')?.paths).not.toContain(summaryPath('datasource.ledger-db'))

    const own = await org.withOrg((ctx) => readDocument(ctx, workspaceId, ORDERS))
    expect(own?.raw).toBe(fixture.documents.find((document) => document.path === ORDERS)?.raw)
    expect(own?.revision).toBe(1)
    expect((await seen()).has('service.orders')).toBe(true)
  })

  it('skips every neighbourhood that has not changed, and supersedes the summary of one that has', async () => {
    const before = prompts.length
    const unchanged = await run(scripted())
    expect(unchanged.summary).toEqual(expect.objectContaining({ summarized: 0, aiCalls: 0, failed: 0 }))
    expect(unchanged.summary?.skipped.unchanged).toBeGreaterThan(5)
    expect(prompts.length).toBe(before)

    const raw = fixture.documents.find((document) => document.path === ORDERS)?.raw ?? ''
    const payments = promptFor('service.payments')
    await repoWrite(ORDERS, raw.replace('Takes and tracks customer orders.', 'Takes and tracks customer orders, and refunds them.'))
    const changed = await run(scripted(() => `${NARRATIVE} It now handles refunds too.`))
    const asked = prompts.slice(before)
    expect(changed.summary).toEqual(expect.objectContaining({ summarized: asked.length, superseded: asked.length, aiCalls: asked.length }))
    expect(promptFor('service.orders')?.at(-1)?.content).toContain('refunds them')
    expect(asked.some(isFor('service.search'))).toBe(false)

    // Payments depends on nothing it is shown that changed, but a neighbour's notes did: its summary is written again.
    expect(asked.some(isFor('service.payments'))).toBe(true)
    expect(promptFor('service.payments')).toEqual(payments)

    const orders = (await graph()).entities.find((entity) => entity.id === 'service.orders')
    expect(orders?.frontmatter.summary).toBe(`${NARRATIVE} It now handles refunds too.`)
    const rows = await org.withOrg(async (ctx) => {
      const { rows } = await ctx.tx.query<{ id: string; revision: number; superseded_by: string | null }>(
        "SELECT id, revision, superseded_by FROM consolidation_summaries WHERE workspace_id = $1 AND resource_id = 'service.orders' ORDER BY revision",
        [workspaceId],
      )
      return rows
    })
    expect(rows.map((row) => row.revision)).toEqual([1, 2])
    expect(rows[0]?.superseded_by).toBe(rows[1]?.id)
    expect(rows[1]?.superseded_by).toBeNull()
  })

  it('keeps the checkpoint of a summary that failed, so the next run tries it again, and stops at the monthly limit', async () => {
    const raw = fixture.documents.find((document) => document.path === PAYMENTS)?.raw ?? ''
    await repoWrite(PAYMENTS, raw.replace('Charges cards', 'Charges cards and wallets'))
    const checkpoint = (await seen()).get('service.payments')

    const failed = await run(scripted(() => {
      throw new Error('the model timed out')
    }))
    const affected = failed.summary?.failed ?? 0
    expect(failed.status).toBe('ok')
    expect(failed.summary).toEqual(expect.objectContaining({ summarized: 0, aiCalls: affected }))
    expect(affected).toBeGreaterThan(1)
    expect(failed.error).toMatch(/: the model timed out/)
    expect((await seen()).get('service.payments')).toBe(checkpoint)

    const limited = await run(
      scripted(undefined, async () => {
        throw new EnrichmentLimitReached(2, 2)
      }),
    )
    expect(limited.status).toBe('limited')
    expect(limited.summary).toEqual(expect.objectContaining({ summarized: 0, aiCalls: 0, aiStopped: 'limit' }))
    expect(limited.summary?.skipped.overLimit).toBe(affected)

    const retried = await run(scripted())
    expect(retried.summary).toEqual(expect.objectContaining({ summarized: affected, failed: 0 }))
    expect((await seen()).get('service.payments')).not.toBe(checkpoint)
    const runs = await org.withOrg((ctx) => recentRuns(ctx.tx, workspaceId, 3))
    expect(runs.map((r) => r.status)).toEqual(['ok', 'limited', 'ok'])
  })

  it('writes a summary again when its document was retired, though the neighbourhood is unchanged', async () => {
    await org.withOrg((ctx) => retireDocument(ctx.tx, { workspaceId, path: summaryPath('service.search') }))
    expect((await graph()).entities.find((entity) => entity.id === 'service.search')?.paths).not.toContain(summaryPath('service.search'))

    const outcome = await run(scripted())
    expect(outcome.summary).toEqual(expect.objectContaining({ summarized: 1, aiCalls: 1, failed: 0 }))
    expect(promptFor('service.search')).toBeDefined()
    const search = (await graph()).entities.find((entity) => entity.id === 'service.search')
    expect(search?.paths).toContain(summaryPath('service.search'))
    expect(search?.frontmatter.summary).toBe(NARRATIVE)
  })

  it('treats a neighbourhood as unchanged the night after a summary document joins notes that began with a blank line', async () => {
    await repoWrite(
      '.docket/resources/service/indexer.md',
      '---\nid: service.indexer\ntype: service\ntitle: Indexer\nlinks:\n  - rel: depends_on\n    target: service.search\n  - rel: owned_by\n    target: team.discovery\n---\n\n# Indexer\n\nFeeds documents to the search index.\n',
    )
    const first = await run(scripted())
    expect(first.summary?.failed).toBe(0)
    expect(promptFor('service.indexer')).toBeDefined()
    expect((await entity('service.indexer'))?.paths).toContain(summaryPath('service.indexer'))

    const before = prompts.length
    const next = await run(scripted())
    expect(next.summary).toEqual(expect.objectContaining({ summarized: 0, superseded: 0, aiCalls: 0, failed: 0 }))
    expect(prompts.length).toBe(before)
  })

  it('asks again about a too-short answer only once its neighbourhood changes', async () => {
    const audit = (body: string) =>
      `---\nid: service.audit\ntype: service\ntitle: Audit\nlinks:\n  - rel: depends_on\n    target: service.search\n  - rel: owned_by\n    target: team.discovery\n---\n${body}\n`
    const answer = (prompt: string) => (prompt.includes('Entity: service.audit ') ? 'Audit.' : NARRATIVE)
    await repoWrite('.docket/resources/service/audit.md', audit('Keeps the audit trail.'))
    const before = prompts.length
    const first = await run(scripted(answer))
    expect(first.summary?.skipped.trivial).toBe(1)
    expect(prompts.length - before).toBe(first.summary?.aiCalls)
    expect(promptFor('service.audit')).toBeDefined()

    const asked = prompts.length
    const stable = await run(scripted(answer))
    expect(stable.summary).toEqual(expect.objectContaining({ aiCalls: 0, summarized: 0 }))
    expect(prompts.length).toBe(asked)

    await repoWrite('.docket/resources/service/audit.md', audit('Keeps the audit trail, and signs every entry.'))
    const changed = await run(scripted(answer))
    expect(changed.summary?.skipped.trivial).toBe(1)
    expect(promptFor('service.audit')?.at(-1)?.content).toContain('signs every entry')
  })

  const summaryRows = (ids: string[]) =>
    org.withOrg(async (ctx) => {
      const { rows } = await ctx.tx.query<{
        id: string
        resource_id: string
        superseded_by: string | null
        superseded_at: Date | null
        superseded_in: string | null
        superseded_reason: string | null
      }>(
        `SELECT id, resource_id, superseded_by, superseded_at, superseded_in, superseded_reason FROM consolidation_summaries
          WHERE workspace_id = $1 AND resource_id = ANY($2::text[]) ORDER BY generated_at DESC`,
        [workspaceId, ids],
      )
      return rows
    })
  const latestRun = async () => (await org.withOrg((ctx) => recentRuns(ctx.tx, workspaceId, 1)))[0]?.id
  const entity = async (id: string) => (await graph()).entities.find((e) => e.id === id)

  it('retires a near-duplicate in favour of the resource it duplicates once that one has a live summary, never on a title alone', async () => {
    const gateway = (body: string) =>
      `---\nid: service.payments-gateway\ntype: service\ntitle: Payments\nattributes:\n  tier: critical\nlinks:\n  - rel: depends_on\n    target: datasource.ledger-db\n  - rel: owned_by\n    target: team.commerce\n---\n${body}\n`
    const payments = async (body: string) => {
      const raw = (await org.withOrg((ctx) => readDocument(ctx, workspaceId, PAYMENTS)))?.raw ?? ''
      await repoWrite(PAYMENTS, raw.replace(/\n---\n[\s\S]*$/, `\n---\n${body}\n`))
    }

    // The same title and type, but other notes: not the same thing.
    await repoWrite(GATEWAY, gateway('Takes card payments.'))
    expect((await run(scripted())).summary?.skipped.duplicate).toBe(0)
    expect((await entity('service.payments-gateway'))?.paths).toContain(summaryPath('service.payments-gateway'))

    // Now the same notes, but Payments' own summary comes back too short: its old one is retired, and the gateway is summarized as itself meanwhile.
    const body = `${(await entity('service.payments'))?.content.trim()} It settles daily.`
    await payments(body)
    await repoWrite(GATEWAY, gateway(body))
    let before = prompts.length
    const short = await run(scripted((prompt) => (prompt.includes('Entity: service.payments ') ? 'Short.' : NARRATIVE)))
    expect(short.summary).toEqual(expect.objectContaining({ retired: 1, failed: 0 }))
    expect(short.summary?.skipped).toEqual(expect.objectContaining({ trivial: 1, duplicate: 0 }))
    expect(prompts.slice(before).some(isFor('service.payments-gateway'))).toBe(true)
    expect((await entity('service.payments'))?.frontmatter.summary).toBeUndefined()
    expect((await entity('service.payments'))?.paths).not.toContain(summaryPath('service.payments'))
    const [trivial] = await summaryRows(['service.payments'])
    expect(trivial).toEqual(expect.objectContaining({ superseded_by: null, superseded_in: await latestRun(), superseded_reason: 'trivial' }))
    expect(trivial?.superseded_at).not.toBeNull()

    // Once Payments has a live summary again, the gateway's is retired in favour of it, and nothing more is asked about the gateway.
    await payments(`${body} Really.`)
    await repoWrite(GATEWAY, gateway(`${body} Really.`))
    before = prompts.length
    const merged = await run(scripted())
    expect(merged.summary).toEqual(expect.objectContaining({ retired: 1, failed: 0 }))
    expect(merged.summary?.skipped.duplicate).toBe(1)
    expect(prompts.slice(before).some(isFor('service.payments-gateway'))).toBe(false)
    const duplicate = await entity('service.payments-gateway')
    expect(duplicate?.paths).toEqual([GATEWAY])
    expect(duplicate?.frontmatter.summary).toBeUndefined()
    expect((await entity('service.payments'))?.frontmatter.summary).toBe(NARRATIVE)
    const rows = await summaryRows(['service.payments', 'service.payments-gateway'])
    const kept = rows.find((row) => row.resource_id === 'service.payments' && row.superseded_at === null)
    const [retired] = rows.filter((row) => row.resource_id === 'service.payments-gateway')
    expect(retired).toEqual(expect.objectContaining({ superseded_by: kept?.id, superseded_in: await latestRun(), superseded_reason: 'duplicate' }))

    const again = await run(scripted())
    expect(again.summary).toEqual(expect.objectContaining({ retired: 0, failed: 0 }))
    expect(again.summary?.skipped.duplicate).toBe(1)
    expect(prompts.slice(before).some(isFor('service.payments-gateway'))).toBe(false)
  })

  it('keeps two same-titled resources apart when only a shared owner joins them, and retires the summary of one left with too few links', async () => {
    const frontend = (id: string, links: string) =>
      `---\nid: ${id}\ntype: service\ntitle: Frontend\nlinks:\n  - rel: owned_by\n    target: team.commerce\n${links}---\nServes the web pages.\n`
    await repoWrite('.docket/resources/service/checkout-frontend.md', frontend('service.checkout-frontend', '  - rel: depends_on\n    target: service.payments\n'))
    await repoWrite('.docket/resources/service/admin-frontend.md', frontend('service.admin-frontend', '  - rel: depends_on\n    target: service.search\n'))
    const both = await run(scripted())
    expect(both.summary).toEqual(expect.objectContaining({ failed: 0 }))
    for (const id of ['service.checkout-frontend', 'service.admin-frontend']) {
      expect((await entity(id))?.frontmatter.summary).toBe(NARRATIVE)
    }

    await repoWrite('.docket/resources/service/admin-frontend.md', frontend('service.admin-frontend', ''))
    const isolated = await run(scripted())
    expect(isolated.summary).toEqual(expect.objectContaining({ retired: 1, failed: 0 }))
    const admin = await entity('service.admin-frontend')
    expect(admin?.paths).toEqual(['.docket/resources/service/admin-frontend.md'])
    expect(admin?.frontmatter.summary).toBeUndefined()
    const [retired] = await summaryRows(['service.admin-frontend'])
    expect(retired).toEqual(expect.objectContaining({ superseded_by: null, superseded_in: await latestRun(), superseded_reason: 'isolated' }))

    expect((await run(scripted())).summary?.retired).toBe(0)
  })

  it('follows near-duplicates to the one with most standing, and summarizes a resource as itself while the embedder is down', async () => {
    const service = (id: string, links: string[], body = 'Copies ledger entries between regions.') =>
      `---\nid: service.${id}\ntype: service\ntitle: Ledger sync\nlinks:\n  - rel: owned_by\n    target: team.discovery\n${links
        .map((target) => `  - rel: depends_on\n    target: ${target}\n`)
        .join('')}---\n${body}\n`
    for (const [n, title, body] of [
      ['1', 'Inbound queue', 'Buffers incoming writes.'],
      ['2', 'Outbound archive', 'Keeps exported batches for a month.'],
    ] as const) {
      await repoWrite(`.docket/resources/datasource/sync-${n}.md`, `---\nid: datasource.sync-${n}\ntype: datasource\ntitle: ${title}\n---\n${body}\n`)
    }
    // A and L are four hops apart; each is a near-duplicate only of K, which has more standing than A and less than L.
    await repoWrite('.docket/resources/service/sync-a.md', service('sync-a', ['datasource.sync-1']))
    await repoWrite('.docket/resources/service/sync-k.md', service('sync-k', ['datasource.sync-1', 'datasource.sync-2']))
    await repoWrite('.docket/resources/service/sync-l.md', service('sync-l', ['datasource.sync-2', 'service.search', 'datasource.catalogue-db']))
    let before = prompts.length
    const chained = await run(scripted())
    expect(chained.summary).toEqual(expect.objectContaining({ failed: 0 }))
    const asked = prompts.slice(before)
    expect(asked.some(isFor('service.sync-l'))).toBe(true)
    expect(asked.some(isFor('service.sync-k'))).toBe(false)
    expect(asked.some(isFor('service.sync-a'))).toBe(false)
    expect((await entity('service.sync-a'))?.frontmatter.summary).toBeUndefined()

    // With the embedder down, no one is a near-duplicate this run: A is summarized as itself, as is K.
    await repoWrite('.docket/resources/service/sync-a.md', service('sync-a', ['datasource.sync-1'], 'Copies ledger entries between regions, nightly.'))
    before = prompts.length
    const down = await run(scripted(), async () => {
      throw new Error('the embedder is restarting')
    })
    expect(down.summary).toEqual(expect.objectContaining({ failed: 0 }))
    expect(down.summary?.duplicatesUnchecked).toBeGreaterThan(0)
    expect(prompts.slice(before).some(isFor('service.sync-a'))).toBe(true)
    expect((await entity('service.sync-a'))?.frontmatter.summary).toBe(NARRATIVE)

    // Once it is back, the summaries written meanwhile, A's and K's, are retired in favour of L's, the root of the chain.
    const back = await run(scripted())
    expect(back.summary).toEqual(expect.objectContaining({ aiCalls: 0, failed: 0 }))
    expect(back.summary?.retired).toBeGreaterThanOrEqual(2)
    const [kept] = (await summaryRows(['service.sync-l'])).filter((row) => row.superseded_at === null)
    for (const id of ['service.sync-a', 'service.sync-k']) {
      expect((await entity(id))?.frontmatter.summary).toBeUndefined()
      const [retired] = await summaryRows([id])
      expect(retired).toEqual(expect.objectContaining({ superseded_by: kept?.id, superseded_reason: 'duplicate', superseded_in: await latestRun() }))
    }
  })

  it('near its document limit, still updates summaries a workspace has, and spends nothing on ones it has no room for', async () => {
    const billing =
      '---\nid: service.billing\ntype: service\ntitle: Billing\nlinks:\n  - rel: depends_on\n    target: service.orders\n  - rel: owned_by\n    target: team.commerce\n---\nSends the invoices.\n'
    await repoWrite('.docket/resources/service/billing.md', billing)
    await org.withOrg(async (ctx) => {
      const room = CONSOLIDATION_LIMITS.summaryDocumentsUntil - (await countDocuments(ctx.tx, workspaceId))
      await ctx.tx.query(
        `INSERT INTO documents (workspace_id, origin, path, resource_id, resource_type, raw_ciphertext, raw_nonce, dek_version, hash, created_by)
         SELECT workspace_id, origin, '.docket/filler/' || n || '.md', 'filler.' || n, resource_type, raw_ciphertext, raw_nonce, dek_version, hash, created_by
           FROM documents, generate_series(1, $3::int) n WHERE workspace_id = $1 AND path = $2 AND retired_at IS NULL`,
        [workspaceId, ORDERS, room],
      )
    })
    const before = prompts.length

    const outcome = await run(scripted(() => `${NARRATIVE} Billing sends its invoices.`))
    expect(outcome.status).toBe('limited')
    expect(outcome.summary).toEqual(expect.objectContaining({ documentsFull: 1, failed: 0 }))
    expect(outcome.summary?.aiStopped).toBeUndefined()
    expect(outcome.summary?.summarized).toBe(prompts.length - before)
    expect(promptFor('service.billing')).toBeUndefined()
    expect(promptFor('service.orders')?.at(-1)?.content).toContain('service.billing')

    const entities = new Map((await graph()).entities.map((entity) => [entity.id, entity]))
    expect(entities.get('service.orders')?.frontmatter.summary).toBe(`${NARRATIVE} Billing sends its invoices.`)
    expect(entities.get('service.billing')?.paths).toEqual(['.docket/resources/service/billing.md'])
  })
})
