// SPDX-License-Identifier: AGPL-3.0-only
import { AiCapReached } from '@docket/platform-ai'
import {
  listDocuments,
  listIngests,
  parseOntology,
  postgresSource,
  putDocument,
  readDocument,
  retireDocument,
  validate,
  writeResource,
} from '@docket/platform-canonical-store'
import { createTestOrg, readFixture, type Fixture, type TestOrg } from '@docket/platform-canonical-store/testing'
import { createWorkspace, headOf } from '@docket/platform-ontology-service'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { EnrichmentLimitReached, type Reviewer } from './judge.js'
import { ensureEnrichmentOntology } from './ontology.js'
import { inferredPath, retireRun, runEnrichment, type RunOutcome } from './run.js'
import { ENRICHMENT_LIMITS, finishRun, knownFingerprints, recentRuns, requestRun, saveSettings, startRun } from './settings.js'

const NOW = new Date('2026-11-05T09:00:00.000Z')
const total = (counts: Record<string, number> | undefined) => Object.values(counts ?? {}).reduce((sum, n) => sum + n, 0)

const CHECKOUT = `---
id: service.checkout
type: service
title: Checkout
attributes:
  tier: critical
links:
  - rel: owned_by
    target: team.commerce
---
Takes the basket and writes every charge to the Ledger database.
`
const PAYMENTS_V2 = `---
id: service.payments-v2
type: service
title: Payments
attributes:
  tier: standard
---
The new payments service.
`

async function setUp(org: TestOrg, fixture: Fixture, slug: string, ontology: string, extra: Record<string, string> = {}) {
  return org.withOrg(async (ctx) => {
    const { workspace } = await createWorkspace(ctx, {
      name: slug,
      slug,
      start: { importYaml: ontology },
      publisher: { actor: `user:${org.userId}`, login: org.login },
    })
    for (const document of fixture.documents) {
      await putDocument(ctx, { workspaceId: workspace.id, ...document, origin: 'repo', originRef: 'conn1:.docket', actor: 'system:repo-sync' })
    }
    for (const [path, raw] of Object.entries(extra)) await putDocument(ctx, { workspaceId: workspace.id, path, raw, origin: 'cloud', actor: `user:${org.userId}` })
    return workspace.id
  })
}

