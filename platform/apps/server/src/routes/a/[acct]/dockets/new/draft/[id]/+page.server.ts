// SPDX-License-Identifier: AGPL-3.0-only
import { ATTRIBUTE_TYPES, EVIDENCE_LOCATION_FIELDS, ICON_NAMES, WorkspaceError, connectedRepositories, spaceById } from '@docket/platform-canonical-store'
import {
  OntologyInvalid,
  VersionNotFound,
  acceptDocketDraft,
  discardDocketDraft,
  docketDraftById,
  updateDocketDraft,
  type DocketDraft,
} from '@docket/platform-ontology-service'
import { spacePlace } from '@docket/platform-tenancy'
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit'

import { afterFirstDocket } from '$lib/onboarding'
import { giveInitialAccess } from '$lib/server/new-docket'
import { forgetOnboardingDraft, onboardingDraft } from '$lib/server/onboarding'
import { authoriseAnywhere, orgAccess, recordAudit, type OrgAccess } from '$lib/server/request'
import { directory, registry } from '$lib/server/trust'
import { actorNames, docketLimitOf, formText, inOrg, publisherOf } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/**
 * A new docket's drafted ontology, in the ontology editor before the docket
 * exists: the usual tabs and change check (against no documents), saved as
 * its author goes, and "Create docket" makes the docket with it as v1, in the
 * space New docket was opened from, with the initial access chosen there. Only
 * its author opens it, while they may still add dockets to that space; anyone
 * else gets 404, as for a draft that is gone.
 */

/** Refuses a draft whose author may no longer add dockets to its space. */
function mayCreateIn(access: OrgAccess, draft: Pick<DocketDraft, 'spaceId'>): void {
  if (!access.capsAt(spacePlace(draft.spaceId)).has('create')) error(403, 'You do not have access to that.')
}

export const load: PageServerLoad = async (event) => {
  const access = await orgAccess(event)
  authoriseAnywhere(access, 'create')
  const { actor } = publisherOf(event)
  const read = await inOrg(access, async (ctx) => {
    const draft = await docketDraftById(ctx.tx, event.params.id, actor)
    if (!draft) error(404, 'Not found')
    mayCreateIn(access, draft)
    return {
      draft,
      space: await spaceById(ctx.tx, draft.spaceId),
      people: await directory(access, ctx),
      registered: await registry(ctx, null),
      repositories: await connectedRepositories(ctx),
    }
  })
  const name = await actorNames(access)
  return {
    onboarding: onboardingDraft(event),
    pending: {
      id: read.draft.id,
      name: read.draft.name,
      slug: read.draft.slug,
      yaml: read.draft.yaml,
      message: read.draft.message,
      source: read.draft.source,
      author: name(read.draft.author),
      space: read.space ? { slug: read.space.slug, name: read.space.name } : null,
      access: read.draft.access.length,
    },
    usage: { types: {}, relationships: {} },
    trust: { people: read.people, registered: read.registered, repositories: read.repositories, records: [], manage: access.can('settings') },
    vocabulary: { icons: [...ICON_NAMES], attributeTypes: [...ATTRIBUTE_TYPES], locationFields: [...EVIDENCE_LOCATION_FIELDS] },
  }
}

const invalid = (caught: OntologyInvalid) =>
  fail(400, { problem: 'That is not a valid docket ontology.', diagnostics: caught.diagnostics.map((d) => d.message) })

/** Back to New docket: its space's, when the draft's space is known. */
const picker = (event: RequestEvent, space?: string | null) => (space ? `/a/${event.params.acct}/s/${space}/new` : `/a/${event.params.acct}/dockets/new`)

export const actions: Actions = {
  save: async (event) => {
    const access = await orgAccess(event)
    authoriseAnywhere(access, 'create')
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
    authoriseAnywhere(access, 'create')
    const { actor } = publisherOf(event)
    let space: string | null
    try {
      space = await inOrg(access, async (ctx) => {
        const draft = await docketDraftById(ctx.tx, event.params.id, actor)
        await discardDocketDraft(ctx.tx, event.params.id, actor)
        await recordAudit(ctx.tx, event, { action: 'workspace.draft.discard', orgId: access.org.id, target: [`docket-draft:${event.params.id}`] })
        return draft ? ((await spaceById(ctx.tx, draft.spaceId))?.slug ?? null) : null
      })
    } catch (caught) {
      if (caught instanceof VersionNotFound) return fail(404, { problem: caught.message })
      throw caught
    }
    redirect(303, picker(event, space))
  },

  /** "Create docket": the docket is made with the editor's text as its first published version, and the draft goes. */
  publish: async (event) => {
    const access = await orgAccess(event)
    authoriseAnywhere(access, 'create')
    const form = await event.request.formData()
    const yaml = formText(form, 'yaml')
    const message = String(form.get('message') ?? '').trim() || null
    const publisher = publisherOf(event)
    let made: { workspace: { id: string; slug: string; spaceId: string }; access: DocketDraft['access'] }
    const docketLimit = await docketLimitOf(access.org.id)
    try {
      made = await inOrg(access, async (ctx) => {
        const pending = await docketDraftById(ctx.tx, event.params.id, publisher.actor)
        if (pending) mayCreateIn(access, pending)
        const { workspace, version, draft } = await acceptDocketDraft(ctx, event.params.id, {
          ...(yaml ? { yaml } : {}),
          message,
          publisher,
          requestId: event.locals.requestId,
          docketLimit,
        })
        await recordAudit(ctx.tx, event, {
          action: 'workspace.create',
          orgId: access.org.id,
          workspaceId: workspace.id,
          target: [`workspace:${workspace.id}`, `ontology:v${version.number}`, `docket-draft:${event.params.id}`, `space:${workspace.spaceId}`],
          args: { slug: workspace.slug, source: version.source },
        })
        return { workspace, access: draft.access }
      })
    } catch (caught) {
      if (caught instanceof OntologyInvalid) return invalid(caught)
      if (caught instanceof WorkspaceError) return fail(400, { problem: `${caught.message} Discard this draft and describe the docket again under another address.` })
      if (caught instanceof VersionNotFound) return fail(404, { problem: caught.message })
      throw caught
    }
    // Its initial access, chosen on New docket, as its creator; anything that could not be given shows on its Access tab.
    const problem = await giveInitialAccess(event, access, made.workspace, made.access)
    if (problem) redirect(303, `/a/${event.params.acct}/d/${made.workspace.slug}/access?problem=${encodeURIComponent(problem)}`)
    // Described during signing up (step 4): on to step 5.
    if (onboardingDraft(event)) {
      forgetOnboardingDraft(event)
      redirect(303, afterFirstDocket(event.params.acct, made.workspace.slug))
    }
    redirect(303, `/a/${event.params.acct}/d/${made.workspace.slug}/ontology`)
  },
}
