// SPDX-License-Identifier: AGPL-3.0-only
import { audit, listAudit, type Outcome } from '@docket/platform-audit'
import {
  issueApiToken,
  listApiTokens,
  listConnections,
  mcpResourceUrl,
  notifyRevoked,
  renameApiToken,
  renameConnection,
  revokeApiToken,
  revokeConnection,
  revokeWorkspaceCredentials,
} from '@docket/platform-auth'
import {
  deleteWorkspace,
  insertSpace,
  listSpaces,
  listWorkspaces,
  newSpaceProblem,
  removeMemberAttributes,
  trustChanged,
  updateSpace,
  updateWorkspace,
  WorkspaceError,
  type StoreContext,
} from '@docket/platform-canonical-store'
import { dropRoutes } from '@docket/platform-github'
import { rateLimitMessage, tokenCreateLimits } from '@docket/platform-limits'
import { createWorkspace, isTemplateId, orgTemplateId, type OntologyStart } from '@docket/platform-ontology-service'
import {
  ACCOUNT,
  CAPABILITIES,
  because,
  createInvite,
  createServiceAccount,
  deleteRole,
  docketPlace,
  grantCaps,
  insertOrg,
  listGrants,
  listMembers,
  listRoles,
  listSystemAccounts,
  mayCreateSpace,
  mayGrant,
  membershipsOf,
  newTenantId,
  openInvitesOf,
  placeKey,
  removeGrant,
  removeMember,
  reissueInvite,
  revokeInvite,
  rolesOf,
  saveRole,
  seesDocket,
  seesSpace,
  setGrant,
  setOwner,
  slugProblem,
  spacePlace,
  discardUnprovisionedOrg,
  type Access,
  type Capability,
  type Grantee,
  type GrantView,
  type IssuedInvite,
  type Place,
  type Tx,
} from '@docket/platform-tenancy'

import { placeLabel, placeNames, type PlaceNames } from '../grants'
import { sendInvite } from '../invites'
import { accountRoles } from '../members'
import { changeAccount, operatorAccountView, operatorOverview } from '../operator'
import { becauseLabel, placeAccess } from '../place-access'
import { isPlatformAdmin, type SignedIn } from '../request'
import { getRuntime } from '../runtime'
import { accountShell, commandSearch, docketFacts } from '../shell'
import { mayChangeAccount, mayManageSystemAccounts } from '../system-accounts'
import { actorNames, docketLimitOf, inOrg } from '../workspace'
import { accountCaller, ApiFailure, readsOnly, type AccountCaller, type Caller } from './caller'
import {
  accountView,
  connectionView,
  docketIds,
  docketView,
  grantView,
  inviteView,
  memberView,
  placeFromRef,
  placeView,
  roleFrom,
  roleView,
  spaceView,
  tokenView,
} from './views'

/**
 * What each `/api/v1` operation does (tenancy v2 §3.5), whatever carried the
 * call: the API route, or an `admin_*` tool at an account's MCP address. Each
 * checks the capability the app's own button checks, on the place the call
 * names, with `capsAt` on the caller's grants - narrowed to what their
 * credential reaches - and records one audit event in the account's log, in
 * the transaction that made its change.
 */

export interface CallMeta {
  requestId: string
  ip: string | null
  userAgent: string | null
  startedAt: number
  /** The session's CSRF token, for `me.get`. */
  csrf: string | null
}

export interface ApiCall {
  caller: Caller
  meta: CallMeta
  params: Record<string, string>
  query: Record<string, unknown>
  body: Record<string, unknown>
  /** What the call's audit event says: set as the handler finds out; `written` once it is in the log. */
  audit: { orgId: string | null; workspaceId?: string; target: string[]; args?: unknown; written: boolean }
  /** The action it is audited as: `api.<operation id>`, or `mcp.tools/call <tool>`. */
  action: string
}

export interface Answer {
  status?: number
  body: unknown
}

export type Handler = (call: ApiCall) => Promise<Answer>

const runtime = () => getRuntime()

/** The account the call names, once: its audit event goes to that account's log. */
async function account(call: ApiCall, slug = call.params.acct ?? ''): Promise<AccountCaller> {
  const found = await accountCaller(call.caller, slug)
  call.audit.orgId = found.org.id
  return found
}

function auditFields(call: ApiCall, outcome: Outcome) {
  return {
    orgId: call.audit.orgId,
    ...(call.audit.workspaceId ? { workspaceId: call.audit.workspaceId } : {}),
    actor: call.caller.actor as `user:${string}`,
    ip: call.meta.ip,
    userAgent: call.meta.userAgent,
    action: call.action,
    target: call.audit.target,
    ...(call.audit.args !== undefined ? { args: call.audit.args } : {}),
    outcome,
    latencyMs: performance.now() - call.meta.startedAt,
    requestId: call.meta.requestId,
  }
}

/** Records the call's audit event on its own: a read, or a refusal after the change rolled back. */
export async function recordCall(call: ApiCall, outcome: Outcome): Promise<void> {
  if (call.audit.written) return
  const write = (tx: Tx) => audit(tx, auditFields(call, outcome))
  if (call.audit.orgId) await runtime().router.withTenant(call.audit.orgId, write)
  else await runtime().router.withPlatform(write)
  call.audit.written = true
}

/** A change to the platform's records, with its audit event in the account's log in the same transaction (§10). */
async function inPlatform<T>(call: ApiCall, acct: AccountCaller, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const { router } = runtime()
  const value = await router.withPlatform(async (tx) => {
    const done = await fn(tx)
    await router.enterTenant(tx, acct.org.id)
    await audit(tx, auditFields(call, 'ok'))
    return done
  })
  call.audit.written = true
  return value
}

/** A change to the account's own schema, with its audit event in the same transaction. */
async function inTenant<T>(call: ApiCall, acct: AccountCaller, fn: (ctx: StoreContext) => Promise<T>): Promise<T> {
  const { router, keyring } = runtime()
  const keys = await keyring.forOrg(acct.org.id)
  const value = await router.withTenant(acct.org.id, async (tx) => {
    const done = await fn({ tx, keys })
    await audit(tx, auditFields(call, 'ok'))
    return done
  })
  call.audit.written = true
  return value
}

const reading = <T>(acct: AccountCaller, fn: (tx: Tx) => Promise<T>) => runtime().router.withTenant(acct.org.id, fn)
const platform = <T>(fn: (tx: Tx) => Promise<T>) => runtime().router.withPlatform(fn)

/** The platform operator making the call, in their own browser session (`DOCKET_PLATFORM_ADMINS`); anyone else is refused. */
function mustOperate(call: ApiCall): SignedIn {
  const session = call.caller.session
  if (!session || !isPlatformAdmin(session)) refuse('Only a platform operator can do that.')
  return session
}

function refuse(message = 'You do not have access to that.'): never {
  throw new ApiFailure('forbidden', message)
}

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

