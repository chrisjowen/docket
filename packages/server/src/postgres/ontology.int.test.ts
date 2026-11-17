import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { readFixture, type Fixture } from '../../test/fixture.js'
import { STORE_KINDS, TEST_PG_URL, createTestStore, type TestStore } from '../../test/postgres.js'
import type { Disposition } from '../ontology/check.js'
import { OntologyBreakingChange, OntologyInvalid, OntologyNarrowingChange, OntologyWriteDisabled, StaleDraft } from '../ontology/errors.js'
import type { Migration } from '../ontology/migrations.js'
import { template } from '../ontology/templates.js'
import { MAX_ONTOLOGY_BYTES } from '../ontology/yaml-io.js'
import type { StoreContext } from '../ports.js'
import type { Writer } from '../write/inputs.js'
import {
  WorkspaceError,
  checkDraft,
  createDraft,
  createWorkspace,
  discardDraft,
  headOf,
  listDrafts,
  listIngests,
  listPublished,
  ontologyMcpRoles,
  proposeOntologyChange,
  publish,
  publishOntologyChange,
  putDocument,
  readDocument,
  rollback,
  setOntologyMcpRoles,
  updateDraft,
  versionByNumber
} from './index.js'

/** The fixture's ontology with one edit, made the way the editor makes it: on the YAML document. */
function edit(yaml: string, change: (doc: ReturnType<typeof parseDocument>) => void): string {
  const doc = parseDocument(yaml)
  change(doc)
  return doc.toString()
}

describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('checkDraft over a workspace of 12 documents over $name', (kind) => {
  let org: TestStore
  let fixture: Fixture
  let workspaceId: string
  const publisher = { actor: 'user:publisher', login: 'alice' }
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.as(fn)

  beforeAll(async () => {
    org = await createTestStore(kind)
    fixture = await readFixture()
    workspaceId = await as(async (ctx) => {
      const { workspace } = await createWorkspace(ctx, {
        name: 'Platform',
        slug: 'platform',
        start: { importYaml: fixture.ontology },
        publisher,
      })
      for (const document of fixture.documents) {
        await putDocument(ctx, { workspaceId: workspace.id, ...document, origin: 'cloud', actor: 'user:seed' })
      }
      return workspace.id
    })
  })
  afterAll(() => org?.drop())

  it('adding type slo is safe and introduces nothing', async () => {
    const draft = edit(fixture.ontology, (doc) => doc.setIn(['resourceTypes', 'slo'], { description: 'A service level objective.' }))
    const check = await as((ctx) => checkDraft(ctx, workspaceId, draft))
    expect(check.classification).toBe('safe')
    expect(check.introduced).toEqual([])
    expect(check.documents).toBe(12)
    expect(check.head).toBe(1)
    expect(check.changes).toEqual([{ op: '+', text: 'type `slo`' }])
  })

  it('narrowing depends_on.to to service lists the 3 resources whose links target a datasource', async () => {
    const draft = edit(fixture.ontology, (doc) => doc.setIn(['relationships', 'depends_on', 'to'], ['service']))
    const check = await as((ctx) => checkDraft(ctx, workspaceId, draft))
    expect(check.classification).toBe('narrowing')
    expect(check.affected).toEqual([
      { resourceId: 'service.catalogue', origin: 'cloud' },
      { resourceId: 'service.orders', origin: 'cloud' },
      { resourceId: 'service.payments', origin: 'cloud' },
    ])
    expect(check.introduced.map((d) => d.code)).toEqual(Array(3).fill('relationship-to-violation'))
    expect(check.introduced.map((d) => d.message).join('\n')).toContain('"datasource.orders-db"')
    expect(check.changes).toEqual([{ op: '~', text: 'relationship `depends_on`: to −= `datasource`' }])

    // Publishing it needs an explicit "publish anyway".
    await expect(
      as(async (ctx) => {
        const created = await createDraft(ctx.tx, workspaceId, { yaml: draft, source: 'editor', author: publisher.actor })
        return publish(ctx, workspaceId, created.id, { expectedHead: 1, publisher })
      }),
    ).rejects.toBeInstanceOf(OntologyNarrowingChange)
  })

  it('removing type pod, used by 2 documents, is breaking and blocked without a migration', async () => {
    const draft = edit(fixture.ontology, (doc) => doc.deleteIn(['resourceTypes', 'pod']))
    const check = await as((ctx) => checkDraft(ctx, workspaceId, draft))
    expect(check.classification).toBe('breaking')
    expect(check.introduced).toEqual([
      expect.objectContaining({ code: 'unknown-type', id: 'pod.orders-7f9c', severity: 'error' }),
      expect.objectContaining({ code: 'unknown-type', id: 'pod.payments-5d2a', severity: 'error' }),
    ])

    const refused = await as(async (ctx) => {
      const created = await createDraft(ctx.tx, workspaceId, { yaml: draft, source: 'editor', author: publisher.actor })
      return publish(ctx, workspaceId, created.id, { expectedHead: 1, publisher, acceptNarrowing: true }).catch((e: unknown) => e)
    })
    expect(refused).toBeInstanceOf(OntologyBreakingChange)
    expect((refused as OntologyBreakingChange).check.introduced).toHaveLength(2)
    expect(await as((ctx) => headOf(ctx.tx, workspaceId))).toMatchObject({ number: 1 })
  })

  it('a migration step that resolves nothing does not unblock a breaking change', async () => {
    const draft = edit(fixture.ontology, (doc) => doc.deleteIn(['resourceTypes', 'pod']))
    const migration: Migration[] = [{ op: 'dropAttribute', type: 'service', from: 'nonexistent' }]
    const check = await as((ctx) => checkDraft(ctx, workspaceId, draft, { migration }))
    expect(check.unresolved).toEqual([
      { resourceId: 'pod.orders-7f9c', origin: 'cloud', changes: ['type pod'], updatable: false },
      { resourceId: 'pod.payments-5d2a', origin: 'cloud', changes: ['type pod'], updatable: false },
    ])

    const refused = await as(async (ctx) => {
      const created = await createDraft(ctx.tx, workspaceId, { yaml: draft, source: 'editor', author: publisher.actor })
      return publish(ctx, workspaceId, created.id, { expectedHead: 1, migration, publisher, acceptNarrowing: true }).catch(
        (e: unknown) => e,
      )
    })
    expect(refused).toBeInstanceOf(OntologyBreakingChange)
    expect(await as((ctx) => headOf(ctx.tx, workspaceId))).toMatchObject({ number: 1 })
  })

  it('a rename migration rewrites the cloud documents as new revisions with evidence, and records what to do with repo ones', async () => {
    const draft = edit(fixture.ontology, (doc) => {
      doc.deleteIn(['resourceTypes', 'pod'])
      doc.setIn(['resourceTypes', 'container'], { description: 'A running container.', icon: 'container' })
    })
    // One pod comes from a repo: it cannot be rewritten in place.
    const repoPod = fixture.documents.find((d) => d.path.endsWith('pod/payments-5d2a.md'))
    await as((ctx) =>
      putDocument(ctx, {
        workspaceId,
        path: '.docket/resources/pod/payments-5d2a.md',
        raw: `${repoPod?.raw}\nSeen in the cluster.\n`,
        origin: 'repo',
        originRef: 'conn-1:.docket/resources/pod/payments-5d2a.md',
        actor: 'system:repo-sync',
      }),
    )
    const migration = [{ op: 'renameType' as const, from: 'pod', to: 'container' }]
    const repoUnresolved = { resourceId: 'pod.payments-5d2a', origin: 'repo', changes: ['type pod'], updatable: true }
    expect((await as((ctx) => checkDraft(ctx, workspaceId, draft, { migration }))).unresolved).toEqual([repoUnresolved])
    const attempt = (acceptNarrowing: boolean, dispositions: Record<string, Disposition> = {}) =>
      as(async (ctx) => {
        const created = await createDraft(ctx.tx, workspaceId, { yaml: draft, source: 'editor', author: publisher.actor })
        return publish(ctx, workspaceId, created.id, { expectedHead: 1, migration, publisher, acceptNarrowing, dispositions })
      })

    // The step rewrites nothing in the repo: the repo pod needs a disposition, and says where to fix it.
    const refused = await attempt(true).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(OntologyBreakingChange)
    expect((refused as OntologyBreakingChange).check.affected).toEqual([{ resourceId: 'pod.payments-5d2a', origin: 'repo' }])
    const narrowing = await attempt(false, { 'pod.payments-5d2a': 'accept-data-loss' }).catch((e: unknown) => e)
    expect(narrowing).toBeInstanceOf(OntologyNarrowingChange)

    const published = await attempt(true, { 'pod.payments-5d2a': 'accept-data-loss' })
    expect(published.number).toBe(2)
    expect(published.migration).toEqual(migration)
    expect(published.dispositions).toEqual([{ ...repoUnresolved, disposition: 'accept-data-loss' }])
    expect(published.rewritten.map((d) => [d.path, d.revision, d.resourceType])).toEqual([
      ['.docket/resources/pod/orders-7f9c.md', 2, 'container'],
    ])
    const events = await as((ctx) => listIngests(ctx, { workspaceId, actor: publisher.actor }))
    const event = events.find((candidate) => candidate.action === 'publish-ontology')
    expect(event?.documents.map((d) => d.path)).toEqual(['.docket/resources/pod/orders-7f9c.md'])
    expect(event?.evidenceCount).toBe(1)
    expect(event?.detail?.evidence).toEqual([
      { on: 'pod.orders-7f9c', entries: [{ source: 'human', observedBy: 'alice', note: 'ontology v2 migration: renameType pod -> container' }] },
    ])
    expect(event?.detail?.evidence?.flatMap((group) => group.entries)).toHaveLength(event?.evidenceCount ?? -1)
    const rewritten = await as((ctx) => readDocument(ctx, workspaceId, '.docket/resources/pod/orders-7f9c.md'))
    expect(rewritten?.raw).toBe(
      [
        '---',
        'id: pod.orders-7f9c',
        'type: container',
        'title: orders-7f9c',
        'evidence:',
        '  - source: human',
        '    observedBy: alice',
        '    note: "ontology v2 migration: renameType pod -> container"',
        '---',
        '',
      ].join('\n'),
    )
    const repo = await as((ctx) => readDocument(ctx, workspaceId, '.docket/resources/pod/payments-5d2a.md'))
    expect(repo?.resourceType).toBe('pod')
    expect(repo?.revision).toBe(2)
  })
})

describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('the breaking-change gate when the broken documents come from a repo or the CLI over $name', (kind) => {
  let org: TestStore
  let fixture: Fixture
  let workspaceId: string
  const publisher = { actor: 'user:publisher', login: 'alice' }
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.as(fn)
  const attempt = (draft: string, options: { migration?: Migration[]; dispositions?: Record<string, Disposition> }) =>
    as(async (ctx) => {
      const created = await createDraft(ctx.tx, workspaceId, { yaml: draft, source: 'editor', author: publisher.actor })
      return publish(ctx, workspaceId, created.id, { expectedHead: 1, publisher, acceptNarrowing: true, ...options })
    })

  beforeAll(async () => {
    org = await createTestStore(kind)
    fixture = await readFixture()
    workspaceId = await as(async (ctx) => {
      const { workspace } = await createWorkspace(ctx, {
        name: 'Platform',
        slug: 'platform',
        start: { importYaml: fixture.ontology },
        publisher,
      })
      for (const document of fixture.documents) {
        const origin = document.path.includes('/pod/') ? (document.path.includes('orders') ? 'repo' : 'cli') : 'cloud'
        const originRef = origin === 'cloud' ? null : `conn-1:${document.path}`
        await putDocument(ctx, { workspaceId: workspace.id, ...document, origin, originRef, actor: 'user:seed' })
      }
      return workspace.id
    })
  })
  afterAll(() => org?.drop())

  it('an unrelated migration step does not unblock removing type pod', async () => {
    const draft = edit(fixture.ontology, (doc) => doc.deleteIn(['resourceTypes', 'pod']))
    const migration: Migration[] = [{ op: 'dropAttribute', type: 'service', from: 'nonexistent' }]
    const check = await as((ctx) => checkDraft(ctx, workspaceId, draft, { migration }))
    expect(check.classification).toBe('breaking')
    expect(check.affected).toEqual([
      { resourceId: 'pod.orders-7f9c', origin: 'repo' },
      { resourceId: 'pod.payments-5d2a', origin: 'cli' },
    ])
    expect(check.unresolved.map((u) => [u.resourceId, u.updatable])).toEqual([
      ['pod.orders-7f9c', false],
      ['pod.payments-5d2a', false],
    ])

    const updateInRepo = { 'pod.orders-7f9c': 'update-in-repo', 'pod.payments-5d2a': 'update-in-repo' } as const
    expect(await attempt(draft, { migration }).catch((e: unknown) => e)).toBeInstanceOf(OntologyBreakingChange)
    expect(await attempt(draft, {}).catch((e: unknown) => e)).toBeInstanceOf(OntologyBreakingChange)
    expect(await attempt(draft, { migration, dispositions: updateInRepo }).catch((e: unknown) => e)).toBeInstanceOf(
      OntologyBreakingChange,
    )
    expect(await as((ctx) => headOf(ctx.tx, workspaceId))).toMatchObject({ number: 1 })
  })

  it('a rename that rewrites no document is blocked without a disposition for each, and records them once given', async () => {
    const draft = edit(fixture.ontology, (doc) => {
      doc.deleteIn(['resourceTypes', 'pod'])
      doc.setIn(['resourceTypes', 'container'], { description: 'A running container.' })
    })
    const migration: Migration[] = [{ op: 'renameType', from: 'pod', to: 'container' }]
    const check = await as((ctx) => checkDraft(ctx, workspaceId, draft, { migration }))
    expect(check.migrated).toEqual([])
    expect(check.unresolved).toEqual([
      { resourceId: 'pod.orders-7f9c', origin: 'repo', changes: ['type pod'], updatable: true },
      { resourceId: 'pod.payments-5d2a', origin: 'cli', changes: ['type pod'], updatable: true },
    ])

    expect(await attempt(draft, { migration }).catch((e: unknown) => e)).toBeInstanceOf(OntologyBreakingChange)
    expect(
      await attempt(draft, { migration, dispositions: { 'pod.orders-7f9c': 'update-in-repo' } }).catch((e: unknown) => e),
    ).toBeInstanceOf(OntologyBreakingChange)
    expect(await as((ctx) => headOf(ctx.tx, workspaceId))).toMatchObject({ number: 1 })

    const dispositions = { 'pod.orders-7f9c': 'update-in-repo', 'pod.payments-5d2a': 'accept-data-loss' } as const
    const published = await attempt(draft, { migration, dispositions })
    expect(published.number).toBe(2)
    expect(published.rewritten).toEqual([])
    const recorded = [
      { resourceId: 'pod.orders-7f9c', origin: 'repo', changes: ['type pod'], updatable: true, disposition: 'update-in-repo' },
      { resourceId: 'pod.payments-5d2a', origin: 'cli', changes: ['type pod'], updatable: true, disposition: 'accept-data-loss' },
    ]
    expect(published.dispositions).toEqual(recorded)
    expect((await as((ctx) => versionByNumber(ctx.tx, workspaceId, 2)))?.dispositions).toEqual(recorded)
  })
})

