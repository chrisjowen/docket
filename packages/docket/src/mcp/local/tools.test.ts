import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { init } from '../../commands/init.js'
import { sync } from '../../commands/sync.js'
import { validate } from '../../commands/validate.js'
import { why } from '../../commands/why.js'
import type { CoordinatedAnswer } from '../../query/wire.js'
import { createMcpServer } from '../server.js'
import { localTools } from './tools.js'
import { TOOL_NAMES } from '../surface/definitions.js'

const ORDERS = `---
id: service.orders
type: service
title: Orders API
links:
  - rel: owned_by
    target: team.payments
---

Handles orders for checkout.
`

const PAYMENTS = `---
id: team.payments
type: team
title: Payments
---

The payments team owns checkout money movement.
`

const EVIDENCE = [{ source: 'human', note: 'Said in planning.' }]

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-local-tools-'))
  await init({ cwd: root })
  await appendFile(join(root, '.docket.yaml'), '\nquery:\n  synthesis: false\n')
  await mkdir(join(root, '.docket/resources/services'), { recursive: true })
  await mkdir(join(root, '.docket/resources/teams'), { recursive: true })
  await writeFile(join(root, '.docket/resources/services/orders.md'), ORDERS, 'utf8')
  await writeFile(join(root, '.docket/resources/teams/payments.md'), PAYMENTS, 'utf8')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

type Answer = { result?: { content: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }; error?: { code: number; message: string } }

const server = () => createMcpServer({ cwd: root, viewer: 'http://127.0.0.1:4400/' })
let id = 1
const call = async (name: string, args: unknown): Promise<Answer> =>
  (await server().handle({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } })) as unknown as Answer
const structured = (answer: Answer) => answer.result?.structuredContent as Record<string, unknown>
const text = (answer: Answer) => answer.result?.content[0]?.text ?? ''
const read = (path: string) => readFile(join(root, path), 'utf8')