/** A member a request names, by login (a person's or a system account's name) or id; `everyone` for everyone. */
async function granteeFrom(acct: AccountCaller, ref: string): Promise<{ who: Grantee; kind: 'human' | 'service' | 'everyone'; login: string }> {
  if (ref === 'everyone') return { who: { kind: 'everyone' }, kind: 'everyone', login: 'everyone' }
  const wanted = ref.replace(/^@/, '').toLowerCase()
  const member = (await platform((tx) => listMembers(tx, acct.org.id))).find((each) => each.id === ref || each.login.toLowerCase() === wanted)
  if (!member) throw new ApiFailure('not_found', `No such member: ${ref}.`)
  return { who: { kind: 'user', id: member.id }, kind: member.kind, login: member.login }
}

/** Whether the caller manages access on a place (or system accounts, for grants to one). */
const manages = (acct: AccountCaller, place: Place, kind: 'human' | 'service' | 'everyone' = 'human') => {
  const caps = acct.capsAt(place)
  return caps.has('access') || (kind === 'service' && caps.has('system'))
}

/** The docket a path names, with the caller's capabilities there: 404 when they cannot see it, 403 when they cannot read it. */
async function docketOf(acct: AccountCaller, slug: string, names?: PlaceNames) {
  const all = names ?? (await placeNames(acct.org.id))
  const id = [...all.dockets].find(([, docket]) => docket.slug === slug)?.[0]
  if (!id || !seesDocket(acct.principal, id)) throw new ApiFailure('not_found', 'Not found.')
  const workspace = (await reading(acct, listWorkspaces)).find((each) => each.id === id)
  if (!workspace) throw new ApiFailure('not_found', 'Not found.')
  return { workspace, names: all, caps: acct.capsAt(docketPlace(id)) }
}

async function spaceOf(acct: AccountCaller, slug: string) {
  const space = (await reading(acct, listSpaces)).find((each) => each.slug === slug)
  if (!space || !seesSpace(acct.principal, space.id)) throw new ApiFailure('not_found', 'Not found.')
  return { space, caps: acct.capsAt(spacePlace(space.id)) }
}

/** A place the request names, which the caller must see. */
function placeFor(acct: AccountCaller, ref: string, names: PlaceNames): Place {
  const place = placeFromRef(ref, names)
  if (place.kind === 'docket' && !seesDocket(acct.principal, place.id)) throw new ApiFailure('not_found', 'Not found.')
  if (place.kind === 'space' && !seesSpace(acct.principal, place.id)) throw new ApiFailure('not_found', 'Not found.')
  return place
}

async function grantById(acct: AccountCaller, id: string): Promise<GrantView> {
  const grant = (await platform((tx) => listGrants(tx, acct.org.id))).find((each) => each.id === id)
  if (!grant) throw new ApiFailure('not_found', 'No such grant.')
  const kind = grant.grantee.kind === 'everyone' ? 'everyone' : grant.grantee.userKind
  const own = grant.who.kind === 'user' && grant.who.id === acct.principal.userId
  if (!own && !manages(acct, grant.place, kind)) throw new ApiFailure('not_found', 'No such grant.')
  return grant
}

const targetOf = (grant: GrantView) => [`grant:${grant.id}`, grant.who.kind === 'user' ? `user:${grant.who.id}` : 'everyone']

/** Gives or changes a grant, as the app's Access tabs do: the actor holds what it gives, where they manage access. */
async function putGrant(call: ApiCall, acct: AccountCaller, input: { who: Grantee; place: Place; roleId: string; add: readonly Capability[]; remove: readonly Capability[] }) {
  const names = await placeNames(acct.org.id)
  const { grant, before } = await inPlatform(call, acct, async (tx) => {
    const given = await setGrant(tx, { orgId: acct.org.id, ...input, actor: acct.principal, actorId: call.caller.user.id })
    call.audit.target = targetOf(given.grant)
    call.audit.args = { place: placeKey(input.place), role: input.roleId, add: input.add, remove: input.remove }
    return given
  })
  return { status: before ? 200 : 201, body: grantView(grant, acct.principal, names, acct.org) }
}

/** The dockets a system account reaches now: what its tokens may name. */
async function systemAccountOf(acct: AccountCaller, id: string, options: { change?: boolean } = {}) {
  if (!mayManageSystemAccounts(acct)) refuse('You do not manage system accounts.')
  const names = await placeNames(acct.org.id)
  const { account: found, grants } = await platform(async (tx) => ({
    account: (await listSystemAccounts(tx, acct.org.id)).find((each) => each.id === id),
    grants: await listGrants(tx, acct.org.id, { userId: id }),
  }))
  if (!found) throw new ApiFailure('not_found', 'No such system account.')
  const views = grants.map((grant) => grantView(grant, acct.principal, names, acct.org))
  if (!mayChangeAccount(acct, views.map((grant) => ({ place: { key: placeKey(placeFromRef(grant.place.ref, names)) } })))) {
    throw new ApiFailure('not_found', 'No such system account.')
  }
  if (options.change && found.managed) refuse('This system account is managed through the org admin API.')
  return { found, views, names }
}

const systemAccountView = (found: Awaited<ReturnType<typeof systemAccountOf>>['found'], grants: ReturnType<typeof grantView>[]) => ({
  id: found.id,
  name: found.name,
  description: found.description,
  managed: found.managed,
  live_tokens: found.liveTokens,
  last_used_at: found.lastUsedAt?.toISOString() ?? null,
  next_expiry: found.nextExpiry?.toISOString() ?? null,
  created_at: found.createdAt.toISOString(),
  created_by: found.createdByLogin,
  grants: found.managed ? grants.map((grant) => ({ ...grant, may_change: false })) : grants,
})

/** At most 10 new tokens a minute per person (§19), wherever they are made. */
async function tokenLimit(call: ApiCall): Promise<void> {
  const decision = await runtime().limiter.check(tokenCreateLimits(call.caller.user.id))
  if (!decision.allowed) throw new ApiFailure('rate_limited', rateLimitMessage(decision), undefined, { 'retry-after': String(decision.retryAfterSeconds) })
}

/** The account a `me.*` call names in its query or body. */
const ownCredentialAccount = (call: ApiCall, slug: unknown): Promise<AccountCaller> => account(call, str(slug) ?? '')

async function resources(acct: AccountCaller): Promise<Map<string, string>> {
  const all = await reading(acct, listWorkspaces)
  return new Map(all.map((workspace) => [mcpResourceUrl(runtime().origin, acct.org.slug, workspace.slug), workspace.id]))
}

/** A just-made (or renewed) invite, once it is saved and its email sent: with its link, shown this once. */
async function issuedInviteView(call: ApiCall, acct: AccountCaller, invite: IssuedInvite, names: PlaceNames) {
  const sent = await sendInvite(invite, {
    accountName: acct.org.name,
    placeName: placeLabel(invite.place, names, acct.org.name),
    invitedBy: call.caller.user.login,
    requestId: call.meta.requestId,
  })
  return { ...inviteView({ ...invite, emailedTo: sent.emailedTo, emailedAt: sent.emailedTo ? new Date() : null }, names, acct.org), link: sent.link }
}

