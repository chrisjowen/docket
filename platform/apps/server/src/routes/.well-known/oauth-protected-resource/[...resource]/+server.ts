// SPDX-License-Identifier: AGPL-3.0-only
import { protectedResourceMetadata, resourceOfMetadataPath } from '@docket/platform-auth'
import { error, json } from '@sveltejs/kit'

import { CORS_HEADERS, preflight } from '$lib/server/cors'
import { getRuntime } from '$lib/server/runtime'

import type { RequestHandler } from './$types'

/**
 * A workspace MCP endpoint's Protected Resource Metadata (RFC 9728; §8.2
 * step 2), at `/.well-known/oauth-protected-resource/mcp/{org}/{workspace}`.
 * It answers for any well-formed path without looking the workspace up, as
 * the endpoint's own 401 does, so neither tells a stranger which orgs exist.
 */
export const GET: RequestHandler = ({ url }) => {
  const { origin } = getRuntime()
  const resource = resourceOfMetadataPath(origin, url.pathname)
  if (!resource) error(404, 'Not found')
  return json(protectedResourceMetadata(origin, resource), { headers: { ...CORS_HEADERS, 'cache-control': 'public, max-age=300' } })
}

export const OPTIONS: RequestHandler = preflight
