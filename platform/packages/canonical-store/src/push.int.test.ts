// SPDX-License-Identifier: AGPL-3.0-only
import { hashContent } from '@chrisjowen/docket'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { insertWorkspace, listDocumentPage, listIngests, putDocument, pushDocuments, readDocument, type PushInput, type PushResult, type Writer } from './index.js'
import { createTestOrg, readFixture, type Fixture, type TestOrg } from './testing.js'

const CHECKOUT = 'docket-platform-0123456789ab'

const service = (id: string, title: string, extra = '') => `---
id: service.${id}
type: service
title: ${title}
attributes:
  tier: standard
links:
  - rel: owned_by
    target: team.commerce
evidence:
  - source: manifest
    path: ${id}/package.json
${extra}---
${title} does things.
`

describe.skipIf(!TEST_PG_URL)('pushDocuments', () => {
  let org: TestOrg
  let fixture: Fixture
  let workspaceId: string
  let writer: Writer

  beforeAll(async () => {
    org = await createTestOrg()
    fixture = await readFixture()
    workspaceId = await org.withOrg(async (ctx) => {
      const workspace = await insertWorkspace(ctx.tx, { name: 'Platform', slug: 'platform', createdBy: org.userId })
      await ctx.tx.query(
        `INSERT INTO ontology_versions (workspace_id, number, status, yaml, yaml_hash, source, author, published_at, published_by)
         VALUES ($1, 1, 'published', $2, $3, 'import', $4, now(), $4)`,
        [workspace.id, fixture.ontology, hashContent(fixture.ontology), org.userId],
      )
      for (const document of fixture.documents) {
        await putDocument(ctx, { workspaceId: workspace.id, ...document, origin: 'repo', originRef: 'conn1:.docket', actor: 'system:repo-sync' })
      }
      return workspace.id
    })
    writer = { workspaceId, actor: 'oauth:docket-cli/user:u1', label: 'docket-cli via alice (oauth)', channel: 'cli', requestId: 'req-push' }
  })
  afterAll(() => org?.drop())

  const push = (input: Partial<PushInput>, options: { dryRun?: boolean; checkout?: string } = {}) =>
    org.withOrg((ctx) =>
      pushDocuments(ctx, { ...writer, requestId: `req-${Math.random()}` }, { checkout: options.checkout ?? CHECKOUT, upsert: [], remove: [], ...input }, { dryRun: options.dryRun ?? false }),
    )
  const ours = (checkout = CHECKOUT) => org.withOrg((ctx) => listDocumentPage(ctx, { workspaceId, origin: 'cli', originRef: checkout, limit: 500 }))

  it('creates cli documents keyed by the checkout, validated against the published head, as one ingest event', async () => {
    const upsert = [
      { path: '.docket/resources/service/billing.md', raw: service('billing', 'Billing') },
      { path: '.docket/resources/service/invoices.md', raw: service('invoices', 'Invoices') },
    ]
    const result = await push({ upsert })
    expect(result).toMatchObject({ ok: true, dryRun: false, created: upsert.map((file) => file.path), updated: [], unchanged: [], removed: [] })
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])

    const listed = await ours()
    expect(listed.documents.map(({ path, hash, origin, originRef, revision }) => ({ path, hash, origin, originRef, revision }))).toEqual(
      upsert.map((file) => ({ path: file.path, hash: hashContent(file.raw), origin: 'cli', originRef: CHECKOUT, revision: 1 })),
    )
    expect(listed.next).toBeNull()

    const [event] = await org.withOrg((ctx) => listIngests(ctx, { workspaceId, channel: 'cli', limit: 1 }))
    expect(event).toMatchObject({ channel: 'cli', action: 'push', outcome: 'ok', actor: writer.actor, actorLabel: writer.label, id: result.ingestId })
    expect(event?.documents.map((d) => [d.path, d.change])).toEqual(upsert.map((file) => [file.path, 'created']))
  })

  it('reports unchanged and updated files, and retires what the checkout removes', async () => {
    const result = await push({
      upsert: [
        { path: '.docket/resources/service/billing.md', raw: service('billing', 'Billing') },
        { path: '.docket/resources/service/invoices.md', raw: service('invoices', 'Invoices v2') },
      ],
    })
    expect(result).toMatchObject({ ok: true, created: [], updated: ['.docket/resources/service/invoices.md'], unchanged: ['.docket/resources/service/billing.md'] })
    expect((await ours()).documents.find((d) => d.path.endsWith('invoices.md'))?.revision).toBe(2)

    const removed = await push({ remove: ['.docket/resources/service/billing.md', '.docket/resources/service/never.md'] })
    expect(removed).toMatchObject({ ok: true, removed: ['.docket/resources/service/billing.md'] })
    expect(removed.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'not-pushed', path: '.docket/resources/service/never.md' }))
    expect((await ours()).documents.map((d) => d.path)).toEqual(['.docket/resources/service/invoices.md'])
  })

  it('refuses the whole push on any error, applying nothing, and records the refusal', async () => {
    const result = await push({
      upsert: [
        { path: '.docket/resources/service/fine.md', raw: service('fine', 'Fine') },
        { path: '.docket/resources/queue/orders.md', raw: '---\nid: queue.orders\ntype: queue\ntitle: Orders\n---\n' },
        { path: 'notes.txt', raw: 'not markdown' },
      ],
      remove: ['.docket/resources/service/invoices.md'],
    })
    expect(result).toMatchObject({ ok: false, created: [], updated: [], unchanged: [], removed: [] })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'unknown-type', path: '.docket/resources/queue/orders.md' }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'invalid-document', path: 'notes.txt' }))
    expect((await ours()).documents.map((d) => d.path)).toEqual(['.docket/resources/service/invoices.md'])
    const [event] = await org.withOrg((ctx) => listIngests(ctx, { workspaceId, channel: 'cli', limit: 1 }))
    expect(event).toMatchObject({ action: 'push', outcome: 'refused', documents: [], id: result.ingestId })
    expect(event?.detail?.diagnostics).toContainEqual(expect.objectContaining({ code: 'unknown-type' }))
  })

  it('refuses a link the ontology does not allow, a duplicate path, and a path both upserted and removed', async () => {
    const badLink = service('wrong', 'Wrong').replace('rel: owned_by\n    target: team.commerce', 'rel: exposes\n    target: team.commerce')
    const result = await push({
      upsert: [
        { path: '.docket/resources/service/wrong.md', raw: badLink },
        { path: '.docket/resources/service/twice.md', raw: service('twice', 'Twice') },
        { path: '.docket/resources/service/twice.md', raw: service('twice', 'Twice') },
        { path: '.docket/resources/service/both.md', raw: service('both', 'Both') },
      ],
      remove: ['.docket/resources/service/both.md'],
    })
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', path: '.docket/resources/service/wrong.md' }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'duplicate-path', path: '.docket/resources/service/twice.md' }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'upsert-and-remove', path: '.docket/resources/service/both.md' }))
  })

  it('validates and reports on a dry run, writing nothing and logging nothing', async () => {
    const before = await org.withOrg((ctx) => listIngests(ctx, { workspaceId, channel: 'cli', limit: 500 }))
    const result = await push({ upsert: [{ path: '.docket/resources/service/dry.md', raw: service('dry', 'Dry') }] }, { dryRun: true })
    expect(result).toMatchObject({ ok: true, dryRun: true, created: ['.docket/resources/service/dry.md'] })
    expect(result.ingestId).toBeUndefined()
    expect((await ours()).documents.map((d) => d.path)).not.toContain('.docket/resources/service/dry.md')
    expect(await org.withOrg((ctx) => listIngests(ctx, { workspaceId, channel: 'cli', limit: 500 }))).toHaveLength(before.length)
  })

  it("never takes over another source's path: refused when the text differs, left alone when it is the same", async () => {
    const repo = fixture.documents.find((d) => d.path.endsWith('team/commerce.md')) as { path: string; raw: string }
    const taken = await push({ upsert: [{ path: repo.path, raw: repo.raw.replace('Orders and payments.', 'Changed.') }] })
    expect(taken.ok).toBe(false)
    expect(taken.diagnostics).toContainEqual(expect.objectContaining({ code: 'path-taken', path: repo.path }))

    const same = await push({ upsert: [{ path: repo.path, raw: repo.raw }] })
    expect(same).toMatchObject({ ok: true, unchanged: [repo.path], created: [] })
    expect(same.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'held-elsewhere', path: repo.path }))
    expect((await org.withOrg((ctx) => readDocument(ctx, workspaceId, repo.path)))?.origin).toBe('repo')

    const other = await push({ upsert: [{ path: '.docket/resources/service/invoices.md', raw: service('invoices', 'Theirs') }] }, { checkout: 'docket-other-ffffffffffff' })
    expect(other.diagnostics).toContainEqual(expect.objectContaining({ code: 'path-taken', message: expect.stringContaining("another checkout's service.invoices") }))
  })

  it("sees a path another writer creates while the push waits, and refuses to take it over", async () => {
    const path = '.docket/resources/service/raced.md'
    let pushing: Promise<PushResult> | undefined
    await org.withOrg(async (ctx) => {
      await putDocument(ctx, { workspaceId, path, raw: service('raced', 'Cloud'), origin: 'cloud', actor: 'user:u1' })
      pushing = push({ upsert: [{ path, raw: service('raced', 'Checkout') }] })
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    const result = await pushing
    expect(result?.ok).toBe(false)
    expect(result?.diagnostics).toContainEqual(expect.objectContaining({ code: 'path-taken', path }))
    expect(await org.withOrg((ctx) => readDocument(ctx, workspaceId, path))).toMatchObject({ origin: 'cloud', revision: 1 })
  })

  it('pages the listing by path, with the text only when asked', async () => {
    const first = await org.withOrg((ctx) => listDocumentPage(ctx, { workspaceId, origin: 'repo', limit: 5, raw: true }))
    expect(first.documents).toHaveLength(5)
    expect(first.next).toBe(first.documents[4]?.path)
    expect(first.documents[0]?.raw).toBe(fixture.documents[0]?.raw)
    expect(first.documents[0]?.updatedAt).toBeInstanceOf(Date)
    const rest = await org.withOrg((ctx) => listDocumentPage(ctx, { workspaceId, origin: 'repo', limit: 500, after: first.next as string }))
    expect([...first.documents, ...rest.documents].map((d) => d.path)).toEqual(fixture.documents.map((d) => d.path))
    expect(rest.next).toBeNull()
    expect(rest.documents[0]).not.toHaveProperty('raw')
  })
})
