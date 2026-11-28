// SPDX-License-Identifier: AGPL-3.0-only
import { CORS_HEADERS, preflight } from '$lib/server/cors'
import { handleMcp } from '$lib/server/mcp'

import type { RequestHandler } from './$types'

/** A workspace's MCP endpoint (§9): see `handleMcp`. */
export const POST: RequestHandler = (event) => handleMcp(event)

/** No server-sent event stream: every answer comes back on its POST. */
const notAllowed: RequestHandler = () =>
  new Response('Send one JSON-RPC message per POST.', { status: 405, headers: { ...CORS_HEADERS, allow: 'POST, OPTIONS' } })

export const GET = notAllowed
export const DELETE = notAllowed
export const OPTIONS: RequestHandler = preflight
