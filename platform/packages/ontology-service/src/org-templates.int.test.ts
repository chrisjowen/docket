// SPDX-License-Identifier: AGPL-3.0-only
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import type { Tx } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { acceptDocketDraft, checkNewDocket, createDocketDraft, discardDocketDraft, docketDraftById, listDocketDrafts, MAX_DOCKET_DRAFTS, newDocketProblem, updateDocketDraft } from './docket-drafts.js'
import { OntologyInvalid, VersionNotFound } from './errors.js'
import { deleteOrgTemplate, listOrgTemplates, orgCatalogueEntry, orgTemplateById, saveOrgTemplate, TemplateError, updateOrgTemplate } from './org-templates.js'
import { template } from './templates.js'
import { headOf } from './versions.js'
import { createWorkspace } from './workspaces.js'

const publisher = { actor: 'user:owner', login: 'owner' }

describe.skipIf(!TEST_PG_URL)("the org's own templates", () => {
  let org: TestOrg
  let crm: string
  let research: string

  beforeAll(async () => {
    org = await createTestOrg()
    ;[crm, research] = await org.withOrg(async (ctx) => [
      (await createWorkspace(ctx, { name: 'Sales', slug: 'sales', start: { template: 'crm' }, publisher })).workspace.id,
      (await createWorkspace(ctx, { name: 'Papers', slug: 'papers', start: { template: 'research' }, publisher })).workspace.id,
    ])
  })
  afterAll(() => org?.drop())

  it("saves a docket's published ontology, and nothing else of it, under a name", async () => {
    const saved = await org.withOrg((ctx) =>
      saveOrgTemplate(ctx.tx, { name: ' Our CRM ', description: 'How sales tracks deals.', tags: 'Sales, deals', fromWorkspaceId: crm, actor: 'user:owner' }),
    )
    expect(saved).toMatchObject({ name: 'Our CRM', description: 'How sales tracks deals.', tags: ['sales', 'deals'], fromWorkspaceId: crm, createdBy: 'user:owner' })
    expect(saved.yaml).toBe(template('crm').yaml)
    expect(orgCatalogueEntry(saved)).toMatchObject({ id: `org:${saved.id}`, kind: 'org', types: expect.arrayContaining(['account', 'opportunity']) })
    await expect(
      org.withOrg((ctx) => saveOrgTemplate(ctx.tx, { name: 'our crm', fromWorkspaceId: crm, actor: 'user:owner' })),
    ).rejects.toThrow(TemplateError)
    await expect(org.withOrg((ctx) => saveOrgTemplate(ctx.tx, { name: '', fromWorkspaceId: crm, actor: 'user:owner' }))).rejects.toThrow('1-80 characters')
    await expect(org.withOrg((ctx) => saveOrgTemplate(ctx.tx, { name: 'Nothing', fromWorkspaceId: 'nosuchdocket', actor: 'user:owner' }))).rejects.toThrow(VersionNotFound)
  })

  it('renames it, updates it from another docket, and starts a docket from it', async () => {
    const [saved] = await org.withOrg((ctx) => listOrgTemplates(ctx.tx))
    if (!saved) throw new Error('no template')
    const renamed = await org.withOrg((ctx) => updateOrgTemplate(ctx.tx, saved.id, { name: 'Field sales', description: '', tags: [], actor: 'user:admin' }))
    expect(renamed).toMatchObject({ name: 'Field sales', description: '', tags: [], updatedBy: 'user:admin', yaml: saved.yaml })
    const updated = await org.withOrg((ctx) => updateOrgTemplate(ctx.tx, saved.id, { fromWorkspaceId: research, actor: 'user:admin' }))
    expect(updated).toMatchObject({ name: 'Field sales', fromWorkspaceId: research, yaml: template('research').yaml })

    const started = await org.withOrg(async (ctx) => {
      const { workspace, version } = await createWorkspace(ctx, { name: 'From ours', slug: 'from-ours', start: { orgTemplate: saved.id }, publisher })
      return { version, head: await headOf(ctx.tx, workspace.id) }
    })
    expect(started.version).toMatchObject({ source: `org-template:${saved.id}`, message: 'Started from the Field sales template' })
    expect(started.head?.yaml).toBe(template('research').yaml)
  })

  it('deletes it; dockets started from it keep their ontology', async () => {
    const [saved] = await org.withOrg((ctx) => listOrgTemplates(ctx.tx))
    if (!saved) throw new Error('no template')
    await org.withOrg((ctx) => deleteOrgTemplate(ctx.tx, saved.id))
    expect(await org.withOrg((ctx) => orgTemplateById(ctx.tx, saved.id))).toBeNull()
    await expect(org.withOrg((ctx) => deleteOrgTemplate(ctx.tx, saved.id))).rejects.toThrow(TemplateError)
    await expect(
      org.withOrg((ctx) => createWorkspace(ctx, { name: 'Gone', slug: 'gone', start: { orgTemplate: saved.id }, publisher })),
    ).rejects.toThrow(VersionNotFound)
  })

  it("never shows one org's templates or drafts to another", async () => {
    const saved = await org.withOrg((ctx) => saveOrgTemplate(ctx.tx, { name: 'Private', fromWorkspaceId: crm, actor: 'user:owner' }))
    const draft = await org.withOrg((ctx) => createDocketDraft(ctx.tx, { name: 'Vets', slug: 'vets', yaml: template('blank').yaml, source: 'ai:blank', author: 'user:owner' }))
    const other = await org.addOrg()
    const asOther = <T>(fn: (tx: Tx) => Promise<T>) => org.router.withTenant(other.orgId, fn)
    expect(await asOther((tx) => listOrgTemplates(tx))).toEqual([])
    expect(await asOther((tx) => orgTemplateById(tx, saved.id))).toBeNull()
    expect(await asOther((tx) => docketDraftById(tx, draft.id, 'user:owner'))).toBeNull()
    await expect(asOther((tx) => deleteOrgTemplate(tx, saved.id))).rejects.toThrow(TemplateError)
    // Naming the first org's schema outright is refused: the other org's role has no rights there.
    await expect(asOther((tx) => tx.query(`SELECT * FROM org_${org.orgId}.ontology_templates`))).rejects.toThrow(/permission denied/)
    await expect(asOther((tx) => tx.query(`SELECT * FROM org_${org.orgId}.docket_drafts`))).rejects.toThrow(/permission denied/)
    expect(await org.withOrg((ctx) => orgTemplateById(ctx.tx, saved.id))).not.toBeNull()
  })
})

