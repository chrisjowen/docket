// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatMessage } from '@docket/platform-ai'
import { listIngests, listProposals, liveSupersessions, workspaceById, workspaceGraph, writeResource, type RememberInput, type Writer } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { saveSettings } from '@docket/platform-enrichment'
import { createWorkspace } from '@docket/platform-ontology-service'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runConsolidation, type RunOutcome, type Summarizer } from './run.js'
import { CONSOLIDATION_EVERY_MS, contradictionChecks, dueWorkspaces, recentRuns, startRun } from './runs.js'

const ONTOLOGY = `version: 1
resourceTypes:
  person:
    description: A person.
  agent:
    description: A bot or assistant someone runs.
relationships:
  runs:
    from: [person]
    to: [agent]
evidence:
  unevidenced: 0.5
  sources:
    conversation:
      description: Said in a conversation with an agent.
      confidence: 0.8
    inferred:
      description: Inferred by Docket Cloud.
      confidence: 0.8
`

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

describe.skipIf(!TEST_PG_URL)('consolidation supersedes records gone out of date', () => {
  let org: TestOrg
  let workspaceId: string
  let writer: Writer
  let clock = new Date('2026-11-12T09:00:00.000Z')
  const schedule = () => ({ now: clock, everyMs: CONSOLIDATION_EVERY_MS })
  const prompts: string[] = []

  const agent = (id: string, title: string, body: string, observedAt: string): RememberInput => ({
    id,
    type: 'agent',
    title,
    body,
    evidence: [{ source: 'conversation', observedAt, note: `${title}, as the chris-muse workspace was told.` }],
  })
  const remember = (input: RememberInput) => org.withOrg((ctx) => writeResource(ctx, writer, input, { now: () => clock }))
  const runsFor = (ids: string[]) =>
    remember({
      id: 'person.chris',
      type: 'person',
      title: 'Chris',
      body: 'Chris runs a Muse bot in the chris-muse workspace.',
      evidence: [{ source: 'conversation', observedAt: '2026-08-01' }],
      links: ids.map((target) => ({ rel: 'runs', target, evidence: [{ source: 'conversation', observedAt: '2026-08-01' }] })),
    })

  /** Four hours on, a scheduled run starts, with no enrichment run before it. */
  const run = async (summarizer: Summarizer | null): Promise<RunOutcome> => {
    clock = new Date(clock.getTime() + CONSOLIDATION_EVERY_MS)
    const started = await org.withOrg(async (ctx) => {
      expect(await dueWorkspaces(ctx.tx, schedule())).toEqual([workspaceId])
      return startRun(ctx.tx, workspaceId, clock, schedule())
    })
    if (!started) throw new Error('no consolidation run started')
    expect(started.enrichmentRunId).toBeNull()
    return runConsolidation({ withOrg: (fn) => org.withOrg(fn), summarizer, embed, now: () => clock }, { id: started.id, orgId: org.orgId, workspaceId })
  }
  const scripted = (verdict: (prompt: string) => string): Summarizer => ({
    beforeCall: async () => {},
    model: {
      async chat(messages: ChatMessage[]) {
        const prompt = messages.map((message) => message.content).join('\n')
        prompts.push(prompt)
        return {
          text: prompt.includes('OLDER: ') ? verdict(prompt) : 'Chris runs a Muse bot in the chris-muse workspace, and has renamed it once since it started answering.',
          model: 'test/cheap-model',
        }
      },
    },
  })
  const graph = () =>
    org.withOrg(async (ctx) => {
      const workspace = await workspaceById(ctx.tx, workspaceId)
      if (!workspace) throw new Error('no workspace')
      return workspaceGraph(ctx, workspace, { root: '.' })
    })

  beforeAll(async () => {
    org = await createTestOrg()
    workspaceId = await org.withOrg(async (ctx) => {
      const { workspace } = await createWorkspace(ctx, {
        name: 'Chris Muse',
        slug: 'chris-muse',
        start: { importYaml: ONTOLOGY },
        publisher: { actor: `user:${org.userId}`, login: org.login },
      })
      await saveSettings(ctx.tx, workspace.id, { enabled: true, schedule: 'nightly', monthlyLimitUsd: 2, capUsd: 20, by: `user:${org.userId}`, now: clock })
      return workspace.id
    })
    writer = { workspaceId, actor: 'token:dkt_live_muse', label: 'muse (token tok_muse…)', channel: 'mcp', requestId: 'req-muse' }
    await remember(agent('agent.sophia', 'Sophia', "Sophia is Chris's Muse bot, answering in the chris-muse workspace.", '2026-09-01'))
    await remember(agent('agent.captin', 'Captin', "Captin is Chris's Muse bot. It was renamed from Sophia on 2026-11-01.", '2026-11-01'))
    await runsFor(['agent.sophia', 'agent.captin'])
  })
  afterAll(() => org?.drop())

  it('runs every four hours on its own schedule, and not again until four hours have passed', async () => {
    const outcome = await run(null)
    expect(outcome.status).toBe('ok')
    await org.withOrg(async (ctx) => {
      expect(await dueWorkspaces(ctx.tx, schedule())).toEqual([])
      expect(await startRun(ctx.tx, workspaceId, clock, schedule())).toBeNull()
      expect(await dueWorkspaces(ctx.tx, { now: new Date(clock.getTime() + CONSOLIDATION_EVERY_MS - 60_000), everyMs: CONSOLIDATION_EVERY_MS })).toEqual([])
      expect(await dueWorkspaces(ctx.tx, { now: new Date(clock.getTime() + CONSOLIDATION_EVERY_MS + 60_000), everyMs: CONSOLIDATION_EVERY_MS })).toEqual([workspaceId])
    })
  })

  it('supersedes Sophia with Captin, which says it was renamed from her, even with AI off - keeping Sophia on file', async () => {
    const [last] = await org.withOrg((ctx) => recentRuns(ctx.tx, workspaceId, 1))
    expect(last?.summary).toEqual(expect.objectContaining({ aiStopped: 'off', contradictions: { checked: 1, superseded: 1, proposed: 0 } }))

    const [renamed, ...others] = await org.withOrg((ctx) => liveSupersessions(ctx, workspaceId))
    expect(others).toEqual([])
    expect(renamed).toEqual(
      expect.objectContaining({
        resourceId: 'agent.sophia',
        supersededBy: 'agent.captin',
        validUntil: new Date('2026-11-01T00:00:00.000Z'),
        source: 'consolidation',
        runId: last?.id,
        reason: `"Captin" (agent.captin) says it replaces "Sophia": "It was renamed from Sophia on 2026-11-01."`,
        evidence: [expect.objectContaining({ source: 'inferred', path: expect.stringContaining('captin'), observedBy: 'docket-cloud consolidation' })],
      }),
    )
    const sophia = (await graph()).entities.find((entity) => entity.id === 'agent.sophia')
    expect(sophia?.frontmatter).toEqual(expect.objectContaining({ superseded_by: 'agent.captin', superseded_until: '2026-11-01', superseded_source: 'consolidation' }))
    const [event] = await org.withOrg((ctx) => listIngests(ctx, { workspaceId, limit: 1 }))
    expect(event).toEqual(expect.objectContaining({ channel: 'enrichment', action: 'supersede', actor: 'system:consolidation' }))
  })

  it('asks the AI about two records that only look alike, supersedes only on a clear verdict, and never asks about the same pair twice', async () => {
    await remember(agent('agent.helper', 'Helper', "Helper is Chris's Muse bot, answering in the chris-muse workspace about Docket.", '2026-10-01'))
    await remember(agent('agent.aide', 'Aide', "Aide is Chris's Muse bot, answering in the chris-muse workspace about Docket.", '2026-10-20'))
    await runsFor(['agent.sophia', 'agent.captin', 'agent.helper', 'agent.aide'])
    prompts.length = 0

    const outcome = await run(scripted(() => '{"verdict": "distinct", "reason": "Two bots that answer in the same workspace."}'))
    expect(outcome.summary?.contradictions).toEqual({ checked: 1, superseded: 0, proposed: 0 })
    const asked = prompts.filter((prompt) => prompt.includes('OLDER: '))
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('OLDER: agent.helper (agent) "Helper", first recorded 2026-10-01')
    expect(asked[0]).toContain('NEWER: agent.aide (agent) "Aide", first recorded 2026-10-20')
    // Sophia is out of date: she is not summarized, and not asked about again.
    expect(prompts.some((prompt) => prompt.startsWith('Entity: agent.sophia '))).toBe(false)
    expect(await org.withOrg((ctx) => contradictionChecks(ctx.tx, workspaceId))).toEqual(
      new Map([
        ['agent.sophia\u0000agent.captin', expect.any(String)],
        ['agent.helper\u0000agent.aide', expect.any(String)],
      ]),
    )
    expect((await org.withOrg((ctx) => liveSupersessions(ctx, workspaceId))).map((each) => each.resourceId)).toEqual(['agent.sophia'])

    prompts.length = 0
    const again = await run(scripted(() => '{"verdict": "supersedes", "reason": "Aide replaced Helper."}'))
    expect(again.summary?.contradictions).toEqual({ checked: 0, superseded: 0, proposed: 0 })
    expect(prompts.filter((prompt) => prompt.includes('OLDER: '))).toEqual([])
  })

  it('asks again once either record changes, and supersedes on a clear verdict, with its reason', async () => {
    await remember({
      ...agent('agent.aide', 'Aide', "Aide is Chris's Muse bot, answering in the chris-muse workspace about Docket.", '2026-10-20'),
      evidence: [{ source: 'conversation', observedAt: '2026-11-10', note: 'Chris says Aide does what Helper used to.' }],
    })
    const outcome = await run(scripted(() => '{"verdict": "supersedes", "reason": "Aide took over Helper\'s role as the Muse bot."}'))
    expect(outcome.summary?.contradictions).toEqual({ checked: 1, superseded: 1, proposed: 0 })
    const live = await org.withOrg((ctx) => liveSupersessions(ctx, workspaceId))
    expect(live.find((each) => each.resourceId === 'agent.helper')).toEqual(
      expect.objectContaining({ supersededBy: 'agent.aide', reason: "Aide took over Helper's role as the Muse bot.", validUntil: new Date('2026-10-20T00:00:00.000Z') }),
    )
  })

  it('never supersedes on "took over from" or "replaced" alone with AI off, and leaves those pairs for the AI', async () => {
    await remember({ id: 'person.bob', type: 'person', title: 'Bob', body: 'Bob is an engineer.', evidence: [{ source: 'conversation', observedAt: '2026-09-01' }] })
    await remember({
      id: 'person.alice',
      type: 'person',
      title: 'Alice',
      body: 'Alice took over from Bob as on-call lead.',
      evidence: [{ source: 'conversation', observedAt: '2026-10-01' }],
    })
    await remember(agent('agent.legacy-checkout', 'Legacy Checkout', 'Legacy Checkout took orders.', '2026-09-01'))
    await remember(agent('agent.billing', 'Billing', 'Last year Orders replaced Legacy Checkout.', '2026-10-01'))
    const before = (await org.withOrg((ctx) => liveSupersessions(ctx, workspaceId))).map((each) => each.resourceId).sort()

    const outcome = await run(null)
    expect(outcome.summary?.contradictions).toEqual({ checked: 0, superseded: 0, proposed: 0 })
    expect((await org.withOrg((ctx) => liveSupersessions(ctx, workspaceId))).map((each) => each.resourceId).sort()).toEqual(before)
    const checks = await org.withOrg((ctx) => contradictionChecks(ctx.tx, workspaceId))
    expect(checks.has('person.bob\u0000person.alice')).toBe(false)
    expect(checks.has('agent.legacy-checkout\u0000agent.billing')).toBe(false)

    prompts.length = 0
    await run(scripted(() => '{"verdict": "distinct", "reason": "Both are still current."}'))
    const asked = prompts.filter((prompt) => prompt.includes('OLDER: '))
    expect(asked.some((prompt) => prompt.includes('OLDER: person.bob ') && prompt.includes('NEWER: person.alice '))).toBe(true)
    expect(asked.some((prompt) => prompt.includes('OLDER: agent.legacy-checkout ') && prompt.includes('NEWER: agent.billing '))).toBe(true)
    expect((await org.withOrg((ctx) => liveSupersessions(ctx, workspaceId))).map((each) => each.resourceId).sort()).toEqual(before)
  })
})

