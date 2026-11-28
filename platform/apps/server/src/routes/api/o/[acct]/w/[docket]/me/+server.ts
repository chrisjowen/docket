// SPDX-License-Identifier: AGPL-3.0-only
import { CAPABILITIES, summarise, userById } from '@docket/platform-tenancy'

import { cliJson, handleCli } from '$lib/server/cli-api'

import type { RequestHandler } from './$types'

/** `docket cloud whoami`: who the bearer acts as here, with its effective scopes (any scope will do). */
export const GET: RequestHandler = (event) =>
  handleCli(event, { action: 'me' }, async ({ runtime, principal, orgSlug, workspaceSlug, owner, caps, effective }) => {
    const user = await runtime.router.withPlatform((tx) => userById(tx, principal.userId))
    return cliJson(200, {
      login: user?.login ?? principal.userId,
      org: orgSlug,
      workspace: workspaceSlug,
      // In a word, then exactly: what the caller may do on this docket (tenancy v2 §3.1).
      role: owner ? 'owner' : summarise(caps).label,
      permission: summarise(caps).level,
      capabilities: CAPABILITIES.filter((cap) => caps.has(cap)),
      scopes: effective,
      token: {
        kind: principal.via === 'oauth' ? 'oauth' : 'api',
        ...(principal.via === 'token' ? { id: principal.tokenId } : {}),
        expiresAt: principal.expiresAt.toISOString(),
      },
    })
  })
