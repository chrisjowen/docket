// SPDX-License-Identifier: AGPL-3.0-only
import { CORS_HEADERS, preflight } from '$lib/server/cors'
import { handleAccountMcp } from '$lib/server/mcp-account'

import type { RequestHandler } from './$types'

/** An account's MCP address (tenancy v2 §4): one for every docket, with a `docket` argument. See `handleAccountMcp`. */
export const POST: RequestHandler = (event) => handleAccountMcp(event)

/** No server-sent event stream: every answer comes back on its POST. */
const notAllowed: RequestHandler = () =>
  new Response('Send one JSON-RPC message per POST.', { status: 405, headers: { ...CORS_HEADERS, allow: 'POST, OPTIONS' } })

export const GET = notAllowed
export const DELETE = notAllowed
export const OPTIONS: RequestHandler = preflight
