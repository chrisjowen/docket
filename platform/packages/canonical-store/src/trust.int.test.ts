// SPDX-License-Identifier: AGPL-3.0-only
import { hashContent } from '@chrisjowen/docket'
import { scoreProposal } from '@chrisjowen/docket/workspace'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addProposalEvidence,
  attestationsChanged,
  confirmProposal,
  describeResource,
  insertWorkspace,
  listProposals,
  liveSupersessions,
  openProposals,
  orgTrust,
  overrideProposal,
  postgresSource,
  proposalModel,
  readWorkspace,
  recordRepositoryAttributes,
  registerSource,
  rejectProposal,
  setMemberAttributes,
  snapshotProposals,
  supersedeResource,
  unregisterSource,
  validate,
  writeResource,
  type StoreContext,
  type Writer,
} from './index.js'
import { createTestOrg, type TestOrg } from './testing.js'

/**
 * The trust design's worked example, in small: a person source scored by the
 * directory, a GitHub source scored by what the connection says about the
 * repository, and a document source scored by what the registry says.
 */
const ONTOLOGY = `version: 1
resourceTypes:
  vendor:
    description: A company we buy from.
  decision:
    description: A decision.
relationships: {}
sources:
  person:
    kind: identity
    attributes:
      role: { type: string, setBy: directory }
      flags: { type: "string[]", setBy: directory }
  github:
    kind: system
    identifiedBy: [repository]
    attributes:
      visibility: { type: string, setBy: connection }
      branch_protected: { type: boolean, setBy: connection }
    locator:
      repository: { required: true }
  document:
    kind: content
    identifiedBy: [url]
    attributes:
      status: { type: string, enum: [verified, unverified, draft], setBy: registry }
    locator:
      url: { required: true }
trust:
  unevidenced: 0.5
  fallback: 0.4
  cap: 0.99
  accept: { default: 0.75, decision: 0.8 }
  policies:
    - name: A person said so
      when: { source: person }
      score: 0.5
    - name: A lead said so
      when: { source: person, role: lead }
      score: 0.85
    - name: New starter
      when: { source: person, flags: { has: new-starter } }
      adjust: -0.1
    - name: Seen in GitHub
      when: { source: github }
      score: 0.7
    - name: Protected default branch
      when: { source: github, branch_protected: true }
      adjust: 0.1
    - name: A document
      when: { source: document }
      score: 0.4
    - name: A verified document
      when: { source: document, status: verified }
      score: 0.9
`

const NOW = new Date('2026-11-20T09:00:00.000Z')

