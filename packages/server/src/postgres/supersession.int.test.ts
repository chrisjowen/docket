import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readFixture, type Fixture } from '../../test/fixture.js'
import { STORE_KINDS, TEST_PG_URL, createTestStore, seedWorkspace, type TestStore } from '../../test/postgres.js'
import type { Writer } from '../write/inputs.js'
import { listDocuments, listIngests, liveSupersessions, putDocument, retireResource, supersedeResource, writeResource, type SupersedeInput } from './index.js'

const NOW = new Date('2026-11-12T09:30:00.000Z')

describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('superseding records over $name', (kind) => {
  let org: TestStore
  let fixture: Fixture
  let workspaceId: string
  let writer: Writer

  const evidence = [{ source: 'human', note: 'Payments moved to the billing service in November.' }]
  const supersede = (input: Partial<SupersedeInput> = {}) =>
    org.as((ctx) =>
      supersedeResource(ctx, writer, { id: 'service.payments', by: 'service.billing', reason: 'Billing replaced Payments.', evidence, ...input }, { now: () => NOW }),
    )

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
    for (const id of ['service.billing', 'service.ledger']) {
      await org.as((ctx) =>
        writeResource(ctx, writer, { id, type: 'service', title: id === 'service.billing' ? 'Billing' : 'Ledger', evidence: [{ source: 'human' }] }, { now: () => NOW }),
      )
    }
  })
  afterAll(() => org?.drop())

  it('refuses what it cannot record, writing nothing but the refusal to the activity log', async () => {
    const refused = async (input: Partial<SupersedeInput>) => (await supersede(input)).diagnostics.filter((d) => d.severity === 'error').map((d) => d.code)
    expect(await refused({ by: 'service.payments' })).toEqual(['same-resource'])
    expect(await refused({ reason: ' ' })).toEqual(['missing-reason'])
    expect(await refused({ evidence: [] })).toEqual(['missing-evidence'])
    expect(await refused({ by: 'service.nowhere' })).toEqual(['unknown-resource'])
    expect(await refused({ validUntil: 'last tuesday' })).toEqual(['invalid-date'])
    expect(await refused({ validUntil: '2027-01-01' })).toEqual(['future-date'])
    expect(await org.as((ctx) => liveSupersessions(ctx, workspaceId))).toEqual([])
    const log = await org.as((ctx) => listIngests(ctx, { workspaceId, limit: 6 }))
    expect(log.every((event) => event.action === 'supersede' && event.outcome === 'refused')).toBe(true)
  })

  it('marks a repo record superseded by its replacement, keeping both on file with the reason, evidence and until-date', async () => {
    const result = await supersede({ validUntil: '2026-11-01' })
    expect(result.changed).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.supersession).toEqual(
      expect.objectContaining({
        resourceId: 'service.payments',
        supersededBy: 'service.billing',
        validUntil: new Date('2026-11-01T00:00:00.000Z'),
        source: 'agent',
        actorLabel: 'ci-bot (token tok_8f3a…)',
        reason: 'Billing replaced Payments.',
        evidence: [expect.objectContaining({ source: 'human', observedBy: 'ci-bot (token tok_8f3a…)', session: 'req-1' })],
      }),
    )
    // Nothing is deleted: the repo document is still live.
    const documents = await org.as((ctx) => listDocuments(ctx.tx, workspaceId))
    expect(documents.some((document) => document.resourceId === 'service.payments')).toBe(true)

    const [event] = await org.as((ctx) => listIngests(ctx, { workspaceId, limit: 1 }))
    expect(event).toEqual(expect.objectContaining({ action: 'supersede', outcome: 'ok', evidenceCount: 1 }))
    expect(event?.detail).toEqual(expect.objectContaining({ resourceId: 'service.payments', supersededBy: 'service.billing', reason: 'Superseded by service.billing: Billing replaced Payments.' }))

    // Saying it again changes nothing.
    expect((await supersede()).changed).toBe(false)
  })

  it('refuses a replacement that is itself out of date, and re-points a record to a new replacement, keeping the earlier in its history', async () => {
    const stale = await org.as((ctx) =>
      supersedeResource(ctx, writer, { id: 'service.ledger', by: 'service.payments', reason: 'Merged.', evidence }, { now: () => NOW }),
    )
    expect(stale.diagnostics.map((d) => d.code)).toEqual(['replacement-superseded'])

    const repointed = await supersede({ by: 'service.ledger', reason: 'Ledger took over payments, not Billing.' })
    expect(repointed).toEqual(expect.objectContaining({ changed: true, replaced: 'service.billing' }))
    expect(repointed.diagnostics.map((d) => d.code)).toEqual(['repointed'])
    const live = await org.as((ctx) => liveSupersessions(ctx, workspaceId))
    expect(live.map((each) => [each.resourceId, each.supersededBy])).toEqual([['service.payments', 'service.ledger']])
    const rows = await org.as((ctx) => ctx.tx.query('SELECT superseded_by, lifted_at FROM supersessions WHERE workspace_id = $1 ORDER BY recorded_at, lifted_at NULLS LAST', [workspaceId]))
    expect(rows.rows.map((row: { superseded_by: string; lifted_at: Date | null }) => [row.superseded_by, row.lifted_at !== null])).toEqual([
      ['service.billing', true],
      ['service.ledger', false],
    ])
  })

  it('leaves docket_retire working as it did', async () => {
    const retired = await org.as((ctx) => retireResource(ctx, writer, { id: 'service.billing', reason: 'written by mistake' }))
    expect(retired.retired.map((document) => document.resourceId)).toEqual(['service.billing'])
  })
})