describe.skipIf(!TEST_PG_URL)('runEnrichment', () => {
  let org: TestOrg
  let fixture: Fixture
  let workspaceId: string

  const run = async (deps: { reviewer?: Reviewer | null; spent?: () => Promise<number> } = {}, ws = workspaceId): Promise<RunOutcome> => {
    const started = await org.withOrg(async (ctx) => {
      await requestRun(ctx.tx, ws, `user:${org.userId}`, NOW)
      return startRun(ctx.tx, ws, NOW)
    })
    if (!started) throw new Error('no run started')
    return runEnrichment({ withOrg: (fn) => org.withOrg(fn), now: () => NOW, ...deps }, { id: started.id, orgId: org.orgId, workspaceId: ws })
  }
  const entities = (ws = workspaceId) => org.withOrg(async (ctx) => (await validate({ source: postgresSource(ctx, ws) })).entities)
  const enable = (ws = workspaceId) =>
    org.withOrg((ctx) => saveSettings(ctx.tx, ws, { enabled: true, schedule: 'nightly', monthlyLimitUsd: 2, capUsd: 20, by: `user:${org.userId}`, now: NOW }))

  beforeAll(async () => {
    org = await createTestOrg()
    fixture = await readFixture()
    workspaceId = await setUp(org, fixture, 'platform', fixture.ontology, {
      '.docket/resources/service/checkout.md': CHECKOUT,
      '.docket/resources/service/payments-v2.md': PAYMENTS_V2,
    })
    await enable()
  })
  afterAll(() => org?.drop())

  it('fails, writing nothing, while the ontology does not register the inferred source', async () => {
    const outcome = await run()
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toMatch(/inferred evidence source/)
    const documents = await org.withOrg((ctx) => listDocuments(ctx.tx, workspaceId))
    expect(documents.some((document) => document.path.startsWith('.docket/~inferred/'))).toBe(false)
  })

  it('adds the inferred source and the duplicate_of and contradicts relationships as one safe version, once', async () => {
    const publisher = { actor: `user:${org.userId}`, login: org.login }
    const added = await org.withOrg((ctx) => ensureEnrichmentOntology(ctx, workspaceId, publisher))
    expect(added).toEqual({ number: 2, added: ['the inferred evidence source', 'the duplicate_of relationship', 'the contradicts relationship'] })
    const head = await org.withOrg((ctx) => headOf(ctx.tx, workspaceId))
    const ontology = parseOntology(head?.yaml ?? '').ontology
    expect(ontology?.sources?.inferred).toBeDefined()
    expect(ontology?.trust?.policies).toContainEqual({ name: 'Inferred by enrichment', when: { source: 'inferred' }, score: 0.4 })
    expect(ontology?.sources?.code).toBeDefined()
    expect(await org.withOrg((ctx) => ensureEnrichmentOntology(ctx, workspaceId, publisher))).toBeNull()
  })

  it('writes the links, owners, duplicates and contradictions the documents imply, each in a document of its own', async () => {
    const outcome = await run()
    expect(outcome.status).toBe('ok')
    expect(outcome.summary?.written).toEqual({ link: 1, owner: 5, duplicate: 1, contradiction: 1 })
    // Only a team names payments-v2, so its owner is left to review, and AI is off here.
    expect(outcome.summary?.skipped.undecided).toBe(1)
    expect(outcome.summary?.aiStopped).toBe('off')

    const byId = new Map((await entities()).map((entity) => [entity.id, entity]))
    // The resource's own document stays its primary: the inferred one sorts after it.
    expect(byId.get('api.orders')?.path).toBe('.docket/resources/api/orders.md')
    expect(byId.get('api.orders')?.paths).toEqual(['.docket/resources/api/orders.md', '.docket/~inferred/api.orders/owner--owned_by--team.commerce.md'])
    const owner = byId.get('api.orders')?.links.find((link) => link.rel === 'owned_by')
    expect(owner?.target).toBe('team.commerce')
    expect(owner?.evidence[0]).toEqual(
      expect.objectContaining({ source: 'inferred', path: '.docket/resources/datasource/orders-db.md', symbol: 'datasource.orders-db', observedBy: 'docket-cloud enrichment' }),
    )
    expect(owner?.evidence[0]?.note).toMatch(/has no owner/)
    expect(byId.get('service.checkout')?.links.map((link) => `${link.rel} ${link.target}`)).toContain('depends_on datasource.ledger-db')
    expect(byId.get('service.payments-v2')?.links.map((link) => `${link.rel} ${link.target}`).sort()).toEqual([
      'contradicts service.payments',
      'duplicate_of service.payments',
    ])

    const raw = await org.withOrg((ctx) => readDocument(ctx, workspaceId, inferredPath({ kind: 'owner', from: 'api.orders', target: 'team.commerce' }, 'owned_by')))
    expect(raw?.origin).toBe('cloud')
    expect(raw?.raw).toContain('authority: inferred')
    expect(raw?.raw).toContain('capturedBy: docket-cloud enrichment')

    const events = await org.withOrg((ctx) => listIngests(ctx, { workspaceId, channel: 'enrichment', limit: 50 }))
    expect(events.length).toBe(8)
    expect(events.every((event) => event.action === 'infer' && event.outcome === 'ok' && event.actor === 'system:enrichment')).toBe(true)
    const audit = await org.withOrg((ctx) => ctx.tx.query("SELECT actor FROM audit_event WHERE action = 'enrichment.run' AND workspace_id = $1", [workspaceId]))
    expect(audit.rows).toContainEqual({ actor: 'system:enrichment' })
  })

  it('writes nothing again on the next run', async () => {
    const outcome = await run()
    expect(total(outcome.summary?.written)).toBe(0)
    // What the first run inferred is linked now; only payments-v2's owner is still open.
    expect(total(outcome.summary?.found)).toBe(1)
    expect(outcome.summary?.skipped.undecided).toBe(1)
  })

  it('never puts a person’s write in an inferred document', async () => {
    const result = await org.withOrg((ctx) =>
      writeResource(
        ctx,
        { workspaceId, actor: `user:${org.userId}`, label: org.login, channel: 'ui', requestId: 'req-person' },
        { id: 'api.orders', type: 'api', title: 'Orders API', evidence: [{ source: 'human', note: 'I know it' }] },
      ),
    )
    expect(result.path).toBe('.docket/resources/api/orders.cloud.md')
  })

  it('retires everything a run added at once, and no later run writes it back', async () => {
    const first = (await org.withOrg((ctx) => recentRuns(ctx.tx, workspaceId, 10))).find((entry) => entry.live > 0)
    if (!first) throw new Error('no first run')
    expect(first.live).toBe(8)
    const { retired } = await org.withOrg((ctx) =>
      retireRun(ctx, { workspaceId, runId: first.id, actor: `user:${org.userId}`, label: org.login, requestId: 'req-retire' }),
    )
    expect(retired).toBe(8)
    const documents = await org.withOrg((ctx) => listDocuments(ctx.tx, workspaceId))
    expect(documents.filter((document) => document.path.startsWith('.docket/~inferred/'))).toEqual([])
    const again = await run()
    expect(total(again.summary?.written)).toBe(0)
    const runs = await org.withOrg((ctx) => recentRuns(ctx.tx, workspaceId, 10))
    expect(runs.find((entry) => entry.id === first.id)?.retiredAt).not.toBeNull()
  })

  it('refuses to retire a run that is still writing, and retires it once it has finished', async () => {
    const ws = await setUp(org, fixture, 'retire-running', fixture.ontology)
    await enable(ws)
    const started = await org.withOrg(async (ctx) => {
      await requestRun(ctx.tx, ws, `user:${org.userId}`, NOW)
      return startRun(ctx.tx, ws, NOW)
    })
    if (!started) throw new Error('no run started')
    const retire = () =>
      org.withOrg((ctx) => retireRun(ctx, { workspaceId: ws, runId: started.id, actor: `user:${org.userId}`, label: org.login, requestId: 'req-retire-running' }))
    await expect(retire()).rejects.toThrow(/still writing/)
    expect((await org.withOrg((ctx) => recentRuns(ctx.tx, ws, 1)))[0]?.retiredAt).toBeNull()
    await org.withOrg((ctx) => finishRun(ctx.tx, started.id, { status: 'ok', at: NOW }))
    expect(await retire()).toEqual({ retired: 0 })
    expect((await org.withOrg((ctx) => recentRuns(ctx.tx, ws, 1)))[0]?.retiredAt).not.toBeNull()
  })

  it('retires an inference once its resource has no document of its own', async () => {
    const ws = await setUp(org, fixture, 'orphans', fixture.ontology)
    await org.withOrg((ctx) => ensureEnrichmentOntology(ctx, ws, { actor: `user:${org.userId}`, login: org.login }))
    await enable(ws)
    expect((await run({}, ws)).summary?.written.owner).toBeGreaterThan(0)
    await org.withOrg((ctx) => retireDocument(ctx.tx, { workspaceId: ws, path: '.docket/resources/datasource/ledger-db.md' }))
    const outcome = await run({}, ws)
    expect(outcome.summary?.orphansRetired).toBe(1)
    expect((await entities(ws)).some((entity) => entity.id === 'datasource.ledger-db')).toBe(false)
  })

  it('retires an inference once its target has no document of its own', async () => {
    const ws = await setUp(org, fixture, 'orphan-targets', fixture.ontology)
    await org.withOrg((ctx) => ensureEnrichmentOntology(ctx, ws, { actor: `user:${org.userId}`, login: org.login }))
    await enable(ws)
    await run({}, ws)
    const toDiscovery = async () =>
      (await org.withOrg((ctx) => listDocuments(ctx.tx, ws))).filter((document) => document.path.startsWith('.docket/~inferred/') && document.path.endsWith('--team.discovery.md'))
    const before = await toDiscovery()
    expect(before.length).toBeGreaterThan(0)
    await org.withOrg((ctx) => retireDocument(ctx.tx, { workspaceId: ws, path: '.docket/resources/team/discovery.md' }))
    const outcome = await run({}, ws)
    expect(outcome.summary?.orphansRetired).toBe(before.length)
    expect(await toDiscovery()).toEqual([])
  })
})

