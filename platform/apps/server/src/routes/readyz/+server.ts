// SPDX-License-Identifier: AGPL-3.0-only
import { readyz } from '$lib/server/health'
import { probes } from '$lib/server/runtime'

import type { RequestHandler } from './$types'

export const GET: RequestHandler = () => readyz(probes)
