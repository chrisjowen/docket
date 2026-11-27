// SPDX-License-Identifier: AGPL-3.0-only
import { ApiTokenError, DEFAULT_TOKEN_DAYS, MAX_TOKEN_DAYS, SCOPES, impliedScopes, isScope, issueApiToken } from '@docket/platform-auth'
import { ontologyMcpRoles } from '@docket/platform-canonical-store'
import { tokenCreateLimits } from '@docket/platform-limits'
import { canInNamespace } from '@docket/platform-tenancy'

import { CliError, cliJson, handleCli } from '$lib/server/cli-api'
import { tokenView, workspaceTokens } from '$lib/server/tokens'

import type { RequestHandler } from './$types'

/**
 * `docket cloud token list|create`: the workspace's API tokens, for CI. An
 * OAuth session only: a token never mints tokens. The list is the MCP page's.
 */
export const GET: RequestHandler = (event) =>
  handleCli(event, { action: 'tokens.list', oauthOnly: true }, async ({ runtime, principal, permission }) => {
    const tokens = await runtime.router.withPlatform((tx) =>
      workspaceTokens(tx, { orgId: principal.orgId, workspaceId: principal.workspaceId, userId: principal.userId, manage: canInNamespace(permission, 'tokens.manage') }),
    )
    const now = Date.now()
    return cliJson(200, { tokens: tokens.map((token) => tokenView(token, principal.userId, now)) })
  })

/** A token for the caller, within the caller's effective scopes. Its text is in this answer only. */
export const POST: RequestHandler = (event) =>
  handleCli(event, { action: 'tokens.create', oauthOnly: true, limits: (principal) => tokenCreateLimits(principal.userId) }, async (call) => {
    const { runtime, principal, effective } = call
    const body = await call.json()
    const asked = body.scopes
    if (!Array.isArray(asked) || asked.length === 0 || !asked.every(isScope)) {
      throw new CliError(400, 'invalid_scope', `scopes is a list of one or more of ${SCOPES.join(', ')}.`)
    }
    const scopes = impliedScopes(asked)
    const beyond = scopes.filter((scope) => !effective.includes(scope))
    if (beyond.length) throw new CliError(400, 'invalid_scope', `This session cannot grant ${beyond.join(', ')}: a token's scopes stay within the caller's.`)
    const days = body.days ?? DEFAULT_TOKEN_DAYS
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_TOKEN_DAYS) {
      throw new CliError(400, 'invalid_request', `days is a whole number from 1 to ${MAX_TOKEN_DAYS}.`)
    }
    if (body.description !== undefined && typeof body.description !== 'string') throw new CliError(400, 'invalid_request', 'description is a string.')

    // ontology:write only while the workspace lets the caller's role change the ontology over MCP.
    const ontologyWriters = await runtime.router.withTenant(principal.orgId, (tx) => ontologyMcpRoles(tx, principal.workspaceId))
    try {
      const issued = await runtime.router.withPlatform(async (tx) => {
        const token = await issueApiToken(tx, {
          orgId: principal.orgId,
          workspaceId: principal.workspaceId,
          ownerId: principal.userId,
          createdBy: principal.userId,
          scopes,
          ontologyWriters,
          expiresInDays: days,
          description: (body.description as string | undefined) ?? null,
        })
        await runtime.router.enterTenant(tx, principal.orgId)
        await call.audit(tx, { outcome: 'ok', target: [token.id], args: { prefix: token.prefix, scopes, days } })
        return token
      })
      return cliJson(201, { id: issued.id, token: issued.token, prefix: issued.prefix, scopes, expiresAt: issued.expiresAt.toISOString() })
    } catch (cause) {
      if (cause instanceof ApiTokenError) throw new CliError(cause.code === 'forbidden' ? 403 : 400, cause.code === 'forbidden' ? 'insufficient_scope' : 'invalid_request', cause.message)
      throw cause
    }
  })
