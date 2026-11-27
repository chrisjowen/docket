// SPDX-License-Identifier: AGPL-3.0-only
import { TokenRevocationError, revokeApiToken } from '@docket/platform-auth'

import { CliError, handleCli } from '$lib/server/cli-api'

import type { RequestHandler } from './$types'

/**
 * `docket cloud token revoke`: the caller's own token, or, for a member who
 * manages this docket's tokens (its admins), anyone's that reaches this docket
 * alone. Revoking notifies every API process (§8.5).
 */
export const DELETE: RequestHandler = (event) =>
  handleCli(event, { action: 'tokens.revoke', oauthOnly: true }, async (call) => {
    const { runtime, principal, caps } = call
    const tokenId = event.params.id ?? ''
    try {
      await runtime.router.withPlatform(async (tx) => {
        const revoked = await revokeApiToken(tx, {
          orgId: principal.orgId,
          tokenId,
          by: principal.userId,
          ...(caps.has('tokens')
            ? { ownOrPinned: { ownerId: principal.userId, workspaceId: principal.workspaceId } }
            : { ownerId: principal.userId }),
        })
        await runtime.router.enterTenant(tx, principal.orgId)
        await call.audit(tx, { outcome: 'ok', target: [tokenId], args: { prefix: revoked.prefix } })
      })
    } catch (cause) {
      if (cause instanceof TokenRevocationError) throw new CliError(404, 'not_found', 'No live token of yours with that id, or none that reaches this docket alone.')
      throw cause
    }
    return new Response(null, { status: 204 })
  })
