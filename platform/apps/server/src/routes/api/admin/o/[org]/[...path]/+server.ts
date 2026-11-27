// SPDX-License-Identifier: AGPL-3.0-only
import { handleOrgAdmin } from '$lib/server/org-admin'

import type { RequestHandler } from './$types'

export const GET: RequestHandler = handleOrgAdmin
export const POST: RequestHandler = handleOrgAdmin
export const PUT: RequestHandler = handleOrgAdmin
export const DELETE: RequestHandler = handleOrgAdmin