describe.skipIf(!TEST_PG_URL)("a new docket's draft", () => {
  let org: TestOrg

  beforeAll(async () => {
    org = await createTestOrg()
  })
  afterAll(() => org?.drop())

  it('checks the name and address before anything is drafted', async () => {
    await org.withOrg((ctx) => createWorkspace(ctx, { name: 'Taken', slug: 'taken', start: { template: 'blank' }, publisher }))
    expect(await org.withOrg((ctx) => newDocketProblem(ctx.tx, { name: 'Vets', slug: 'vets' }))).toBeNull()
    expect(await org.withOrg((ctx) => newDocketProblem(ctx.tx, { name: 'Vets', slug: 'taken' }))).toBe('A workspace already has that address.')
    expect(await org.withOrg((ctx) => newDocketProblem(ctx.tx, { name: ' ', slug: 'vets' }))).toMatch(/1-80/)
    expect(await org.withOrg((ctx) => newDocketProblem(ctx.tx, { name: 'Vets', slug: 'Bad Slug' }))).toMatch(/lowercase/)
  })

  it('is kept for its author only, until they accept it and the docket is made from it', async () => {
    const draft = await org.withOrg((ctx) =>
      createDocketDraft(ctx.tx, { name: 'Vets', slug: 'vets', yaml: template('crm').yaml, source: 'ai:crm', message: 'Drafted by AI', author: 'user:a' }),
    )
    expect(await org.withOrg((ctx) => docketDraftById(ctx.tx, draft.id, 'user:b'))).toBeNull()
    expect((await org.withOrg((ctx) => listDocketDrafts(ctx.tx, 'user:a'))).map((each) => each.id)).toEqual([draft.id])
    expect(await org.withOrg((ctx) => listDocketDrafts(ctx.tx, 'user:b'))).toEqual([])
    await expect(org.withOrg((ctx) => updateDocketDraft(ctx.tx, draft.id, 'user:b', { yaml: template('blank').yaml }))).rejects.toThrow(VersionNotFound)
    await expect(org.withOrg((ctx) => updateDocketDraft(ctx.tx, draft.id, 'user:a', { yaml: 'resourceTypes: 3' }))).rejects.toThrow(OntologyInvalid)

    // The editor's check sees no documents and no head: everything is a change from nothing.
    const check = await org.withOrg((ctx) => checkNewDocket(ctx, draft.yaml))
    expect(check).toMatchObject({ head: 0, classification: 'safe', unresolved: [] })
    expect(check.changes.length).toBeGreaterThan(0)

    await expect(
      org.withOrg((ctx) => acceptDocketDraft(ctx, draft.id, { publisher: { actor: 'user:b', login: 'b' } })),
    ).rejects.toThrow(VersionNotFound)
    const { workspace, version } = await org.withOrg((ctx) =>
      acceptDocketDraft(ctx, draft.id, { yaml: template('research').yaml, publisher: { actor: 'user:a', login: 'a' } }),
    )
    expect(workspace).toMatchObject({ name: 'Vets', slug: 'vets' })
    expect(version).toMatchObject({ number: 1, source: 'ai:crm', message: 'Drafted by AI', yaml: template('research').yaml })
    expect(await org.withOrg((ctx) => docketDraftById(ctx.tx, draft.id, 'user:a'))).toBeNull()
  })

  it("keeps a member's newest drafts, and discards on request", async () => {
    const ids: string[] = []
    for (let i = 0; i <= MAX_DOCKET_DRAFTS; i++) {
      ids.push((await org.withOrg((ctx) => createDocketDraft(ctx.tx, { name: `D${i}`, slug: `d${i}x`, yaml: template('blank').yaml, source: 'ai:blank', author: 'user:c' }))).id)
    }
    expect(await org.withOrg((ctx) => docketDraftById(ctx.tx, ids[0] as string, 'user:c'))).toBeNull()
    const newest = ids.at(-1) as string
    await org.withOrg((ctx) => discardDocketDraft(ctx.tx, newest, 'user:c'))
    expect(await org.withOrg((ctx) => docketDraftById(ctx.tx, newest, 'user:c'))).toBeNull()
  })
})
