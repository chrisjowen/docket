// SPDX-License-Identifier: AGPL-3.0-only
import { listAudit } from '@docket/platform-audit'
import {
  ApiTokenError,
  ConnectionError,
  DEFAULT_TOKEN_DAYS,
  MAX_TOKEN_DAYS,
  TokenRevocationError,
  issueApiToken,
  mcpResourceUrl,
  revokeApiToken,
  revokeConnection,
} from '@docket/platform-auth'
import type { Workspace } from '@docket/platform-canonical-store'
import { rateLimitMessage, tokenCreateLimits } from '@docket/platform-limits'
import { listMembers, type Tx } from '@docket/platform-tenancy'
import { fail, type RequestEvent } from '@sveltejs/kit'

import { authorise, recordAudit, recordStandalone, requireUser, type NamespaceAccess } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { accountDockets, actorNamer, connectionView, tokenView, workspaceConnections, workspaceTokens } from '$lib/server/tokens'
import { docketAccess } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/**
 * A workspace's MCP page (§9, §18; tenancy v2 §3.4): its endpoint, the three
 * ways to connect an AI client (signing in with OAuth, a personal token, or a
 * system account's token), the tokens and named connections that reach this
 * docket with their revocation, and the audit log of MCP calls. A member
 * makes a personal token for this docket here; every token and connection of
 * theirs is on Your tokens & connections, and system accounts' tokens are in
 * Settings › System accounts. A docket's admins (`tokens.manage`) see
 * everyone's here, and revoke those that reach this docket alone.
 */

const EXPIRY_CHOICES = [7, 30, 60, MAX_TOKEN_DAYS]

export const load: PageServerLoad = async (event) => {
  const user = requireUser(event)
  const { access, workspace } = await docketAccess(event)
  authorise(access, 'graph.read')
  const { router, origin } = getRuntime()
  const endpoint = mcpResourceUrl(origin, access.org.slug, workspace.slug)
  const manage = access.can('tokens.manage')
  const { dockets, resources } = await accountDockets(access.org)

  const { tokens, connections, members } = await router.withPlatform(async (tx) => ({
    tokens: await workspaceTokens(tx, { orgId: access.org.id, workspaceId: workspace.id, userId: user.id, manage }),
    connections: await workspaceConnections(tx, { orgId: access.org.id, workspaceId: workspace.id, userId: user.id, manage, resources }),
    members: await listMembers(tx, access.org.id),
  }))
  const logins = new Map(members.map((member) => [member.id, member.login]))
  const ownTokens = tokens.filter((token) => token.ownerId === user.id)

  const full = access.can('audit.view-full')
  const events = await router.withTenant(access.org.id, (tx) =>
    listAudit(tx, {
      workspaceId: workspace.id,
      actionPrefixes: ['mcp.', 'cli.', 'oauth.', 'tokens.'],
      ...(full ? {} : { actor: `user:${user.id}`, actors: ownTokens.map((token) => `token:${token.prefix}`) }),
      limit: 100,
    }),
  )
  const actorName = await actorNamer(access.org)

  const now = Date.now()
  const pinned = (ids: readonly string[] | null) => ids?.length === 1 && ids[0] === workspace.id
  return {
    csrf: event.locals.csrf,
    endpoint,
    manage,
    readOnlyHere: access.permission === 'read',
    expiryChoices: EXPIRY_CHOICES,
    defaultDays: DEFAULT_TOKEN_DAYS,
    tokens: tokens.map((token) => ({ ...tokenView(token, user.id, dockets, now), revocable: token.ownerId === user.id || pinned(token.dockets) })),
    connections: connections.map((connection) => ({
      ...connectionView(connection, user.id, dockets, logins),
      revocable: connection.userId === user.id || pinned(connection.dockets),
    })),
    full,
    events: events.map((entry) => ({
      id: entry.id,
      at: entry.at.toISOString(),
      actor: actorName(entry.actor),
      action: entry.action,
      target: entry.target,
      outcome: entry.outcome,
      argsDigest: entry.argsDigest,
      latencyMs: entry.latencyMs,
    })),
  }
}