describe.skipIf(!TEST_PG_URL)('consolidation proposes what its inference alone does not carry', () => {
  let org: TestOrg
  let workspaceId: string
  const clock = new Date('2026-11-12T09:00:00.000Z')

  beforeAll(async () => {
    org = await createTestOrg()
    // Inferred evidence is worth 0.5 here, under the 0.75 a supersede proposal needs.
    workspaceId = await org.withOrg(async (ctx) => {
      const { workspace } = await createWorkspace(ctx, {
        name: 'Chris Muse',
        slug: 'chris-muse',
        start: { importYaml: ONTOLOGY.replace('Inferred by Docket Cloud.\n      confidence: 0.8', 'Inferred by Docket Cloud.\n      confidence: 0.5') },
        publisher: { actor: `user:${org.userId}`, login: org.login },
      })
      await saveSettings(ctx.tx, workspace.id, { enabled: true, schedule: 'nightly', monthlyLimitUsd: 2, capUsd: 20, by: `user:${org.userId}`, now: clock })
      return workspace.id
    })
    const writer: Writer = { workspaceId, actor: 'token:dkt_live_muse', label: 'muse (token tok_muse…)', channel: 'mcp', requestId: 'req-muse' }
    for (const [id, title, body, observedAt] of [
      ['agent.sophia', 'Sophia', "Sophia is Chris's Muse bot.", '2026-09-01'],
      ['agent.captin', 'Captin', "Captin is Chris's Muse bot. It was renamed from Sophia on 2026-11-01.", '2026-11-01'],
    ] as const) {
      await org.withOrg((ctx) =>
        writeResource(ctx, writer, { id, type: 'agent', title, body, evidence: [{ source: 'conversation', observedAt }] }, { now: () => clock }),
      )
    }
  })
  afterAll(() => org?.drop())

  it('files the rename as a pending proposal: Sophia stays current until something carries it', async () => {
    const at = new Date(clock.getTime() + CONSOLIDATION_EVERY_MS)
    const started = await org.withOrg((ctx) => startRun(ctx.tx, workspaceId, at, { now: at, everyMs: CONSOLIDATION_EVERY_MS }))
    if (!started) throw new Error('no consolidation run started')
    const outcome = await runConsolidation({ withOrg: (fn) => org.withOrg(fn), summarizer: null, embed, now: () => at }, { id: started.id, orgId: org.orgId, workspaceId })
    expect(outcome.summary?.contradictions).toEqual({ checked: 1, superseded: 0, proposed: 1 })
    expect(await org.withOrg((ctx) => liveSupersessions(ctx, workspaceId))).toEqual([])
    const [proposal, ...none] = await org.withOrg((ctx) => listProposals(ctx, workspaceId))
    expect(none).toEqual([])
    expect(proposal).toEqual(
      expect.objectContaining({
        score: 0.5,
        threshold: 0.75,
        supersession: expect.objectContaining({ resourceId: 'agent.sophia', supersededBy: 'agent.captin', status: 'pending', source: 'consolidation' }),
      }),
    )
    // One more observation from a conversation (0.8 here) would carry it.
    expect(proposal?.carry).toContainEqual(expect.objectContaining({ source: 'conversation' }))
  })
})
