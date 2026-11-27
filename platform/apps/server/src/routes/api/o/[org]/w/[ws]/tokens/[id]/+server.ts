// SPDX-License-Identifier: AGPL-3.0-only
import { TokenRevocationError, revokeApiToken } from '@docket/platform-auth'
import { canInNamespace } from '@docket/platform-tenancy'

import { CliError, handleCli } from '$lib/server/cli-api'

import type { RequestHandler } from './$types'

/**
 * `docket cloud token revoke`: the caller's own token, or anyone's in the
 * workspace for a member who manages its tokens (its admins). Revoking
 * notifies every API process (§8.5).
 */
export const DELETE: RequestHandler = (event) =>
  handleCli(event, { action: 'tokens.revoke', oauthOnly: true }, async (call) => {
    const { runtime, principal, permission } = call
    const tokenId = event.params.id ?? ''
    try {
      await runtime.router.withPlatform(async (tx) => {
        const revoked = await revokeApiToken(tx, {
          orgId: principal.orgId,
          workspaceId: principal.workspaceId,
          tokenId,
          by: principal.userId,
          ...(canInNamespace(permission, 'tokens.manage') ? {} : { ownerId: principal.userId }),
        })
        await runtime.router.enterTenant(tx, principal.orgId)
        await call.audit(tx, { outcome: 'ok', target: [tokenId], args: { prefix: revoked.prefix } })
      })
    } catch (cause) {
      if (cause instanceof TokenRevocationError) throw new CliError(404, 'not_found', 'No live token of yours with that id in this workspace.')
      throw cause
    }
    return new Response(null, { status: 204 })
  })
