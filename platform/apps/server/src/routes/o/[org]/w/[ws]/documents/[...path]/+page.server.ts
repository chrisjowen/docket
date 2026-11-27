// SPDX-License-Identifier: AGPL-3.0-only
import { documentHistory, parseMemoryFile, readDocument } from '@docket/platform-canonical-store'
import { error } from '@sveltejs/kit'

import { authorise } from '$lib/server/request'
import { actorNames, inWorkspace } from '$lib/server/workspace'

import type { PageServerLoad } from './$types'

/** Splits a docket file into its frontmatter block and its body, as written. */
function sections(raw: string): { frontmatter: string | null; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw)
  return match ? { frontmatter: match[1] ?? '', body: raw.slice(match[0].length) } : { frontmatter: null, body: raw }
}

/**
 * One live document (§6.1), decrypted: its record, its text as written, and
 * every revision, newest first. `?rev=<n>` shows an earlier revision's text.
 */
export const load: PageServerLoad = async (event) => {
  const path = event.params.path
  const asked = event.url.searchParams.get('rev')
  const read = await inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, 'graph.read')
    const document = await readDocument(ctx, workspace.id, path)
    if (!document) error(404, 'No live document at that path.')
    return { access, document, history: await documentHistory(ctx, workspace.id, document.id) }
  })
  const name = await actorNames(read.access)
  const { document, history } = read
  const shown = asked === null ? history[0] : history.find((revision) => String(revision.revision) === asked)
  if (!shown) error(404, 'That document has no such revision.')
  const parsed = shown.raw === undefined ? null : parseMemoryFile(shown.raw, document.path).document
  return {
    document: {
      path: document.path,
      resourceId: document.resourceId,
      resourceType: document.resourceType,
      title: parsed?.title ?? null,
      origin: document.origin,
      originRef: document.originRef,
      revision: document.revision,
      createdBy: name(document.createdBy),
      createdAt: document.createdAt.toISOString(),
    },
    shown: {
      revision: shown.revision,
      current: shown.revision === document.revision,
      error: shown.raw === undefined ? (shown.error ?? 'This revision could not be opened.') : null,
      ...(shown.raw === undefined ? { frontmatter: null, body: '' } : sections(shown.raw)),
    },
    revisions: history.map((revision) => ({
      revision: revision.revision,
      createdBy: name(revision.createdBy),
      createdAt: revision.createdAt.toISOString(),
    })),
  }
}
