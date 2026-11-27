// SPDX-License-Identifier: AGPL-3.0-only
import { ApiTokenError, DEFAULT_TOKEN_DAYS, MAX_TOKEN_DAYS, SCOPES, fromLegacyScopes, impliedScopes, isScope, issueApiToken } from '@docket/platform-auth'
import { tokenCreateLimits } from '@docket/platform-limits'
import { canInNamespace } from '@docket/platform-tenancy'

import { CliError, cliJson, handleCli } from '$lib/server/cli-api'
import { accountDockets, tokenView, workspaceTokens } from '$lib/server/tokens'

import type { RequestHandler } from './$types'

/**
 * `docket cloud token list|create`: the tokens that reach this docket, for CI.
 * An OAuth session only: a token never mints tokens. The list is the MCP page's.
 */
export const GET: RequestHandler = (event) =>
  handleCli(event, { action: 'tokens.list', oauthOnly: true }, async ({ runtime, principal, permission, orgSlug }) => {
    const tokens = await runtime.router.withPlatform((tx) =>
      workspaceTokens(tx, { orgId: principal.orgId, workspaceId: principal.workspaceId, userId: principal.userId, manage: canInNamespace(permission, 'tokens.manage') }),
    )
    const { dockets } = await accountDockets({ id: principal.orgId, slug: orgSlug })
    const now = Date.now()
    return cliJson(200, { tokens: tokens.map((token) => tokenView(token, principal.userId, dockets, now)) })
  })

/**
 * A personal token for the caller on this docket, as the caller (tenancy v2
 * §3.4): `read_only: true` narrows it to reading. `scopes`, which older CLIs
 * send, still works: read scopes make it read-only, and any set read-only and
 * full access cannot say is kept as its ceiling. It never does more than the
 * session that made it. Its text is in this answer only.
 */
export const POST: RequestHandler = (event) =>
  handleCli(event, { action: 'tokens.create', oauthOnly: true, limits: (principal) => tokenCreateLimits(principal.userId) }, async (call) => {
    const { runtime, principal, effective } = call
    const body = await call.json()
    if (body.read_only !== undefined && typeof body.read_only !== 'boolean') throw new CliError(400, 'invalid_request', 'read_only is true or false.')
    let readOnly = body.read_only === true
    let legacy: ReturnType<typeof fromLegacyScopes>['legacy'] = null
    if (body.scopes !== undefined) {
      const asked = body.scopes
      if (!Array.isArray(asked) || asked.length === 0 || !asked.every(isScope)) {
        throw new CliError(400, 'invalid_scope', `scopes is a list of one or more of ${SCOPES.join(', ')}.`)
      }
      const scopes = impliedScopes(asked)
      const beyond = scopes.filter((scope) => !effective.includes(scope))
      if (beyond.length) throw new CliError(400, 'invalid_scope', `This session cannot grant ${beyond.join(', ')}: a token stays within the session that made it.`)
      const mapped = fromLegacyScopes(scopes)
      readOnly ||= mapped.readOnly
      legacy = mapped.legacy
    }
    // Never more than this session: a read-only connection makes read-only tokens, and its own ceiling carries over.
    readOnly ||= principal.readOnly === true
    if (!legacy && SCOPES.some((scope) => !principal.scopes.includes(scope))) legacy = [...principal.scopes]
    const days = body.days ?? DEFAULT_TOKEN_DAYS
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_TOKEN_DAYS) {
      throw new CliError(400, 'invalid_request', `days is a whole number from 1 to ${MAX_TOKEN_DAYS}.`)
    }
    const name = body.name ?? body.description
    if (name !== undefined && typeof name !== 'string') throw new CliError(400, 'invalid_request', 'name is a string.')

    try {
      const issued = await runtime.router.withPlatform(async (tx) => {
        const token = await issueApiToken(tx, {
          orgId: principal.orgId,
          ownerId: principal.userId,
          createdBy: principal.userId,
          readOnly,
          dockets: [principal.workspaceId],
          legacyScopes: legacy,
          expiresInDays: days,
          name: (name as string | undefined) ?? null,
        })
        await runtime.router.enterTenant(tx, principal.orgId)
        await call.audit(tx, { outcome: 'ok', target: [token.id], args: { prefix: token.prefix, readOnly: token.readOnly, dockets: [principal.workspaceId], days } })
        return token
      })
      const [record] = await runtime.router.withPlatform(async (tx) =>
        (await workspaceTokens(tx, { orgId: principal.orgId, workspaceId: principal.workspaceId, userId: principal.userId, manage: false })).filter((token) => token.id === issued.id),
      )
      return cliJson(201, {
        id: issued.id,
        token: issued.token,
        prefix: issued.prefix,
        read_only: issued.readOnly,
        scopes: record?.scopes ?? [],
        expiresAt: issued.expiresAt.toISOString(),
      })
    } catch (cause) {
      if (cause instanceof ApiTokenError) throw new CliError(cause.code === 'forbidden' ? 403 : 400, cause.code === 'forbidden' ? 'insufficient_scope' : 'invalid_request', cause.message)
      throw cause
    }
  })
