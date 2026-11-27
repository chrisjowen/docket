// SPDX-License-Identifier: AGPL-3.0-only
import { setupRedirect } from '$lib/server/github-link'

import type { RequestHandler } from './$types'

/** The GitHub App's setup URL: where GitHub sends an admin after installing it (§14.1). */
export const GET: RequestHandler = (event) => setupRedirect(event)