describe("docket's local MCP tools", () => {
  it('lists every tool of the surface over a directory', async () => {
    const listed = (await server().handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as unknown as { result: { tools: { name: string }[] } }
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(TOOL_NAMES)
  })

  it('remembers a new resource in its own document, with stamped evidence, and adds nothing when repeated', async () => {
    const args = {
      id: 'service.billing',
      type: 'service',
      title: 'Billing',
      body: 'Bills customers monthly.',
      links: [{ rel: 'owned_by', target: 'team.payments', evidence: [{ source: 'human' }] }],
      evidence: EVIDENCE
    }
    const dry = await call('docket_remember', { ...args, dryRun: true })
    expect(structured(dry)).toMatchObject({ schema: 'docket-write.v1', ok: true, dryRun: true, created: true, changed: false })
    expect(existsSync(join(root, '.docket/resources/services/billing.md'))).toBe(false)

    const written = await call('docket_remember', args)
    expect(written.result?.isError).toBeUndefined()
    expect(structured(written)).toMatchObject({
      tool: 'docket_remember',
      id: 'service.billing',
      ok: true,
      created: true,
      changed: true,
      evidenceAdded: 2,
      path: '.docket/resources/services/billing.md',
      viewer: 'http://127.0.0.1:4400/#service.billing'
    })
    expect(structured(written)).not.toHaveProperty('revision')
    expect(text(written)).toBe('Created service.billing (.docket/resources/services/billing.md) with 2 new evidence, recorded as observed by you.')
    const raw = await read('.docket/resources/services/billing.md')
    expect(raw).toContain('Bills customers monthly.')
    expect(raw).toMatch(/observedBy: .+ via docket MCP/)
    expect((await validate({ cwd: root })).diagnostics.filter((d) => d.severity === 'error')).toEqual([])

    const again = await call('docket_remember', args)
    expect(structured(again)).toMatchObject({ ok: true, created: false, changed: false, evidenceAdded: 0 })
    expect(await read('.docket/resources/services/billing.md')).toBe(raw)
  })

  it('refuses a write the ontology does not allow, and one without evidence, writing nothing', async () => {
    const unknown = await call('docket_remember', { id: 'gizmo.x', type: 'gizmo', title: 'X', evidence: EVIDENCE })
    expect(unknown.result?.isError).toBe(true)
    expect(text(unknown)).toMatch(/^Refused: nothing was written/)
    const bare = await call('docket_remember', { id: 'service.x', type: 'service', title: 'X', evidence: [] })
    expect(structured(bare)).toMatchObject({ ok: false, created: true, changed: false })
    expect(existsSync(join(root, '.docket/resources/service'))).toBe(false)
  })

  it('updates the document that already declares a resource in place', async () => {
    const answer = await call('docket_remember', { id: 'service.orders', type: 'service', title: 'Orders API', attributes: { language: 'go' }, evidence: EVIDENCE })
    expect(structured(answer)).toMatchObject({ ok: true, created: false, changed: true, path: '.docket/resources/services/orders.md' })
    const raw = await read('.docket/resources/services/orders.md')
    expect(raw).toContain('language: go')
    expect(raw).toContain('Handles orders for checkout.')
  })

  it('adds evidence to a resource and to a link, and refuses a link it does not have', async () => {
    expect(structured(await call('docket_add_evidence', { id: 'service.orders', evidence: [{ source: 'human', note: 'Confirmed.' }] }))).toMatchObject({ ok: true, evidenceAdded: 1 })
    expect(
      structured(await call('docket_add_evidence', { id: 'service.orders', link: { rel: 'owned_by', target: 'team.payments' }, evidence: [{ source: 'human' }] }))
    ).toMatchObject({ ok: true, evidenceAdded: 1 })
    const missing = await call('docket_add_evidence', { id: 'service.orders', link: { rel: 'depends_on', target: 'team.payments' }, evidence: EVIDENCE })
    expect(text(missing)).toMatch(/unknown-link/)
  })

  it('appends dated notes, and refuses notes for a resource it does not have', async () => {
    const answer = await call('docket_update_notes', { id: 'service.orders', additional_notes: 'It also refunds.', evidence: EVIDENCE })
    expect(structured(answer)).toMatchObject({ ok: true, changed: true })
    const raw = await read('.docket/resources/services/orders.md')
    expect(raw).toContain('Handles orders for checkout.')
    expect(raw).toContain('It also refunds.')
    expect(text(await call('docket_update_notes', { id: 'service.none', additional_notes: 'x', evidence: EVIDENCE }))).toMatch(/unknown-resource/)
  })

  it('reads one resource with its documents and evidence', async () => {
    const answer = await call('docket_get', { id: 'service.orders' })
    expect(structured(answer)).toMatchObject({
      schema: 'docket-resource.v1',
      id: 'service.orders',
      viewer: 'http://127.0.0.1:4400/#service.orders',
      resource: { type: 'service', title: 'Orders API' },
      documents: [{ path: '.docket/resources/services/orders.md', origin: 'local' }],
      history: []
    })
    expect(text(answer)).toContain('Declared in: .docket/resources/services/orders.md (local)')
    expect((await call('docket_get', { id: 'service.none' })).result?.isError).toBe(true)
    expect((await call('docket_get', {})).error?.code).toBe(-32602)
  })

  it('supersedes a record, and search and get answer with its replacement', async () => {
    // A lead's word clears the bar at once: "A lead said so", 0.85 of 0.75.
    await writeFile(join(root, '.docket/people.yaml'), 'me: dana\npeople:\n  dana:\n    role: lead\n', 'utf8')
    await call('docket_remember', { id: 'team.money', type: 'team', title: 'Money Movement', evidence: EVIDENCE })
    const refused = await call('docket_supersede', { id: 'team.payments', by: 'team.none', reason: 'Renamed.', evidence: EVIDENCE })
    expect(text(refused)).toMatch(/unknown-resource/)
    const answer = await call('docket_supersede', { id: 'team.payments', by: 'team.money', reason: 'The team was renamed.', validUntil: '2026-11-01', evidence: EVIDENCE })
    expect(structured(answer)).toMatchObject({
      ok: true,
      changed: true,
      status: 'accepted',
      proposal: { status: 'accepted', score: 0.85, threshold: 0.75 },
      supersededBy: 'team.money',
      validUntil: '2026-11-01T00:00:00.000Z'
    })
    const kept = parse(await read('.docket/supersessions.yaml')) as { supersessions: { resource: string; supersededBy: string }[] }
    expect(kept.supersessions).toEqual([expect.objectContaining({ resource: 'team.payments', supersededBy: 'team.money' })])
    expect(structured(await call('docket_supersede', { id: 'team.payments', by: 'team.money', reason: 'Again.', evidence: EVIDENCE }))).toMatchObject({ changed: false })

    const got = await call('docket_get', { id: 'team.payments' })
    expect(structured(got)).toMatchObject({ superseded: { by: 'team.money', current: 'team.money', reason: 'The team was renamed.' } })
    expect(text(got)).toContain('Out of date: "Payments" (team.payments) is superseded by "Money Movement" (team.money) since 2026-11-01.')

    await sync({ cwd: root })
    const found = await call('docket_search', { query: 'payments' })
    const search = structured(found) as { matches: { id: string; supersedes?: string[] }[]; changes?: { id: string; current: { id: string } | null }[] }
    expect(search.matches.map((match) => match.id)).not.toContain('team.payments')
    expect(search.matches).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'team.money', supersedes: ['team.payments'] })]))
    expect(search.changes).toEqual([expect.objectContaining({ id: 'team.payments', current: expect.objectContaining({ id: 'team.money' }) })])
    expect(text(found)).toContain('Changed since recorded - never present these as current:')
  })

  it('asks around a superseded record: its replacement ranked first, the change named', async () => {
    await writeFile(join(root, '.docket/people.yaml'), 'me: dana\npeople:\n  dana:\n    role: lead\n', 'utf8')
    await call('docket_remember', { id: 'team.money', type: 'team', title: 'Money Movement', body: 'Formerly the payments team.', evidence: EVIDENCE })
    await call('docket_supersede', { id: 'team.payments', by: 'team.money', reason: 'The team was renamed.', validUntil: '2026-11-01', evidence: EVIDENCE })
    await sync({ cwd: root })
    const asked = await call('docket_ask', { question: 'payments' })
    const response = structured(asked) as { answer: CoordinatedAnswer; changes?: { id: string }[] }
    expect(response.changes).toEqual([expect.objectContaining({ id: 'team.payments', current: expect.objectContaining({ id: 'team.money' }) })])
    expect(response.answer.changes).toEqual(response.changes)
    const ids = (response.answer.references ?? []).map((reference) => reference.id)
    expect(ids.indexOf('team.money')).toBeLessThan(ids.indexOf('team.payments'))
    expect(text(asked)).toContain('Changed since recorded - never present these as current:')
  })

  it('keeps a proposal its evidence does not carry pending, the record current, until more evidence does', async () => {
    const people = (me: string) => writeFile(join(root, '.docket/people.yaml'), `me: ${me}\npeople:\n  dana:\n    role: lead\n  tom: {}\n`, 'utf8')
    await people('tom')
    await call('docket_remember', { id: 'team.money', type: 'team', title: 'Money Movement', evidence: EVIDENCE })
    const proposed = structured(await call('docket_supersede', { id: 'team.payments', by: 'team.money', reason: 'The team was renamed.', evidence: [{ note: 'I heard so.' }] })) as {
      ok: boolean
      status: string
      proposal: { id: string; score: number; threshold: number; carry: { policy: string }[] }
    }
    // Tom is a person the template prices at 0.70; the bar is 0.75.
    expect(proposed).toMatchObject({ ok: true, changed: true, status: 'pending', proposal: { status: 'pending', score: 0.7, threshold: 0.75 } })
    expect(proposed.proposal.carry.map((each) => each.policy)).toContain('A lead said so')

    const old = await call('docket_get', { id: 'team.payments' })
    expect(structured(old)).not.toHaveProperty('superseded')
    expect(structured(old)).toMatchObject({ pendingReplacement: { proposal: proposed.proposal.id, by: 'team.money', score: 0.7, threshold: 0.75 } })
    expect(text(old)).toContain(`A pending proposal (${proposed.proposal.id}, 0.70 of 0.75) says it is replaced by team.money`)
    expect(structured(await call('docket_get', { id: 'team.money' }))).toMatchObject({ pendingReplaces: [{ id: 'team.payments', proposal: proposed.proposal.id }] })

    await sync({ cwd: root })
    const found = structured(await call('docket_search', { query: 'payments' })) as { matches: { id: string }[]; pending?: { id: string; by: string }[]; changes?: unknown }
    expect(found.matches.map((match) => match.id)).toContain('team.payments')
    expect(found.changes).toBeUndefined()
    expect(found.pending).toEqual([expect.objectContaining({ proposal: proposed.proposal.id, id: 'team.payments', by: 'team.money' })])

    // Dana, a lead, confirms it: her own word carries it over the bar.
    await people('dana')
    const confirmed = await call('docket_add_evidence', { supersession: proposed.proposal.id, evidence: [{ note: 'Yes, renamed in October.' }] })
    expect(structured(confirmed)).toMatchObject({ ok: true, evidenceAdded: 1, status: 'accepted', id: 'team.payments', supersededBy: 'team.money' })
    expect(structured(await call('docket_get', { id: 'team.payments' }))).toMatchObject({ superseded: { by: 'team.money' } })
    const kept = parse(await read('.docket/supersessions.yaml')) as { supersessions: { status: string; decidedBy: string; evidence: unknown[] }[] }
    expect(kept.supersessions).toEqual([expect.objectContaining({ status: 'accepted', decidedBy: 'score', evidence: [expect.anything(), expect.anything()] })])
  })

  it('refuses evidence for a proposal it does not have, and an id given with a supersession', async () => {
    expect(text(await call('docket_add_evidence', { supersession: 'nope-nope', evidence: [{ note: 'x' }] }))).toMatch(/unknown-proposal/)
    const both = await call('docket_add_evidence', { id: 'team.payments', supersession: 'x', evidence: [{ note: 'x' }] })
    expect(both.error?.message).toMatch(/Give supersession alone/)
  })

  it('writes a reporter as reportedBy, which sync and validate accept without a warning', async () => {
    const written = await call('docket_remember', {
      id: 'service.billing',
      type: 'service',
      title: 'Billing',
      evidence: [{ source: 'human', observedBy: 'alice', note: 'Said in planning.' }]
    })
    expect(structured(written)).toMatchObject({ ok: true, created: true, diagnostics: [] })
    const raw = await read('.docket/resources/services/billing.md')
    expect(raw).toContain('reportedBy: alice')
    expect((await validate({ cwd: root })).diagnostics).toEqual([])
    expect((await sync({ cwd: root })).diagnostics).toEqual([])
    const got = structured(await call('docket_get', { id: 'service.billing' })) as { resource: { evidence: { reportedBy?: string }[] } }
    expect(got.resource.evidence).toEqual([expect.objectContaining({ reportedBy: 'alice' })])
  })

  it('stamps the person the writer acts for, and scores evidence citing no source by who they are', async () => {
    await writeFile(join(root, '.docket/people.yaml'), 'me: dana\npeople:\n  dana:\n    role: lead\n', 'utf8')
    const written = await call('docket_remember', { id: 'service.billing', type: 'service', title: 'Billing', evidence: [{ note: 'I own this decision.' }] })
    expect(structured(written)).toMatchObject({ ok: true, created: true, diagnostics: [] })
    const raw = await read('.docket/resources/services/billing.md')
    expect(raw).toContain('source: person')
    expect(raw).toContain('principal: dana')
    expect((await validate({ cwd: root })).diagnostics).toEqual([])
    const explained = await why('service.billing', { cwd: root })
    expect(explained.resource).toMatchObject({ confidence: 0.85, observations: [expect.objectContaining({ base: { policy: 'A lead said so', score: 0.85 } })] })
  })

  it('counts a person cited second-hand as the writer until they confirm, and asks them to', async () => {
    const people = (me: string) => writeFile(join(root, '.docket/people.yaml'), `me: ${me}\npeople:\n  dana:\n    role: lead\n  tom: {}\n`, 'utf8')
    await people('tom')
    const written = await call('docket_remember', {
      id: 'service.billing',
      type: 'service',
      title: 'Billing',
      evidence: [{ source: 'person', sourceRef: 'dana', note: 'Dana said so in stand-up.' }]
    })
    expect(structured(written)).toMatchObject({ ok: true, diagnostics: [expect.objectContaining({ code: 'confirm-requested' })] })
    expect(text(written)).toContain('until dana confirms it')
    expect((await why('service.billing', { cwd: root })).resource).toMatchObject({
      confidence: 0.7,
      observations: [expect.objectContaining({ source: expect.objectContaining({ instance: 'person:tom', secondHand: 'dana' }), confirmed: false })]
    })

    await people('dana')
    expect(structured(await call('docket_add_evidence', { id: 'service.billing', evidence: [{ note: 'Yes, I said so.' }] }))).toMatchObject({ ok: true, diagnostics: [] })
    const confirmed = await why('service.billing', { cwd: root })
    expect(confirmed.resource?.observations.map((observation) => [observation.source.instance, observation.confirmed])).toEqual([
      ['person:tom', true],
      ['person:dana', undefined]
    ])
    expect(confirmed.resource?.confidence).toBe(0.85)
  })

  it('searches with the surface arguments, tagging each match with where it was found', async () => {
    await sync({ cwd: root })
    const found = await call('docket_search', { query: 'orders', include: ['facts', 'timeline'], minConfidence: 0.4 })
    const search = structured(found) as { matches: { id: string; foundIn: string[]; score: number }[]; warnings: string[] }
    expect(search.matches[0]).toMatchObject({ id: 'service.orders', foundIn: ['facts'], score: 1 })
    expect(search.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/no activity timeline/), expect.stringMatching(/minConfidence is ignored/)]))
    expect(text(found)).toContain('service.orders (service) [facts]')
    expect((await call('docket_search', { query: 'orders', include: ['everything'] })).error?.code).toBe(-32602)
  })

  it('asks the projections, without a summary when synthesis is off', async () => {
    await sync({ cwd: root })
    const answer = await call('docket_ask', { question: 'Who owns orders?' })
    expect(answer.result?.isError).toBeUndefined()
    expect(structured(answer)).toMatchObject({ schema: 'docket-ask.v1', answer: { question: 'Who owns orders?' } })
    expect(text(answer)).toContain('Call docket_get with an id for its full record.')
    expect((await call('docket_ask', { question: '' })).error?.code).toBe(-32602)
  })

  it('reads the ontology as version 1 until a version is published', async () => {
    const answer = await call('docket_ontology', {})
    expect(structured(answer)).toMatchObject({ schema: 'docket-ontology.v1', version: 1, message: null })
    expect(text(answer)).toMatch(/^The published ontology of this docket, version 1 \(sha256:/)
  })

  it('proposes a change as a draft beside the ontology, publishing nothing', async () => {
    const before = await read('.docket/entities.yaml')
    const answer = await call('docket_propose_ontology_change', { patch: 'resourceTypes:\n  queue:\n    description: A message queue.\n', message: 'Queues.' })
    const proposal = structured(answer) as { draftId: string; head: number; classification: string }
    expect(proposal).toMatchObject({ schema: 'docket-ontology-proposal.v1', head: 1, classification: 'safe' })
    expect(await read(`.docket/ontology-drafts/${proposal.draftId}.yaml`)).toContain('queue:')
    expect(await read('.docket/entities.yaml')).toBe(before)
    expect(text(answer)).toMatch(/nothing was published/)
    const invalid = await call('docket_propose_ontology_change', { yaml: 'resourceTypes: 7\n' })
    expect(invalid.result?.isError).toBe(true)
  })

  it('publishes a change as the next version, refusing a stale head and a narrowing change it was not told to accept', async () => {
    const stale = await call('docket_publish_ontology_change', { patch: 'resourceTypes:\n  queue:\n    description: A message queue.\n', expectedHead: 4 })
    expect(text(stale)).toMatch(/Nothing was published: the draft was made against v4, but the head is now v1/)

    const published = await call('docket_publish_ontology_change', { patch: 'resourceTypes:\n  queue:\n    description: A message queue.\n', expectedHead: 1, message: 'Queues.' })
    expect(structured(published)).toMatchObject({ schema: 'docket-ontology-publish.v1', version: 2, previous: 1, classification: 'safe', history: '.docket/ontology-history.yaml' })
    expect(await read('.docket/entities.yaml')).toContain('queue:')
    expect(structured(await call('docket_ontology', {}))).toMatchObject({ version: 2, message: 'Queues.' })

    const narrowing = await call('docket_publish_ontology_change', { patch: 'relationships:\n  owned_by:\n    from: [repository]\n' })
    expect(narrowing.result?.isError).toBe(true)
    expect(text(narrowing)).toMatch(/Nothing was published/)
    expect(structured(await call('docket_ontology', {}))).toMatchObject({ version: 2 })
  })

  it('migrates documents across a breaking change it publishes', async () => {
    const broken = await call('docket_publish_ontology_change', { patch: 'resourceTypes:\n  team: null\n  squad:\n    description: A squad.\n' })
    expect(text(broken)).toMatch(/breaks 1 resource/)
    const published = await call('docket_publish_ontology_change', {
      patch: 'resourceTypes:\n  squad:\n    description: A squad.\n',
      migration: [{ op: 'mapType', from: 'team', to: 'squad' }],
      acceptNarrowing: true
    })
    expect(published.result?.isError, text(published)).toBeUndefined()
    expect(structured(published)).toMatchObject({ version: 2, rewritten: [{ resourceId: 'team.payments', path: '.docket/resources/teams/payments.md' }] })
    expect(await read('.docket/resources/teams/payments.md')).toMatch(/type: squad/)
  })

  it('retires a resource by removing the documents that declare it', async () => {
    expect(text(await call('docket_retire', { id: 'service.none', reason: 'Gone.' }))).toMatch(/unknown-resource/)
    const answer = await call('docket_retire', { id: 'service.orders', reason: 'Replaced by billing.' })
    expect(structured(answer)).toMatchObject({ ok: true, retired: [{ path: '.docket/resources/services/orders.md' }], remaining: [] })
    expect(existsSync(join(root, '.docket/resources/services/orders.md'))).toBe(false)
  })

  it('runs concurrent writes one at a time, so neither is lost', async () => {
    await Promise.all([
      call('docket_add_evidence', { id: 'service.orders', evidence: [{ source: 'human', note: 'One.' }] }),
      call('docket_add_evidence', { id: 'service.orders', evidence: [{ source: 'human', note: 'Two.' }] })
    ])
    const raw = await read('.docket/resources/services/orders.md')
    expect(raw).toContain('One.')
    expect(raw).toContain('Two.')
  })

  it('answers docket_ask that it is off, for a server without a model', async () => {
    const off = createMcpServer({ cwd: root, tools: localTools({ cwd: root, ask: false }) })
    const answer = (await off.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'docket_ask', arguments: { question: 'Who owns orders?' } } })) as unknown as Answer
    expect(answer.result?.isError).toBe(true)
    expect(text(answer)).toMatch(/docket_ask is off on this server/)
  })

  it("refuses a publish when the caller's role may not change the ontology, re-checked on every call", async () => {
    let role: string | null = 'editor'
    const guarded = createMcpServer({ cwd: root, tools: localTools({ cwd: root, publisher: { role: async () => role, allowed: async () => ['owner'] } }) })
    const publish = async () =>
      (await guarded.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'docket_publish_ontology_change', arguments: { patch: 'resourceTypes:\n  queue:\n    description: A queue.\n' } }
      })) as unknown as Answer
    const refused = await publish()
    expect(refused.result?.isError).toBe(true)
    expect(text(refused)).toMatch(/Nothing was published: this workspace's settings do not let editors change the ontology over MCP/)
    expect(await read('.docket/entities.yaml')).not.toContain('queue:')
    role = 'owner'
    expect(structured(await publish())).toMatchObject({ version: 2 })
  })
})
