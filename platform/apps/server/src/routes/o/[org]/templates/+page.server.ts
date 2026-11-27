// SPDX-License-Identifier: AGPL-3.0-only
import { listWorkspaces } from '@docket/platform-canonical-store'
import {
  MAX_ORG_TEMPLATES,
  TemplateError,
  VersionNotFound,
  builtInCatalogue,
  deleteOrgTemplate,
  headOf,
  listOrgTemplates,
  orgCatalogueEntry,
  saveOrgTemplate,
  updateOrgTemplate,
} from '@docket/platform-ontology-service'
import { fail, type RequestEvent } from '@sveltejs/kit'

import { authorise, orgAccess, readsDocket, recordAudit, type OrgAccess } from '$lib/server/request'
import { actorNames, inOrg, publisherOf } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/**
 * The org's ontology templates: owners and admins save a docket's published
 * ontology (never its documents) as one, rename it, update it from a docket
 * and delete it. New docket offers them beside the built-in templates, which
 * are listed here read-only.
 */
export const load: PageServerLoad = async (event) => {
  const access = await orgAccess(event)
  authorise(access, 'settings')
  const read = await inOrg(access, async (ctx) => {
    const workspaces = (await listWorkspaces(ctx.tx)).filter((workspace) => readsDocket(access, workspace.id))
    const heads = await Promise.all(workspaces.map(async (workspace) => ({ workspace, head: await headOf(ctx.tx, workspace.id) })))
    return { templates: await listOrgTemplates(ctx.tx), dockets: heads.filter((each) => each.head).map((each) => each.workspace) }
  })
  const name = await actorNames(access)
  const docketName = new Map(read.dockets.map((workspace) => [workspace.id, workspace.name]))
  return {
    templates: read.templates.map((template) => ({
      ...orgCatalogueEntry(template),
      templateId: template.id,
      from: template.fromWorkspaceId ? (docketName.get(template.fromWorkspaceId) ?? 'a deleted docket') : null,
      fromId: template.fromWorkspaceId,
      updatedBy: name(template.updatedBy),
      updatedAt: template.updatedAt.toISOString(),
    })),
    builtIn: builtInCatalogue(),
    dockets: read.dockets.map((workspace) => ({ id: workspace.id, name: workspace.name, slug: workspace.slug })),
    max: MAX_ORG_TEMPLATES,
  }
}

/** A docket named in the form, as long as the member reaches it: a template is only ever saved from one they can read. */
function docketOf(access: OrgAccess, form: FormData): string | null {
  const id = String(form.get('workspace') ?? '')
  return id && readsDocket(access, id) ? id : null
}

const details = (form: FormData) => ({
  name: String(form.get('name') ?? ''),
  description: String(form.get('description') ?? ''),
  tags: String(form.get('tags') ?? ''),
})

async function manage<T>(event: RequestEvent, fn: (access: OrgAccess, form: FormData, actor: string) => Promise<T>) {
  const access = await orgAccess(event)
  authorise(access, 'settings')
  const form = await event.request.formData()
  try {
    return await fn(access, form, publisherOf(event).actor)
  } catch (caught) {
    if (caught instanceof TemplateError || caught instanceof VersionNotFound) return fail(caught instanceof TemplateError && caught.code === 'not-found' ? 404 : 400, { problem: caught.message })
    throw caught
  }
}

export const actions: Actions = {
  save: (event) =>
    manage(event, async (access, form, actor) => {
      const workspace = docketOf(access, form)
      if (!workspace) return fail(400, { problem: 'Choose the docket to save.' })
      const saved = await inOrg(access, async (ctx) => {
        const template = await saveOrgTemplate(ctx.tx, { ...details(form), fromWorkspaceId: workspace, actor })
        await recordAudit(ctx.tx, event, { action: 'template.save', orgId: access.org.id, workspaceId: workspace, target: [`template:${template.id}`], args: { name: template.name } })
        return template
      })
      return { flash: `Saved "${saved.name}". New docket offers it now.` }
    }),

  edit: (event) =>
    manage(event, async (access, form, actor) => {
      const id = String(form.get('template') ?? '')
      const edited = await inOrg(access, async (ctx) => {
        const template = await updateOrgTemplate(ctx.tx, id, { ...details(form), actor })
        await recordAudit(ctx.tx, event, { action: 'template.edit', orgId: access.org.id, target: [`template:${template.id}`], args: { name: template.name } })
        return template
      })
      return { flash: `Saved "${edited.name}".` }
    }),

  update: (event) =>
    manage(event, async (access, form, actor) => {
      const id = String(form.get('template') ?? '')
      const workspace = docketOf(access, form)
      if (!workspace) return fail(400, { problem: 'Choose the docket to update it from.' })
      const updated = await inOrg(access, async (ctx) => {
        const template = await updateOrgTemplate(ctx.tx, id, { fromWorkspaceId: workspace, actor })
        await recordAudit(ctx.tx, event, { action: 'template.update', orgId: access.org.id, workspaceId: workspace, target: [`template:${template.id}`] })
        return template
      })
      return { flash: `"${updated.name}" now holds that docket's published ontology. Dockets already started from it keep theirs.` }
    }),

  delete: (event) =>
    manage(event, async (access, form) => {
      const id = String(form.get('template') ?? '')
      const deleted = await inOrg(access, async (ctx) => {
        const template = await deleteOrgTemplate(ctx.tx, id)
        await recordAudit(ctx.tx, event, { action: 'template.delete', orgId: access.org.id, target: [`template:${template.id}`], args: { name: template.name } })
        return template
      })
      return { flash: `Deleted "${deleted.name}". Dockets started from it keep their ontology.` }
    }),
}
