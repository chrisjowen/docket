// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CORS for what MCP clients read cross-origin - the discovery documents and
 * the MCP endpoint - so a browser-based client (the MCP Inspector) can
 * connect. They authenticate by bearer token only, never by cookie, so any
 * origin may call them; the response says which headers it may read.
 */
export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'www-authenticate, mcp-protocol-version, retry-after',
  'access-control-max-age': '600',
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
