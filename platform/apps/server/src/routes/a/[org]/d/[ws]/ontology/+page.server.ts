// SPDX-License-Identifier: AGPL-3.0-only
import {
  ATTRIBUTE_TYPES,
  EVIDENCE_LOCATION_FIELDS,
  ICON_NAMES,
  connectedRepositories,
  postgresSource,
  readCanonical,
  readWorkspace,
} from '@docket/platform-canonical-store'
import {
  DISPOSITIONS,
  MigrationInvalid,
  OntologyBreakingChange,
  OntologyInvalid,
  OntologyNarrowingChange,
  StaleDraft,
  TEMPLATES,
  VersionNotFound,
  createDraft,
  discardDraft,
  headOf,
  isTemplateId,
  listDrafts,
  migrationSteps,
  publish,
  template,
  updateDraft,
  versionById,
  type Disposition,
  type Migration,
} from '@docket/platform-ontology-service'
import { fail, redirect, type RequestEvent } from '@sveltejs/kit'

import { ACCOUNT } from '@docket/platform-tenancy'

import { authorise, recordAudit } from '$lib/server/request'
import { directory, registry } from '$lib/server/trust'
import { actorNames, formText, inWorkspace, publisherOf } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async (event) => {
  const draftId = event.url.searchParams.get('draft')
  const read = await inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, 'read')
    const head = await headOf(ctx.tx, workspace.id)
    const drafts = access.can('propose') ? await listDrafts(ctx.tx, workspace.id) : []
    const draft = draftId && access.can('propose') ? await versionById(ctx.tx, workspace.id, draftId) : null
    // What the documents use, so the editor can say what a change touches.
    const { documents } = await readCanonical(postgresSource(ctx, workspace.id))
    const types: Record<string, number> = {}
    const relationships: Record<string, number> = {}
    for (const document of documents) {
      types[document.type] = (types[document.type] ?? 0) + 1
      for (const link of document.links) relationships[link.rel] = (relationships[link.rel] ?? 0) + 1
    }
    // What the org attests about sources, which the Sources tab shows and the Policies tab's preview scores with.
    const people = await directory(access, ctx)
    const registered = await registry(ctx, null)
    const repositories = await connectedRepositories(ctx)
    // The records a sample observation can be added to, in the preview.
    const records = (await readWorkspace(ctx, workspace.id)).entities
      .map((entity) => ({ id: entity.id, title: entity.title, type: entity.type, confidence: entity.confidence }))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, 500)
    return {
      access,
      head,
      drafts,
      draft: draft?.status === 'draft' ? draft : null,
      usage: { types, relationships },
      trust: { people, registered, repositories, records },
    }
  })
  const name = await actorNames(read.access)
  return {
    propose: read.access.can('propose'),
    publish: read.access.can('publish'),
    head: read.head ? { number: read.head.number ?? 0, yaml: read.head.yaml, hash: read.head.yamlHash } : null,
    drafts: read.drafts.map((draft) => ({
      id: draft.id,
      author: name(draft.author),
      updatedAt: draft.updatedAt.toISOString(),
      parentNumber: draft.parentNumber,
      source: draft.source,
      message: draft.message,
    })),
    draft: read.draft
      ? {
          id: read.draft.id,
          yaml: read.draft.yaml,
          parentNumber: read.draft.parentNumber ?? 0,
          message: read.draft.message,
          source: read.draft.source,
          author: name(read.draft.author),
        }
      : null,
    usage: read.usage,
    trust: { ...read.trust, manage: read.access.capsAt(ACCOUNT).has('settings') },
    templates: TEMPLATES.map(({ id, name }) => ({ id, name })),
    vocabulary: { icons: [...ICON_NAMES], attributeTypes: [...ATTRIBUTE_TYPES], locationFields: [...EVIDENCE_LOCATION_FIELDS] },
  }
}

const here = (event: RequestEvent, draftId?: string) =>
  `/a/${event.params.org}/d/${event.params.ws}/ontology${draftId ? `?draft=${draftId}` : ''}`

const invalid = (caught: OntologyInvalid) =>
  fail(400, { problem: 'That is not a valid docket ontology.', diagnostics: caught.diagnostics.map((d) => d.message) })

function migrationOf(form: FormData): Migration[] | string {
  const text = String(form.get('migration') ?? '').trim()
  if (!text) return []
  try {
    return migrationSteps(JSON.parse(text)) ?? 'The migration is not a list.'
  } catch {
    return 'The migration is not readable.'
  }
}

function dispositionsOf(form: FormData): Record<string, Disposition> {
  try {
    const parsed: unknown = JSON.parse(String(form.get('dispositions') ?? '{}'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, Disposition] => DISPOSITIONS.includes(entry[1] as Disposition)),
    )
  } catch {
    return {}
  }
}