const owner = { actor: 'user:owner', login: 'owner' }

/** The blank template with types t2 ... t<n> added. */
function withTypes(n: number): string {
  const doc = parseDocument(template('blank').yaml)
  for (let i = 2; i <= n; i += 1) doc.setIn(['resourceTypes', `t${i}`], { description: `Type ${i}.` })
  return doc.toString()
}

describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('ontology versions over $name', (kind) => {
  let org: TestStore
  let workspaceId: string
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.as(fn)

  beforeAll(async () => {
    org = await createTestStore(kind)
    workspaceId = await as(async (ctx) => {
      const { workspace, version } = await createWorkspace(ctx, {
        name: 'Versions',
        slug: 'versions',
        start: { template: 'blank' },
        publisher: owner,
      })
      expect(version.number).toBe(1)
      expect(version.source).toBe('template:blank')
      // v2 ... v14, one type more each.
      for (let n = 2; n <= 14; n += 1) {
        const draft = await createDraft(ctx.tx, workspace.id, { yaml: withTypes(n), source: 'editor', author: owner.actor })
        expect(draft.parentNumber).toBe(n - 1)
        const published = await publish(ctx, workspace.id, draft.id, { expectedHead: n - 1, publisher: owner, message: `v${n}` })
        expect(published.number).toBe(n)
      }
      return workspace.id
    })
  })
  afterAll(() => org?.drop())

  it('refuses a draft made against v13 once the head is v14', async () => {
    const stale = await as(async (ctx) => {
      const draft = await createDraft(ctx.tx, workspaceId, { yaml: withTypes(15), source: 'editor', author: owner.actor })
      return publish(ctx, workspaceId, draft.id, { expectedHead: 13, publisher: owner }).catch((e: unknown) => e)
    })
    expect(stale).toBeInstanceOf(StaleDraft)
    expect(stale).toMatchObject({ expectedHead: 13, head: 14 })
    expect((await as((ctx) => headOf(ctx.tx, workspaceId)))?.number).toBe(14)
  })

  it('rolls back by publishing v15 equal to v12', async () => {
    const v15 = await as((ctx) => rollback(ctx, workspaceId, 12, { expectedHead: 14, publisher: owner }))
    const v12 = await as((ctx) => versionByNumber(ctx.tx, workspaceId, 12))
    expect(v15.number).toBe(15)
    expect(v15.yaml).toBe(v12?.yaml)
    expect(v15.yamlHash).toBe(v12?.yamlHash)
    expect(v15.source).toBe('rollback:v12')
    expect(v15.parentNumber).toBe(14)
    expect(v15.message).toBe('Roll back to v12')
    // Nothing was rewritten: v12 and v14 are still as they were.
    const history = await as((ctx) => listPublished(ctx.tx, workspaceId))
    expect(history.map((v) => v.number)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(history.find((v) => v.number === 14)?.yaml).toBe(withTypes(14))
  })

  it('keeps drafts open until published or discarded, and rebases one onto the head', async () => {
    await as(async (ctx) => {
      const draft = await createDraft(ctx.tx, workspaceId, { yaml: withTypes(3), source: 'editor', author: owner.actor })
      expect((await listDrafts(ctx.tx, workspaceId)).map((d) => d.id)).toContain(draft.id)
      await expect(updateDraft(ctx.tx, workspaceId, draft.id, { yaml: 'resourceTypes: [' })).rejects.toBeInstanceOf(OntologyInvalid)
      const rebased = await updateDraft(ctx.tx, workspaceId, draft.id, { yaml: withTypes(4), rebase: true })
      expect(rebased.parentNumber).toBe((await headOf(ctx.tx, workspaceId))?.number)
      await discardDraft(ctx.tx, workspaceId, draft.id)
      expect((await listDrafts(ctx.tx, workspaceId)).map((d) => d.id)).not.toContain(draft.id)
    })
  })

  it('refuses an ontology over the size limit, however it arrives', async () => {
    const huge = `${withTypes(2)}# ${'x'.repeat(MAX_ONTOLOGY_BYTES)}\n`
    await as(async (ctx) => {
      const created = await createDraft(ctx.tx, workspaceId, { yaml: huge, source: 'import', author: owner.actor }).catch((e: unknown) => e)
      expect(created).toBeInstanceOf(OntologyInvalid)
      expect((created as OntologyInvalid).diagnostics).toEqual([expect.objectContaining({ code: 'ontology-too-large' })])
      const draft = await createDraft(ctx.tx, workspaceId, { yaml: withTypes(2), source: 'editor', author: owner.actor })
      await expect(updateDraft(ctx.tx, workspaceId, draft.id, { yaml: huge })).rejects.toBeInstanceOf(OntologyInvalid)
      await discardDraft(ctx.tx, workspaceId, draft.id)
    })
  })

  it('finds no version for a number that is not one', async () => {
    for (const number of [Number('abc'), 1.5, 0, -1, 2 ** 31]) {
      expect(await as((ctx) => versionByNumber(ctx.tx, workspaceId, number))).toBeNull()
    }
  })

  it('reports schema errors with their paths', async () => {
    const invalid = await as((ctx) =>
      createDraft(ctx.tx, workspaceId, {
        yaml: 'version: 1\nresourceTypes:\n  service:\n    icon: Not An Icon\n',
        source: 'import',
        author: owner.actor,
      }).catch((e: unknown) => e),
    )
    expect(invalid).toBeInstanceOf(OntologyInvalid)
    expect((invalid as OntologyInvalid).diagnostics).toEqual([
      expect.objectContaining({ code: 'ontology-invalid', message: expect.stringMatching(/^resourceTypes\.service\.icon: /) }),
    ])
  })

  it('copies another workspace’s ontology, and holds at most 5 workspaces', async () => {
    await as(async (ctx) => {
      const { workspace, version } = await createWorkspace(ctx, {
        name: 'Copy',
        slug: 'copy',
        start: { copyFrom: workspaceId },
        publisher: owner,
      })
      expect(version.yaml).toBe((await headOf(ctx.tx, workspaceId))?.yaml)
      expect(version.source).toBe('copy:versions')
      expect(workspace.slug).toBe('copy')
    })
    // A store held to five workspaces, as Docket Cloud's beta holds an organisation.
    const limited = org.limited({ workspaces: 5 })
    for (const slug of ['three', 'four', 'five']) {
      await limited.run((ctx) => createWorkspace(ctx, { name: slug, slug, start: { template: 'lean-catalogue' }, publisher: owner }))
    }
    await expect(
      limited.run((ctx) => createWorkspace(ctx, { name: 'Six', slug: 'six', start: { template: 'sdlc' }, publisher: owner })),
    ).rejects.toMatchObject({ code: 'limit' })
    // Unlimited by default.
    await as((ctx) => createWorkspace(ctx, { name: 'Six', slug: 'six', start: { template: 'sdlc' }, publisher: owner }))
  })
})

describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('proposeOntologyChange over $name', (kind) => {
  let org: TestStore
  let workspaceId: string
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.as(fn)

  beforeAll(async () => {
    org = await createTestStore(kind)
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

describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('publishOntologyChange over $name', (kind) => {
  let org: TestStore
  let workspaceId: string
  let writer: Writer
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.as(fn)
  const rename = 'resourceTypes:\n  pod: null\n  container:\n    description: A running container.\n    icon: container\n'

  beforeAll(async () => {
    org = await createTestStore(kind)
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
