// SPDX-License-Identifier: AGPL-3.0-only
import { openApiDocument } from '@docket/api'
import { json } from '@sveltejs/kit'

import { getRuntime } from '$lib/server/runtime'

import type { RequestHandler } from './$types'

/** The OpenAPI document of `/api/v1`: every operation, its credentials, the capability it needs, its schemas and errors. */
export const GET: RequestHandler = () => json(openApiDocument(getRuntime().origin), { headers: { 'cache-control': 'public, max-age=300' } })
