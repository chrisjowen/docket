// SPDX-License-Identifier: AGPL-3.0-only
import { type ToolResult } from '@chrisjowen/docket'
import { parseMemoryFile, putDocument, readDocument, type StoreContext, type Writer } from '@docket/platform-canonical-store'
import { createTestOrg, readFixture, type TestOrg } from '@docket/platform-canonical-store/testing'
import { createWorkspace } from '@docket/platform-ontology-service'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { AuditOutcome, CloudToolContext } from './context.js'
import { getTool } from './get.js'
import { writeTools } from './index.js'

const VIEWER = 'https://docket.test/a/acme/d/platform/graph'
const HISTORY = 'https://docket.test/a/acme/d/platform/ontology/history'
/** Whether the caller holds Publish ontology changes on the docket, as the endpoint answers it. */
let holdsPublish = false

function stubContext(overrides: Partial<CloudToolContext> = {}): CloudToolContext {
  return {
    orgId: 'orga',
    workspaceId: 'ws1',
    viewer: VIEWER,
    ontologyHistory: HISTORY,
    inTenant: vi.fn(),
    query: { search: vi.fn(), ask: vi.fn(), turn: vi.fn() },
    assertWithinCap: vi.fn(async () => undefined),
    actor: 'token:dkt_live_abcdefgh',
    userId: 'u-alice',
    writer: vi.fn(async () => ({ workspaceId: 'ws1', actor: 'token:dkt_live_abcdefgh', label: 'ci-bot (token tok_abcd…)', channel: 'mcp' as const, requestId: 'req-1' })),
    mayPublish: vi.fn(async () => holdsPublish),
    audited: vi.fn(),
    ...overrides,
  }
}

const tool = (context: CloudToolContext, name: string) => {
  const found = writeTools(context).find((entry) => entry.tool.definition.name === name)
  if (!found) throw new Error(`no ${name}`)
  return found.tool
}
const call = (context: CloudToolContext, name: string, args: unknown) => tool(context, name).call(args, { source: vi.fn(), viewer: null })