describe.skipIf(!TEST_PG_URL)('runEnrichment with AI review', () => {
  let org: TestOrg
  let fixture: Fixture

  // Teams that name the APIs they use, where the ontology has two relationships from a team to an API: the rules leave it to review.
  const TEAMS = {
    '.docket/resources/team/web.md': '---\nid: team.web\ntype: team\ntitle: Web\n---\nBuilds the storefront on the Orders API.\n',
    '.docket/resources/team/data.md': '---\nid: team.data\ntype: team\ntitle: Data\n---\nReads the Orders API nightly.\n',
  }

  const start = async (slug: string) => {
    const doc = parseDocument(fixture.ontology)
    doc.setIn(['relationships', 'calls'], doc.createNode({ from: ['team'], to: ['api'] }))
    doc.setIn(['relationships', 'maintains'], doc.createNode({ from: ['team'], to: ['api'] }))
    const ws = await setUp(org, fixture, slug, doc.toString(), TEAMS)
    await org.withOrg((ctx) => ensureEnrichmentOntology(ctx, ws, { actor: `user:${org.userId}`, login: org.login }))
    await org.withOrg((ctx) => saveSettings(ctx.tx, ws, { enabled: true, schedule: 'weekly', monthlyLimitUsd: 1, capUsd: 20, by: `user:${org.userId}`, now: NOW }))
    return ws
  }
  const run = async (ws: string, reviewer: Reviewer | null) => {
    const started = await org.withOrg(async (ctx) => {
      await requestRun(ctx.tx, ws, `user:${org.userId}`, NOW)
      return startRun(ctx.tx, ws, NOW)
    })
    if (!started) throw new Error('no run started')
    return runEnrichment({ withOrg: (fn) => org.withOrg(fn), reviewer, now: () => NOW }, { id: started.id, orgId: org.orgId, workspaceId: ws })
  }

  beforeAll(async () => {
    org = await createTestOrg()
    fixture = await readFixture()
  })
  afterAll(() => org?.drop())

  it('leaves open candidates alone when AI is off', async () => {
    const ws = await start('ai-off')
    const outcome = await run(ws, null)
    expect(outcome.summary?.aiStopped).toBe('off')
    expect(outcome.summary?.skipped.undecided).toBe(3)
    expect(outcome.summary?.written.link).toBe(0)
  })

  it('writes what review accepts with its reasoning, and records what it rejects so it is never asked again', async () => {
    const ws = await start('ai-on')
    const asked: string[] = []
    const reviewer: Reviewer = {
      beforeCall: async () => undefined,
      model: {
        async chat(messages) {
          const user = messages[1]?.content ?? ''
          asked.push(user)
          const verdicts = [...user.matchAll(/^(\d+)\. from (\S+)/gm)].map(([, n, from]) =>
            from === 'team.web'
              ? { n: Number(n), rel: 'calls', reasoning: 'Web builds on it, so it calls it.' }
              : { n: Number(n), rel: null, reasoning: 'Naming an API is not calling or maintaining it.' },
          )
          return JSON.stringify({ verdicts })
        },
      },
    }
    const outcome = await run(ws, reviewer)
    expect(outcome.summary).toEqual(expect.objectContaining({ aiCalls: 1, written: expect.objectContaining({ link: 1 }) }))
    expect(outcome.summary?.skipped.rejected).toBe(2)
    const web = (await org.withOrg(async (ctx) => (await validate({ source: postgresSource(ctx, ws) })).entities)).find((entity) => entity.id === 'team.web')
    const call = web?.links.find((link) => link.rel === 'calls')
    expect(call?.target).toBe('api.orders')
    expect(call?.evidence[0]?.note).toContain('Reviewed: Web builds on it, so it calls it.')
    const known = await org.withOrg((ctx) => knownFingerprints(ctx.tx, ws))
    expect(known.has('link|api.orders|team.data')).toBe(true)

    const again = await run(ws, reviewer)
    expect(again.summary?.aiCalls).toBe(0)
    expect(asked.length).toBe(1)
  })

  it('reviews only what the run could still write, and leaves the rest unreviewed and unrecorded for the next run', async () => {
    const squads = Object.fromEntries(
      Array.from({ length: ENRICHMENT_LIMITS.inferencesPerRun + 10 }, (_, i) => {
        const n = String(i).padStart(2, '0')
        return [`.docket/resources/team/squad-${n}.md`, `---\nid: team.squad-${n}\ntype: team\ntitle: Squad ${n}\n---\nBuilds on the Orders API.\n`]
      }),
    )
    const doc = parseDocument(fixture.ontology)
    doc.setIn(['relationships', 'calls'], doc.createNode({ from: ['team'], to: ['api'] }))
    doc.setIn(['relationships', 'maintains'], doc.createNode({ from: ['team'], to: ['api'] }))
    const ws = await setUp(org, fixture, 'ai-run-limit', doc.toString(), squads)
    await org.withOrg((ctx) => ensureEnrichmentOntology(ctx, ws, { actor: `user:${org.userId}`, login: org.login }))
    await org.withOrg((ctx) => saveSettings(ctx.tx, ws, { enabled: true, schedule: 'weekly', monthlyLimitUsd: 1, capUsd: 20, by: `user:${org.userId}`, now: NOW }))
    const asked: string[][] = []
    const reviewer: Reviewer = {
      beforeCall: async () => undefined,
      model: {
        async chat(messages) {
          const found = [...(messages[1]?.content ?? '').matchAll(/^(\d+)\. from (\S+)[\s\S]*?allowed: ([^,\n]+)/gm)]
          asked.push(found.map(([, , from]) => from as string))
          return JSON.stringify({ verdicts: found.map(([, n, , rel]) => ({ n: Number(n), rel, reasoning: 'It plainly does.' })) })
        },
      },
    }

    const first = await run(ws, reviewer)
    const reviewed = asked.flat()
    expect(total(first.summary?.written)).toBe(ENRICHMENT_LIMITS.inferencesPerRun)
    expect(reviewed.length).toBeGreaterThan(0)
    expect(first.summary?.skipped.overRunLimit).toBeGreaterThanOrEqual(10)
    // Every candidate reviewed was written, and nothing else was recorded.
    const known = await org.withOrg((ctx) => knownFingerprints(ctx.tx, ws))
    expect(known.size).toBe(ENRICHMENT_LIMITS.inferencesPerRun)
    for (const from of reviewed.filter((id) => id.startsWith('team.squad-'))) expect(known.has(`link|api.orders|${from}`)).toBe(true)

    asked.length = 0
    const second = await run(ws, reviewer)
    expect(asked.flat().length).toBe(first.summary?.skipped.overRunLimit)
    expect(asked.flat().some((from) => reviewed.includes(from))).toBe(false)
    expect(second.summary?.skipped.overRunLimit).toBe(0)
  }, 60_000)

  it('stops reviewing at the job limit or the org cap, and says so', async () => {
    for (const [slug, error, stopped] of [
      ['ai-limit', new EnrichmentLimitReached(1, 1), 'limit'],
      ['ai-cap', new AiCapReached(org.orgId, 20, 20), 'cap'],
    ] as const) {
      const ws = await start(slug)
      const outcome = await run(ws, {
        beforeCall: async () => {
          throw error
        },
        model: { chat: async () => '{}' },
      })
      expect(outcome.status).toBe('limited')
      expect(outcome.summary?.aiStopped).toBe(stopped)
      expect(outcome.summary?.skipped.undecided).toBe(3)
      // What the rules decide alone needs no AI, and is written anyway.
      expect(outcome.summary?.written.owner).toBeGreaterThan(0)
    }
  })
})