export const HANDLERS: Record<string, Handler> = {
  // --- Me ----------------------------------------------------------------------
  'me.get': async (call) => {
    const { caller } = call
    const memberships = await platform((tx) => membershipsOf(tx, caller.user.id))
    const accounts = memberships
      .filter((membership) => !caller.credential || membership.org.id === caller.credential.orgId)
      .map((membership) => ({ id: membership.org.id, slug: membership.org.slug, name: membership.org.name, owner: membership.owner, guest: membership.guest }))
    const credentialOrg = caller.credential ? memberships.find((membership) => membership.org.id === caller.credential?.orgId)?.org.slug ?? '' : ''
    return {
      body: {
        user: caller.user,
        via: caller.via,
        csrf: caller.via === 'session' ? call.meta.csrf : null,
        credential: caller.credential
          ? {
              id: caller.credential.tokenId,
              name: caller.credential.credentialName ?? null,
              read_only: readsOnly(caller.credential),
              dockets: caller.credential.dockets ?? null,
              account: credentialOrg,
            }
          : null,
        allowlisted: caller.session?.allowlisted ?? false,
        platform_admin: caller.session ? isPlatformAdmin(caller.session) : false,
        accounts,
      },
    }
  },

  'me.tokens.list': async (call) => {
    const acct = await ownCredentialAccount(call, call.query.account)
    const names = await placeNames(acct.org.id)
    const tokens = await platform((tx) => listApiTokens(tx, { orgId: acct.org.id, ownerId: call.caller.user.id }))
    return { body: { tokens: tokens.map((token) => tokenView(token, names)) } }
  },

  'me.tokens.create': async (call) => {
    await tokenLimit(call)
    const acct = await ownCredentialAccount(call, call.body.account)
    const names = await placeNames(acct.org.id)
    const dockets = docketIds(call.body.dockets as string[] | null | undefined, names)
    const issued = await inPlatform(call, acct, async (tx) => {
      const done = await issueApiToken(tx, {
        orgId: acct.org.id,
        ownerId: call.caller.user.id,
        createdBy: call.caller.user.id,
        readOnly: call.body.read_only === true,
        dockets,
        ...(call.body.days !== undefined ? { expiresInDays: call.body.days as number } : {}),
        name: str(call.body.name) ?? '',
      })
      call.audit.target = [done.id]
      call.audit.args = { prefix: done.prefix, owner: call.caller.user.id, readOnly: done.readOnly, dockets: dockets ?? 'all' }
      return done
    })
    return { status: 201, body: { id: issued.id, prefix: issued.prefix, token: issued.token, read_only: issued.readOnly, expires_at: issued.expiresAt.toISOString() } }
  },

  'me.tokens.update': async (call) => {
    const acct = await tokenAccount(call)
    const names = await placeNames(acct.org.id)
    const tokenId = call.params.id ?? ''
    await inPlatform(call, acct, async (tx) => {
      const renamed = await renameApiToken(tx, { orgId: acct.org.id, tokenId, ownerId: call.caller.user.id, name: str(call.body.name) ?? '' })
      call.audit.target = [tokenId]
      call.audit.args = { prefix: renamed.prefix, from: renamed.before, to: renamed.after }
    })
    const token = (await platform((tx) => listApiTokens(tx, { orgId: acct.org.id, ownerId: call.caller.user.id }))).find((each) => each.id === tokenId)
    if (!token) throw new ApiFailure('not_found', 'No such token.')
    return { body: tokenView(token, names) }
  },

  'me.tokens.revoke': async (call) => {
    const acct = await tokenAccount(call)
    const tokenId = call.params.id ?? ''
    await inPlatform(call, acct, async (tx) => {
      const revoked = await revokeApiToken(tx, { orgId: acct.org.id, tokenId, by: call.caller.user.id, ownerId: call.caller.user.id })
      call.audit.target = [tokenId]
      call.audit.args = { prefix: revoked.prefix }
    })
    return { status: 204, body: null }
  },

  'me.connections.list': async (call) => {
    const acct = await ownCredentialAccount(call, call.query.account)
    const names = await placeNames(acct.org.id)
    const found = await platform(async (tx) => listConnections(tx, { orgId: acct.org.id, resources: await resources(acct), userId: call.caller.user.id }))
    return { body: { connections: found.map((connection) => connectionView(connection, names)) } }
  },

  'me.connections.update': async (call) => {
    const acct = await ownCredentialAccount(call, call.body.account)
    const names = await placeNames(acct.org.id)
    const grantId = call.params.id ?? ''
    const map = await resources(acct)
    await inPlatform(call, acct, async (tx) => {
      const renamed = await renameConnection(tx, { orgId: acct.org.id, grantId, userId: call.caller.user.id, resources: map, name: str(call.body.name) ?? '' })
      call.audit.target = [`conn:${grantId}`]
      call.audit.args = { from: renamed.before, to: renamed.after }
    })
    const found = (await platform((tx) => listConnections(tx, { orgId: acct.org.id, resources: map, userId: call.caller.user.id }))).find((each) => each.id === grantId)
    if (!found) throw new ApiFailure('not_found', 'No such connection.')
    return { body: connectionView(found, names) }
  },

  'me.connections.revoke': async (call) => {
    const acct = await ownCredentialAccount(call, call.query.account)
    const grantId = call.params.id ?? ''
    const map = await resources(acct)
    await inPlatform(call, acct, async (tx) => {
      const revoked = await revokeConnection(tx, { orgId: acct.org.id, grantId, userId: call.caller.user.id, resources: map })
      call.audit.target = [`conn:${grantId}`, revoked.clientId]
    })
    return { status: 204, body: null }
  },

  // --- Accounts ----------------------------------------------------------------
  'accounts.list': async (call) => {
    const { caller } = call
    const memberships = (await platform((tx) => membershipsOf(tx, caller.user.id))).filter((membership) => !caller.credential || membership.org.id === caller.credential.orgId)
    const accounts = []
    for (const membership of memberships) {
      const acct = await accountCaller(caller, membership.org.slug)
      accounts.push(accountView(membership.org, acct.principal, acct.capsAt(ACCOUNT), membership))
    }
    return { body: { accounts } }
  },

  // --- The platform operator -------------------------------------------------------
  'operator.accounts.list': async (call) => {
    mustOperate(call)
    const { accounts, defaults, platform: box } = await operatorOverview()
    call.audit.target = ['operator:accounts']
    return { body: { accounts: accounts.map(operatorAccountView), defaults: { max_members: defaults.maxMembers, max_dockets: defaults.maxDockets }, platform: box } }
  },

  'operator.accounts.update': async (call) => {
    const operator = mustOperate(call)
    const body = call.body as { suspended?: boolean; reason?: string; max_members?: number | null; max_dockets?: number | null }
    const changed = await changeAccount(
      call.params.acct ?? '',
      {
        ...(body.suspended !== undefined ? { suspended: body.suspended, reason: body.reason ?? null } : {}),
        ...(body.max_members !== undefined ? { maxMembers: body.max_members } : {}),
        ...(body.max_dockets !== undefined ? { maxDockets: body.max_dockets } : {}),
      },
      operator.id,
      async (tx, entry) => {
        call.audit.target = entry.target
        call.audit.args = entry.args
        await audit(tx, auditFields(call, 'ok'))
      },
    )
    call.audit.written = true
    return { body: operatorAccountView(changed) }
  },

  'accounts.create': async (call) => {
    const session = call.caller.session
    if (!session?.allowlisted) refuse('Only accounts on the beta list can create an account.')
    const name = String(call.body.name).trim()
    const slug = String(call.body.slug)
    const problem = slugProblem(slug)
    if (problem) throw new ApiFailure('invalid_request', problem)
    const { router, provisioner, maxOrgs } = runtime()
    const id = newTenantId()
    call.audit.target = [`org:${id}`, `slug:${slug}`]
    await router.withPlatform(async (tx) => {
      await insertOrg(tx, { id, slug, name, ownerId: session.id, maxOrgs })
      await audit(tx, auditFields({ ...call, action: 'org.create' }, 'ok'))
    })
    try {
      await provisioner.provision({ orgId: id })
    } catch (caught) {
      console.error(`[${call.meta.requestId}] provisioning org ${id}: ${caught instanceof Error ? caught.message : String(caught)}`)
      await router.withPlatform((tx) => discardUnprovisionedOrg(tx, id))
      throw new ApiFailure('server_error', 'The account could not be set up. Nothing was kept; try again.')
    }
    call.audit.orgId = id
    const acct = await account(call, slug)
    await recordCall({ ...call, action: 'org.provision' }, 'ok')
    call.audit.written = true
    return { status: 201, body: accountView(acct.org, acct.principal, acct.capsAt(ACCOUNT), { owner: true, guest: false }) }
  },

  'accounts.get': async (call) => {
    const acct = await account(call)
    return { body: accountView(acct.org, acct.principal, acct.capsAt(ACCOUNT), { owner: acct.owner, guest: acct.principal.guest }) }
  },

  // The app's sidebar, as the server's account pages draw it (`accountShell`): the web UI draws it from here.
  'accounts.navigation': async (call) => {
    const acct = await account(call)
    const shell = await accountShell(acct)
    return {
      body: {
        account: shell.org,
        role: shell.role,
        caps: CAPABILITIES.filter((cap) => shell.permissions[cap]),
        owner: shell.owner,
        account_admin: shell.accountAdmin,
        manages_access: shell.managesAccess,
        manages_system_accounts: shell.managesSystemAccounts,
        creates_spaces: shell.createsSpaces,
        spaces: shell.spaces,
        dockets: shell.dockets.map((docket) => ({ slug: docket.slug, name: docket.name, space_id: docket.spaceId, number: docket.docketNo, open: docket.open })),
        token_notices: shell.tokenNotices,
        ai: { spent_usd: shell.ai.spentUsd, cap_usd: shell.ai.capUsd, fraction: shell.ai.fraction, warned: shell.ai.warned },
      },
    }
  },

  // The command menu's search, as the server's own pages ask it (`commandSearch`): only the dockets the caller reads.
  'accounts.search': async (call) => {
    const acct = await account(call)
    if (!acct.canAnywhere('read')) refuse()
    const named = (str(call.query.ws) ?? '').split(',').map((each) => each.trim()).filter(Boolean)
    return { body: await commandSearch(acct, call.caller.user.id, str(call.query.q) ?? '', named) }
  },

  'accounts.update': async (call) => {
    const acct = await account(call)
    if (!acct.owner) refuse('Only an owner of the account can do that.')
    const name = str(call.body.name)?.trim() ?? acct.org.name
    const heir = str(call.body.owner)
    if (str(call.body.name) === undefined && heir === undefined) throw new ApiFailure('invalid_request', 'Send a name, an owner, or both.')
    const next = heir === undefined ? null : await granteeFrom(acct, heir)
    if (next && next.kind !== 'human') throw new ApiFailure('invalid_request', 'Only a person can own the account.')
    const transfer = next !== null && next.who.kind === 'user' && next.who.id !== call.caller.user.id ? next.who.id : null
    await inPlatform(call, acct, async (tx) => {
      await tx.query('UPDATE platform.orgs SET name = $2 WHERE id = $1', [acct.org.id, name])
      if (transfer) {
        await setOwner(tx, { orgId: acct.org.id, userId: transfer, owner: true, actor: acct.principal })
        await setOwner(tx, { orgId: acct.org.id, userId: call.caller.user.id, owner: false, actor: acct.principal })
      }
      call.audit.target = [`org:${acct.org.id}`, ...(transfer ? [`user:${transfer}`] : [])]
      call.audit.args = { from: acct.org.name, to: name, ...(transfer ? { owner: transfer } : {}) }
    })
    const owner = transfer === null && acct.owner
    return { body: accountView({ ...acct.org, name }, acct.principal, acct.capsAt(ACCOUNT), { owner, guest: acct.principal.guest }) }
  },

  'accounts.delete': async (call) => {
    const acct = await account(call)
    if (!acct.owner) refuse('Only an owner of the account can do that.')
    call.audit.target = [`org:${acct.org.id}`, `slug:${acct.org.slug}`]
    await runtime().provisioner.deprovision({ orgId: acct.org.id }, 'soft')
    // The account's own log is no longer served: its deletion is recorded in the platform's.
    await platform((tx) => audit(tx, auditFields(call, 'ok')))
    call.audit.written = true
    return { body: null }
  },

  // --- Users -------------------------------------------------------------------
  'members.list': async (call) => {
    const acct = await account(call)
    if (acct.principal.guest) refuse('A guest does not see the account’s users.')
    const members = await platform(async (tx) => {
      const all = await listMembers(tx, acct.org.id)
      const roles = await accountRoles(tx, acct.org.id, all)
      return all.map((member) => memberView(member, roles.get(member.id) ?? ''))
    })
    return { body: { members } }
  },

  'members.update': async (call) => {
    const acct = await account(call)
    const { who } = await granteeFrom(acct, call.params.user ?? '')
    if (who.kind !== 'user') throw new ApiFailure('not_found', 'No such member.')
    const owner = call.body.owner === true
    await inPlatform(call, acct, async (tx) => {
      const was = await setOwner(tx, { orgId: acct.org.id, userId: who.id, owner, actor: acct.principal })
      call.audit.target = [`user:${who.id}`]
      call.audit.args = { from: was, to: owner }
    })
    const member = await platform(async (tx) => {
      const all = await listMembers(tx, acct.org.id)
      const roles = await accountRoles(tx, acct.org.id, all)
      const found = all.find((each) => each.id === who.id)
      return found ? memberView(found, roles.get(found.id) ?? '') : null
    })
    if (!member) throw new ApiFailure('not_found', 'No such member.')
    return { body: member }
  },

  'members.remove': async (call) => {
    const acct = await account(call)
    const { who, kind } = await granteeFrom(acct, call.params.user ?? '')
    if (who.kind !== 'user') throw new ApiFailure('not_found', 'No such member.')
    await inPlatform(call, acct, async (tx) => {
      const removed = await removeMember(tx, { orgId: acct.org.id, userId: who.id, actor: acct.principal })
      if (kind === 'service') await notifyRevoked(tx, `user:${who.id}`)
      call.audit.target = [`user:${who.id}`]
      call.audit.args = removed
      await runtime().router.enterTenant(tx, acct.org.id)
      // What the directory said about them goes too: no policy trusts a role they no longer hold here.
      if (await removeMemberAttributes({ tx }, who.id)) await trustChanged(tx)
    })
    return { status: 204, body: null }
  },

  'invites.list': async (call) => {
    const acct = await account(call)
    if (!acct.canAnywhere('access')) refuse()
    const names = await placeNames(acct.org.id)
    const { invites, roles } = await platform(async (tx) => ({ invites: await openInvitesOf(tx, acct.org.id), roles: await rolesOf(tx, acct.org.id) }))
    const capsOf = (id: string) => roles.find((role) => role.id === id)?.caps ?? CAPABILITIES
    return {
      body: {
        invites: invites
          .filter((invite) => (invite.owner ? acct.owner : mayGrant(acct.principal, invite.place, capsOf(invite.roleId), 'human')))
          .map((invite) => inviteView(invite, names, acct.org)),
      },
    }
  },

  'invites.create': async (call) => {
    const acct = await account(call)
    const names = await placeNames(acct.org.id)
    const place = placeFor(acct, String(call.body.place), names)
    const role = roleFrom(String(call.body.role), await platform((tx) => rolesOf(tx, acct.org.id)))
    const invite = await inPlatform(call, acct, async (tx) => {
      const made = await createInvite(tx, {
        orgId: acct.org.id,
        who: String(call.body.to),
        roleId: role.id,
        place,
        guest: call.body.guest === true,
        actorId: call.caller.user.id,
        actor: acct.principal,
      })
      call.audit.target = [`invite:${made.id}`]
      call.audit.args = { place: placeKey(place), role: role.id, guest: made.guest }
      return made
    })
    return { status: 201, body: await issuedInviteView(call, acct, invite, names) }
  },

  'invites.resend': async (call) => {
    const acct = await account(call)
    const names = await placeNames(acct.org.id)
    const invite = await inPlatform(call, acct, async (tx) => {
      const renewed = await reissueInvite(tx, { orgId: acct.org.id, inviteId: call.params.id ?? '', actor: acct.principal })
      call.audit.target = [`invite:${renewed.id}`]
      return renewed
    })
    return { body: await issuedInviteView(call, acct, invite, names) }
  },

  'invites.revoke': async (call) => {
    const acct = await account(call)
    const inviteId = call.params.id ?? ''
    await inPlatform(call, acct, async (tx) => {
      await revokeInvite(tx, { orgId: acct.org.id, inviteId, actor: acct.principal })
      call.audit.target = [`invite:${inviteId}`]
    })
    return { status: 204, body: null }
  },

  // --- Access ------------------------------------------------------------------
  'access.explain': async (call) => {
    const acct = await account(call)
    const names = await placeNames(acct.org.id)
    const place = placeFor(acct, String(call.query.place), names)
    const caps = acct.capsAt(place)
    return {
      body: {
        place: placeView(place, names, acct.org),
        owner: acct.owner,
        caps: CAPABILITIES.filter((cap) => caps.has(cap)),
        because: acct.owner ? [`You own ${acct.org.name}: every capability, everywhere.`] : because(acct.principal, place).map((grant) => becauseLabel(grant, place, names, acct.org.name)),
      },
    }
  },

  // Who reaches a place, as its Access tab shows whoever manages access there (`placeAccess`).
  'access.who': async (call) => {
    const acct = await account(call)
    const names = await placeNames(acct.org.id)
    const place = placeFor(acct, String(call.query.place), names)
    const caps = acct.capsAt(place)
    if (!caps.has('access') && !caps.has('system')) refuse('You do not manage access here.')
    const page = await placeAccess({ access: acct, here: place, caps, names })
    const spaceId = place.kind === 'docket' ? names.dockets.get(place.id)?.spaceId : undefined
    // The bigger places: the whole account, and for a docket its space.
    const covering = (await platform((tx) => listGrants(tx, acct.org.id))).filter(
      (grant) =>
        (place.kind !== 'account' && grant.place.kind === 'account') || (spaceId !== undefined && grant.place.kind === 'space' && grant.place.id === spaceId),
    )
    return {
      body: {
        place: placeView(place, names, acct.org),
        reach: page.reach,
        // Changed on the bigger place's own page, never from this one.
        covering: covering.map((grant) => ({ ...grantView(grant, acct.principal, names, acct.org), may_change: false })),
        candidates: page.people.map((person) => ({ ref: person.id, label: person.label })),
      },
    }
  },

  'grants.list': async (call) => {
    const acct = await account(call)
    const names = await placeNames(acct.org.id)
    const place = typeof call.query.place === 'string' ? placeFor(acct, call.query.place, names) : undefined
    const who = typeof call.query.who === 'string' ? (await granteeFrom(acct, call.query.who)).who : undefined
    const grants = (await platform((tx) => listGrants(tx, acct.org.id, place ? { place } : {}))).filter((grant) => {
      if (who && JSON.stringify(who) !== JSON.stringify(grant.who)) return false
      const kind = grant.grantee.kind === 'everyone' ? 'everyone' : grant.grantee.userKind
      const own = grant.who.kind === 'user' ? grant.who.id === acct.principal.userId : grant.who.kind === 'everyone' && !acct.principal.guest && acct.principal.kind === 'human'
      return own || manages(acct, grant.place, kind)
    })
    return { body: { grants: grants.map((grant) => grantView(grant, acct.principal, names, acct.org)) } }
  },

  'grants.create': async (call) => {
    const acct = await account(call)
    const names = await placeNames(acct.org.id)
    const place = placeFor(acct, String(call.body.place), names)
    const { who } = await granteeFrom(acct, String(call.body.who))
    const role = roleFrom(String(call.body.role), await platform((tx) => rolesOf(tx, acct.org.id)))
    return putGrant(call, acct, { who, place, roleId: role.id, add: (call.body.add as Capability[]) ?? [], remove: (call.body.remove as Capability[]) ?? [] })
  },

  'grants.replace': async (call) => {
    const acct = await account(call)
    const existing = await grantById(acct, call.params.id ?? '')
    const role = roleFrom(String(call.body.role), await platform((tx) => rolesOf(tx, acct.org.id)))
    const answer = await putGrant(call, acct, { who: existing.who, place: existing.place, roleId: role.id, add: (call.body.add as Capability[]) ?? [], remove: (call.body.remove as Capability[]) ?? [] })
    return { body: answer.body }
  },

  'grants.adjust': async (call) => {
    const acct = await account(call)
    const existing = await grantById(acct, call.params.id ?? '')
    const answer = await putGrant(call, acct, {
      who: existing.who,
      place: existing.place,
      roleId: existing.role.id,
      add: (call.body.add as Capability[] | undefined) ?? existing.add,
      remove: (call.body.remove as Capability[] | undefined) ?? existing.remove,
    })
    return { body: answer.body }
  },

  'grants.delete': async (call) => {
    const acct = await account(call)
    const existing = await grantById(acct, call.params.id ?? '')
    await inPlatform(call, acct, async (tx) => {
      const removed = await removeGrant(tx, { orgId: acct.org.id, grantId: existing.id, actor: acct.principal })
      call.audit.target = targetOf(removed)
      call.audit.args = { place: placeKey(removed.place), role: removed.role.id }
    })
    return { status: 204, body: null }
  },

  // --- Roles -------------------------------------------------------------------
  'roles.list': async (call) => {
    const acct = await account(call)
    return { body: { roles: (await platform((tx) => listRoles(tx, acct.org.id))).map(roleView) } }
  },

  'roles.create': async (call) => saveRoleCall(call),
  'roles.update': async (call) => saveRoleCall(call, call.params.id),

  'roles.delete': async (call) => {
    const acct = await account(call)
    const id = call.params.id ?? ''
    await inPlatform(call, acct, async (tx) => {
      const deleted = await deleteRole(tx, { orgId: acct.org.id, id, actor: acct.principal })
      call.audit.target = [`role:${id}`]
      call.audit.args = { name: deleted.name }
    })
    return { status: 204, body: null }
  },

  // --- Spaces ------------------------------------------------------------------
  'spaces.list': async (call) => {
    const acct = await account(call)
    const spaces = (await reading(acct, listSpaces)).filter((space) => seesSpace(acct.principal, space.id))
    return { body: { spaces: spaces.map((space) => spaceView(space, acct.capsAt(spacePlace(space.id)))) } }
  },

  'spaces.create': async (call) => {
    const acct = await account(call)
    if (!mayCreateSpace(acct.principal)) refuse('Only an admin on the whole account can make a space.')
    const space = await inTenant(call, acct, async (ctx) => {
      const input = { name: String(call.body.name), slug: String(call.body.slug) }
      const problem = await newSpaceProblem(ctx.tx, input)
      if (problem) throw new WorkspaceError(problem.includes('already') ? 'conflict' : 'invalid', problem)
      const made = await insertSpace(ctx.tx, { ...input, description: str(call.body.description) ?? null, createdBy: call.caller.actor })
      call.audit.target = [`space:${made.id}`]
      call.audit.args = input
      return made
    })
    return { status: 201, body: spaceView(space, acct.capsAt(spacePlace(space.id))) }
  },

  'spaces.get': async (call) => {
    const acct = await account(call)
    const { space, caps } = await spaceOf(acct, call.params.space ?? '')
    return { body: spaceView(space, caps) }
  },

  'spaces.update': async (call) => {
    const acct = await account(call)
    const { space, caps } = await spaceOf(acct, call.params.space ?? '')
    if (!caps.has('settings')) refuse(`You cannot change ${space.name}'s settings.`)
    const updated = await inTenant(call, acct, async (ctx) => {
      const done = await updateSpace(ctx.tx, space.id, {
        ...(call.body.name !== undefined ? { name: String(call.body.name) } : {}),
        ...(call.body.description !== undefined ? { description: call.body.description as string | null } : {}),
      })
      call.audit.target = [`space:${space.id}`]
      call.audit.args = { name: done.name }
      return done
    })
    return { body: spaceView(updated, caps) }
  },

  // --- Dockets -----------------------------------------------------------------
  'dockets.list': async (call) => {
    const acct = await account(call)
    const names = await placeNames(acct.org.id)
    const space = typeof call.query.space === 'string' ? (await spaceOf(acct, call.query.space)).space : null
    const all = (await reading(acct, listWorkspaces)).filter((workspace) => seesDocket(acct.principal, workspace.id) && (!space || workspace.spaceId === space.id))
    return { body: { dockets: all.map((workspace) => docketView(acct.org, workspace, names, acct.capsAt(docketPlace(workspace.id)))) } }
  },

  'dockets.create': createDocket,

  'dockets.get': async (call) => {
    const acct = await account(call)
    const { workspace, names, caps } = await docketOf(acct, call.params.docket ?? '')
    if (!caps.has('read')) refuse('You have no access to this docket.')
    return { body: docketView(acct.org, workspace, names, caps) }
  },

  'dockets.summary': async (call) => {
    const acct = await account(call)
    const { workspace, caps } = await docketOf(acct, call.params.docket ?? '')
    if (!caps.has('read')) refuse('You have no access to this docket.')
    call.audit.workspaceId = workspace.id
    const facts = await inOrg(acct, (ctx) => docketFacts(ctx, workspace))
    const name = await actorNames(acct)
    return {
      body: {
        docket: workspace.slug,
        documents: facts.documents,
        drafts: facts.drafts,
        schema: facts.head
          ? {
              version: facts.head.number ?? 0,
              published_at: facts.head.publishedAt?.toISOString() ?? null,
              published_by: name(facts.head.publishedBy),
              message: facts.head.message,
            }
          : null,
      },
    }
  },

  'dockets.update': async (call) => {
    const acct = await account(call)
    const { workspace, names, caps } = await docketOf(acct, call.params.docket ?? '')
    if (!caps.has('settings')) refuse(`You cannot change ${workspace.name}'s settings.`)
    let spaceId: string | undefined
    if (typeof call.body.space === 'string') {
      const { space, caps: there } = await spaceOf(acct, call.body.space)
      // Moving puts it under the new space's grants: only someone who adds dockets and gives access there may.
      if (space.id !== workspace.spaceId && (!there.has('create') || !there.has('access'))) refuse(`You cannot move dockets into ${space.name}.`)
      spaceId = space.id
    }
    call.audit.workspaceId = workspace.id
    const updated = await inTenant(call, acct, async (ctx) => {
      const done = await updateWorkspace(ctx.tx, workspace.id, { ...(call.body.name !== undefined ? { name: String(call.body.name) } : {}), ...(spaceId ? { spaceId } : {}) })
      call.audit.target = [`workspace:${workspace.id}`]
      call.audit.args = { name: done.name, space: done.spaceId }
      return done
    })
    const after = await placeNames(acct.org.id)
    const fresh = await accountCaller(call.caller, acct.org.slug)
    return { body: docketView(acct.org, updated, after.dockets.size ? after : names, fresh.capsAt(docketPlace(updated.id))) }
  },

  'dockets.delete': async (call) => {
    const acct = await account(call)
    const { workspace, caps } = await docketOf(acct, call.params.docket ?? '')
    if (!caps.has('delete')) refuse(`You cannot delete ${workspace.name}.`)
    call.audit.workspaceId = workspace.id
    call.audit.target = [workspace.slug]
    const { router, origin } = runtime()
    await inTenant(call, acct, async (ctx) => {
      const { connections } = await deleteWorkspace(ctx, { workspaceId: workspace.id, deletedBy: call.caller.actor })
      // Its tokens, connections and webhook routes go before the deletion commits, so none outlives it.
      await router.withPlatform(async (tx) => {
        await revokeWorkspaceCredentials(tx, {
          orgId: acct.org.id,
          workspaceId: workspace.id,
          resource: mcpResourceUrl(origin, acct.org.slug, workspace.slug),
          by: call.caller.user.id,
        })
        await dropRoutes(tx, { orgId: acct.org.id, connectionIds: connections })
      })
    })
    return { status: 204, body: null }
  },

  // --- System accounts ---------------------------------------------------------
  'system-accounts.list': async (call) => {
    const acct = await account(call)
    if (!mayManageSystemAccounts(acct)) refuse('You do not manage system accounts.')
    const names = await placeNames(acct.org.id)
    const { accounts, grants } = await platform(async (tx) => ({ accounts: await listSystemAccounts(tx, acct.org.id), grants: await listGrants(tx, acct.org.id) }))
    const out = accounts.flatMap((found) => {
      const views = grants.filter((grant) => grant.who.kind === 'user' && grant.who.id === found.id).map((grant) => grantView(grant, acct.principal, names, acct.org))
      const visible = mayChangeAccount(acct, views.map((grant) => ({ place: { key: placeKey(placeFromRef(grant.place.ref, names)) } })))
      return visible ? [systemAccountView(found, views)] : []
    })
    return { body: { system_accounts: out } }
  },

  'system-accounts.create': async (call) => {
    const acct = await account(call)
    if (!mayManageSystemAccounts(acct)) refuse('You do not manage system accounts.')
    const names = await placeNames(acct.org.id)
    const roles = await platform((tx) => rolesOf(tx, acct.org.id))
    const wanted = (call.body.grants as { place: string; role: string; add?: Capability[]; remove?: Capability[] }[]).map((grant) => ({
      place: placeFor(acct, grant.place, names),
      roleId: roleFrom(grant.role, roles).id,
      add: grant.add ?? [],
      remove: grant.remove ?? [],
    }))
    const id = await inPlatform(call, acct, async (tx) => {
      const made = await createServiceAccount(tx, {
        orgId: acct.org.id,
        name: String(call.body.name),
        description: str(call.body.description)?.trim().slice(0, 200) || null,
        actorId: call.caller.user.id,
        actor: acct.principal,
      })
      const given = []
      for (const grant of wanted) {
        given.push((await setGrant(tx, { orgId: acct.org.id, who: { kind: 'user', id: made.id }, ...grant, actor: acct.principal, actorId: call.caller.user.id })).grant.id)
      }
      call.audit.target = [`user:${made.id}`, ...given.map((grant) => `grant:${grant}`)]
      call.audit.args = { name: made.login, grants: wanted.map((grant) => ({ place: placeKey(grant.place), role: grant.roleId, add: grant.add, remove: grant.remove })) }
      return made.id
    })
    const { found, views } = await systemAccountOf(acct, id)
    return { status: 201, body: systemAccountView(found, views) }
  },

  'system-accounts.get': async (call) => {
    const acct = await account(call)
    const { found, views } = await systemAccountOf(acct, call.params.id ?? '')
    return { body: systemAccountView(found, views) }
  },

  'system-accounts.delete': async (call) => {
    const acct = await account(call)
    const { found } = await systemAccountOf(acct, call.params.id ?? '', { change: true })
    await inPlatform(call, acct, async (tx) => {
      await removeMember(tx, { orgId: acct.org.id, userId: found.id, actor: acct.principal })
      await notifyRevoked(tx, `user:${found.id}`)
      call.audit.target = [`user:${found.id}`]
      call.audit.args = { name: found.name }
    })
    return { status: 204, body: null }
  },

  'system-accounts.tokens.list': async (call) => {
    const acct = await account(call)
    const { found, names } = await systemAccountOf(acct, call.params.id ?? '')
    const tokens = await platform((tx) => listApiTokens(tx, { orgId: acct.org.id, ownerId: found.id }))
    return { body: { tokens: tokens.map((token) => tokenView(token, names)) } }
  },

  'system-accounts.tokens.create': async (call) => {
    await tokenLimit(call)
    const acct = await account(call)
    const { found, names } = await systemAccountOf(acct, call.params.id ?? '', { change: true })
    const dockets = docketIds(call.body.dockets as string[] | null | undefined, names)
    const issued = await inPlatform(call, acct, async (tx) => {
      const done = await issueApiToken(tx, {
        orgId: acct.org.id,
        ownerId: found.id,
        createdBy: call.caller.user.id,
        readOnly: call.body.read_only === true,
        dockets,
        ...(call.body.days !== undefined ? { expiresInDays: call.body.days as number } : {}),
        name: str(call.body.name) ?? '',
      })
      call.audit.target = [done.id, `user:${found.id}`]
      call.audit.args = { prefix: done.prefix, owner: found.id, readOnly: done.readOnly, dockets: dockets ?? 'all' }
      return done
    })
    return { status: 201, body: { id: issued.id, prefix: issued.prefix, token: issued.token, read_only: issued.readOnly, expires_at: issued.expiresAt.toISOString() } }
  },

  'system-accounts.tokens.revoke': async (call) => {
    const acct = await account(call)
    const { found } = await systemAccountOf(acct, call.params.id ?? '', { change: true })
    const tokenId = call.params.token ?? ''
    await inPlatform(call, acct, async (tx) => {
      const revoked = await revokeApiToken(tx, { orgId: acct.org.id, tokenId, by: call.caller.user.id, ownerId: found.id })
      call.audit.target = [tokenId, `user:${found.id}`]
      call.audit.args = { prefix: revoked.prefix }
    })
    return { status: 204, body: null }
  },

  // --- Oversight ---------------------------------------------------------------
  'audit.list': async (call) => {
    const acct = await account(call)
    const names = await placeNames(acct.org.id)
    const docket = typeof call.query.docket === 'string' ? await docketOf(acct, call.query.docket, names) : null
    const caps = docket ? docket.caps : acct.capsAt(ACCOUNT)
    if (!caps.has('audit')) refuse('You cannot see this audit log.')
    const events = await reading(acct, (tx) =>
      listAudit(tx, {
        ...(docket ? { workspaceId: docket.workspace.id } : {}),
        ...(typeof call.query.action === 'string' ? { action: call.query.action } : {}),
        ...(typeof call.query.since === 'string' ? { since: new Date(call.query.since) } : {}),
        limit: typeof call.query.limit === 'number' ? call.query.limit : 100,
      }),
    )
    return {
      body: {
        events: events.map((event) => ({
          at: event.at.toISOString(),
          actor: event.actor,
          action: event.action,
          outcome: event.outcome,
          docket: event.workspaceId ? (names.dockets.get(event.workspaceId)?.slug ?? event.workspaceId) : null,
          target: event.target,
          request_id: event.requestId,
        })),
      },
    }
  },

  'usage.get': async (call) => {
    const acct = await account(call)
    if (!acct.can('audit')) refuse('You cannot see this account’s usage.')
    const tenant = await reading(acct, async (tx) => {
      const { rows } = await tx.query<{ dockets: string; spaces: string; calls: string }>(
        `SELECT (SELECT count(*) FROM workspaces WHERE deleted_at IS NULL) AS dockets, (SELECT count(*) FROM spaces) AS spaces,
                (SELECT count(*) FROM audit_event WHERE at >= now() - interval '30 days') AS calls`,
      )
      return rows[0]
    })
    const counts = await platform(async (tx) => {
      const { rows } = await tx.query<{ members: string; system: string; tokens: string }>(
        `SELECT (SELECT count(*) FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id WHERE m.org_id = $1 AND u.kind = 'human') AS members,
                (SELECT count(*) FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id WHERE m.org_id = $1 AND u.kind = 'service') AS system,
                (SELECT count(*) FROM platform.api_tokens WHERE org_id = $1 AND revoked_at IS NULL AND expires_at > now()) AS tokens`,
        [acct.org.id],
      )
      return rows[0]
    })
    return {
      body: {
        dockets: Number(tenant?.dockets ?? 0),
        spaces: Number(tenant?.spaces ?? 0),
        members: Number(counts?.members ?? 0),
        system_accounts: Number(counts?.system ?? 0),
        live_tokens: Number(counts?.tokens ?? 0),
        calls_30d: Number(tenant?.calls ?? 0),
      },
    }
  },
}

