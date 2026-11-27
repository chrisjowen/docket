// SPDX-License-Identifier: AGPL-3.0-only
import { healthz } from '$lib/server/health'

import type { RequestHandler } from './$types'

export const GET: RequestHandler = () => healthz()
