// SPDX-License-Identifier: AGPL-3.0-only
import { authorizationServerMetadata } from '@docket/platform-auth'
import { json } from '@sveltejs/kit'

import { CORS_HEADERS, preflight } from '$lib/server/cors'
import { getRuntime } from '$lib/server/runtime'

import type { RequestHandler } from './$types'

/** The authorization server's metadata (RFC 8414; §8.2 step 3). */
export const GET: RequestHandler = () =>
  json(authorizationServerMetadata(getRuntime().origin), { headers: { ...CORS_HEADERS, 'cache-control': 'public, max-age=300' } })

export const OPTIONS: RequestHandler = preflight
