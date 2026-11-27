// SPDX-License-Identifier: AGPL-3.0-only
import { listDocumentPage } from '@docket/platform-canonical-store'

import { CliError, cliJson, handleCli } from '$lib/server/cli-api'

import type { RequestHandler } from './$types'

/** At most this many documents a page; `next` asks for the rest. */
const PAGE = 500

/**
 * `docket cloud push|status` (`?origin=cli&originRef=<checkout>`) and
 * `pull --resources` (`?origin=cloud&include=raw`): the workspace's live
 * documents in path order, a page at a time.
 */
export const GET: RequestHandler = (event) =>
  handleCli(event, { action: 'documents.list', scope: 'docket:read' }, async (call) => {
    const query = event.url.searchParams
    const origin = query.get('origin')
    if (origin !== 'cli' && origin !== 'cloud') throw new CliError(400, 'invalid_request', 'origin is cli or cloud.')
    const originRef = query.get('originRef')
    if ((origin === 'cli') !== (originRef !== null)) throw new CliError(400, 'invalid_request', 'originRef is the checkout, with origin=cli only.')
    const include = query.get('include')
    if (include !== null && (include !== 'raw' || origin !== 'cloud')) throw new CliError(400, 'invalid_request', 'include is raw with origin=cloud, or left out.')
    const cursor = query.get('cursor')
    const after = cursor === null ? undefined : Buffer.from(cursor, 'base64url').toString('utf8')
    if (cursor !== null && (after === '' || Buffer.from(after ?? '', 'utf8').toString('base64url') !== cursor)) {
      throw new CliError(400, 'invalid_request', 'cursor is the next value of the previous page.')
    }
    const page = await call.inTenant((ctx) =>
      listDocumentPage(ctx, {
        workspaceId: call.principal.workspaceId,
        origin,
        ...(originRef !== null ? { originRef } : {}),
        ...(after !== undefined ? { after } : {}),
        limit: PAGE,
        raw: include === 'raw',
      }),
    )
    return cliJson(200, {
      documents: page.documents.map((document) => ({ ...document, updatedAt: document.updatedAt.toISOString() })),
      ...(page.next ? { next: Buffer.from(page.next, 'utf8').toString('base64url') } : {}),
    })
  })
