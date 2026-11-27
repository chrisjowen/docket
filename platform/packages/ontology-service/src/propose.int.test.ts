// SPDX-License-Identifier: AGPL-3.0-only
import {
  WorkspaceError,
  listIngests,
  ontologyMcpRoles,
  putDocument,
  readDocument,
  setOntologyMcpRoles,
  type StoreContext,
  type Writer,
} from '@docket/platform-canonical-store'
import { createTestOrg, readFixture, type TestOrg } from '@docket/platform-canonical-store/testing'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { OntologyBreakingChange, OntologyWriteDisabled, StaleDraft } from './errors.js'
import { proposeOntologyChange, publishOntologyChange } from './propose.js'
import { headOf, listDrafts, rollback, versionByNumber } from './versions.js'
import { createWorkspace } from './workspaces.js'

describe.skipIf(!TEST_PG_URL)('proposeOntologyChange', () => {
  let org: TestOrg
  let workspaceId: string
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.withOrg(fn)

  beforeAll(async () => {
    org = await createTestOrg()
    workspaceId = await as(async (ctx) => {
      const { workspace } = await createWorkspace(ctx, { name: 'Propose', slug: 'propose', start: { template: 'blank' }, publisher: { actor: 'user:owner', login: 'owner' } })
      return workspace.id
    })
  })
  afterAll(() => org?.drop())

  it('makes a checked draft and never publishes it', async () => {
    const writer: Writer = { workspaceId, actor: 'oauth:client1/user:u1', label: 'Claude Code via alice (oauth)', channel: 'mcp', requestId: 'req-propose' }
    const { draft, check } = await as((ctx) => proposeOntologyChange(ctx, writer, { patch: 'resourceTypes:\n  service:\n    description: A service.\n', message: 'Add services' }))
    expect(draft.status).toBe('draft')
    expect(draft.message).toBe('Add services')
    expect(draft.author).toBe('oauth:client1/user:u1')
    expect(check.classification).toBe('safe')
    expect(check.changes.length).toBeGreaterThan(0)
    expect((await as((ctx) => headOf(ctx.tx, workspaceId)))?.number).toBe(1)
    expect((await as((ctx) => listDrafts(ctx.tx, workspaceId))).map((d) => d.id)).toContain(draft.id)
    const events = await as((ctx) => listIngests(ctx, { workspaceId, actor: writer.actor }))
    expect(events[0]).toMatchObject({ action: 'propose-ontology', channel: 'mcp', ontologyDraftId: draft.id, requestId: 'req-propose' })
  })
})