export const actions: Actions = {
  /** Starts a draft from the head or a template. */
  draft: async (event) => {
    const form = await event.request.formData()
    const from = String(form.get('from') ?? 'head')
    const publisher = publisherOf(event)
    const created = await inWorkspace(event, async ({ access, workspace, ctx }) => {
      authorise(access, 'propose')
      const head = await headOf(ctx.tx, workspace.id)
      const id = from.startsWith('template:') ? from.slice('template:'.length) : null
      const yaml = id && isTemplateId(id) ? template(id).yaml : (head?.yaml ?? template('blank').yaml)
      const draft = await createDraft(ctx.tx, workspace.id, { yaml, source: id ? from : 'editor', author: publisher.actor })
      await recordAudit(ctx.tx, event, {
        action: 'ontology.draft.create',
        orgId: access.org.id,
        workspaceId: workspace.id,
        target: [`ontology-draft:${draft.id}`],
        args: { from },
      })
      return draft
    })
    redirect(303, here(event, created.id))
  },

  /** Imports an `entities.yaml` as a draft (§13.4): it goes through the same checks before it can publish. */
  import: async (event) => {
    const form = await event.request.formData()
    const file = form.get('file')
    const text = file instanceof File && file.size > 0 ? await file.text() : formText(form, 'yaml')
    if (!text.trim()) return fail(400, { problem: 'Choose an entities.yaml file, or paste one.' })
    const publisher = publisherOf(event)
    let draftId: string
    try {
      draftId = await inWorkspace(event, async ({ access, workspace, ctx }) => {
        authorise(access, 'propose')
        const draft = await createDraft(ctx.tx, workspace.id, { yaml: text, source: 'import', author: publisher.actor, message: 'Imported' })
        await recordAudit(ctx.tx, event, {
          action: 'ontology.import',
          orgId: access.org.id,
          workspaceId: workspace.id,
          target: [`ontology-draft:${draft.id}`],
        })
        return draft.id
      })
    } catch (caught) {
      if (caught instanceof OntologyInvalid) return invalid(caught)
      throw caught
    }
    redirect(303, here(event, draftId))
  },

  save: async (event) => {
    const form = await event.request.formData()
    const draftId = String(form.get('draft') ?? '')
    try {
      await inWorkspace(event, async ({ access, workspace, ctx }) => {
        authorise(access, 'propose')
        await updateDraft(ctx.tx, workspace.id, draftId, {
          yaml: formText(form, 'yaml'),
          message: String(form.get('message') ?? '').trim() || null,
          rebase: form.get('rebase') === 'on',
        })
        await recordAudit(ctx.tx, event, {
          action: form.get('rebase') === 'on' ? 'ontology.draft.rebase' : 'ontology.draft.save',
          orgId: access.org.id,
          workspaceId: workspace.id,
          target: [`ontology-draft:${draftId}`],
        })
      })
    } catch (caught) {
      if (caught instanceof OntologyInvalid) return invalid(caught)
      if (caught instanceof VersionNotFound) return fail(404, { problem: caught.message })
      throw caught
    }
    return { flash: form.get('rebase') === 'on' ? 'Draft rebased onto the head. Check it again before you publish.' : 'Draft saved.' }
  },

  discard: async (event) => {
    const form = await event.request.formData()
    const draftId = String(form.get('draft') ?? '')
    await inWorkspace(event, async ({ access, workspace, ctx }) => {
      authorise(access, 'propose')
      await discardDraft(ctx.tx, workspace.id, draftId)
      await recordAudit(ctx.tx, event, {
        action: 'ontology.draft.discard',
        orgId: access.org.id,
        workspaceId: workspace.id,
        target: [`ontology-draft:${draftId}`],
      })
    })
    redirect(303, here(event))
  },

  /**
   * Saves the draft, then publishes it (§13.5): blocked while a breaking change
   * leaves a resource unknown that has no disposition, and while it narrows
   * without "publish anyway".
   */
  publish: async (event) => {
    const form = await event.request.formData()
    const draftId = String(form.get('draft') ?? '')
    const yaml = formText(form, 'yaml')
    const message = String(form.get('message') ?? '').trim() || null
    const expectedHead = Number(form.get('expectedHead') ?? -1)
    const migration = migrationOf(form)
    if (typeof migration === 'string') return fail(400, { problem: migration })
    const publisher = publisherOf(event)
    try {
      if (yaml) {
        await inWorkspace(event, async ({ access, workspace, ctx }) => {
          authorise(access, 'propose')
          await updateDraft(ctx.tx, workspace.id, draftId, { yaml, message })
        })
      }
      const version = await inWorkspace(event, async ({ access, workspace, ctx }) => {
        authorise(access, 'publish')
        const published = await publish(ctx, workspace.id, draftId, {
          expectedHead,
          migration,
          acceptNarrowing: form.get('acceptNarrowing') === 'on',
          dispositions: dispositionsOf(form),
          publisher,
          message,
          requestId: event.locals.requestId,
        })
        await recordAudit(ctx.tx, event, {
          action: 'ontology.publish',
          orgId: access.org.id,
          workspaceId: workspace.id,
          target: [`ontology:v${published.number}`, ...published.rewritten.map((document) => document.resourceId)],
          args: { classification: published.checkResult?.classification, migration, dispositions: published.dispositions },
        })
        return published
      })
      redirect(303, `/a/${event.params.org}/d/${event.params.ws}/ontology/history?published=${version.number}`)
    } catch (caught) {
      if (caught instanceof OntologyInvalid) return invalid(caught)
      if (caught instanceof StaleDraft) return fail(409, { problem: `${caught.message}. Rebase the draft and check it again.` })
      if (caught instanceof OntologyBreakingChange || caught instanceof OntologyNarrowingChange) {
        return fail(422, { problem: caught.message, blocked: caught.check.classification })
      }
      if (caught instanceof MigrationInvalid) return fail(400, { problem: caught.message })
      if (caught instanceof VersionNotFound) return fail(404, { problem: caught.message })
      throw caught
    }
  },
}