/** The account a `me.tokens` call's token is in: the caller's own token, found by its id. */
async function tokenAccount(call: ApiCall): Promise<AccountCaller> {
  const { rows } = await platform((tx) =>
    tx.query<{ slug: string }>(
      `SELECT o.slug FROM platform.api_tokens t JOIN platform.orgs o ON o.id = t.org_id WHERE t.id = $1 AND t.owner_id = $2`,
      [call.params.id ?? '', call.caller.user.id],
    ),
  )
  if (!rows[0]) throw new ApiFailure('not_found', 'No such token.')
  return account(call, rows[0].slug)
}

async function saveRoleCall(call: ApiCall, id?: string): Promise<Answer> {
  const acct = await account(call)
  const { role, before } = await inPlatform(call, acct, async (tx) => {
    const saved = await saveRole(tx, {
      orgId: acct.org.id,
      ...(id ? { id } : {}),
      name: String(call.body.name),
      description: (call.body.description as string | null | undefined) ?? null,
      caps: call.body.caps as Capability[],
      actor: acct.principal,
      actorId: call.caller.user.id,
    })
    call.audit.target = [`role:${saved.role.id}`]
    call.audit.args = { name: saved.role.name, caps: saved.role.caps }
    return saved
  })
  return { status: before ? 200 : 201, body: roleView(role) }
}

