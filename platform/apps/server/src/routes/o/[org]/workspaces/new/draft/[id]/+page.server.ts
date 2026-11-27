// SPDX-License-Identifier: AGPL-3.0-only
import { ATTRIBUTE_TYPES, EVIDENCE_LOCATION_FIELDS, ICON_NAMES, WorkspaceError, connectedRepositories } from '@docket/platform-canonical-store'
import {
  OntologyInvalid,
  VersionNotFound,
  acceptDocketDraft,
  discardDocketDraft,
  docketDraftById,
  updateDocketDraft,
} from '@docket/platform-ontology-service'
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit'

import { authorise, orgAccess, recordAudit } from '$lib/server/request'
import { directory, registry } from '$lib/server/trust'
import { actorNames, formText, inOrg, publisherOf } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/**
 * A new docket's drafted ontology, in the ontology editor before the docket
 * exists: the usual tabs and change check (against no documents), saved as
 * its author goes, and "Create docket" makes the docket with it as v1. Only
 * its author opens it; anyone else gets 404, as for a draft that is gone.
 */
export const load: PageServerLoad = async (event) => {
  const access = await orgAccess(event)
  authorise(access, 'ontology.publish')
  const { actor } = publisherOf(event)
  const read = await inOrg(access, async (ctx) => {
    const draft = await docketDraftById(ctx.tx, event.params.id, actor)
    if (!draft) error(404, 'Not found')
    return {
      draft,
      people: await directory(access, ctx),
      registered: await registry(ctx, null),
      repositories: await connectedRepositories(ctx),
    }
  })
  const name = await actorNames(access)
  return {
    pending: {
      id: read.draft.id,
      name: read.draft.name,
      slug: read.draft.slug,
      yaml: read.draft.yaml,
      message: read.draft.message,
      source: read.draft.source,
      author: name(read.draft.author),
    },
    usage: { types: {}, relationships: {} },
    trust: { people: read.people, registered: read.registered, repositories: read.repositories, records: [], manage: access.can('trust.manage') },
    vocabulary: { icons: [...ICON_NAMES], attributeTypes: [...ATTRIBUTE_TYPES], locationFields: [...EVIDENCE_LOCATION_FIELDS] },
  }
}

const invalid = (caught: OntologyInvalid) =>
  fail(400, { problem: 'That is not a valid docket ontology.', diagnostics: caught.diagnostics.map((d) => d.message) })

const picker = (event: RequestEvent) => `/o/${event.params.org}/workspaces/new`

export const actions: Actions = {
  save: async (event) => {
    const access = await orgAccess(event)
    authorise(access, 'ontology.publish')
    const form = await event.request.formData()
    const { actor } = publisherOf(event)
    try {
      await inOrg(access, (ctx) =>
        updateDocketDraft(ctx.tx, event.params.id, actor, { yaml: formText(form, 'yaml'), message: String(form.get('message') ?? '').trim() || null }),
      )
    } catch (caught) {
      if (caught instanceof OntologyInvalid) return invalid(caught)
      if (caught instanceof VersionNotFound) return fail(404, { problem: caught.message })
      throw caught
    }
    return { flash: 'Draft saved.' }
  },

  discard: async (event) => {
    const access = await orgAccess(event)
    authorise(access, 'ontology.publish')
    const { actor } = publisherOf(event)
    try {
      await inOrg(access, async (ctx) => {
        await discardDocketDraft(ctx.tx, event.params.id, actor)
        await recordAudit(ctx.tx, event, { action: 'workspace.draft.discard', orgId: access.org.id, target: [`docket-draft:${event.params.id}`] })
      })
    } catch (caught) {
      if (caught instanceof VersionNotFound) return fail(404, { problem: caught.message })
      throw caught
    }
    redirect(303, picker(event))
  },

  /** "Create docket": the docket is made with the editor's text as its first published version, and the draft goes. */
  publish: async (event) => {
    const access = await orgAccess(event)
    authorise(access, 'ontology.publish')
    const form = await event.request.formData()
    const yaml = formText(form, 'yaml')
    const message = String(form.get('message') ?? '').trim() || null
    const publisher = publisherOf(event)
    let slug: string
    try {
      slug = await inOrg(access, async (ctx) => {
        const { workspace, version } = await acceptDocketDraft(ctx, event.params.id, {
          ...(yaml ? { yaml } : {}),
          message,
          publisher,
          requestId: event.locals.requestId,
        })
        await recordAudit(ctx.tx, event, {
          action: 'workspace.create',
          orgId: access.org.id,
          workspaceId: workspace.id,
          target: [`workspace:${workspace.id}`, `ontology:v${version.number}`, `docket-draft:${event.params.id}`],
          args: { slug: workspace.slug, source: version.source },
        })
        return workspace.slug
      })
    } catch (caught) {
      if (caught instanceof OntologyInvalid) return invalid(caught)
      if (caught instanceof WorkspaceError) return fail(400, { problem: `${caught.message} Discard this draft and describe the docket again under another address.` })
      if (caught instanceof VersionNotFound) return fail(404, { problem: caught.message })
      throw caught
    }
    redirect(303, `/o/${event.params.org}/w/${slug}/ontology`)
  },
}
