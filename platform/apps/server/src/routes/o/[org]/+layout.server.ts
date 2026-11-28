// SPDX-License-Identifier: AGPL-3.0-only
import { accountShell } from '$lib/server/shell'
import { orgAccess } from '$lib/server/request'

import type { LayoutServerLoad } from './$types'

/** The account's sidebar: what `GET /api/v1/accounts/{acct}/navigation` answers too (`accountShell`). */
export const load: LayoutServerLoad = async (event) => accountShell(await orgAccess(event))
