// SPDX-License-Identifier: AGPL-3.0-only
import { parseOntology } from '@docket/platform-canonical-store'
import {
  OntologyBreakingChange,
  OntologyNarrowingChange,
  StaleDraft,
  VersionNotFound,
  createDraft,
  describeMigration,
  diffOntologies,
  listPublished,
  rollback,
  versionByNumber,
} from '@docket/platform-ontology-service'
import { fail, redirect } from '@sveltejs/kit'

import { authorise, recordAudit } from '$lib/server/request'
import { actorNames, inWorkspace, publisherOf } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/** Every published version with its author, message and structural diff from the one before (§13.2). */
export const load: PageServerLoad = async (event) => {
  const read = await inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, 'read')
    return { access, versions: await listPublished(ctx.tx, workspace.id) }
  })
  const name = await actorNames(read.access)
  const oldestFirst = [...read.versions].reverse()
  const parsed = oldestFirst.map((version) => parseOntology(version.yaml).ontology)
  const published = Number(event.url.searchParams.get('published') ?? 0)
  return {
    rollback: read.access.can('publish'),
    propose: read.access.can('propose'),
    published: published || null,
    versions: oldestFirst
      .map((version, i) => ({
        number: version.number ?? 0,
        message: version.message,
        source: version.source,
        publishedBy: name(version.publishedBy),
        publishedAt: version.publishedAt?.toISOString() ?? null,
        hash: version.yamlHash,
        classification: version.checkResult?.classification ?? 'safe',
        affected: version.checkResult?.affected.length ?? 0,
        migration: (version.migration ?? []).map(describeMigration),
        dispositions: (version.dispositions ?? []).map((d) => `${d.resourceId}: ${d.disposition.replace(/-/g, ' ')}`),
        changes: parsed[i] ? diffOntologies(i > 0 ? (parsed[i - 1] ?? null) : null, parsed[i]) : [],
        yaml: version.yaml,
      }))
      .reverse(),
  }
}

export const actions: Actions = {
  /** Publishes a new version equal to an old one; checked like any publish. */
  rollback: async (event) => {
    const form = await event.request.formData()
    const to = Number(form.get('to') ?? 0)
    const expectedHead = Number(form.get('expectedHead') ?? -1)
    const publisher = publisherOf(event)
    try {
      const version = await inWorkspace(event, async ({ access, workspace, ctx }) => {
        authorise(access, 'publish')
        const published = await rollback(ctx, workspace.id, to, { expectedHead, publisher, requestId: event.locals.requestId })
        await recordAudit(ctx.tx, event, {
          action: 'ontology.rollback',
          orgId: access.org.id,
          workspaceId: workspace.id,
          target: [`ontology:v${published.number}`, `ontology:v${to}`],
        })
        return published
      })
      redirect(303, `?published=${version.number}`)
    } catch (caught) {
      if (caught instanceof StaleDraft) return fail(409, { problem: `${caught.message}. Reload and try again.` })
      if (caught instanceof OntologyBreakingChange || caught instanceof OntologyNarrowingChange) {
        return fail(422, {
          problem: `Rolling back to v${to} would give ${caught.check.affected.length} resource(s) new diagnostics. Open it as a draft to see them and add a migration.`,
          to,
        })
      }
      if (caught instanceof VersionNotFound) return fail(404, { problem: caught.message })
      throw caught
    }
  },

  /** Opens an old version as a draft, to edit or migrate before publishing it again. */
  draft: async (event) => {
    const form = await event.request.formData()
    const from = Number(form.get('from') ?? 0)
    const publisher = publisherOf(event)
    const draftId = await inWorkspace(event, async ({ access, workspace, ctx }) => {
      authorise(access, 'propose')
      const version = await versionByNumber(ctx.tx, workspace.id, from)
      if (!version) return null
      const draft = await createDraft(ctx.tx, workspace.id, {
        yaml: version.yaml,
        source: `rollback:v${from}`,
        author: publisher.actor,
        message: `Back to v${from}`,
      })
      await recordAudit(ctx.tx, event, {
        action: 'ontology.draft.create',
        orgId: access.org.id,
        workspaceId: workspace.id,
        target: [`ontology-draft:${draft.id}`],
        args: { from: `v${from}` },
      })
      return draft.id
    })
    if (!draftId) return fail(404, { problem: `No version ${from}.` })
    redirect(303, `/o/${event.params.org}/w/${event.params.ws}/ontology?draft=${draftId}`)
  },
}