/** One change to the platform's credentials, audited in the org's own log in the same transaction (§10). */
async function change<T extends { flash: string }>(
  event: RequestEvent,
  run: (
    tx: Tx,
    scope: { access: NamespaceAccess; workspace: Workspace; userId: string; form: FormData; resources: ReadonlyMap<string, string> },
  ) => Promise<T & { action: string; target: string[]; args?: unknown }>,
) {
  const user = requireUser(event)
  const { access, workspace } = await docketAccess(event)
  authorise(access, 'tokens.create-own')
  const { router } = getRuntime()
  const form = await event.request.formData()
  const { resources } = await accountDockets(access.org)
  try {
    return await router.withPlatform(async (tx) => {
      const result = await run(tx, { access, workspace, userId: user.id, form, resources })
      await router.enterTenant(tx, access.org.id)
      await recordAudit(tx, event, { action: result.action, orgId: access.org.id, workspaceId: workspace.id, target: result.target, args: result.args })
      // What the page shows: the flash and, once, a new token's text. Never the audit fields.
      const shown: Partial<typeof result> = { ...result }
      delete shown.action
      delete shown.target
      delete shown.args
      return shown as Omit<typeof result, 'action' | 'target' | 'args'>
    })
  } catch (cause) {
    if (cause instanceof ApiTokenError) return fail(cause.code === 'forbidden' ? 403 : cause.code === 'not-found' ? 404 : 400, { problem: cause.message })
    if (cause instanceof TokenRevocationError || cause instanceof ConnectionError) return fail(404, { problem: cause.message })
    throw cause
  }
}

export const actions: Actions = {
  /** A personal token for this docket alone: the member's own access here, read-only if asked. */
  createToken: async (event) => {
    // At most 10 new tokens a minute per person (§19), the CLI's `token create` included.
    const decision = await getRuntime().limiter.check(tokenCreateLimits(requireUser(event).id))
    if (!decision.allowed) {
      await recordStandalone(event, { action: 'tokens.create', outcome: 'denied', orgId: null, target: ['rate-limit'] })
      return fail(429, { problem: rateLimitMessage(decision) })
    }
    return change(event, async (tx, { access, workspace, userId, form }) => {
      const days = Number(form.get('days') ?? DEFAULT_TOKEN_DAYS)
      const readOnly = form.get('readOnly') === 'on' || access.permission === 'read'
      const issued = await issueApiToken(tx, {
        orgId: access.org.id,
        ownerId: userId,
        createdBy: userId,
        readOnly,
        dockets: [workspace.id],
        expiresInDays: days,
        name: String(form.get('name') ?? ''),
      })
      return {
        action: 'tokens.create',
        target: [issued.id],
        args: { prefix: issued.prefix, owner: userId, readOnly: issued.readOnly, dockets: [workspace.id], days },
        flash: `Created ${issued.prefix}… It is shown once: copy it now.`,
        created: { token: issued.token, prefix: issued.prefix, expiresAt: issued.expiresAt.toISOString() },
      }
    })
  },

  revokeToken: (event) =>
    change(event, async (tx, { access, workspace, userId, form }) => {
      const tokenId = String(form.get('token') ?? '')
      // The member's own; for a docket's admins, also anyone's that reaches this docket alone.
      const whose = access.can('tokens.manage') ? { ownOrPinned: { ownerId: userId, workspaceId: workspace.id } } : { ownerId: userId }
      const revoked = await revokeApiToken(tx, { orgId: access.org.id, tokenId, by: userId, ...whose })
      return {
        action: 'tokens.revoke',
        target: [tokenId],
        args: { prefix: revoked.prefix },
        flash: `Revoked ${revoked.prefix}… — the next call with this token will fail.`,
      }
    }),

  revokeConnection: (event) =>
    change(event, async (tx, { access, workspace, userId, form, resources }) => {
      const grantId = String(form.get('connection') ?? '')
      const whose = access.can('tokens.manage') ? { ownOrPinned: { userId, workspaceId: workspace.id } } : { userId }
      const revoked = await revokeConnection(tx, { orgId: access.org.id, grantId, resources, ...whose })
      return {
        action: 'oauth.revoke',
        target: [revoked.clientId, `conn:${revoked.id}`],
        args: { name: revoked.name },
        flash: `Revoked ‘${revoked.name}’ — the next call through this connection will fail.`,
      }
    }),
}
