// SPDX-License-Identifier: AGPL-3.0-only
import type { StoreContext } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { OntologyInvalid, StaleDraft } from './errors.js'
import { template } from './templates.js'
import { MAX_ONTOLOGY_BYTES } from './yaml-io.js'
import { createDraft, discardDraft, headOf, listDrafts, listPublished, publish, rollback, updateDraft, versionByNumber } from './versions.js'
import { createWorkspace } from './workspaces.js'

const publisher = { actor: 'user:owner', login: 'owner' }

/** The blank template with types t2 ... t<n> added. */
function withTypes(n: number): string {
  const doc = parseDocument(template('blank').yaml)
  for (let i = 2; i <= n; i += 1) doc.setIn(['resourceTypes', `t${i}`], { description: `Type ${i}.` })
  return doc.toString()
}

describe.skipIf(!TEST_PG_URL)('ontology versions', () => {
  let org: TestOrg
  let workspaceId: string
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.withOrg(fn)

  beforeAll(async () => {
    org = await createTestOrg()
    workspaceId = await as(async (ctx) => {
      const { workspace, version } = await createWorkspace(ctx, {
        name: 'Versions',
        slug: 'versions',
        start: { template: 'blank' },
        publisher,
      })
      expect(version.number).toBe(1)
      expect(version.source).toBe('template:blank')
      // v2 ... v14, one type more each.
      for (let n = 2; n <= 14; n += 1) {
        const draft = await createDraft(ctx.tx, workspace.id, { yaml: withTypes(n), source: 'editor', author: publisher.actor })
        expect(draft.parentNumber).toBe(n - 1)
        const published = await publish(ctx, workspace.id, draft.id, { expectedHead: n - 1, publisher, message: `v${n}` })
        expect(published.number).toBe(n)
      }
      return workspace.id
    })
  })
  afterAll(() => org?.drop())

  it('refuses a draft made against v13 once the head is v14', async () => {
    const stale = await as(async (ctx) => {
      const draft = await createDraft(ctx.tx, workspaceId, { yaml: withTypes(15), source: 'editor', author: publisher.actor })
      return publish(ctx, workspaceId, draft.id, { expectedHead: 13, publisher }).catch((e: unknown) => e)
    })
    expect(stale).toBeInstanceOf(StaleDraft)
    expect(stale).toMatchObject({ expectedHead: 13, head: 14 })
    expect((await as((ctx) => headOf(ctx.tx, workspaceId)))?.number).toBe(14)
  })

  it('rolls back by publishing v15 equal to v12', async () => {
    const v15 = await as((ctx) => rollback(ctx, workspaceId, 12, { expectedHead: 14, publisher }))
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
      const draft = await createDraft(ctx.tx, workspaceId, { yaml: withTypes(3), source: 'editor', author: publisher.actor })
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
      const created = await createDraft(ctx.tx, workspaceId, { yaml: huge, source: 'import', author: publisher.actor }).catch((e: unknown) => e)
      expect(created).toBeInstanceOf(OntologyInvalid)
      expect((created as OntologyInvalid).diagnostics).toEqual([expect.objectContaining({ code: 'ontology-too-large' })])
      const draft = await createDraft(ctx.tx, workspaceId, { yaml: withTypes(2), source: 'editor', author: publisher.actor })
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
        author: publisher.actor,
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
        publisher,
      })
      expect(version.yaml).toBe((await headOf(ctx.tx, workspaceId))?.yaml)
      expect(version.source).toBe('copy:versions')
      expect(workspace.slug).toBe('copy')
    })
    for (const slug of ['three', 'four', 'five']) {
      await as((ctx) => createWorkspace(ctx, { name: slug, slug, start: { template: 'lean-catalogue' }, publisher }))
    }
    await expect(
      as((ctx) => createWorkspace(ctx, { name: 'Six', slug: 'six', start: { template: 'sdlc' }, publisher })),
    ).rejects.toMatchObject({ code: 'limit' })
  })
})
