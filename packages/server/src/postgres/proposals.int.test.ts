import { readFileSync } from 'node:fs'

import { ONTOLOGY_TEMPLATES } from '@chrisjowen/docket'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { STORE_KINDS, TEST_PG_URL, createTestStore, seedWorkspace, type TestStore } from '../../test/postgres.js'
import type { PeopleDirectory } from '../docket.js'
import type { StoreContext } from '../ports.js'
import type { Writer } from '../write/inputs.js'
import {
  addProposalEvidence,
  liveSupersessions,
  lockResource,
  openProposals,
  promoteProposals,
  rejectProposal,
  supersedeResource,
  writeResource
} from './index.js'

const NOW = new Date('2026-11-20T09:30:00.000Z')

/**
 * Supersede proposals over Postgres, with docket's default ontology - a
 * person source, "A person said so" at 0.70 and "A lead said so" at 0.85 - and
 * the 0.75 bar: Tom's word alone leaves a proposal pending, Dana's carries it.
 */
describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('supersede proposals over $name', (kind) => {
  let org: TestStore
  let workspaceId: string
  let people: PeopleDirectory = { people: { dana: { attributes: { role: 'lead' } }, tom: { attributes: {} } } }
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.as((ctx) => fn({ ...ctx, people }))
  const writer = (principal: string): Writer => ({ workspaceId, actor: `token:${principal}`, label: `${principal}-agent`, channel: 'mcp', requestId: `req-${principal}`, principal })
  const propose = (id: string, by: string, principal = 'tom') =>
    as((ctx) => supersedeResource(ctx, writer(principal), { id, by, reason: `${by} replaced ${id}.`, evidence: [{ note: 'I heard so.' }] }, { now: () => NOW }))

  beforeAll(async () => {
    org = await createTestStore(kind)
    workspaceId = await org.as((ctx) => seedWorkspace(ctx, { slug: 'platform', ontology: readFileSync(ONTOLOGY_TEMPLATES.sdlc as string, 'utf8') }))
    for (const id of ['team.payments', 'team.money', 'team.ledger', 'team.books', 'team.ops', 'team.platform', 'team.alpha', 'team.beta']) {
      await as((ctx) => writeResource(ctx, writer('tom'), { id, type: 'team', title: id, evidence: [{ source: 'code', path: 'CODEOWNERS' }] }, { now: () => NOW }))
    }
  })
  afterAll(() => org?.drop())

  it('keeps a proposal its evidence does not carry pending, the record current, until a lead\'s word carries it', async () => {
    const proposed = await propose('team.payments', 'team.money')
    expect(proposed.diagnostics).toEqual([])
    expect(proposed.proposal).toMatchObject({ status: 'pending', score: 0.7, threshold: 0.75 })
    expect(proposed.proposal?.carry.map((each) => each.policy)).toContain('A lead said so')
    expect(await as((ctx) => liveSupersessions(ctx, workspaceId))).toEqual([])
    expect(await as((ctx) => openProposals(ctx, workspaceId))).toEqual([
      expect.objectContaining({ proposal: proposed.proposal?.id, id: 'team.payments', by: 'team.money', score: 0.7, threshold: 0.75, stale: false })
    ])

    const confirmed = await as((ctx) => addProposalEvidence(ctx, writer('dana'), { supersession: proposed.proposal?.id as string, evidence: [{ note: 'Renamed in October.' }] }, { now: () => NOW }))
    expect(confirmed).toMatchObject({ changed: true, evidenceAdded: 1, proposal: { status: 'accepted', resource: 'team.payments', supersededBy: 'team.money' } })
    expect(await as((ctx) => liveSupersessions(ctx, workspaceId))).toEqual([
      expect.objectContaining({ resourceId: 'team.payments', supersededBy: 'team.money', status: 'accepted', decidedBy: 'score', grandfathered: false })
    ])
    expect(await as((ctx) => openProposals(ctx, workspaceId))).toEqual([])
  })

  it('takes a repeated proposal\'s evidence into the pending one, and a different one in its place', async () => {
    const first = await propose('team.ledger', 'team.books')
    const again = await propose('team.ledger', 'team.books', 'tom')
    expect(again).toMatchObject({ changed: false, proposal: { id: first.proposal?.id, status: 'pending' } })
    const other = await propose('team.ledger', 'team.ops')
    expect(other.diagnostics).toEqual([expect.objectContaining({ code: 'repointed' })])
    expect((await as((ctx) => openProposals(ctx, workspaceId))).filter((each) => each.id === 'team.ledger')).toEqual([
      expect.objectContaining({ by: 'team.ops' })
    ])
  })

  it('rejects a pending proposal with a reason, and takes no more evidence for it', async () => {
    const proposed = await propose('team.ops', 'team.platform')
    const id = proposed.proposal?.id as string
    const rejected = await as((ctx) => rejectProposal(ctx, writer('dana'), { supersession: id.slice(0, 8), reason: 'Two teams, not one.' }, { now: () => NOW }))
    expect(rejected).toMatchObject({ changed: true, proposal: { id, status: 'rejected' } })
    const more = await as((ctx) => addProposalEvidence(ctx, writer('dana'), { supersession: id, evidence: [{ note: 'x' }] }))
    expect(more.diagnostics).toEqual([expect.objectContaining({ code: 'rejected-proposal' })])
    expect((await as((ctx) => openProposals(ctx, workspaceId))).some((each) => each.proposal === id)).toBe(false)
  })

  it('refuses a reject that races an acceptance under the same resource lock, leaving the acceptance to stand', async () => {
    const proposed = await propose('team.alpha', 'team.beta')
    const id = proposed.proposal?.id as string

    let release = () => undefined as void
    const held = new Promise<void>((resolve) => { release = resolve })
    let lockedAt = () => undefined as void
    const acquired = new Promise<void>((resolve) => { lockedAt = resolve })

    const racingAccept = as(async (ctx) => {
      await lockResource(ctx, workspaceId, 'team.alpha')
      lockedAt()
      await ctx.tx.query("UPDATE supersessions SET status = 'accepted' WHERE id = $1", [id])
      await held
    })

    await acquired
    const rejectPromise = as((ctx) => rejectProposal(ctx, writer('dana'), { supersession: id, reason: 'Too late, already decided.' }, { now: () => NOW }))
    await new Promise((resolve) => setTimeout(resolve, 100))
    release()
    await racingAccept

    const rejected = await rejectPromise
    expect(rejected).toMatchObject({ changed: false })
    expect(rejected.diagnostics).toEqual([expect.objectContaining({ code: 'decided-proposal' })])
    expect((await as((ctx) => openProposals(ctx, workspaceId))).some((each) => each.proposal === id)).toBe(false)
  })

  it('accepts a pending proposal a person\'s new role carries, when read and when promoted, and keeps it accepted', async () => {
    const proposed = await propose('team.books', 'team.platform')
    expect(proposed.proposal?.status).toBe('pending')
    // Tom is made a lead: his word now clears the bar - live on read, recorded by a promotion.
    people = { people: { ...people.people, tom: { attributes: { role: 'lead' } } } }
    expect((await as((ctx) => liveSupersessions(ctx, workspaceId))).map((each) => each.resourceId)).toContain('team.books')
    // Tom's earlier pending proposal (team.ledger) is carried too.
    expect((await as((ctx) => promoteProposals(ctx, workspaceId, NOW))).map((each) => each.id)).toContain(proposed.proposal?.id)
    people = { people: { ...people.people, tom: { attributes: {} } } }
    expect((await as((ctx) => liveSupersessions(ctx, workspaceId))).find((each) => each.resourceId === 'team.books')).toMatchObject({ status: 'accepted' })
  })
})
