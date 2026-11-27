// SPDX-License-Identifier: AGPL-3.0-only
import { listIngests, liveSupersessions, putDocument, readDocument, supersedeResource, type StoreContext } from '@docket/platform-canonical-store'
import { createTestOrg, readFixture, type Fixture, type TestOrg } from '@docket/platform-canonical-store/testing'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { checkDraft } from './check.js'
import { OntologyBreakingChange, OntologyNarrowingChange } from './errors.js'
import type { Disposition } from './check.js'
import type { Migration } from './migrations.js'
import { createDraft, headOf, publish, versionByNumber } from './versions.js'
import { createWorkspace } from './workspaces.js'

/** The fixture's ontology with one edit, made the way the editor makes it: on the YAML document. */
function edit(yaml: string, change: (doc: ReturnType<typeof parseDocument>) => void): string {
  const doc = parseDocument(yaml)
  change(doc)
  return doc.toString()
}

describe.skipIf(!TEST_PG_URL)('checkDraft over a workspace of 12 documents', () => {
  let org: TestOrg
  let fixture: Fixture
  let workspaceId: string
  const publisher = { actor: 'user:publisher', login: 'alice' }
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.withOrg(fn)

  beforeAll(async () => {
    org = await createTestOrg()
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

describe.skipIf(!TEST_PG_URL)('the breaking-change gate when the broken documents come from a repo or the CLI', () => {
  let org: TestOrg
  let fixture: Fixture
  let workspaceId: string
  const publisher = { actor: 'user:publisher', login: 'alice' }
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.withOrg(fn)
  const attempt = (draft: string, options: { migration?: Migration[]; dispositions?: Record<string, Disposition> }) =>
    as(async (ctx) => {
      const created = await createDraft(ctx.tx, workspaceId, { yaml: draft, source: 'editor', author: publisher.actor })
      return publish(ctx, workspaceId, created.id, { expectedHead: 1, publisher, acceptNarrowing: true, ...options })
    })

  beforeAll(async () => {
    org = await createTestOrg()
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

describe.skipIf(!TEST_PG_URL)('a change that moves confidence and nothing else', () => {
  let org: TestOrg
  let fixture: Fixture
  let workspaceId: string
  const publisher = { actor: 'user:publisher', login: 'alice' }
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.withOrg(fn)
  /** The fixture's policies with one score changed. */
  const priced = (name: string, score: number) =>
    edit(fixture.ontology, (doc) => {
      const index = (doc.toJS() as { trust: { policies: { name: string }[] } }).trust.policies.findIndex((policy) => policy.name === name)
      doc.setIn(['trust', 'policies', index, 'score'], score)
    })

  beforeAll(async () => {
    org = await createTestOrg()
    fixture = await readFixture()
    workspaceId = await as(async (ctx) => {
      const { workspace } = await createWorkspace(ctx, { name: 'Platform', slug: 'platform', start: { importYaml: fixture.ontology }, publisher })
      for (const document of fixture.documents) {
        await putDocument(ctx, { workspaceId: workspace.id, ...document, origin: 'cloud', actor: 'user:seed' })
      }
      return workspace.id
    })
  })
  afterAll(() => org?.drop())

  it('is a rescore: it lists every resource and link it moves, with the band before and after', async () => {
    const check = await as((ctx) => checkDraft(ctx, workspaceId, priced('manifest evidence', 0.4)))
    expect(check.classification).toBe('rescore')
    expect(check.introduced).toEqual([])
    expect(check.changes).toEqual([{ op: '~', text: 'policy `manifest evidence`: score 0.9 → 0.4' }])
    // Orders is seen only in its manifest: established at 0.9, unverified at 0.4.
    expect(check.rescored).toContainEqual({ resourceId: 'service.orders', before: 0.9, after: 0.4, bandBefore: 'established', bandAfter: 'unverified' })
    expect(check.rescored.every((each) => each.before !== each.after)).toBe(true)
  })

  it('publishes without "publish anyway", and accepts the pending proposals the new policies carry', async () => {
    const writer = { workspaceId, actor: 'user:seed', label: 'alice (web)', channel: 'ui' as const, requestId: 'req-1', principal: 'alice' }
    const proposed = await as((ctx) =>
      supersedeResource(ctx, writer, {
        id: 'service.payments',
        by: 'service.orders',
        reason: 'Orders took over payments.',
        evidence: [{ source: 'code', path: 'src/payments.ts' }],
      }),
    )
    // Code is worth 0.6 here, under the 0.75 bar.
    expect(proposed.proposal).toEqual(expect.objectContaining({ status: 'pending', score: 0.6 }))

    const draft = priced('code evidence', 0.8)
    const check = await as((ctx) => checkDraft(ctx, workspaceId, draft))
    expect(check.classification).toBe('rescore')
    expect(check.proposals).toEqual([
      { proposal: proposed.proposal?.id, resource: 'service.payments', status: 'pending', before: 0.6, after: 0.8, threshold: 0.75, change: 'would-accept' },
    ])
    const published = await as(async (ctx) => {
      const created = await createDraft(ctx.tx, workspaceId, { yaml: draft, source: 'editor', author: publisher.actor })
      return publish(ctx, workspaceId, created.id, { expectedHead: 1, publisher })
    })
    expect(published.number).toBe(2)
    expect((await as((ctx) => liveSupersessions(ctx, workspaceId))).map((each) => [each.resourceId, each.status])).toEqual([['service.payments', 'accepted']])
  })
})
