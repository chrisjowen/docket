// SPDX-License-Identifier: AGPL-3.0-only
import {
  ApiTokenError,
  DEFAULT_SYSTEM_TOKEN_DAYS,
  MAX_SYSTEM_TOKEN_DAYS,
  TokenRevocationError,
  issueApiToken,
  listApiTokens,
  notifyRevoked,
  renameApiToken,
  revokeApiToken,
} from '@docket/platform-auth'
import { rateLimitMessage, tokenCreateLimits } from '@docket/platform-limits'
import {
  TenancyError,
  accessOf,
  capsAt,
  describeServiceAccount,
  docketPlace,
  listGrants,
  listSystemAccounts,
  removeMember,
  tokenNotices,
  type Tx,
} from '@docket/platform-tenancy'
import { error, fail, redirect } from '@sveltejs/kit'

import { grantActions, grantView, placeNames, placesToGive, rolesFor } from '$lib/server/grants'
import { orgAccess, recordStandalone, requireUser, type OrgAccess } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { accessSummary, manage, mayChangeAccount, mayManageSystemAccounts } from '$lib/server/system-accounts'
import { accountDockets, tokenView, type DocketRef } from '$lib/server/tokens'

import type { Actions, PageServerLoad } from './$types'

/**
 * One system account (tenancy v2 §3.3): what it may do across the account,
 * its tokens with their names, reach and expiry, a new token, and removing
 * it. A token acts as the system account, narrowed to read-only or some
 * dockets; it lasts at most a year, and the account's owners are told before
 * it expires. The org admin API's own accounts are shown, never changed.
 */

const iso = (date: Date | null) => (date ? date.toISOString() : null)
const EXPIRY_CHOICES = [30, DEFAULT_SYSTEM_TOKEN_DAYS, 180, MAX_SYSTEM_TOKEN_DAYS]

async function systemAccount(tx: Tx, orgId: string, id: string) {
  const account = (await listSystemAccounts(tx, orgId)).find((candidate) => candidate.id === id)
  if (!account) error(404, 'No such system account.')
  return account
}

/** The dockets a system account reaches now, by its grants: what its tokens may name. */
async function reachable(tx: Tx, orgId: string, accountId: string, dockets: ReadonlyMap<string, DocketRef>) {
  const access = await accessOf(tx, orgId, accountId)
  return [...dockets.values()].flatMap((docket) => {
    const caps = capsAt(access, docketPlace(docket.id))
    return caps.has('read') ? [{ ...docket, readOnly: !caps.has('write') }] : []
  })
}

export const load: PageServerLoad = async (event) => {
  const user = requireUser(event)
  const access = await orgAccess(event)
  if (!mayManageSystemAccounts(access)) error(403, 'You do not have access to that.')
  const id = event.params.id ?? ''
  const { dockets } = await accountDockets(access.org)
  const names = await placeNames(access.org.id)
  const { account, tokens, reach, notices, grants } = await getRuntime().router.withPlatform(async (tx) => ({
    account: await systemAccount(tx, access.org.id, id),
    tokens: await listApiTokens(tx, { orgId: access.org.id, ownerId: id }),
    reach: await reachable(tx, access.org.id, id, dockets),
    notices: (await tokenNotices(tx, access.org.id)).filter((notice) => notice.accountId === id),
    grants: await listGrants(tx, access.org.id, { userId: id }),
  }))
  const views = grants.map((grant) => grantView(grant, access.principal, names, access.org.name))
  if (!mayChangeAccount(access, views)) error(404, 'No such system account.')
  const now = Date.now()
  return {
    created: event.url.searchParams.has('created'),
    account: {
      id: account.id,
      name: account.name,
      description: account.description,
      access: accessSummary(views),
      managed: account.managed,
      createdAt: iso(account.createdAt),
      createdBy: account.createdByLogin,
    },
    mayChange: !account.managed && mayChangeAccount(access, views),
    grants: account.managed ? views.map((grant) => ({ ...grant, mayChange: false })) : views,
    roles: await rolesFor(access.org.id),
    places: placesToGive(access, names, 'service'),
    reachable: reach,
    expiryChoices: EXPIRY_CHOICES,
    defaultDays: DEFAULT_SYSTEM_TOKEN_DAYS,
    tokens: tokens.map((token) => tokenView(token, user.id, dockets, now)),
    notices: notices.map((notice) => ({ ...notice, expiresAt: notice.expiresAt.toISOString() })),
  }
}

/** The system account named in the path, if this member may change it. */
async function changeable(tx: Tx, access: OrgAccess, id: string) {
  const account = await systemAccount(tx, access.org.id, id)
  if (account.managed) throw new TenancyError('forbidden', 'This system account is managed through the org admin API.')
  const names = await placeNames(access.org.id)
  const grants = (await listGrants(tx, access.org.id, { userId: id })).map((grant) => grantView(grant, access.principal, names, access.org.name))
  if (!mayChangeAccount(access, grants)) throw new TenancyError('forbidden', 'You do not manage system accounts where it reaches.')
  return account
}

