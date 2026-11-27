// SPDX-License-Identifier: AGPL-3.0-only
import {
  ApiTokenError,
  ConnectionError,
  DEFAULT_TOKEN_DAYS,
  MAX_TOKEN_DAYS,
  TokenRevocationError,
  issueApiToken,
  listApiTokens,
  listConnections,
  renameApiToken,
  renameConnection,
  revokeApiToken,
  revokeConnection,
} from '@docket/platform-auth'
import { rateLimitMessage, tokenCreateLimits } from '@docket/platform-limits'
import type { Tx } from '@docket/platform-tenancy'
import { fail, type RequestEvent } from '@sveltejs/kit'

import { orgAccess, permissionOn, recordAudit, recordStandalone, requireUser, type OrgAccess } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { accountDockets, connectionView, tokenView, type DocketRef } from '$lib/server/tokens'

import type { Actions, PageServerLoad } from './$types'

/**
 * Your tokens & connections (tenancy v2 §3.4): everything that acts as you
 * in this account. Your named OAuth connections, one per sign-in by an AI
 * client, and your personal tokens, each with rename and revoke, and a new
 * personal token for every docket you reach or for chosen ones, read-only if
 * you like. Each acts as you, so it never does more than you can.
 */

const EXPIRY_CHOICES = [7, 30, 60, MAX_TOKEN_DAYS]

/** The account's dockets the member reaches now: what their tokens may name. */
function reachable(access: OrgAccess, dockets: ReadonlyMap<string, DocketRef>) {
  return [...dockets.values()].flatMap((docket) => {
    const permission = permissionOn(access, docket.id)
    return permission ? [{ ...docket, readOnly: permission === 'read' }] : []
  })
}

export const load: PageServerLoad = async (event) => {
  const user = requireUser(event)
  const access = await orgAccess(event)
  const { router } = getRuntime()
  const { dockets, resources } = await accountDockets(access.org)
  const { tokens, connections } = await router.withPlatform(async (tx) => ({
    tokens: await listApiTokens(tx, { orgId: access.org.id, ownerId: user.id }),
    connections: await listConnections(tx, { orgId: access.org.id, resources, userId: user.id }),
  }))
  const now = Date.now()
  const logins = new Map([[user.id, user.login]])
  return {
    csrf: event.locals.csrf,
    expiryChoices: EXPIRY_CHOICES,
    defaultDays: DEFAULT_TOKEN_DAYS,
    reachable: reachable(access, dockets),
    tokens: tokens.map((token) => tokenView(token, user.id, dockets, now)),
    connections: connections.map((connection) => connectionView(connection, user.id, dockets, logins)),
  }
}

/** One change to the member's own credentials, audited in the org's log in the same transaction (§10). */
async function change(
  event: RequestEvent,
  run: (scope: {
    tx: Tx
    access: OrgAccess
    userId: string
    form: FormData
    dockets: ReadonlyMap<string, DocketRef>
    resources: ReadonlyMap<string, string>
  }) => Promise<{ action: string; target: string[]; args?: unknown; flash: string; created?: { token: string; prefix: string; expiresAt: string } }>,
) {
  const user = requireUser(event)
  const access = await orgAccess(event)
  const { router } = getRuntime()
  const form = await event.request.formData()
  const { dockets, resources } = await accountDockets(access.org)
  try {
    return await router.withPlatform(async (tx) => {
      const result = await run({ tx, access, userId: user.id, form, dockets, resources })
      await router.enterTenant(tx, access.org.id)
      await recordAudit(tx, event, { action: result.action, orgId: access.org.id, target: result.target, args: result.args })
      return { flash: result.flash, ...(result.created ? { created: result.created } : {}) }
    })
  } catch (cause) {
    if (cause instanceof ApiTokenError) return fail(cause.code === 'forbidden' ? 403 : cause.code === 'not-found' ? 404 : 400, { problem: cause.message })
    if (cause instanceof TokenRevocationError || cause instanceof ConnectionError) return fail(404, { problem: cause.message })
    throw cause
  }
}

export const actions: Actions = {
  createToken: async (event) => {
    // At most 10 new tokens a minute per person (§19), wherever they are made.
    const decision = await getRuntime().limiter.check(tokenCreateLimits(requireUser(event).id))
    if (!decision.allowed) {
      await recordStandalone(event, { action: 'tokens.create', outcome: 'denied', orgId: null, target: ['rate-limit'] })
      return fail(429, { problem: rateLimitMessage(decision) })
    }
    return change(event, async ({ tx, access, userId, form, dockets }) => {
      const reach = reachable(access, dockets)
      const all = form.get('reach') === 'all'
      const chosen = form.getAll('docket').map(String).filter((id) => reach.some((docket) => docket.id === id))
      if (!all && chosen.length === 0) throw new ApiTokenError('invalid', 'Choose at least one docket, or every docket.')
      const readOnly = form.get('readOnly') === 'on'
      const days = Number(form.get('days') ?? DEFAULT_TOKEN_DAYS)
      const issued = await issueApiToken(tx, {
        orgId: access.org.id,
        ownerId: userId,
        createdBy: userId,
        readOnly,
        dockets: all ? null : chosen,
        expiresInDays: days,
        name: String(form.get('name') ?? ''),
      })
      return {
        action: 'tokens.create',
        target: [issued.id],
        args: { prefix: issued.prefix, owner: userId, readOnly, dockets: all ? 'all' : chosen, days },
        flash: `Created ${issued.prefix}… It is shown once: copy it now.`,
        created: { token: issued.token, prefix: issued.prefix, expiresAt: issued.expiresAt.toISOString() },
      }
    })
  },

  renameToken: (event) =>
    change(event, async ({ tx, access, userId, form }) => {
      const tokenId = String(form.get('token') ?? '')
      const renamed = await renameApiToken(tx, { orgId: access.org.id, tokenId, ownerId: userId, name: String(form.get('name') ?? '') })
      return {
        action: 'tokens.rename',
        target: [tokenId],
        args: { prefix: renamed.prefix, from: renamed.before, to: renamed.after },
        flash: `Renamed ${renamed.prefix}….`,
      }
    }),

  revokeToken: (event) =>
    change(event, async ({ tx, access, userId, form }) => {
      const tokenId = String(form.get('token') ?? '')
      const revoked = await revokeApiToken(tx, { orgId: access.org.id, tokenId, by: userId, ownerId: userId })
      return {
        action: 'tokens.revoke',
        target: [tokenId],
        args: { prefix: revoked.prefix },
        flash: `Revoked ${revoked.prefix}… — the next call with this token will fail.`,
      }
    }),

  renameConnection: (event) =>
    change(event, async ({ tx, access, userId, form, resources }) => {
      const grantId = String(form.get('connection') ?? '')
      const renamed = await renameConnection(tx, { orgId: access.org.id, grantId, userId, resources, name: String(form.get('name') ?? '') })
      return {
        action: 'oauth.rename',
        target: [`conn:${grantId}`],
        args: { from: renamed.before, to: renamed.after },
        flash: `Renamed to ‘${renamed.after}’.`,
      }
    }),

  revokeConnection: (event) =>
    change(event, async ({ tx, access, userId, form, resources }) => {
      const grantId = String(form.get('connection') ?? '')
      const revoked = await revokeConnection(tx, { orgId: access.org.id, grantId, userId, resources })
      return {
        action: 'oauth.revoke',
        target: [revoked.clientId, `conn:${revoked.id}`],
        args: { name: revoked.name },
        flash: `Revoked ‘${revoked.name}’ — the next call through this connection will fail.`,
      }
    }),
}
