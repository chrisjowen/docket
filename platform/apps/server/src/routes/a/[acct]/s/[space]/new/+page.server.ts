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
import { spacePlace } from '@docket/platform-tenancy'
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit'

import { afterFirstDocket } from '$lib/onboarding'
import { placeNames } from '$lib/server/grants'
import { accessChoices, giveInitialAccess, initialAccessFrom } from '$lib/server/new-docket'
import { onboarding, rememberOnboardingDraft } from '$lib/server/onboarding'
import { draftOntology } from '$lib/server/ontology-draft'
import { placeAccess } from '$lib/server/place-access'
import { readsDocket, recordAudit, requireUser, type OrgAccess } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { spaceAccess, type SpaceAccess } from '$lib/server/spaces'
import { docketLimitOf, formText, inOrg, publisherOf } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/**
 * New docket (tenancy v2 §2, §8), opened from a space's +: the space is
 * already chosen. Its ontology starts from a template (searched by name,
 * domain or record type), from "Describe your domain" (AI drafts one, which
 * is reviewed before the docket is made), a file or another docket; and its
 * initial access says who gets a role on it beyond everyone the space and the
 * account already give access. Creating a docket publishes its first ontology
 * version; it takes Create dockets on the space.
 */
async function creating(event: RequestEvent): Promise<SpaceAccess> {
  const scope = await spaceAccess(event)
  if (!scope.caps.has('create')) error(403, `You cannot add dockets to ${scope.space.name}.`)
  return scope
}

export const load: PageServerLoad = async (event) => {
  const { access, space } = await creating(event)
  const { actor } = publisherOf(event)
  const { workspaces, members, templates, drafts } = await getRuntime().router.withTenant(access.org.id, async (tx) => ({
    workspaces: await listWorkspaces(tx),
    members: await countMemberWorkspaces(tx),
    templates: await listOrgTemplates(tx),
    drafts: await listDocketDrafts(tx, actor),
  }))
  const choices = await accessChoices(access, space.id)
  const limit = await docketLimitOf(access.org.id)
  // Who reaches every docket in the space already: shown to whoever may give more.
  const already = choices.gives ? (await placeAccess({ access, here: spacePlace(space.id), caps: access.capsAt(spacePlace(space.id)), names: await placeNames(access.org.id) })).reach : []
  return {
    /** Step 4 of signing up (tenancy v2 §6): the same page, which then goes on to step 5. */
    onboarding: onboarding(event),
    catalogue: [...builtInCatalogue(), ...templates.map(orgCatalogueEntry)],
    copyable: workspaces.filter((workspace) => readsDocket(access, workspace.id)).map((workspace) => ({ id: workspace.id, name: workspace.name })),
    drafts: drafts
      .filter((draft) => draft.spaceId === space.id)
      .map((draft) => ({ id: draft.id, name: draft.name, slug: draft.slug, updatedAt: draft.updatedAt.toISOString() })),
    manageTemplates: access.can('settings'),
    maxDescription: MAX_DESCRIPTION,
    full: members >= limit,
    limit,
    initialAccess: {
      gives: choices.gives,
      people: choices.people.map(({ id, label }) => ({ id, label })),
      roles: choices.roles,
      already: already.map((row) => ({ id: row.id, name: row.name ?? row.login, kind: row.kind, summary: row.summary })),
    },
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
    const { access, space } = await creating(event)
    const form = await event.request.formData()
    const name = String(form.get('name') ?? '').trim()
    const slug = String(form.get('slug') ?? '').trim().toLowerCase()
    const chosenAccess = form.getAll('access_who').map((who, index) => ({ who: String(who), roleId: String(form.getAll('access_role')[index] ?? '') }))
    const values = { name, slug, start: String(form.get('start') ?? 'template'), template: String(form.get('template') ?? ''), access: chosenAccess }

    const rows = await initialAccessFrom(form, access, space.id, await accessChoices(access, space.id))
    if (typeof rows === 'string') return fail(400, { ...values, problem: rows })

    // Described: AI drafts the ontology, and the draft is reviewed in the editor before the docket is made.
    if (values.start === 'describe') {
      const description = formText(form, 'description').trim()
      const described = { ...values, description }
      if (!description) return fail(400, { ...described, problem: 'Describe what the docket should keep track of.' })
      if (description.length > MAX_DESCRIPTION) return fail(400, { ...described, problem: `Describe it in at most ${MAX_DESCRIPTION} characters.` })
      const limit = await docketLimitOf(access.org.id)
      const problem = await inOrg(access, async (ctx) =>
        (await countMemberWorkspaces(ctx.tx)) >= limit ? `This account holds at most ${limit} dockets.` : newDocketProblem(ctx.tx, { name, slug }),
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
          spaceId: space.id,
          access: rows,
        })
        await recordAudit(ctx.tx, event, {
          action: 'workspace.draft',
          orgId: access.org.id,
          target: [`docket-draft:${created.id}`, `space:${space.id}`],
          args: { slug, template: drafted.template.id, space: space.slug },
        })
        return created
      })
      if (onboarding(event)) rememberOnboardingDraft(event, access.org.slug, draft.id)
      redirect(303, `/a/${access.org.slug}/dockets/new/draft/${draft.id}`)
    }

    const start = await startOf(form)
    if (typeof start === 'string') return fail(400, { ...values, problem: start })
    // A copy reads the other docket's ontology, so it must be one the member reaches.
    if ('copyFrom' in start && !readsDocket(access, start.copyFrom)) return fail(400, { ...values, problem: 'Choose the docket to copy.' })
    let created: { slug: string; problem: string | null }
    const docketLimit = await docketLimitOf(access.org.id)
    try {
      const workspace = await inOrg(access, async (ctx) => {
        const { workspace, version } = await createWorkspace(ctx, {
          name,
          slug,
          start,
          spaceId: space.id,
          docketLimit,
          publisher: publisherOf(event),
          requestId: event.locals.requestId,
        })
        await recordAudit(ctx.tx, event, {
          action: 'workspace.create',
          orgId: access.org.id,
          workspaceId: workspace.id,
          target: [`workspace:${workspace.id}`, `ontology:v${version.number}`, `space:${space.id}`],
          args: { slug, source: version.source, space: space.slug },
        })
        return workspace
      })
      created = { slug: workspace.slug, problem: await giveInitialAccess(event, access, workspace, rows) }
    } catch (caught) {
      if (caught instanceof WorkspaceError || caught instanceof VersionNotFound) return fail(400, { ...values, problem: caught.message })
      if (caught instanceof OntologyInvalid) {
        return fail(400, { ...values, problem: 'That file is not a docket ontology.', diagnostics: caught.diagnostics.map((d) => d.message) })
      }
      throw caught
    }
    // Made, but its initial access could not all be given: its Access tab says so and can give it.
    if (created.problem) redirect(303, `/a/${access.org.slug}/d/${created.slug}/access?problem=${encodeURIComponent(created.problem)}`)
    if (onboarding(event)) redirect(303, afterFirstDocket(access.org.slug, created.slug))
    redirect(303, `/a/${access.org.slug}/d/${created.slug}/ontology`)
  },
}
