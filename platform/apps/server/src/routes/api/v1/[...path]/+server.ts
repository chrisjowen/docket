// SPDX-License-Identifier: AGPL-3.0-only
import { handleApiV1 } from '$lib/server/api/v1'

import type { RequestHandler } from './$types'

/** Every `/api/v1` operation (`@docket/api`'s `OPERATIONS`), routed by the one definition. */
export const GET: RequestHandler = handleApiV1
export const POST: RequestHandler = handleApiV1
export const PUT: RequestHandler = handleApiV1
export const PATCH: RequestHandler = handleApiV1
export const DELETE: RequestHandler = handleApiV1