describe.skipIf(!TEST_PG_URL)('trust set by policy, over what the org attests', () => {
  let org: TestOrg
  let workspaceId: string
  let connectionId: string
  const writer = (principal: string | undefined, label = 'claude-code via someone (oauth)'): Writer => ({
    workspaceId,
    actor: 'oauth:claude/user:1',
    label,
    channel: 'mcp',
    requestId: `req-${principal ?? 'none'}`,
    ...(principal ? { principal } : {}),
  })
  const confidence = async (id: string) => {
    const read = await org.withOrg((ctx) => validate({ source: postgresSource(ctx, workspaceId) }))
    return read.entities.find((entity) => entity.id === id)?.confidence
  }
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.withOrg(fn)

  beforeAll(async () => {
    org = await createTestOrg()
    ;({ workspaceId, connectionId } = await as(async (ctx) => {
      const workspace = await insertWorkspace(ctx.tx, { name: 'Payments', slug: 'payments', createdBy: org.userId })
      await ctx.tx.query(
        `INSERT INTO ontology_versions (workspace_id, number, status, yaml, yaml_hash, source, author, published_at, published_by)
         VALUES ($1, 1, 'published', $2, $3, 'import', $4, now(), $4)`,
        [workspace.id, ONTOLOGY, hashContent(ONTOLOGY), org.userId],
      )
      await ctx.tx.query(
        `INSERT INTO repo_connections (id, workspace_id, installation_id, repo_id, repo_full_name, branch, path, created_by)
         VALUES ('conn1', $1, 1, 42, 'Arcadia/Payments', 'main', '.docket', 'test')`,
        [workspace.id],
      )
      return { workspaceId: workspace.id, connectionId: 'conn1' }
    }))
    await as((ctx) => setMemberAttributes(ctx, { userId: 'u-dana', login: 'dana', name: 'Dana Ruiz', attributes: { role: 'lead' }, actor: 'user:owner' }))
    await as((ctx) => setMemberAttributes(ctx, { userId: 'u-tom', login: 'tom', attributes: { role: 'intern', flags: ['new-starter'] }, actor: 'user:owner' }))
  })
  afterAll(() => org?.drop())

  it('stamps who the writer acts for, and takes evidence that cites no source as that person said so', async () => {
    const result = await as((ctx) =>
      writeResource(ctx, writer('tom'), { id: 'vendor.adyen', type: 'vendor', title: 'Adyen', evidence: [{ note: 'Said at stand-up.' }] }, { now: () => NOW }),
    )
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const read = await as((ctx) => validate({ source: postgresSource(ctx, workspaceId) }))
    const adyen = read.entities.find((entity) => entity.id === 'vendor.adyen')
    expect(adyen?.evidence[0]).toEqual(expect.objectContaining({ source: 'person', principal: 'tom', observedBy: 'claude-code via someone (oauth)' }))
    // An intern who is a new starter: 0.5 - 0.1.
    expect(adyen?.confidence).toBe(0.4)
  })

  it('refuses evidence with no source from a credential that acts for no one', async () => {
    const result = await as((ctx) =>
      writeResource(ctx, writer(undefined), { id: 'vendor.stripe', type: 'vendor', title: 'Stripe', evidence: [{ note: 'Someone said.' }] }, { now: () => NOW }),
    )
    expect(result.diagnostics.map((d) => d.code)).toContain('missing-evidence-source')
  })

  it('scores a person by the role the directory gives them, and re-scores when it changes', async () => {
    await as((ctx) => writeResource(ctx, writer('dana'), { id: 'vendor.wise', type: 'vendor', title: 'Wise', evidence: [{ note: 'We use Wise.' }] }, { now: () => NOW }))
    expect(await confidence('vendor.wise')).toBe(0.85)
    await as((ctx) => setMemberAttributes(ctx, { userId: 'u-dana', login: 'dana', attributes: { role: 'engineer' }, actor: 'user:owner' }))
    expect(await confidence('vendor.wise')).toBe(0.5)
    await as((ctx) => setMemberAttributes(ctx, { userId: 'u-dana', login: 'dana', attributes: { role: 'lead' }, actor: 'user:owner' }))
  })

  it('counts a person cited second-hand as the writer until they confirm, and asks them to', async () => {
    const result = await as((ctx) =>
      writeResource(
        ctx,
        writer('tom'),
        { id: 'vendor.klarna', type: 'vendor', title: 'Klarna', evidence: [{ source: 'person', sourceRef: 'dana', note: 'Dana said so.' }] },
        { now: () => NOW },
      ),
    )
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'confirm-requested' }))
    expect(await confidence('vendor.klarna')).toBe(0.4)
  })

  it('takes what GitHub says about a connected repository, never what a writer claims', async () => {
    await as((ctx) =>
      writeResource(
        ctx,
        writer('dana'),
        {
          id: 'vendor.adyen',
          type: 'vendor',
          title: 'Adyen',
          evidence: [{ source: 'github', repository: 'https://github.com/arcadia/payments', attributes: { branch_protected: true } }],
        },
        { now: () => NOW },
      ),
    )
    // The claim is ignored: nothing attests branch protection yet. 1 - 0.6 x 0.3 = 0.82.
    expect(await confidence('vendor.adyen')).toBe(0.82)
    expect(await as((ctx) => recordRepositoryAttributes(ctx, connectionId, { visibility: 'private', branchProtected: true }))).toBe(true)
    // Now the connection attests it: GitHub is worth 0.8. 1 - 0.6 x 0.2 = 0.88.
    expect(await confidence('vendor.adyen')).toBe(0.88)
    // A sync that learns nothing keeps what an earlier one read.
    expect(await as((ctx) => recordRepositoryAttributes(ctx, connectionId, { visibility: null, branchProtected: null }))).toBe(false)
    expect((await as((ctx) => orgTrust(ctx))).repositories).toEqual([{ fullName: 'Arcadia/Payments', attributes: { visibility: 'private', branch_protected: true } }])
  })

  it('takes what the registry says about a document, and drops it when it is unregistered', async () => {
    await as((ctx) =>
      writeResource(
        ctx,
        writer('dana'),
        { id: 'vendor.wise', type: 'vendor', title: 'Wise', evidence: [{ source: 'document', locator: { url: 'notion://vendor-review' }, attributes: { status: 'verified' } }] },
        { now: () => NOW },
      ),
    )
    // Claimed `verified` counts for nothing: 1 - 0.15 x 0.6 = 0.91.
    expect(await confidence('vendor.wise')).toBe(0.91)
    await as((ctx) => registerSource(ctx, { source: 'document', instance: 'notion://vendor-review', attributes: { status: 'verified' }, actor: 'user:owner' }))
    // 1 - 0.15 x 0.1 = 0.985, rounded.
    expect(await confidence('vendor.wise')).toBe(0.99)
    await as((ctx) => unregisterSource(ctx, { source: 'document', instance: 'notion://vendor-review' }))
    expect(await confidence('vendor.wise')).toBe(0.91)
  })

  it('keeps the cached read of a workspace in step with what the org attests', async () => {
    const before = (await as((ctx) => readWorkspace(ctx, workspaceId))).entities.find((entity) => entity.id === 'vendor.wise')?.confidence
    await as((ctx) => registerSource(ctx, { source: 'document', instance: 'notion://vendor-review', attributes: { status: 'verified' }, actor: 'user:owner' }))
    const after = (await as((ctx) => readWorkspace(ctx, workspaceId))).entities.find((entity) => entity.id === 'vendor.wise')?.confidence
    expect([before, after]).toEqual([0.91, 0.99])
    await as((ctx) => unregisterSource(ctx, { source: 'document', instance: 'notion://vendor-review' }))
  })
})

