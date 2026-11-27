// SPDX-License-Identifier: AGPL-3.0-only
import {
  DocumentError,
  checkDocument,
  cloudDocumentPath,
  listDocuments,
  postgresSource,
  putDocument,
  retireDocument,
  validate,
} from '@docket/platform-canonical-store'
import { LIMITS } from '@docket/platform-tenancy'
import { fail } from '@sveltejs/kit'

import { authorise, recordAudit } from '$lib/server/request'
import { actorNames, inWorkspace, publisherOf } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/** The workspace's documents, each with what docket's validator says about it under the published head. */
export const load: PageServerLoad = async (event) => {
  const read = await inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, 'graph.read')
    const records = await listDocuments(ctx.tx, workspace.id)
    const validation = await validate({ source: postgresSource(ctx, workspace.id) })
    return { access, records, validation }
  })
  const name = await actorNames(read.access)
  const titles = new Map(read.validation.documents.map((document) => [document.path, document.title]))
  const byPath = new Map<string, { severity: string; code: string; message: string }[]>()
  for (const d of read.validation.diagnostics) {
    if (!d.path) continue
    byPath.set(d.path, [...(byPath.get(d.path) ?? []), { severity: d.severity, code: d.code, message: d.message }])
  }
  return {
    write: read.access.can('knowledge.write'),
    limit: LIMITS.documentsPerWorkspace,
    documents: read.records.map((record) => ({
      path: record.path,
      resourceId: record.resourceId,
      resourceType: record.resourceType,
      title: titles.get(record.path) ?? null,
      origin: record.origin,
      revision: record.revision,
      createdBy: name(record.createdBy),
      diagnostics: byPath.get(record.path) ?? [],
    })),
  }
}

export const actions: Actions = {
  /** Writes uploaded docket files as cloud documents at their canonical paths (§6.1). */
  import: async (event) => {
    const form = await event.request.formData()
    const files = form.getAll('files').filter((file): file is File => file instanceof File && file.size > 0)
    if (!files.length) return fail(400, { problem: 'Choose one or more docket Markdown files.' })
    const publisher = publisherOf(event)
    return inWorkspace(event, async ({ access, workspace, ctx }) => {
      authorise(access, 'knowledge.write')
      const problems: string[] = []
      const written: string[] = []
      let unchanged = 0
      for (const file of files) {
        const raw = await file.text()
        let path: string
        try {
          const parsed = checkDocument('.docket/upload.md', raw)
          path = cloudDocumentPath(parsed)
          checkDocument(path, raw)
        } catch (caught) {
          if (caught instanceof DocumentError) {
            problems.push(`${file.name}: ${caught.message.replace(/^\.docket\/upload\.md: /, '')}`)
            continue
          }
          throw caught
        }
        try {
          const { document, changed } = await putDocument(ctx, { workspaceId: workspace.id, path, raw, origin: 'cloud', actor: publisher.actor })
          if (changed) written.push(document.resourceId)
          else unchanged += 1
        } catch (caught) {
          if (caught instanceof DocumentError) {
            problems.push(`${file.name}: ${caught.message}`)
            break
          }
          throw caught
        }
      }
      await recordAudit(ctx.tx, event, {
        action: 'documents.import',
        orgId: access.org.id,
        workspaceId: workspace.id,
        target: written,
        args: { files: files.length },
      })
      const flash = [
        written.length ? `Wrote ${written.length} document${written.length === 1 ? '' : 's'}.` : '',
        unchanged ? `${unchanged} unchanged.` : '',
      ]
        .filter(Boolean)
        .join(' ')
      return problems.length ? fail(400, { problem: problems.join('\n'), flash }) : { flash: flash || 'Nothing to write.' }
    })
  },

  /** Retires a document: it leaves the projections at the next reconciliation (§6.1). */
  retire: async (event) => {
    const form = await event.request.formData()
    const path = String(form.get('path') ?? '')
    return inWorkspace(event, async ({ access, workspace, ctx }) => {
      authorise(access, 'knowledge.write')
      try {
        const retired = await retireDocument(ctx.tx, { workspaceId: workspace.id, path })
        await recordAudit(ctx.tx, event, {
          action: 'documents.retire',
          orgId: access.org.id,
          workspaceId: workspace.id,
          target: [retired.resourceId],
        })
        return { flash: `Retired ${retired.resourceId}.` }
      } catch (caught) {
        if (caught instanceof DocumentError) return fail(404, { problem: caught.message })
        throw caught
      }
    })
  },
}
