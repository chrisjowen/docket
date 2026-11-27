// SPDX-License-Identifier: AGPL-3.0-only
import { listAudit } from '@docket/platform-audit'
import {
  ApiTokenError,
  DEFAULT_TOKEN_DAYS,
  GrantRevocationError,
  MAX_TOKEN_DAYS,
  SCOPES,
  SCOPE_LABELS,
  TokenRevocationError,
  issueApiToken,
  listGrants,
  mcpResourceUrl,
  revokeApiToken,
  revokeGrant,
  roleScopes,
} from '@docket/platform-auth'
import type { Workspace } from '@docket/platform-canonical-store'
import { rateLimitMessage, tokenCreateLimits } from '@docket/platform-limits'
import { canInAccount, listMembers, type Tx } from '@docket/platform-tenancy'
import { fail, type RequestEvent } from '@sveltejs/kit'

import { authorise, recordAudit, recordStandalone, requireUser, type NamespaceAccess } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { tokenView, workspaceTokens } from '$lib/server/tokens'
import { docketAccess } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/**
 * A workspace's MCP page (§9, §18): its endpoint, how to connect a client
 * through OAuth or with a token, the workspace's API tokens and OAuth grants
 * with their revocation, and the audit log of MCP calls. Members manage their
 * own tokens and grants; a docket's admins (`tokens.manage`) everyone's in
 * this docket. Service accounts are account-wide, so only an account-level
 * `service-accounts.manage` holder (owner or admin) sees the roster or mints
 * a token on one's behalf.
 */

const iso = (date: Date | null) => (date ? date.toISOString() : null)
const EXPIRY_CHOICES = [7, 30, 60, MAX_TOKEN_DAYS]