describe.skipIf(!TEST_PG_URL)('supersede proposals', () => {
  let org: TestOrg
  let workspaceId: string
  const writer = (principal: string): Writer => ({ workspaceId, actor: `user:${principal}`, label: `${principal} (web)`, channel: 'ui', requestId: `req-${principal}`, principal })
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.withOrg(fn)
  const propose = (by: string, principal = 'tom') =>
    as((ctx) =>
      supersedeResource(
        ctx,
        writer(principal),
        { id: 'decision.fraud-in-house', by, reason: 'Fraud checks moved to Radar.', evidence: [{ note: 'Heard at the review.' }] },
        { now: () => NOW },
      ),
    )

  beforeAll(async () => {
    org = await createTestOrg()
    workspaceId = await as(async (ctx) => {
      const workspace = await insertWorkspace(ctx.tx, { name: 'Payments', slug: 'payments', createdBy: org.userId })
      await ctx.tx.query(
        `INSERT INTO ontology_versions (workspace_id, number, status, yaml, yaml_hash, source, author, published_at, published_by)
         VALUES ($1, 1, 'published', $2, $3, 'import', $4, now(), $4)`,
        [workspace.id, ONTOLOGY, hashContent(ONTOLOGY), org.userId],
      )
      return workspace.id
    })
    await as((ctx) => setMemberAttributes(ctx, { userId: 'u-dana', login: 'dana', attributes: { role: 'lead' }, actor: 'user:owner' }))
    await as((ctx) => setMemberAttributes(ctx, { userId: 'u-tom', login: 'tom', attributes: { role: 'intern', flags: ['new-starter'] }, actor: 'user:owner' }))
    for (const [id, title] of [
      ['decision.fraud-in-house', 'Fraud checks in house'],
      ['decision.fraud-on-radar', 'Fraud checks on Radar'],
      ['decision.fraud-on-sift', 'Fraud checks on Sift'],
    ]) {
      await as((ctx) => writeResource(ctx, writer('dana'), { id: id as string, type: 'decision', title: title as string, evidence: [{ note: 'Recorded.' }] }, { now: () => NOW }))
    }
  })
  afterAll(() => org?.drop())

  it('records a proposal at once and leaves it pending under its bar, the older record current', async () => {
    const result = await propose('decision.fraud-on-radar')
    expect(result.changed).toBe(true)
    // An intern who is a new starter: 0.4, under the 0.80 a decision needs.
    expect(result.proposal).toEqual(expect.objectContaining({ status: 'pending', score: 0.4, threshold: 0.8 }))
    expect(result.proposal?.carry).toContainEqual(expect.objectContaining({ policy: 'A lead said so', reaches: expect.any(Number) }))
    expect(await as((ctx) => liveSupersessions(ctx, workspaceId))).toEqual([])
    expect((await as((ctx) => snapshotProposals(ctx, workspaceId))).map((each) => each.status)).toEqual(['pending'])
  })

  it('carries a pending proposal over its bar with more evidence, given by a prefix of its id', async () => {
    const [pending] = await as((ctx) => listProposals(ctx, workspaceId, { status: 'pending' }))
    const added = await as((ctx) =>
      addProposalEvidence(ctx, writer('tom'), { supersession: pending?.supersession.id.slice(0, 8) ?? '', evidence: [{ source: 'github', repository: 'arcadia/payments' }] }),
    )
    // GitHub (0.7) and Tom (0.4): 1 - 0.3 x 0.6 = 0.82 - over the bar.
    expect(added.proposal).toEqual(expect.objectContaining({ status: 'accepted', score: 0.82 }))
    expect((await as((ctx) => liveSupersessions(ctx, workspaceId))).map((each) => [each.resourceId, each.supersededBy, each.decidedBy])).toEqual([
      ['decision.fraud-in-house', 'decision.fraud-on-radar', 'score'],
    ])
  })

  it('lets a lead confirm a pending proposal into fact, scored as their own first-hand evidence', async () => {
    const proposed = await propose('decision.fraud-on-sift')
    // Radar is fact; this one waits beside it until something carries it.
    expect(proposed.proposal?.status).toBe('pending')
    const confirmed = await as((ctx) => confirmProposal(ctx, writer('dana'), { supersession: proposed.proposal?.id ?? '' }))
    // Dana, a lead (0.85), and Tom (0.4): 1 - 0.15 x 0.6 = 0.91.
    expect(confirmed.proposal).toEqual(expect.objectContaining({ status: 'accepted', score: 0.91 }))
    expect((await as((ctx) => liveSupersessions(ctx, workspaceId))).map((each) => each.supersededBy)).toEqual(['decision.fraud-on-sift'])
    // Radar's is lifted, kept in the history.
    expect((await as((ctx) => listProposals(ctx, workspaceId))).map((each) => each.supersession.supersededBy)).not.toContain('decision.fraud-on-radar')
  })

  it('rejects, and accepts regardless, only a pending proposal - with why', async () => {
    await as((ctx) => writeResource(ctx, writer('dana'), { id: 'vendor.adyen', type: 'vendor', title: 'Adyen', evidence: [{ note: 'Recorded.' }] }, { now: () => NOW }))
    await as((ctx) => writeResource(ctx, writer('dana'), { id: 'vendor.adyen-v2', type: 'vendor', title: 'Adyen v2', evidence: [{ note: 'Recorded.' }] }, { now: () => NOW }))
    await as((ctx) => writeResource(ctx, writer('dana'), { id: 'vendor.stripe', type: 'vendor', title: 'Stripe', evidence: [{ note: 'Recorded.' }] }, { now: () => NOW }))
    const proposal = (by: string) =>
      as((ctx) => supersedeResource(ctx, writer('tom'), { id: 'vendor.adyen', by, reason: 'Moved.', evidence: [{ note: 'Heard.' }] }, { now: () => NOW }))
    const first = await proposal('vendor.adyen-v2')
    expect(first.proposal?.status).toBe('pending')
    expect((await as((ctx) => rejectProposal(ctx, writer('dana'), { supersession: first.proposal?.id ?? '', reason: ' ' }))).diagnostics.map((d) => d.code)).toEqual([
      'missing-reason',
    ])
    const rejected = await as((ctx) => rejectProposal(ctx, writer('dana'), { supersession: first.proposal?.id ?? '', reason: 'Not what happened.' }))
    expect(rejected.proposal?.status).toBe('rejected')
    expect((await as((ctx) => confirmProposal(ctx, writer('dana'), { supersession: first.proposal?.id ?? '' }))).diagnostics.map((d) => d.code)).toEqual([
      'rejected-proposal',
    ])
    const second = await proposal('vendor.stripe')
    const accepted = await as((ctx) => overrideProposal(ctx, writer('dana'), { supersession: second.proposal?.id ?? '', reason: 'The contract says so.' }))
    expect(accepted.proposal).toEqual(expect.objectContaining({ status: 'accepted', score: 0.4 }))
    const listed = (await as((ctx) => listProposals(ctx, workspaceId, { status: 'accepted' }))).find((each) => each.supersession.resourceId === 'vendor.adyen')
    expect(listed?.supersession).toEqual(expect.objectContaining({ resourceId: 'vendor.adyen', decidedBy: 'override:dana', override: 'The contract says so.' }))
    const [gone] = await as((ctx) => listProposals(ctx, workspaceId, { status: 'rejected' }))
    expect(gone?.supersession).toEqual(expect.objectContaining({ rejection: 'Not what happened.', decidedBy: 'dana' }))
  })

  it('flags a pending proposal stale after 30 days, and a recent one not, dropping neither', async () => {
    await as((ctx) => writeResource(ctx, writer('dana'), { id: 'vendor.monzo', type: 'vendor', title: 'Monzo', evidence: [{ note: 'Recorded.' }] }, { now: () => NOW }))
    await as((ctx) => writeResource(ctx, writer('dana'), { id: 'vendor.monzo-business', type: 'vendor', title: 'Monzo Business', evidence: [{ note: 'Recorded.' }] }, { now: () => NOW }))
    await as((ctx) => writeResource(ctx, writer('dana'), { id: 'vendor.starling', type: 'vendor', title: 'Starling', evidence: [{ note: 'Recorded.' }] }, { now: () => NOW }))
    await as((ctx) => writeResource(ctx, writer('dana'), { id: 'vendor.starling-business', type: 'vendor', title: 'Starling Business', evidence: [{ note: 'Recorded.' }] }, { now: () => NOW }))

    const THIRTY_ONE_DAYS_AGO = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000)
    const ONE_DAY_AGO = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000)

    const old = await as((ctx) =>
      supersedeResource(ctx, writer('tom'), { id: 'vendor.monzo', by: 'vendor.monzo-business', reason: 'Renamed.', evidence: [{ note: 'Heard.' }] }, { now: () => THIRTY_ONE_DAYS_AGO }),
    )
    // An intern who is a new starter: 0.4, under the 0.75 a vendor needs - left pending.
    expect(old.proposal?.status).toBe('pending')
    const recent = await as((ctx) =>
      supersedeResource(ctx, writer('tom'), { id: 'vendor.starling', by: 'vendor.starling-business', reason: 'Renamed.', evidence: [{ note: 'Heard.' }] }, { now: () => ONE_DAY_AGO }),
    )
    expect(recent.proposal?.status).toBe('pending')

    const listed = await as((ctx) => listProposals(ctx, workspaceId, { status: 'pending', now: NOW }))
    expect(listed.find((each) => each.supersession.resourceId === 'vendor.monzo')?.stale).toBe(true)
    expect(listed.find((each) => each.supersession.resourceId === 'vendor.starling')?.stale).toBe(false)

    const open = await as((ctx) => openProposals(ctx, workspaceId, NOW))
    expect(open.find((each) => each.id === 'vendor.monzo')?.stale).toBe(true)
    expect(open.find((each) => each.id === 'vendor.starling')?.stale).toBe(false)

    // Leaves none of tom's pending proposals behind for a later role change to sweep up.
    await as((ctx) => rejectProposal(ctx, writer('dana'), { supersession: old.proposal?.id ?? '', reason: 'Test cleanup.' }))
    await as((ctx) => rejectProposal(ctx, writer('dana'), { supersession: recent.proposal?.id ?? '', reason: 'Test cleanup.' }))
  })

  it('keeps an accepted proposal accepted when the org attests less, though it would no longer pass', async () => {
    await as((ctx) => writeResource(ctx, writer('dana'), { id: 'vendor.revolut', type: 'vendor', title: 'Revolut', evidence: [{ note: 'Recorded.' }] }, { now: () => NOW }))
    await as((ctx) => writeResource(ctx, writer('dana'), { id: 'vendor.revolut-business', type: 'vendor', title: 'Revolut Business', evidence: [{ note: 'Recorded.' }] }, { now: () => NOW }))
    const proposed = await as((ctx) =>
      supersedeResource(ctx, writer('dana'), { id: 'vendor.revolut', by: 'vendor.revolut-business', reason: 'Renamed.', evidence: [{ note: 'Heard.' }] }, { now: () => NOW }),
    )
    // Dana, a lead: 0.85, clears the 0.75 bar at once.
    expect(proposed.proposal).toEqual(expect.objectContaining({ status: 'accepted', score: 0.85 }))

    await as((ctx) => setMemberAttributes(ctx, { userId: 'u-dana', login: 'dana', attributes: { role: 'engineer' }, actor: 'user:owner' }))
    await as((ctx) => attestationsChanged(ctx))

    // Sticky: acceptance is never reverted by a later attestation change.
    expect((await as((ctx) => liveSupersessions(ctx, workspaceId))).find((each) => each.resourceId === 'vendor.revolut')?.supersededBy).toBe('vendor.revolut-business')
    const listed = (await as((ctx) => listProposals(ctx, workspaceId, { status: 'accepted' }))).find((each) => each.supersession.resourceId === 'vendor.revolut')
    expect(listed?.supersession.status).toBe('accepted')

    // Scored fresh against what the org attests now, it would no longer pass.
    const revolut = (await as((ctx) => snapshotProposals(ctx, workspaceId))).find((each) => each.resource === 'vendor.revolut')
    const model = await as((ctx) => proposalModel(ctx, workspaceId))
    const type = await as((ctx) => describeResource(ctx, workspaceId, 'vendor.revolut'))
    expect(revolut?.status).toBe('accepted')
    expect(scoreProposal(model, type?.type, revolut?.evidence ?? []).clears).toBe(false)

    await as((ctx) => setMemberAttributes(ctx, { userId: 'u-dana', login: 'dana', attributes: { role: 'lead' }, actor: 'user:owner' }))
  })

  it('accepts a pending proposal once a change to what the org attests carries it', async () => {
    await as((ctx) => writeResource(ctx, writer('dana'), { id: 'vendor.wise', type: 'vendor', title: 'Wise', evidence: [{ note: 'Recorded.' }] }, { now: () => NOW }))
    await as((ctx) => writeResource(ctx, writer('dana'), { id: 'vendor.wise-business', type: 'vendor', title: 'Wise Business', evidence: [{ note: 'Recorded.' }] }, { now: () => NOW }))
    const pending = await as((ctx) =>
      supersedeResource(ctx, writer('tom'), { id: 'vendor.wise', by: 'vendor.wise-business', reason: 'Renamed.', evidence: [{ note: 'Heard.' }] }, { now: () => NOW }),
    )
    expect(pending.proposal?.status).toBe('pending')
    // Tom is made a lead: his word now clears the bar on its own.
    await as((ctx) => setMemberAttributes(ctx, { userId: 'u-tom', login: 'tom', attributes: { role: 'lead' }, actor: 'user:owner' }))
    const promoted = await as((ctx) => attestationsChanged(ctx))
    expect(promoted.map((each) => [each.resourceId, each.status, each.decidedBy])).toEqual([['vendor.wise', 'accepted', 'score']])
    const outbox = await as((ctx) => ctx.tx.query<{ kind: string }>("SELECT kind FROM outbox WHERE workspace_id = $1 AND kind = 'trust'", [workspaceId]))
    expect(outbox.rows.length).toBeGreaterThan(0)
  })
})
