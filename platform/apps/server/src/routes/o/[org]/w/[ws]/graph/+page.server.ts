// SPDX-License-Identifier: AGPL-3.0-only
import {
  addEvidence,
  describeResource,
  enqueue,
  hasErrors,
  parseOntology,
  publishedOntology,
  workspaceGraph,
  writeResource,
  type Diagnostic,
  type StoreContext,
  type WriteResult,
  type Writer,
} from '@docket/platform-canonical-store'
import { fail, type RequestEvent } from '@sveltejs/kit'

import { attributesFromForm, captureVocabulary, evidenceFromForm, shown, webWriter } from '$lib/server/capture'
import { authorise, recordAudit } from '$lib/server/request'
import { formText, inWorkspace } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/** The graph browser (§18): the workspace's graph, how far its index lags, and what the capture forms offer. */
export const load: PageServerLoad = async (event) =>
  inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, 'read')
    const head = await publishedOntology(ctx, workspace.id)
    return {
      graph: await workspaceGraph(ctx, workspace, { root: `/o/${access.org.slug}/w/${workspace.slug}` }),
      // Rebuilding resets and replays every projection: an admin's call.
      canRebuild: access.can('publish'),
      // The policy chips in a record's "Why" open the schema editor on the policy.
      canEditSchema: access.can('propose'),
      capture: { canWrite: access.can('write'), vocabulary: captureVocabulary(head ? parseOntology(head.text).ontology : null) },
    }
  })

type Kind = 'resource' | 'link' | 'evidence'

const text = (form: FormData, name: string) => formText(form, name).trim()
const problem = (message: string): Diagnostic => ({ severity: 'error', code: 'invalid', message })

/**
 * One capture as the signed-in member (§14.2): the same structured write an
 * MCP client makes, with its audit event in the same transaction. `prepare`
 * reads the form inside the workspace's transaction and returns the write, or
 * the form's own problems; a refusal comes back with the diagnostics.
 */
async function capture(
  event: RequestEvent,
  kind: Kind,
  prepare: (form: FormData, ctx: StoreContext, writer: Writer) => Promise<{ id: string; problems?: Diagnostic[]; write?: () => Promise<WriteResult> }>,
) {
  const form = await event.request.formData()
  return inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, 'write')
    const writer = webWriter(event, workspace.id)
    const { id, problems = [], write } = await prepare(form, ctx, writer)
    const record = (outcome: 'ok' | 'invalid') =>
      recordAudit(ctx.tx, event, {
        action: `graph.capture ${kind}`,
        orgId: access.org.id,
        workspaceId: workspace.id,
        outcome,
        target: id ? [id.slice(0, 200)] : [],
        args: Object.fromEntries([...form].filter(([name]) => name !== 'csrf')),
      })
    if (problems.length || !write) {
      await record('invalid')
      return fail(400, { capture: { kind, id, diagnostics: shown(problems), done: false } })
    }
    const result = await write()
    if (hasErrors(result.diagnostics)) {
      await record('invalid')
      return fail(400, { capture: { kind, id, diagnostics: shown(result.diagnostics), done: false } })
    }
    await record('ok')
    const what = kind === 'resource' ? (result.created ? 'Captured' : 'Updated') : kind === 'link' ? 'Linked' : 'Added evidence to'
    return {
      flash: result.changed ? `${what} ${id}. Search picks it up at the next index update.` : `Nothing new: ${id} already holds this.`,
      capture: { kind, id, diagnostics: shown(result.diagnostics), done: true },
    }
  })
}

export const actions: Actions = {
  /** Asks the worker to reset the workspace's projections and replay every document (§6.2 step 4). */
  rebuild: (event) =>
    inWorkspace(event, async ({ access, workspace, ctx }) => {
      authorise(access, 'publish')
      await enqueue(ctx.tx, workspace.id, 'rebuild')
      await recordAudit(ctx.tx, event, { action: 'projections.rebuild', orgId: access.org.id, workspaceId: workspace.id })
      return { flash: 'Rebuilding the index: every document is projected again. Search catches up in a few minutes.' }
    }),

  /** Capture a new resource (or more about one), with its evidence. */
  resource: (event) =>
    capture(event, 'resource', async (form, ctx, writer) => {
      const type = text(form, 'type')
      const id = text(form, 'id')
      const title = text(form, 'title')
      const body = formText(form, 'body')
      const problems: Diagnostic[] = []
      if (!type || !id || !title) problems.push(problem('Give the resource a type, an id and a title.'))
      if (id.length > 200 || title.length > 200) problems.push(problem('An id or a title is at most 200 characters.'))
      if (body.length > 60_000) problems.push(problem('The body is at most 60,000 characters.'))
      const head = await publishedOntology(ctx, writer.workspaceId)
      const vocabulary = captureVocabulary(head ? parseOntology(head.text).ontology : null)
      const attributes = attributesFromForm(form, vocabulary.types.find((candidate) => candidate.name === type)?.attributes ?? [])
      problems.push(...attributes.problems)
      return {
        id,
        problems,
        write: () =>
          writeResource(ctx, writer, {
            id,
            type,
            title,
            ...(Object.keys(attributes.values).length ? { attributes: attributes.values } : {}),
            ...(body.trim() ? { body } : {}),
            evidence: evidenceFromForm(form),
          }),
      }
    }),

  /** Capture a link from one resource to another, with the evidence for the link. */
  link: (event) =>
    capture(event, 'link', async (form, ctx, writer) => {
      const id = text(form, 'id')
      const rel = text(form, 'rel')
      const target = text(form, 'target')
      if (!id || !rel || !target) return { id, problems: [problem('Choose the resource, the relationship and its target.')] }
      const from = await describeResource(ctx, writer.workspaceId, id)
      if (!from) return { id, problems: [problem(`There is no resource ${id} in this docket.`)] }
      return { id, write: () => writeResource(ctx, writer, { id, type: from.type, title: from.title, links: [{ rel, target, evidence: evidenceFromForm(form) }], evidence: [] }) }
    }),

  /** Capture more evidence for a resource or one of its links. */
  evidence: (event) =>
    capture(event, 'evidence', async (form, ctx, writer) => {
      const id = text(form, 'id')
      if (!id) return { id, problems: [problem('Choose the resource the evidence is for.')] }
      // `<rel> <target>`: relationship names have no spaces.
      const chosen = text(form, 'link')
      const space = chosen.indexOf(' ')
      const link = space > 0 ? { rel: chosen.slice(0, space), target: chosen.slice(space + 1) } : undefined
      return { id, write: () => addEvidence(ctx, writer, { id, ...(link ? { link } : {}), evidence: evidenceFromForm(form) }) }
    }),
}
