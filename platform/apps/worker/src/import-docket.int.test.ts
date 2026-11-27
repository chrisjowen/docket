// SPDX-License-Identifier: AGPL-3.0-only
import { join } from 'node:path'

import { listDocuments, type StoreContext } from '@docket/platform-canonical-store'
import { FIXTURE_ROOT, createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { createWorkspace, headOf, listPublished, template } from '@docket/platform-ontology-service'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isMap, parseDocument, visit } from 'yaml'

import { ImportRefused, OPERATOR, importDocketTree, readDocketTree, type DocketTree } from './import-docket.js'

const owner = { actor: 'user:owner', login: 'owner' }
const FIXTURE_DOCKET = join(FIXTURE_ROOT, '.docket')

describe.skipIf(!TEST_PG_URL)('importDocketTree', () => {
  let org: TestOrg
  let orgSlug: string
  let tree: DocketTree
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.withOrg(fn)
  const deps = () => ({ router: org.router, keyring: org.keyring })

  /** What a write leaves behind: revisions, ontology versions, outbox rows and audit events. */
  const footprint = () =>
    as(async ({ tx }) => {
      const count = async (sql: string) => Number((await tx.query<{ count: string }>(sql)).rows[0]?.count ?? 0)
      return {
        revisions: await count('SELECT count(*) FROM document_revisions'),
        versions: await count('SELECT count(*) FROM ontology_versions'),
        outbox: await count('SELECT count(*) FROM outbox'),
        audit: await count('SELECT count(*) FROM audit_event'),
      }
    })

  const workspace = (slug: string, yaml = template('blank').yaml) =>
    as(async (ctx) => (await createWorkspace(ctx, { name: slug, slug, start: { importYaml: yaml }, publisher: owner })).workspace.id)

  beforeAll(async () => {
    org = await createTestOrg()
    orgSlug = await org.router.withPlatform(async (tx) => {
      const { rows } = await tx.query<{ slug: string }>('SELECT slug FROM platform.orgs WHERE id = $1', [org.orgId])
      return rows[0]?.slug ?? ''
    })
    tree = await readDocketTree(FIXTURE_DOCKET)
  })
  afterAll(() => org?.drop())

  it('refuses an org or a workspace that does not exist, and creates neither', async () => {
    const before = await footprint()
    await expect(importDocketTree(deps(), { orgSlug: 'no-such-org', workspaceSlug: 'platform', tree })).rejects.toThrow(/No org "no-such-org"/)
    await expect(importDocketTree(deps(), { orgSlug, workspaceSlug: 'no-such-ws', tree })).rejects.toThrow(/no workspace "no-such-ws"/)
    const orgs = await org.router.withPlatform(async (tx) => (await tx.query('SELECT 1 FROM platform.orgs WHERE slug = $1', ['no-such-org'])).rowCount)
    expect(orgs).toBe(0)
    expect(await as(async ({ tx }) => (await tx.query('SELECT 1 FROM workspaces WHERE slug = $1', ['no-such-ws'])).rowCount)).toBe(0)
    expect(await footprint()).toEqual(before)
  })

  it("publishes the tree's ontology over a different one, writes every document, and audits the operator", async () => {
    const workspaceId = await workspace('platform')
    const result = await importDocketTree(deps(), { orgSlug, workspaceSlug: 'platform', tree })
    expect(result).toMatchObject({ ontologyPublished: 2, ontologyHead: 2, unchanged: 0, documents: tree.documents.length, dryRun: false })
    expect(result.written).toHaveLength(tree.documents.length)

    const { head, versions, documents, events, outbox } = await as(async (ctx) => ({
      head: await headOf(ctx.tx, workspaceId),
      versions: await listPublished(ctx.tx, workspaceId),
      documents: await listDocuments(ctx.tx, workspaceId),
      events: (await ctx.tx.query<{ action: string; actor: string }>('SELECT action, actor FROM audit_event WHERE workspace_id = $1 ORDER BY seq', [workspaceId])).rows,
      outbox: (await ctx.tx.query<{ kind: string }>('SELECT DISTINCT kind FROM outbox WHERE workspace_id = $1 AND processed_at IS NULL', [workspaceId])).rows,
    }))
    expect(head?.yaml).toBe(tree.ontology)
    expect(head).toMatchObject({ source: 'import', publishedBy: OPERATOR.actor })
    expect(versions.map((v) => v.number)).toEqual([2, 1])
    expect(documents.map((d) => d.path)).toEqual(tree.documents.map((d) => d.path))
    expect(documents.every((d) => d.origin === 'cloud' && d.createdBy === OPERATOR.actor)).toBe(true)
    expect(events).toEqual([
      { action: 'ontology.import', actor: OPERATOR.actor },
      { action: 'ontology.publish', actor: OPERATOR.actor },
      { action: 'documents.import', actor: OPERATOR.actor },
    ])
    // The worker is queued for both.
    expect(outbox.map((row) => row.kind).sort()).toEqual(['documents', 'ontology'])
  })

  it('changes nothing when run again with the same files', async () => {
    const before = await footprint()
    const result = await importDocketTree(deps(), { orgSlug, workspaceSlug: 'platform', tree })
    expect(result).toMatchObject({ ontologyPublished: null, ontologyHead: 2, written: [], unchanged: tree.documents.length })
    expect(await footprint()).toEqual(before)
  })

  it('keeps an ontology that only differs from the tree’s in formatting', async () => {
    const reformatted = parseDocument(tree.ontology).toString({ singleQuote: true })
    expect(reformatted).not.toBe(tree.ontology)
    await workspace('same', reformatted)
    const result = await importDocketTree(deps(), { orgSlug, workspaceSlug: 'same', tree })
    expect(result).toMatchObject({ ontologyPublished: null, ontologyHead: 1, written: expect.any(Array) as unknown })
    expect(result.written).toHaveLength(tree.documents.length)
  })

  it('keeps an ontology that only lists its keys in a different order from the tree’s', async () => {
    const reordered = parseDocument(tree.ontology)
    visit(reordered, {
      Map(_, map) {
        if (isMap(map)) map.items.reverse()
      },
    })
    expect(reordered.toString()).not.toBe(tree.ontology)
    await workspace('reordered', reordered.toString())
    const result = await importDocketTree(deps(), { orgSlug, workspaceSlug: 'reordered', tree })
    expect(result).toMatchObject({ ontologyPublished: null, ontologyHead: 1 })
  })

  it('writes nothing on a dry run, but says what it would do', async () => {
    await workspace('dry')
    const before = await footprint()
    const result = await importDocketTree(deps(), { orgSlug, workspaceSlug: 'dry', tree, dryRun: true })
    expect(result).toMatchObject({ dryRun: true, ontologyPublished: 2 })
    expect(result.written).toHaveLength(tree.documents.length)
    expect(await footprint()).toEqual(before)
  })

  it('refuses, writing nothing, when a document does not validate against the ontology', async () => {
    await workspace('invalid')
    const before = await footprint()
    const stray = { path: '.docket/resources/widget/w.md', raw: '---\nid: widget.w\ntype: widget\ntitle: W\n---\n\nA widget.\n' }
    const refused = await importDocketTree(deps(), { orgSlug, workspaceSlug: 'invalid', tree: { ...tree, documents: [...tree.documents, stray] } }).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(ImportRefused)
    expect((refused as ImportRefused).problems.join('\n')).toContain('.docket/resources/widget/w.md')
    expect(await footprint()).toEqual(before)
  })

  it('refuses a tree with a file that is not a docket document, before connecting', async () => {
    const broken = { ...tree, documents: [...tree.documents, { path: '.docket/notes.md', raw: 'just notes\n' }] }
    await expect(importDocketTree(deps(), { orgSlug, workspaceSlug: 'platform', tree: broken })).rejects.toThrow(/\.docket\/notes\.md/)
  })
})