describe.skipIf(!TEST_PG_URL)('publishOntologyChange', () => {
  let org: TestOrg
  let workspaceId: string
  let writer: Writer
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.withOrg(fn)
  const rename = 'resourceTypes:\n  pod: null\n  container:\n    description: A running container.\n    icon: container\n'

  beforeAll(async () => {
    org = await createTestOrg()
    const fixture = await readFixture()
    workspaceId = await as(async (ctx) => {
      const { workspace } = await createWorkspace(ctx, { name: 'Direct', slug: 'direct', start: { importYaml: fixture.ontology }, publisher: { actor: 'user:owner', login: 'owner' } })
      for (const document of fixture.documents) await putDocument(ctx, { workspaceId: workspace.id, ...document, origin: 'cloud', actor: 'user:seed' })
      return workspace.id
    })
    writer = { workspaceId, actor: 'token:dkt_live_abcdefgh', label: 'ci-bot (token tok_abcd…)', channel: 'mcp', requestId: 'req-direct' }
  })
  afterAll(() => org?.drop())

  const head = async () => (await as((ctx) => headOf(ctx.tx, workspaceId)))?.number

  it('is refused until the workspace lets the role change the ontology, and leaves nothing behind', async () => {
    expect(await as((ctx) => ontologyMcpRoles(ctx.tx, workspaceId))).toEqual([])
    const refused = await as((ctx) => publishOntologyChange(ctx, writer, 'owner', { patch: 'resourceTypes:\n  queue:\n    description: A queue.\n' })).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(OntologyWriteDisabled)
    expect(await head()).toBe(1)
    expect(await as((ctx) => listDrafts(ctx.tx, workspaceId))).toEqual([])

    await expect(as((ctx) => setOntologyMcpRoles(ctx.tx, workspaceId, ['viewer']))).rejects.toBeInstanceOf(WorkspaceError)
    expect(await as((ctx) => setOntologyMcpRoles(ctx.tx, workspaceId, ['editor', 'owner']))).toEqual(['owner', 'editor'])
    // Admins were not ticked; nor is a former member anything.
    expect(await as((ctx) => publishOntologyChange(ctx, writer, 'admin', { patch: 'resourceTypes:\n  queue:\n    description: A queue.\n' })).catch((e: unknown) => e)).toBeInstanceOf(OntologyWriteDisabled)
    expect(await as((ctx) => publishOntologyChange(ctx, writer, null, { patch: 'resourceTypes:\n  queue:\n    description: A queue.\n' })).catch((e: unknown) => e)).toBeInstanceOf(OntologyWriteDisabled)
  })

  it('publishes an enabled role\'s change as the next version, recorded as the editor records one', async () => {
    const published = await as((ctx) => publishOntologyChange(ctx, writer, 'editor', { patch: 'resourceTypes:\n  queue:\n    description: A message queue.\n', message: 'Add queues' }))
    expect(published).toMatchObject({ number: 2, parentNumber: 1, status: 'published', source: 'mcp:token:dkt_live_abcdefgh', publishedBy: writer.actor, message: 'Add queues' })
    expect(published.checkResult?.classification).toBe('safe')
    expect(await head()).toBe(2)
    const events = await as((ctx) => listIngests(ctx, { workspaceId, actor: writer.actor }))
    expect(events[0]).toMatchObject({ action: 'publish-ontology', channel: 'ontology', requestId: 'req-direct', actorLabel: writer.label })
  })

  it('refuses a stale head, and a breaking change without its migration', async () => {
    expect(await as((ctx) => publishOntologyChange(ctx, writer, 'editor', { patch: 'resourceTypes:\n  topic:\n    description: A topic.\n', expectedHead: 1 })).catch((e: unknown) => e)).toBeInstanceOf(StaleDraft)
    expect(await as((ctx) => publishOntologyChange(ctx, writer, 'editor', { patch: rename, acceptNarrowing: true })).catch((e: unknown) => e)).toBeInstanceOf(OntologyBreakingChange)
    expect(await head()).toBe(2)
  })

  it('migrates the documents a breaking change names, and rolls back from the history', async () => {
    const published = await as((ctx) =>
      publishOntologyChange(ctx, writer, 'editor', { patch: rename, expectedHead: 2, migration: [{ op: 'renameType', from: 'pod', to: 'container' }], acceptNarrowing: true }),
    )
    expect(published.number).toBe(3)
    expect(published.rewritten.map((document) => [document.resourceId, document.resourceType])).toEqual([
      ['pod.orders-7f9c', 'container'],
      ['pod.payments-5d2a', 'container'],
    ])
    const rewritten = await as((ctx) => readDocument(ctx, workspaceId, '.docket/resources/pod/orders-7f9c.md'))
    expect(rewritten?.raw).toContain('observedBy: ci-bot (token tok_abcd…)')

    const back = await as((ctx) => rollback(ctx, workspaceId, 2, { expectedHead: 3, publisher: { actor: 'user:owner', login: 'owner' }, acceptNarrowing: true, dispositions: { 'pod.orders-7f9c': 'accept-data-loss', 'pod.payments-5d2a': 'accept-data-loss' } }))
    expect(back).toMatchObject({ number: 4, source: 'rollback:v2' })
    expect((await as((ctx) => versionByNumber(ctx.tx, workspaceId, 4)))?.yaml).toBe((await as((ctx) => versionByNumber(ctx.tx, workspaceId, 2)))?.yaml)
  })
})