describe.skipIf(!TEST_PG_URL)('the write tools on a workspace', () => {
  let org: TestOrg
  let workspaceId: string
  const audits: { outcome: AuditOutcome; target: string[] }[] = []
  let context: CloudToolContext

  beforeAll(async () => {
    org = await createTestOrg()
    const fixture = await readFixture()
    workspaceId = await org.withOrg(async (ctx) => {
      const publisher = { actor: `user:${org.userId}`, login: org.login }
      const { workspace } = await createWorkspace(ctx, { name: 'Platform', slug: 'platform', start: { importYaml: fixture.ontology }, publisher })
      for (const document of fixture.documents) {
        await putDocument(ctx, { workspaceId: workspace.id, ...document, origin: 'repo', originRef: 'conn1:.docket', actor: 'system:repo-sync' })
      }
      return workspace.id
    })
    const writer: Writer = { workspaceId, actor: 'token:dkt_live_abcdefgh', label: 'ci-bot (token tok_abcd…)', channel: 'mcp', requestId: 'req-tools' }
    context = stubContext({
      orgId: org.orgId,
      workspaceId,
      inTenant: (fn) => org.withOrg(fn),
      writer: async () => writer,
      audited: async <T>(fn: (ctx: StoreContext) => Promise<{ value: T; outcome: AuditOutcome; target: string[] }>) => {
        const done = await org.withOrg(fn)
        audits.push({ outcome: done.outcome, target: done.target })
        return done.value
      },
    })
  })
  afterAll(() => org?.drop())

  const structured = (result: ToolResult) => result.structuredContent as Record<string, unknown>

  it('docket_remember refuses a write without evidence, as a tool error naming missing-evidence', async () => {
    const result = await call(context, 'docket_remember', { id: 'service.ledger', type: 'service', title: 'Ledger', evidence: [] })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('missing-evidence')
    expect(structured(result)).toMatchObject({ schema: 'docket-write.v1', ok: false })
    expect(audits.at(-1)).toEqual({ outcome: 'invalid', target: ['service.ledger'] })
  })

  it('docket_remember writes with evidence, and a dry run writes nothing', async () => {
    const args = { id: 'service.ledger', type: 'service', title: 'Ledger', evidence: [{ source: 'code', path: 'ledger/main.go' }] }
    const dry = await call(context, 'docket_remember', { ...args, dryRun: true })
    expect(dry.isError).toBeUndefined()
    expect(structured(dry)).toMatchObject({ ok: true, dryRun: true, changed: false })
    const result = await call(context, 'docket_remember', args)
    expect(result.isError).toBeUndefined()
    expect(structured(result)).toMatchObject({ ok: true, created: true, changed: true, evidenceAdded: 1, path: '.docket/resources/service/ledger.md', viewer: `${VIEWER}#service.ledger` })
    expect(audits.at(-1)).toEqual({ outcome: 'ok', target: ['service.ledger'] })
  })

  it('docket_add_evidence appends to a link of a repo resource', async () => {
    const result = await call(context, 'docket_add_evidence', { id: 'service.orders', link: { rel: 'owned_by', target: 'team.commerce' }, evidence: [{ source: 'human', note: 'per the team page' }] })
    expect(result.isError).toBeUndefined()
    expect(structured(result)).toMatchObject({ ok: true, evidenceAdded: 1 })
  })

  it('docket_update_notes appends prose, supports dry runs, and audits refusals', async () => {
    const id = 'service.notes-tool'
    await call(context, 'docket_remember', { id, type: 'service', title: 'Notes tool', body: 'Original notes.', evidence: [{ source: 'human' }] })
    const args = { id, additional_notes: 'New observations and reasoning.', evidence: [{ source: 'human', note: 'new observation' }] }
    const path = '.docket/resources/service/notes-tool.md'
    const before = await org.withOrg((ctx) => readDocument(ctx, workspaceId, path))
    const dry = await call(context, 'docket_update_notes', { ...args, dryRun: true })
    expect(structured(dry)).toMatchObject({ ok: true, dryRun: true, changed: false })
    expect((await org.withOrg((ctx) => readDocument(ctx, workspaceId, path)))?.revision).toBe(before?.revision)
    const result = await call(context, 'docket_update_notes', args)
    expect(result.isError).toBeUndefined()
    expect(structured(result)).toMatchObject({ schema: 'docket-write.v1', ok: true, changed: true, created: false, evidenceAdded: 1, viewer: `${VIEWER}#${id}` })
    const stored = await org.withOrg((ctx) => readDocument(ctx, workspaceId, path))
    const parsed = parseMemoryFile(stored?.raw as string, path).document
    expect(parsed?.content).toMatch(/^Original notes\.\n\n---\n\n### Notes added .*\n\nNew observations and reasoning\.\s*$/)
    expect(parsed?.evidence).toHaveLength(2)
    expect(audits.at(-1)).toEqual({ outcome: 'ok', target: [id] })
    for (const refusedArgs of [{ ...args, id: 'service.missing' }, { ...args, evidence: [] }, { ...args, evidence: [{ source: 'unknown' }] }]) {
      const refused = await call(context, 'docket_update_notes', refusedArgs)
      expect(refused.isError).toBe(true)
      expect(structured(refused)).toMatchObject({ ok: false, changed: false })
      expect(audits.at(-1)).toEqual({ outcome: 'invalid', target: [refusedArgs.id] })
    }
    expect((await org.withOrg((ctx) => readDocument(ctx, workspaceId, path)))?.raw).toBe(stored?.raw)
  })

  it('docket_retire refuses a repo-origin resource with "change it in the repo"', async () => {
    const result = await call(context, 'docket_retire', { id: 'service.payments', reason: 'decommissioned' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('change it in the repo')
    const retired = await call(context, 'docket_retire', { id: 'service.ledger', reason: 'written by mistake' })
    expect(retired.isError).toBeUndefined()
    expect(structured(retired)).toMatchObject({ ok: true, retired: [{ path: '.docket/resources/service/ledger.md' }] })
  })

  it('docket_supersede marks a record out of date, keeps it on file, and docket_get says so on both records', async () => {
    const refused = await call(context, 'docket_supersede', { id: 'service.search', by: 'service.nowhere', reason: 'Replaced.', evidence: [{ source: 'human' }] })
    expect(refused.isError).toBe(true)
    expect(refused.content[0]?.text).toContain('unknown-resource')

    const args = {
      id: 'service.search',
      by: 'service.catalogue',
      reason: 'Search moved into the catalogue service.',
      validUntil: '2026-10-01',
      evidence: [{ source: 'human', note: 'Chris said search now lives in catalogue.' }],
    }
    const result = await call(context, 'docket_supersede', args)
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain('service.search is now superseded by service.catalogue since 2026-10-01')
    expect(structured(result)).toMatchObject({ schema: 'docket-write.v1', tool: 'docket_supersede', ok: true, changed: true, supersededBy: 'service.catalogue' })
    expect(audits.at(-1)).toEqual({ outcome: 'ok', target: ['service.search', 'service.catalogue'] })
    expect(structured(await call(context, 'docket_supersede', args))).toMatchObject({ ok: true, changed: false })

    const get = (id: string) => getTool(context).tool.call({ id }, { source: vi.fn(), viewer: null })
    const old = await get('service.search')
    expect(old.content[0]?.text).toContain('Out of date: "Search" (service.search) is superseded by "Catalogue" (service.catalogue) since 2026-10-01. Search moved into the catalogue service.')
    expect(structured(old)).toMatchObject({ superseded: { by: 'service.catalogue', current: 'service.catalogue', validUntil: '2026-10-01T00:00:00.000Z', source: 'agent' } })
    expect(structured(old).resource).not.toBeNull()
    const current = await get('service.catalogue')
    expect(current.content[0]?.text).toContain('Current record: it supersedes service.search (since 2026-10-01).')
    expect(structured(current)).toMatchObject({ supersedes: [{ id: 'service.search', reason: 'Search moved into the catalogue service.' }] })
  })

  it('docket_propose_ontology_change makes a checked draft, and says an invalid one made none', async () => {
    const result = await call(context, 'docket_propose_ontology_change', { patch: 'relationships:\n  depends_on: null\n', message: 'drop depends_on' })
    expect(result.isError).toBeUndefined()
    expect(structured(result)).toMatchObject({ schema: 'docket-ontology-proposal.v1', head: 1, classification: 'breaking' })
    const invalid = await call(context, 'docket_propose_ontology_change', { yaml: 'resourceTypes: 12\n' })
    expect(invalid.isError).toBe(true)
    expect(invalid.content[0]?.text).toContain('no draft was made')
  })

  it('docket_publish_ontology_change publishes only for a caller who holds Publish, migrating what a step names', async () => {
    const add = { patch: 'resourceTypes:\n  queue:\n    description: A message queue.\n', message: 'Add queues' }
    const off = await call(context, 'docket_publish_ontology_change', add)
    expect(off.isError).toBe(true)
    expect(off.content[0]?.text).toContain('you do not hold Publish ontology changes on this docket')

    holdsPublish = true
    const published = await call(context, 'docket_publish_ontology_change', add)
    expect(published.isError).toBeUndefined()
    expect(published.content[0]?.text).toContain(`Published v2 (was v1): safe.`)
    expect(published.content[0]?.text).toContain(HISTORY)
    expect(structured(published)).toMatchObject({ schema: 'docket-ontology-publish.v1', version: 2, previous: 1, classification: 'safe', rewritten: [], history: HISTORY })
    expect(audits.at(-1)).toEqual({ outcome: 'ok', target: ['ontology:v2'] })

    // A breaking change says what to resolve, and publishes nothing.
    const rename = 'resourceTypes:\n  pod: null\n  container:\n    description: A running container.\n'
    const broken = await call(context, 'docket_publish_ontology_change', { patch: rename, acceptNarrowing: true })
    expect(broken.isError).toBe(true)
    expect(broken.content[0]?.text).toMatch(/Nothing was published: the change breaks \d+ resource/)
    const stale = await call(context, 'docket_publish_ontology_change', { ...add, expectedHead: 1 })
    expect(stale.content[0]?.text).toContain('the head is now v2')

    // The repo's pods cannot be rewritten in place: each needs a disposition.
    const migrated = await call(context, 'docket_publish_ontology_change', {
      patch: rename,
      expectedHead: 2,
      migration: [{ op: 'renameType', from: 'pod', to: 'container' }],
      acceptNarrowing: true,
      dispositions: { 'pod.orders-7f9c': 'update-in-repo', 'pod.payments-5d2a': 'update-in-repo' },
    })
    expect(migrated.isError).toBeUndefined()
    expect(structured(migrated)).toMatchObject({ version: 3, previous: 2, migration: [{ op: 'renameType', from: 'pod', to: 'container' }] })
    expect((structured(migrated).dispositions as unknown[]).length).toBe(2)
  })
})
