// SPDX-License-Identifier: AGPL-3.0-only
import { WorkspaceError, countMemberWorkspaces, listWorkspaces } from '@docket/platform-canonical-store'
import {
  MAX_DESCRIPTION,
  OntologyInvalid,
  TEMPLATES,
  VersionNotFound,
  builtInCatalogue,
  contentsOf,
  createDocketDraft,
  createWorkspace,
  isTemplateId,
  listDocketDrafts,
  listOrgTemplates,
  newDocketProblem,
  orgCatalogueEntry,
  orgTemplateId,
  orgTemplateKey,
  type OntologyStart,
  type StartingPoint,
} from '@docket/platform-ontology-service'
import { LIMITS } from '@docket/platform-tenancy'
import { fail, redirect } from '@sveltejs/kit'

import { draftOntology } from '$lib/server/ontology-draft'
import { authorise, orgAccess, readsDocket, recordAudit, requireUser, type OrgAccess } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { formText, inOrg, publisherOf } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/** Creating a workspace publishes its first ontology version, so it takes the publish permission (§4). */
export const load: PageServerLoad = async (event) => {
  const access = await orgAccess(event)
  authorise(access, 'create')
  const { actor } = publisherOf(event)
  const { workspaces, members, templates, drafts } = await getRuntime().router.withTenant(access.org.id, async (tx) => ({
    workspaces: await listWorkspaces(tx),
    members: await countMemberWorkspaces(tx),
    templates: await listOrgTemplates(tx),
    drafts: await listDocketDrafts(tx, actor),
  }))
  return {
    catalogue: [...builtInCatalogue(), ...templates.map(orgCatalogueEntry)],
    copyable: workspaces.filter((workspace) => readsDocket(access, workspace.id)).map((workspace) => ({ id: workspace.id, name: workspace.name })),
    drafts: drafts.map((draft) => ({ id: draft.id, name: draft.name, slug: draft.slug, updatedAt: draft.updatedAt.toISOString() })),
    manageTemplates: access.can('settings'),
    maxDescription: MAX_DESCRIPTION,
    full: members >= LIMITS.workspacesPerOrg,
    limit: LIMITS.workspacesPerOrg,
  }
}

async function startOf(form: FormData): Promise<OntologyStart | string> {
  const start = String(form.get('start') ?? '')
  if (start === 'import') {
    const file = form.get('file')
    const text = file instanceof File && file.size > 0 ? await file.text() : formText(form, 'yaml')
    if (!text.trim()) return 'Choose an entities.yaml file, or paste one.'
    return { importYaml: text }
  }
  if (start === 'copy') {
    const from = String(form.get('copyFrom') ?? '')
    return from ? { copyFrom: from } : 'Choose the docket to copy.'
  }
  const id = String(form.get('template') ?? '')
  const own = orgTemplateId(id)
  if (own) return { orgTemplate: own }
  return isTemplateId(id) ? { template: id } : 'Choose a template.'
}

/** Every template the model may start a draft from: the built-in ones and the org's own. */
async function startingPoints(access: OrgAccess): Promise<StartingPoint[]> {
  const own = await getRuntime().router.withTenant(access.org.id, (tx) => listOrgTemplates(tx))
  return [
    ...TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, types: contentsOf(t.yaml).types, yaml: t.yaml })),
    ...own.map((t) => ({ id: orgTemplateKey(t.id), name: t.name, description: t.description, types: contentsOf(t.yaml).types, yaml: t.yaml })),
  ]
}

export const actions: Actions = {
  default: async (event) => {
    const access = await orgAccess(event)
    authorise(access, 'create')
    const form = await event.request.formData()
    const name = String(form.get('name') ?? '').trim()
    const slug = String(form.get('slug') ?? '').trim().toLowerCase()
    const values = { name, slug, start: String(form.get('start') ?? 'template'), template: String(form.get('template') ?? '') }

    // Described: AI drafts the ontology, and the draft is reviewed in the editor before the docket is made.
    if (values.start === 'describe') {
      const description = formText(form, 'description').trim()
      const described = { ...values, description }
      if (!description) return fail(400, { ...described, problem: 'Describe what the docket should keep track of.' })
      if (description.length > MAX_DESCRIPTION) return fail(400, { ...described, problem: `Describe it in at most ${MAX_DESCRIPTION} characters.` })
      const problem = await inOrg(access, async (ctx) =>
        (await countMemberWorkspaces(ctx.tx)) >= LIMITS.workspacesPerOrg ? `An organisation holds at most ${LIMITS.workspacesPerOrg} workspaces in the beta.` : newDocketProblem(ctx.tx, { name, slug }),
      )
      if (problem) return fail(400, { ...described, problem })
      const user = requireUser(event)
      const publisher = publisherOf(event)
      // No transaction is held while the model writes.
      const drafted = await draftOntology({ query: getRuntime().query, orgId: access.org.id, actor: publisher.actor, userId: user.id }, description, await startingPoints(access))
      if (!drafted.ok) return fail(400, { ...described, problem: drafted.problem })
      const draft = await inOrg(access, async (ctx) => {
        const created = await createDocketDraft(ctx.tx, {
          name,
          slug,
          yaml: drafted.yaml,
          source: `ai:${drafted.template.id}`,
          message: `Drafted by AI from the ${drafted.template.name} template`,
          author: publisher.actor,
        })
        await recordAudit(ctx.tx, event, {
          action: 'workspace.draft',
          orgId: access.org.id,
          target: [`docket-draft:${created.id}`],
          args: { slug, template: drafted.template.id },
        })
        return created
      })
      redirect(303, `/o/${access.org.slug}/workspaces/new/draft/${draft.id}`)
    }

    const start = await startOf(form)
    if (typeof start === 'string') return fail(400, { ...values, problem: start })
    // A copy reads the other docket's ontology, so it must be one the member reaches.
    if ('copyFrom' in start && !readsDocket(access, start.copyFrom)) return fail(400, { ...values, problem: 'Choose the docket to copy.' })
    try {
      const created = await inOrg(access, async (ctx) => {
        const { workspace, version } = await createWorkspace(ctx, { name, slug, start, publisher: publisherOf(event), requestId: event.locals.requestId })
        await recordAudit(ctx.tx, event, {
          action: 'workspace.create',
          orgId: access.org.id,
          workspaceId: workspace.id,
          target: [`workspace:${workspace.id}`, `ontology:v${version.number}`],
          args: { slug, source: version.source },
        })
        return workspace
      })
      redirect(303, `/o/${access.org.slug}/w/${created.slug}/ontology`)
    } catch (caught) {
      if (caught instanceof WorkspaceError || caught instanceof VersionNotFound) return fail(400, { ...values, problem: caught.message })
      if (caught instanceof OntologyInvalid) {
        return fail(400, { ...values, problem: 'That file is not a docket ontology.', diagnostics: caught.diagnostics.map((d) => d.message) })
      }
      throw caught
    }
  },
}