/** The ontology a new docket starts from: exactly one of a template, a copy of another docket, or YAML. */
function startOf(acct: AccountCaller, body: Record<string, unknown>, names: PlaceNames): OntologyStart {
  const given = ['template', 'copy_from', 'inline_yaml'].filter((key) => body[key] !== undefined)
  if (given.length !== 1) throw new ApiFailure('invalid_request', 'Start it from exactly one of template, copy_from or inline_yaml.')
  if (typeof body.inline_yaml === 'string') return { importYaml: body.inline_yaml }
  if (typeof body.copy_from === 'string') {
    const id = [...names.dockets].find(([, docket]) => docket.slug === body.copy_from)?.[0]
    // A copy reads the other docket's ontology, so it must be one the caller reads.
    if (!id || !acct.capsAt(docketPlace(id)).has('read')) throw new ApiFailure('not_found', `No such docket: ${String(body.copy_from)}.`)
    return { copyFrom: id }
  }
  const template = String(body.template)
  const own = orgTemplateId(template)
  if (own) return { orgTemplate: own }
  if (isTemplateId(template)) return { template }
  throw new ApiFailure('invalid_request', `No such template: ${template}.`)
}

async function createDocket(call: ApiCall): Promise<Answer> {
  const acct = await account(call)
  const { space, caps } = await spaceOf(acct, String(call.body.space))
  if (!caps.has('create')) refuse(`You cannot add dockets to ${space.name}.`)
  const names = await placeNames(acct.org.id)
  const start = startOf(acct, call.body, names)
  const name = String(call.body.name).trim()
  const slug =
    typeof call.body.slug === 'string'
      ? call.body.slug
      : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '') || 'docket'
  // Initial access is checked before anything is made: each grantee once, each role one the creator may give on the space.
  const roles = await platform((tx) => rolesOf(tx, acct.org.id))
  const initial: { who: Grantee; roleId: string; label: string }[] = []
  for (const row of (call.body.grants as { who: string; role: string }[] | undefined) ?? []) {
    const grantee = await granteeFrom(acct, row.who)
    const role = roleFrom(row.role, roles)
    if (initial.some((each) => JSON.stringify(each.who) === JSON.stringify(grantee.who))) throw new ApiFailure('invalid_request', `${grantee.login} is listed twice.`)
    if (!mayGrant(acct.principal, spacePlace(space.id), grantCaps({ role, add: [], remove: [] }), grantee.kind)) {
      refuse(`You can only give ${grantee.login} access you hold on ${space.name} yourself, where you manage access.`)
    }
    initial.push({ who: grantee.who, roleId: role.id, label: grantee.login })
  }
  const publisher = { actor: call.caller.actor, login: call.caller.user.login }
  const docketLimit = await docketLimitOf(acct.org.id)
  const workspace = await inTenant(call, acct, async (ctx) => {
    const { workspace: made, version } = await createWorkspace(ctx, { name, slug, start, spaceId: space.id, publisher, requestId: call.meta.requestId, docketLimit })
    call.audit.workspaceId = made.id
    call.audit.target = [`workspace:${made.id}`, `ontology:v${version.number}`, `space:${space.id}`]
    call.audit.args = { slug, source: version.source, space: space.slug }
    return made
  })
  if (initial.length) {
    // As the creator, with the new docket in its space, so what they hold on the space counts there.
    const actor: Access = { ...acct.principal, spaces: new Map([...(acct.principal.spaces ?? []), [workspace.id, space.id]]) }
    const { router } = runtime()
    await router.withPlatform(async (tx) => {
      const given: GrantView[] = []
      for (const row of initial) {
        given.push((await setGrant(tx, { orgId: acct.org.id, who: row.who, place: docketPlace(workspace.id), roleId: row.roleId, actor, actorId: call.caller.user.id })).grant)
      }
      await router.enterTenant(tx, acct.org.id)
      for (const grant of given) {
        await audit(tx, {
          ...auditFields({ ...call, action: 'access.grant', audit: { ...call.audit, target: targetOf(grant), args: { place: placeKey(docketPlace(workspace.id)), role: grant.role.id, initial: true } } }, 'ok'),
        })
      }
    })
  }
  const after = await placeNames(acct.org.id)
  const fresh = await accountCaller(call.caller, acct.org.slug)
  return { status: 201, body: docketView(acct.org, workspace, after, fresh.capsAt(docketPlace(workspace.id))) }
}