const tokenRefusals = (cause: unknown) => {
  if (cause instanceof ApiTokenError) return fail(cause.code === 'forbidden' ? 403 : cause.code === 'not-found' ? 404 : 400, { problem: cause.message })
  if (cause instanceof TokenRevocationError) return fail(404, { problem: cause.message })
  return null
}

export const actions: Actions = {
  createToken: async (event) => {
    const decision = await getRuntime().limiter.check(tokenCreateLimits(requireUser(event).id))
    if (!decision.allowed) {
      await recordStandalone(event, { action: 'tokens.create', outcome: 'denied', orgId: null, target: ['rate-limit'] })
      return fail(429, { problem: rateLimitMessage(decision) })
    }
    const { dockets } = await accountDockets(await orgAccess(event).then((access) => access.org))
    return manage(
      event,
      async (tx, { access, userId, form }) => {
        const account = await changeable(tx, access, event.params.id ?? '')
        const reach = await reachable(tx, access.org.id, account.id, dockets)
        const all = form.get('reach') === 'all'
        const chosen = form.getAll('docket').map(String).filter((id) => reach.some((docket) => docket.id === id))
        if (!all && chosen.length === 0) throw new ApiTokenError('invalid', 'Choose at least one docket, or every docket.')
        const readOnly = form.get('readOnly') === 'on'
        const days = Number(form.get('days') ?? DEFAULT_SYSTEM_TOKEN_DAYS)
        const issued = await issueApiToken(tx, {
          orgId: access.org.id,
          ownerId: account.id,
          createdBy: userId,
          readOnly,
          dockets: all ? null : chosen,
          expiresInDays: days,
          name: String(form.get('name') ?? ''),
        })
        return {
          action: 'tokens.create',
          target: [issued.id, `user:${account.id}`],
          args: { prefix: issued.prefix, owner: account.id, readOnly: issued.readOnly, dockets: all ? 'all' : chosen, days },
          flash: `Created ${issued.prefix}… for ${account.name}. It is shown once: copy it now.`,
          created: { token: issued.token, prefix: issued.prefix, expiresAt: issued.expiresAt.toISOString() },
        }
      },
      tokenRefusals,
    )
  },

  renameToken: (event) =>
    manage(
      event,
      async (tx, { access, form }) => {
        const account = await changeable(tx, access, event.params.id ?? '')
        const tokenId = String(form.get('token') ?? '')
        const renamed = await renameApiToken(tx, { orgId: access.org.id, tokenId, ownerId: account.id, name: String(form.get('name') ?? '') })
        return { action: 'tokens.rename', target: [tokenId], args: { prefix: renamed.prefix, from: renamed.before, to: renamed.after }, flash: `Renamed ${renamed.prefix}….` }
      },
      tokenRefusals,
    ),

  revokeToken: (event) =>
    manage(
      event,
      async (tx, { access, userId, form }) => {
        const account = await changeable(tx, access, event.params.id ?? '')
        const tokenId = String(form.get('token') ?? '')
        const revoked = await revokeApiToken(tx, { orgId: access.org.id, tokenId, by: userId, ownerId: account.id })
        return { action: 'tokens.revoke', target: [tokenId], args: { prefix: revoked.prefix }, flash: `Revoked ${revoked.prefix}… — the next call with this token will fail.` }
      },
      tokenRefusals,
    ),

  // Its grants, as anywhere else: given, adjusted and removed here, for this system account alone.
  ...grantActions({ only: (event) => ({ kind: 'user', id: event.params.id ?? '' }) }),

  describe: (event) =>
    manage(event, async (tx, { access, form }) => {
      const account = await changeable(tx, access, event.params.id ?? '')
      const description = String(form.get('description') ?? '').trim().slice(0, 200) || null
      await describeServiceAccount(tx, { orgId: access.org.id, serviceId: account.id, description })
      return { action: 'system-accounts.describe', target: [`user:${account.id}`], flash: 'Saved.' }
    }),

  remove: async (event) => {
    const removed = await manage(event, async (tx, { access }) => {
      const account = await changeable(tx, access, event.params.id ?? '')
      await removeMember(tx, { orgId: access.org.id, userId: account.id, actor: access.principal })
      await notifyRevoked(tx, `user:${account.id}`)
      return { action: 'system-accounts.remove', target: [`user:${account.id}`], args: { name: account.name }, flash: `Removed ${account.name} and revoked its tokens.`, gone: true }
    })
    if ('gone' in removed) redirect(303, `/a/${event.params.org}/settings/system-accounts`)
    return removed
  },
}