export const load: PageServerLoad = async (event) => {
  const user = requireUser(event)
  const { access, workspace } = await docketAccess(event)
  authorise(access, 'graph.read')
  const { router, origin } = getRuntime()
  const endpoint = mcpResourceUrl(origin, access.org.slug, workspace.slug)
  const manage = access.can('tokens.manage')
  const manageServiceAccounts = canInAccount(access.accountRole, 'service-accounts.manage')

  const { tokens, grants, members } = await router.withPlatform(async (tx) => ({
    tokens: await workspaceTokens(tx, { orgId: access.org.id, workspaceId: workspace.id, userId: user.id, manage }),
    grants: await listGrants(tx, { resource: endpoint, ...(manage ? {} : { accountId: user.id }) }),
    members: await listMembers(tx, access.org.id),
  }))
  const login = new Map(members.map((member) => [member.id, member.login]))
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
  const actorName = (actor: string) => {
    const human = /^user:(.+)$/.exec(actor)?.[1]
    if (human && login.has(human)) return `@${login.get(human)}`
    const oauth = /^oauth:(.+)\/user:(.+)$/.exec(actor)
    if (oauth && login.has(oauth[2] as string)) return `@${login.get(oauth[2] as string)} via ${oauth[1]}`
    return actor
  }

  const now = Date.now()
  return {
    csrf: event.locals.csrf,
    endpoint,
    manage,
    role: access.roleHere,
    scopes: SCOPES.map((scope) => ({ scope, label: SCOPE_LABELS[scope], allowed: roleScopes(access.roleHere, workspace.ontologyMcpRoles).includes(scope) })),
    expiryChoices: EXPIRY_CHOICES,
    defaultDays: DEFAULT_TOKEN_DAYS,
    // Service accounts are account-wide: only an account-level service-accounts.manage holder sees them.
    serviceAccounts: manageServiceAccounts ? members.filter((member) => member.kind === 'service').map((member) => ({ id: member.id, name: member.login, role: member.role })) : [],
    tokens: tokens.map((token) => tokenView(token, user.id, now)),
    grants: grants.map((grant) => ({
      id: grant.id,
      client: grant.clientName ?? grant.clientId,
      clientId: grant.clientId,
      user: login.has(grant.accountId) ? `@${login.get(grant.accountId)}` : grant.accountId,
      mine: grant.accountId === user.id,
      scopes: grant.scopes,
      grantedAt: iso(grant.grantedAt),
      expiresAt: iso(grant.expiresAt),
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
    scope: { access: NamespaceAccess; workspace: Workspace; endpoint: string; userId: string; form: FormData },
  ) => Promise<T & { action: string; target: string[]; args?: unknown; workspaceId?: string }>,
) {
  const user = requireUser(event)
  const { access, workspace } = await docketAccess(event)
  authorise(access, 'tokens.create-own')
  const { router, origin } = getRuntime()
  const form = await event.request.formData()
  const endpoint = mcpResourceUrl(origin, access.org.slug, workspace.slug)
  try {
    return await router.withPlatform(async (tx) => {
      const result = await run(tx, { access, workspace, endpoint, userId: user.id, form })
      await router.enterTenant(tx, access.org.id)
      await recordAudit(tx, event, { action: result.action, orgId: access.org.id, workspaceId: result.workspaceId ?? workspace.id, target: result.target, args: result.args })
      // What the page shows: the flash and, once, a new token's text. Never the audit fields.
      const shown: Partial<typeof result> = { ...result }
      delete shown.action
      delete shown.target
      delete shown.args
      delete shown.workspaceId
      return shown as Omit<typeof result, 'action' | 'target' | 'args' | 'workspaceId'>
    })
  } catch (cause) {
    if (cause instanceof ApiTokenError) return fail(cause.code === 'forbidden' ? 403 : 400, { problem: cause.message })
    if (cause instanceof TokenRevocationError || cause instanceof GrantRevocationError) return fail(404, { problem: cause.message })
    throw cause
  }
}

export const actions: Actions = {
  createToken: async (event) => {
    // At most 10 new tokens a minute per person (§19), the CLI's `token create` included.
    const decision = await getRuntime().limiter.check(tokenCreateLimits(requireUser(event).id))
    if (!decision.allowed) {
      await recordStandalone(event, { action: 'tokens.create', outcome: 'denied', orgId: null, target: ['rate-limit'] })
      return fail(429, { problem: rateLimitMessage(decision) })
    }
    return change(event, async (tx, { access, workspace, userId, form }) => {
      const owner = String(form.get('owner') ?? 'me')
      const ownerId = owner === 'me' ? userId : owner
      if (ownerId !== userId) {
        // Service accounts are account-wide: only an account-level service-accounts.manage holder gives one a token; never another person.
        if (!canInAccount(access.accountRole, 'service-accounts.manage')) throw new ApiTokenError('forbidden', 'Your role cannot create tokens for others.')
        const member = (await listMembers(tx, access.org.id)).find((candidate) => candidate.id === ownerId)
        if (member?.kind !== 'service') throw new ApiTokenError('forbidden', 'Tokens are for yourself or a service account.')
      }
      const scopes = form.getAll('scope').map(String)
      const days = Number(form.get('days') ?? DEFAULT_TOKEN_DAYS)
      const description = String(form.get('description') ?? '')
      const issued = await issueApiToken(tx, {
        orgId: access.org.id,
        workspaceId: workspace.id,
        ownerId,
        createdBy: userId,
        scopes,
        ontologyWriters: workspace.ontologyMcpRoles,
        expiresInDays: days,
        description,
      })
      return {
        action: 'tokens.create',
        target: [issued.id],
        args: { prefix: issued.prefix, owner: ownerId, scopes, days },
        flash: `Created ${issued.prefix}… It is shown once: copy it now.`,
        created: { token: issued.token, prefix: issued.prefix, expiresAt: issued.expiresAt.toISOString() },
      }
    })
  },

  revokeToken: (event) =>
    change(event, async (tx, { access, workspace, userId, form }) => {
      const tokenId = String(form.get('token') ?? '')
      // Anyone's token in this docket for those who manage its tokens; otherwise the member's own.
      const whose = access.can('tokens.manage') ? { workspaceId: workspace.id } : { ownerId: userId }
      const revoked = await revokeApiToken(tx, { orgId: access.org.id, tokenId, by: userId, ...whose })
      return {
        action: 'tokens.revoke',
        workspaceId: revoked.workspaceId,
        target: [tokenId],
        args: { prefix: revoked.prefix },
        flash: `Revoked ${revoked.prefix}… — the next call with this token will fail.`,
      }
    }),

  revokeGrant: (event) =>
    change(event, async (tx, { access, endpoint, userId, form }) => {
      const grantId = String(form.get('grant') ?? '')
      const revoked = await revokeGrant(tx, { grantId, resource: endpoint, ...(access.can('tokens.manage') ? {} : { accountId: userId }) })
      return {
        action: 'oauth.revoke',
        target: [revoked.clientId],
        flash: 'Revoked — the next call with this client’s tokens will fail.',
      }
    }),
}
