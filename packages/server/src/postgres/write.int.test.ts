import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readFixture, type Fixture } from '../../test/fixture.js'
import { STORE_KINDS, TEST_PG_URL, createTestStore, seedWorkspace, type TestStore } from '../../test/postgres.js'
import { parseMemoryFile } from '../docket.js'
import type { RememberInput, Writer } from '../write/inputs.js'
import { addEvidence, describeResource, listDocuments, listIngests, putDocument, readDocument, retireResource, writeInference, writeResource } from './index.js'

const NOW = new Date('2026-11-04T09:30:00.000Z')

describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('writing resources over $name', (kind) => {
  let org: TestStore
  let fixture: Fixture
  let workspaceId: string
  let writer: Writer

  const orders: RememberInput = {
    id: 'service.checkout',
    type: 'service',
    title: 'Checkout',
    attributes: { tier: 'critical' },
    body: 'Takes payment for a basket.',
    evidence: [{ source: 'code', path: 'src/checkout.ts', lines: '1-40', note: 'the checkout handler' }],
  }

  beforeAll(async () => {
    org = await createTestStore(kind)
    fixture = await readFixture()
    workspaceId = await org.as(async (ctx) => {
      const id = await seedWorkspace(ctx, { slug: 'platform', ontology: fixture.ontology })
      for (const document of fixture.documents) {
        await putDocument(ctx, { workspaceId: id, ...document, origin: 'repo', originRef: 'conn1:.docket', actor: 'system:repo-sync' })
      }
      return id
    })
    writer = { workspaceId, actor: 'token:dkt_live_abcd1234', label: 'ci-bot (token tok_8f3a…)', channel: 'mcp', requestId: 'req-1' }
  })
  afterAll(() => org?.drop())

  const write = (input: RememberInput, options: { dryRun?: boolean; as?: Partial<Writer> } = {}) =>
    org.as((ctx) => writeResource(ctx, { ...writer, ...options.as }, input, { dryRun: options.dryRun ?? false, now: () => NOW }))

  it('refuses a new resource with no evidence (missing-evidence) and writes nothing', async () => {
    const result = await write({ ...orders, id: 'service.unevidenced', evidence: [] })
    expect(result.documentId).toBeUndefined()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'missing-evidence' }))
    const records = await org.as((ctx) => listDocuments(ctx.tx, workspaceId))
    expect(records.some((record) => record.resourceId === 'service.unevidenced')).toBe(false)
  })

  it('refuses code evidence without a path (evidence-location-missing)', async () => {
    const result = await write({ ...orders, id: 'service.nopath', evidence: [{ source: 'code', symbol: 'handler' }] })
    expect(result.documentId).toBeUndefined()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'evidence-location-missing' }))
  })

  it('refuses a type or an evidence source the published ontology does not have', async () => {
    const unknownType = await write({ ...orders, id: 'queue.orders', type: 'queue' })
    expect(unknownType.diagnostics).toContainEqual(expect.objectContaining({ code: 'unknown-type' }))
    const unknownSource = await write({ ...orders, id: 'service.rumour', evidence: [{ source: 'rumour' }] })
    expect(unknownSource.diagnostics).toContainEqual(expect.objectContaining({ code: 'unknown-evidence-source' }))
  })

  it('a dry run returns the diagnostics and writes nothing', async () => {
    const before = await org.as((ctx) => ctx.tx.query('SELECT count(*)::int AS n FROM ingest_events'))
    const ok = await write({ ...orders, id: 'service.dry' }, { dryRun: true })
    expect(ok.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(ok.documentId).toBeUndefined()
    expect(ok.changed).toBe(false)
    const refused = await write({ ...orders, id: 'service.dry', evidence: [] }, { dryRun: true })
    expect(refused.diagnostics).toContainEqual(expect.objectContaining({ code: 'missing-evidence' }))
    const records = await org.as((ctx) => listDocuments(ctx.tx, workspaceId))
    expect(records.some((record) => record.resourceId === 'service.dry')).toBe(false)
    const after = await org.as((ctx) => ctx.tx.query('SELECT count(*)::int AS n FROM ingest_events'))
    expect(after.rows[0]).toEqual(before.rows[0])
  })

  it('stores evidence stamped with the writer, the request as session, and a client observedBy as reportedBy', async () => {
    const result = await write({
      ...orders,
      evidence: [
        { source: 'code', path: 'src/checkout.ts', lines: '1-40', note: 'the checkout handler', observedBy: 'alice' },
        { source: 'human', observedAt: '2026-10-01', note: 'confirmed in standup' },
      ],
    })
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(result.documentId).toBeDefined()
    expect(result.created).toBe(true)
    expect(result.path).toBe('.docket/resources/service/checkout.md')
    const stored = await org.as((ctx) => readDocument(ctx, workspaceId, result.path as string))
    const parsed = parseMemoryFile(stored?.raw as string, result.path as string)
    expect(parsed.document?.title).toBe('Checkout')
    expect(parsed.document?.attributes).toEqual({ tier: 'critical' })
    expect(parsed.document?.content.trim()).toBe('Takes payment for a basket.')
    expect(parsed.document?.evidence).toEqual([
      expect.objectContaining({ source: 'code', path: 'src/checkout.ts', observedBy: 'ci-bot (token tok_8f3a…)', session: 'req-1', observedAt: NOW.toISOString() }),
      expect.objectContaining({ source: 'human', observedBy: 'ci-bot (token tok_8f3a…)', session: 'req-1', observedAt: '2026-10-01' }),
    ])
    // The canonical file keeps who the client said saw it, as reportedBy; the writer is the observer.
    expect(stored?.raw).toMatch(/reportedBy: alice/)
    expect(stored?.raw).not.toMatch(/observedBy: alice/)
    expect(stored?.origin).toBe('cloud')
    expect(stored?.createdBy).toBe('token:dkt_live_abcd1234')
  })

  it('records the write as an ingest event with the evidence it added, linked to the request', async () => {
    const events = await org.as((ctx) => listIngests(ctx, { workspaceId, resourceId: 'service.checkout' }))
    const event = events.find((candidate) => candidate.outcome === 'ok')
    expect(event).toMatchObject({ channel: 'mcp', action: 'remember', actor: 'token:dkt_live_abcd1234', requestId: 'req-1', evidenceCount: 2 })
    expect(event?.documents).toEqual([expect.objectContaining({ resourceId: 'service.checkout', change: 'created', revision: 1 })])
    expect(event?.detail?.evidence?.[0]?.entries).toHaveLength(2)
    // The evidence is sealed by the codec, like the documents.
    const raw = await org.as((ctx) => ctx.tx.query<{ detail_ciphertext: Buffer }>('SELECT detail_ciphertext FROM ingest_events WHERE id = $1', [event?.id]))
    expect(raw.rows[0]?.detail_ciphertext.toString('utf8').includes('checkout handler')).toBe(kind.name.includes('plaintext'))
  })

  it('is idempotent: the same write again adds nothing and records nothing', async () => {
    const again = await write(
      {
        ...orders,
        evidence: [
          { source: 'code', path: 'src/checkout.ts', lines: '1-40', note: 'the checkout handler', observedBy: 'alice' },
          { source: 'human', observedAt: '2026-10-01', note: 'confirmed in standup' },
        ],
      },
      { as: { requestId: 'req-2' } },
    )
    expect(again.changed).toBe(false)
    expect(again.evidenceAdded).toBe(0)
    expect(again.ingestId).toBeUndefined()
  })

  it('merges a later write: new evidence appended, attributes updated, links added only with evidence', async () => {
    const refused = await write({ ...orders, links: [{ rel: 'depends_on', target: 'service.payments', evidence: [] }] }, { as: { requestId: 'req-3' } })
    expect(refused.diagnostics).toContainEqual(expect.objectContaining({ code: 'missing-evidence', message: expect.stringContaining('depends_on -> service.payments') }))

    const result = await write(
      {
        ...orders,
        attributes: { language: 'go' },
        evidence: [{ source: 'manifest', path: 'go.mod' }],
        links: [{ rel: 'depends_on', target: 'service.payments', evidence: [{ source: 'code', path: 'src/pay.ts' }] }],
      },
      { as: { requestId: 'req-4' } },
    )
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(result.revision).toBe(2)
    expect(result.evidenceAdded).toBe(2)
    const stored = await org.as((ctx) => readDocument(ctx, workspaceId, result.path as string))
    const parsed = parseMemoryFile(stored?.raw as string, result.path as string).document
    expect(parsed?.attributes).toEqual({ tier: 'critical', language: 'go' })
    expect(parsed?.evidence.map((e) => e.source)).toEqual(['code', 'human', 'manifest'])
    expect(parsed?.links).toEqual([expect.objectContaining({ rel: 'depends_on', target: 'service.payments', evidence: [expect.objectContaining({ session: 'req-4' })] })])
  })

  it('adds a link to an existing resource with the link evidence alone, but refuses a write with no evidence at all', async () => {
    const linked = await write(
      { ...orders, evidence: [], links: [{ rel: 'owned_by', target: 'team.commerce', evidence: [{ source: 'human', note: 'team page' }] }] },
      { as: { requestId: 'req-4b' } },
    )
    expect(linked.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(linked.evidenceAdded).toBe(1)
    const bare = await write({ ...orders, evidence: [], attributes: { tier: 'standard' } }, { as: { requestId: 'req-4c' } })
    expect(bare.diagnostics).toContainEqual(expect.objectContaining({ code: 'missing-evidence' }))
    expect(bare.changed).toBe(false)
  })

  it('refuses a link the ontology forbids, checking the target type', async () => {
    const result = await write(
      { ...orders, links: [{ rel: 'depends_on', target: 'team.commerce', evidence: [{ source: 'human' }] }] },
      { as: { requestId: 'req-5' } },
    )
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'relationship-to-violation' }))
    // A link to something not captured yet is a warning, not a refusal (§9.1).
    const dangling = await write(
      { ...orders, links: [{ rel: 'depends_on', target: 'service.ledger', evidence: [{ source: 'human' }] }] },
      { as: { requestId: 'req-6' } },
    )
    expect(dangling.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'dangling-reference' }))
    expect(dangling.changed).toBe(true)
  })

  it('keeps the layout and comments of an imported cloud document, and leaves it alone when a write adds nothing', async () => {
    const raw = '---\nid: team.ledger\ntype: team\n\n# Owns the money.\ntitle: Ledger team\n---\n\nThey run the books.\n'
    await org.as((ctx) => putDocument(ctx, { workspaceId, path: '.docket/resources/team/ledger.md', raw, origin: 'cloud', actor: 'user:owner' }))
    const input: RememberInput = { id: 'team.ledger', type: 'team', title: 'Ledger team', evidence: [{ source: 'human', note: 'org chart' }] }
    const first = await write(input, { as: { requestId: 'req-layout-1' } })
    expect(first.changed).toBe(true)
    const stored = await org.as((ctx) => readDocument(ctx, workspaceId, '.docket/resources/team/ledger.md'))
    expect(stored?.raw).toContain('# Owns the money.')
    expect(stored?.raw).toContain('They run the books.')
    const again = await write(input, { as: { requestId: 'req-layout-2' } })
    expect(again.changed).toBe(false)
    expect(again.revision).toBe(first.revision)
  })

  it('refuses writing a resource as another type than its documents declare', async () => {
    const result = await write({ ...orders, id: 'service.orders', type: 'datasource' })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'type-conflict' }))
  })

  it('adds evidence to a repo resource in a cloud document of its own, and to an existing link', async () => {
    const added = await org.as((ctx) =>
      addEvidence(ctx, { ...writer, requestId: 'req-7' }, { id: 'service.orders', evidence: [{ source: 'human', note: 'owner confirmed' }] }, { now: () => NOW }),
    )
    expect(added.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    // The repo document holds the canonical path; the cloud one sits beside it and never replaces it.
    expect(added.path).toBe('.docket/resources/service/orders.cloud.md')
    const repo = await org.as((ctx) => readDocument(ctx, workspaceId, '.docket/resources/service/orders.md'))
    expect(repo?.origin).toBe('repo')
    expect(added.evidenceAdded).toBe(1)

    const onLink = await org.as((ctx) =>
      addEvidence(ctx, { ...writer, requestId: 'req-8' }, { id: 'service.orders', link: { rel: 'owned_by', target: 'team.commerce' }, evidence: [{ source: 'human' }] }),
    )
    expect(onLink.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const missing = await org.as((ctx) =>
      addEvidence(ctx, { ...writer, requestId: 'req-9' }, { id: 'service.orders', link: { rel: 'owned_by', target: 'team.discovery' }, evidence: [{ source: 'human' }] }),
    )
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({ code: 'unknown-link' }))
    const unknown = await org.as((ctx) => addEvidence(ctx, { ...writer, requestId: 'req-10' }, { id: 'service.nothing', evidence: [{ source: 'human' }] }))
    expect(unknown.diagnostics).toContainEqual(expect.objectContaining({ code: 'unknown-resource' }))
  })

  it('retires a cloud resource with its reason, and refuses one that comes from a repo', async () => {
    const repo = await org.as((ctx) => retireResource(ctx, { ...writer, requestId: 'req-11' }, { id: 'service.payments', reason: 'gone' }))
    expect(repo.retired).toEqual([])
    expect(repo.diagnostics).toContainEqual(expect.objectContaining({ code: 'repo-origin', message: expect.stringContaining('change it in the repo') }))

    const noReason = await org.as((ctx) => retireResource(ctx, { ...writer, requestId: 'req-12' }, { id: 'service.checkout', reason: ' ' }))
    expect(noReason.diagnostics).toContainEqual(expect.objectContaining({ code: 'missing-reason' }))

    const retired = await org.as((ctx) => retireResource(ctx, { ...writer, requestId: 'req-13' }, { id: 'service.checkout', reason: 'merged into orders' }))
    expect(retired.retired).toEqual([expect.objectContaining({ resourceId: 'service.checkout', change: 'retired' })])
    const records = await org.as((ctx) => listDocuments(ctx.tx, workspaceId))
    expect(records.some((record) => record.resourceId === 'service.checkout')).toBe(false)
    const events = await org.as((ctx) => listIngests(ctx, { workspaceId, resourceId: 'service.checkout' }))
    expect(events[0]?.detail?.reason).toBe('merged into orders')

    // A resource in both a repo and the cloud: the cloud copy goes, the repo copy is named.
    const both = await org.as((ctx) => retireResource(ctx, { ...writer, requestId: 'req-14' }, { id: 'service.orders', reason: 'duplicate' }))
    expect(both.retired).toHaveLength(1)
    expect(both.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'still-declared' }))
  })

  it('records in the ingest event only the evidence the write added, not entries already on the document', async () => {
    const seen = { source: 'code', path: 'src/refunds.ts' }
    await write({ id: 'service.refunds', type: 'service', title: 'Refunds', evidence: [seen] }, { as: { requestId: 'req-dup-1' } })
    const fresh = { source: 'human', note: 'owner confirmed' }
    const again = await write({ id: 'service.refunds', type: 'service', title: 'Refunds', evidence: [seen, fresh] }, { as: { requestId: 'req-dup-2' } })
    expect(again.evidenceAdded).toBe(1)
    const events = await org.as((ctx) => listIngests(ctx, { workspaceId, resourceId: 'service.refunds' }))
    const event = events.find((candidate) => candidate.requestId === 'req-dup-2')
    expect(event?.evidenceCount).toBe(1)
    expect(event?.detail?.evidence).toEqual([{ on: 'service.refunds', entries: [expect.objectContaining({ source: 'human', note: 'owner confirmed' })] }])
  })

  it("describes a resource by its cloud document, so a link-only write keeps the cloud document's title", async () => {
    await org.as(async (ctx) => {
      const repo = '---\nid: service.invoices\ntype: service\ntitle: Invoices\n---\n'
      await putDocument(ctx, { workspaceId, path: '.docket/a-invoices.md', raw: repo, origin: 'repo', originRef: 'conn1:.docket', actor: 'system:repo-sync' })
      const cloud = '---\nid: service.invoices\ntype: service\ntitle: Invoices service\n---\n'
      await putDocument(ctx, { workspaceId, path: '.docket/resources/service/invoices.md', raw: cloud, origin: 'cloud', actor: 'user:owner' })
    })
    const from = await org.as((ctx) => describeResource(ctx, workspaceId, 'service.invoices'))
    expect(from).toEqual({ type: 'service', title: 'Invoices service' })
    const linked = await write(
      { id: 'service.invoices', type: 'service', title: from?.title as string, links: [{ rel: 'owned_by', target: 'team.commerce', evidence: [{ source: 'human' }] }], evidence: [] },
      { as: { requestId: 'req-title-1' } },
    )
    expect(linked.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(linked.path).toBe('.docket/resources/service/invoices.md')
    const stored = await org.as((ctx) => readDocument(ctx, workspaceId, '.docket/resources/service/invoices.md'))
    expect(parseMemoryFile(stored?.raw as string, '.docket/resources/service/invoices.md').document?.title).toBe('Invoices service')
  })

  it('writes an inference in a document of its own, and refuses one about no resource or outside the inferred root', async () => {
    const as = { ...writer, actor: 'system:enrichment', label: 'docket-cloud enrichment', channel: 'enrichment' as const, requestId: 'req-infer-1' }
    const links = [{ rel: 'owned_by', target: 'team.commerce', evidence: [{ source: 'human', note: 'everything around it is Commerce' }] }]
    const infer = (id: string, path: string) => org.as((ctx) => writeInference(ctx, as, { id, path, links }, { now: () => NOW }))

    const written = await infer('pod.payments-5d2a', '.docket/~inferred/pod.payments-5d2a/owner.md')
    expect(written.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(written.path).toBe('.docket/~inferred/pod.payments-5d2a/owner.md')
    const stored = await org.as((ctx) => readDocument(ctx, workspaceId, '.docket/~inferred/pod.payments-5d2a/owner.md'))
    expect(stored?.raw).toContain('title: payments-5d2a')
    expect(stored?.raw).toContain('authority: inferred')
    // The resource's own documents are untouched, and a person's write still goes to its own cloud document.
    expect(await org.as((ctx) => describeResource(ctx, workspaceId, 'pod.payments-5d2a'))).toEqual({ type: 'pod', title: 'payments-5d2a' })

    expect((await infer('pod.nowhere', '.docket/~inferred/pod.nowhere/owner.md')).diagnostics).toContainEqual(expect.objectContaining({ code: 'unknown-resource' }))
    expect((await infer('pod.payments-5d2a', '.docket/resources/pod/payments-5d2a.md')).diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid-path' }))
    const unevidenced = await org.as((ctx) =>
      writeInference(ctx, as, { id: 'pod.payments-5d2a', path: '.docket/~inferred/pod.payments-5d2a/x.md', links: [{ rel: 'owned_by', target: 'team.commerce', evidence: [] }] }),
    )
    expect(unevidenced.diagnostics).toContainEqual(expect.objectContaining({ code: 'missing-evidence' }))
  })
})
