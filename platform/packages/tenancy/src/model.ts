// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { Tx } from './db.js'
import { INVITE_TTL_MS, LIMITS, PROVISIONING_TIMEOUT_MS } from './limits.js'
import { ACCOUNT, BUILTIN_ROLES, CAPABILITIES, grantCaps, isCapability, mayGrant, placeFromRow, placeIdOf, type Access, type Capability, type Place } from './roles.js'

/**
 * The tenancy model over the platform schema (§4, §5.1). Every function runs
 * inside a `withPlatform` transaction.
 */

export class TenancyError extends Error {
  override name = 'TenancyError'
  constructor(
    readonly code: 'limit' | 'conflict' | 'forbidden' | 'not-found' | 'last-owner' | 'invalid',
    message: string,
  ) {
    super(message)
  }
}

export interface User {
  id: string
  kind: 'human' | 'service'
  login: string
  name: string | null
  email: string | null
  /** Verified emails (humans only). */
  emails: string[]
  avatarUrl: string | null
}

export interface GitHubIdentity {
  id: number
  login: string
  name: string | null
  avatarUrl: string | null
  /** Verified emails only; the primary one first. */
  emails: string[]
}

export interface Org {
  id: string
  slug: string
  name: string
  status: 'provisioning' | 'active' | 'suspended' | 'deleted'
}

export interface Member extends User {
  /** Owns the account. */
  owner: boolean
  /** Sees only what they are given. */
  guest: boolean
  joinedAt: Date
  lastSeenAt: Date | null
  description: string | null
}

export interface Invite {
  id: string
  orgId: string
  githubLogin: string | null
  email: string | null
  /** What they get on accepting: a role on a place, and whether they own the account or are a guest in it. */
  roleId: string
  roleName: string
  place: Place
  owner: boolean
  guest: boolean
  invitedBy: string
  invitedByLogin: string
  createdAt: Date
  expiresAt: Date
  /** The address it was made for, once its email was delivered; null for a GitHub-login invite, whose address is never shown. */
  emailedTo: string | null
  /** When its email was delivered; null when none was (or since it was sent again). */
  emailedAt: Date | null
}

type UserRow = {
  id: string
  kind: 'human' | 'service'
  login: string
  name: string | null
  email: string | null
  emails: string[]
  avatar_url: string | null
}

const USER_COLUMNS = 'id, kind, login, name, email, emails, avatar_url'

function toUser(row: UserRow): User {
  return {
    id: row.id,
    kind: row.kind,
    login: row.login,
    name: row.name,
    email: row.email,
    emails: row.emails,
    avatarUrl: row.avatar_url,
  }
}

/** The condition an invite row (optionally aliased) meets while it can still be answered. */
function open(alias = ''): string {
  const p = alias ? `${alias}.` : ''
  return `${p}accepted_at IS NULL AND ${p}declined_at IS NULL AND ${p}revoked_at IS NULL AND ${p}expires_at > now()`
}
const OPEN_INVITE = open()

/** A GitHub login as stored: lowercase, without a leading `@`. Null when it cannot be one. */
export function normaliseLogin(value: string): string | null {
  const login = value.trim().replace(/^@/, '').toLowerCase()
  return /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/.test(login) ? login : null
}

export function normaliseEmail(value: string): string | null {
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

// --- Users and the beta allowlist ---------------------------------------------

/**
 * Creates or refreshes the user behind a GitHub identity, keyed by GitHub's
 * numeric id, and records it as their GitHub identity (`resolveIdentity`).
 */
export async function upsertGitHubUser(tx: Tx, identity: GitHubIdentity): Promise<User> {
  const { rows } = await tx.query<UserRow>(
    `INSERT INTO platform.users (id, kind, github_id, login, name, email, emails, avatar_url, last_seen_at)
     VALUES ($1, 'human', $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (github_id) DO UPDATE SET
       login = EXCLUDED.login, name = EXCLUDED.name, email = EXCLUDED.email, emails = EXCLUDED.emails,
       avatar_url = EXCLUDED.avatar_url, last_seen_at = now()
     RETURNING ${USER_COLUMNS}`,
    [
      randomUUID(),
      identity.id,
      identity.login,
      identity.name,
      identity.emails[0] ?? null,
      identity.emails,
      identity.avatarUrl,
    ],
  )
  const user = toUser(rows[0] as UserRow)
  await tx.query(
    `INSERT INTO platform.identities (provider, issuer, subject, user_id, last_seen_at) VALUES ('github', 'github', $1, $2, now())
     ON CONFLICT (provider, issuer, subject) DO UPDATE SET last_seen_at = now()`,
    [String(identity.id), user.id],
  )
  return user
}

export async function userById(tx: Tx, id: string): Promise<User | null> {
  const { rows } = await tx.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM platform.users WHERE id = $1`,
    [id],
  )
  return rows[0] ? toUser(rows[0]) : null
}

/** Whether the GitHub account is on the beta allowlist. Keyed by GitHub's numeric id: a login can change hands. */
export async function isAllowlisted(tx: Tx, githubId: number): Promise<boolean> {
  const { rowCount } = await tx.query('SELECT 1 FROM platform.beta_allowlist WHERE github_id = $1', [githubId])
  return (rowCount ?? 0) > 0
}

/**
 * Whether the user is on an allowlist, which lets them create an account: their
 * GitHub account on the beta allowlist, or one of their verified emails (or
 * its domain), or their non-GitHub login, on the sign-in allowlist.
 */
export async function isUserAllowlisted(tx: Tx, userId: string): Promise<boolean> {
  const { rowCount } = await tx.query(
    `SELECT 1 FROM platform.users u
      WHERE u.id = $1 AND (
        EXISTS (SELECT 1 FROM platform.beta_allowlist a WHERE a.github_id = u.github_id)
        OR EXISTS (
          SELECT 1 FROM platform.signin_allowlist s
           WHERE (s.kind = 'email' AND s.value = ANY(u.emails))
              OR (s.kind = 'domain' AND s.value = ANY(ARRAY(SELECT split_part(e, '@', 2) FROM unnest(u.emails) e)))
              OR (s.kind = 'login' AND u.github_id IS NULL AND s.value = u.login_lower)))`,
    [userId],
  )
  return (rowCount ?? 0) > 0
}

/**
 * Adds logins to the allowlist as pending entries, which the next sign-in as
 * each login claims. A login already on the list, pending or claimed by an
 * account, is left as it is: a claimed login renamed and registered by
 * someone else does not let them in.
 */
export async function allowlist(tx: Tx, logins: readonly string[], note: string | null = null): Promise<void> {
  for (const raw of logins) {
    const login = normaliseLogin(raw)
    if (!login) throw new TenancyError('invalid', `not a GitHub login: ${JSON.stringify(raw)}`)
    await tx.query(
      `INSERT INTO platform.beta_allowlist (github_login, note)
       SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM platform.beta_allowlist WHERE github_login = $1)
       ON CONFLICT (github_login) WHERE github_id IS NULL DO NOTHING`,
      [login, note],
    )
  }
}

/** Adds a GitHub account to the allowlist; an account already on it is left as it is. */
export async function allowlistAccount(
  tx: Tx,
  account: Pick<GitHubIdentity, 'id' | 'login'>,
  note: string | null = null,
): Promise<void> {
  const login = normaliseLogin(account.login)
  if (!login) throw new TenancyError('invalid', `not a GitHub login: ${JSON.stringify(account.login)}`)
  await claimPendingLogin(tx, account.id, login)
  await tx.query(
    'INSERT INTO platform.beta_allowlist (github_login, github_id, note) VALUES ($1, $2, $3) ON CONFLICT (github_id) DO NOTHING',
    [login, account.id, note],
  )
}

/** Gives a pending entry for the login to the account signing in as it, unless the account already has one. */
async function claimPendingLogin(tx: Tx, githubId: number, login: string): Promise<void> {
  await tx.query(
    `UPDATE platform.beta_allowlist SET github_id = $1
      WHERE github_id IS NULL AND github_login = $2
        AND NOT EXISTS (SELECT 1 FROM platform.beta_allowlist WHERE github_id = $1)`,
    [githubId, login],
  )
}

/**
 * Whether a GitHub identity may sign in: on the allowlist, holding an open
 * invite (§8.1), or already a member of an active org. A pending allowlist
 * entry for the identity's login becomes the identity's here.
 */
export async function mayEnterBeta(tx: Tx, identity: GitHubIdentity): Promise<boolean> {
  await claimPendingLogin(tx, identity.id, identity.login.toLowerCase())
  if (await isAllowlisted(tx, identity.id)) return true
  const member = await tx.query(
    `SELECT 1 FROM platform.users u
       JOIN platform.memberships m ON m.user_id = u.id
       JOIN platform.orgs o ON o.id = m.org_id AND o.status = 'active'
      WHERE u.github_id = $1 LIMIT 1`,
    [identity.id],
  )
  if (member.rowCount) return true
  return (await openInvitesFor(tx, identity)).length > 0
}

// --- Orgs ---------------------------------------------------------------------

/** An org row that has been provisioning for longer than provisioning can take: its provisioner died. */
const STALE_PROVISIONING = "status = 'provisioning' AND created_at < now() - make_interval(secs => $1)"

export async function countLiveOrgs(tx: Tx): Promise<number> {
  const { rows } = await tx.query<{ count: string }>(
    `SELECT count(*) FROM platform.orgs WHERE status <> 'deleted' AND NOT (${STALE_PROVISIONING})`,
    [PROVISIONING_TIMEOUT_MS / 1000],
  )
  return Number(rows[0]?.count ?? 0)
}

/** Removes orgs stuck in provisioning past the timeout, freeing their slugs and beta slots. Returns their ids. */
export async function reapStaleOrgs(tx: Tx): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    `DELETE FROM platform.orgs WHERE ${STALE_PROVISIONING} RETURNING id`,
    [PROVISIONING_TIMEOUT_MS / 1000],
  )
  return rows.map((row) => row.id)
}

/**
 * Records a new org, its owner's membership, and nothing else: the org's
 * stores come from the provisioner, which marks the org active.
 * Serialised so the beta's org limit holds under concurrent sign-ups.
 */
export async function insertOrg(
  tx: Tx,
  input: { id: string; slug: string; name: string; ownerId: string; maxOrgs?: number },
): Promise<Org> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('docket-cloud:org-create'))")
  await reapStaleOrgs(tx)
  const maxOrgs = input.maxOrgs ?? LIMITS.orgs
  if ((await countLiveOrgs(tx)) >= maxOrgs) {
    throw new TenancyError('limit', `The beta is full: it holds ${maxOrgs} accounts.`)
  }
  const taken = await tx.query('SELECT 1 FROM platform.orgs WHERE slug = $1', [input.slug])
  if (taken.rowCount) throw new TenancyError('conflict', 'That name is taken.')
  await tx.query('INSERT INTO platform.orgs (id, slug, name, created_by) VALUES ($1, $2, $3, $4)', [
    input.id,
    input.slug,
    input.name,
    input.ownerId,
  ])
  await tx.query('INSERT INTO platform.memberships (org_id, user_id, owner) VALUES ($1, $2, true)', [
    input.id,
    input.ownerId,
  ])
  return { id: input.id, slug: input.slug, name: input.name, status: 'provisioning' }
}

/** Removes an org that never finished provisioning, so its name and slot are free again. */
export async function discardUnprovisionedOrg(tx: Tx, orgId: string): Promise<void> {
  await tx.query("DELETE FROM platform.orgs WHERE id = $1 AND status = 'provisioning'", [orgId])
}

export interface OrgMembership {
  org: Org
  /** Owns the account. */
  owner: boolean
  /** Sees only what they are given. */
  guest: boolean
}

type MembershipRow = { id: string; slug: string; name: string; status: Org['status']; owner: boolean; guest: boolean }

function membershipOf(row: MembershipRow): OrgMembership {
  return { org: { id: row.id, slug: row.slug, name: row.name, status: row.status }, owner: row.owner, guest: row.guest }
}

/**
 * The org at `slug`, if `userId` is a member of it. Anything else - no such
 * org, not a member, a deleted org - is null, which routes answer as 404 (§5.5).
 * What they may do there is their access (`accessOf`).
 */
export async function membershipBySlug(tx: Tx, slug: string, userId: string): Promise<OrgMembership | null> {
  const { rows } = await tx.query<MembershipRow>(
    `SELECT o.id, o.slug, o.name, o.status, m.owner, m.guest
       FROM platform.orgs o JOIN platform.memberships m ON m.org_id = o.id
      WHERE o.slug = $1 AND m.user_id = $2 AND o.status = 'active'`,
    [slug, userId],
  )
  const row = rows[0]
  return row ? membershipOf(row) : null
}

export async function membershipsOf(tx: Tx, userId: string): Promise<OrgMembership[]> {
  const { rows } = await tx.query<MembershipRow>(
    `SELECT o.id, o.slug, o.name, o.status, m.owner, m.guest
       FROM platform.orgs o JOIN platform.memberships m ON m.org_id = o.id
      WHERE m.user_id = $1 AND o.status = 'active'
      ORDER BY o.name`,
    [userId],
  )
  return rows.map(membershipOf)
}

// --- Members ------------------------------------------------------------------

/** Whether membership `m` is one of the org admin API's database accounts (platform 0014): not a member anyone manages. */
const DATABASE_ACCOUNT = (m: string) =>
  `EXISTS (SELECT 1 FROM platform.database_accounts d WHERE d.org_id = ${m}.org_id AND d.user_id = ${m}.user_id)`

export async function listMembers(tx: Tx, orgId: string): Promise<Member[]> {
  const { rows } = await tx.query<
    UserRow & { owner: boolean; guest: boolean; created_at: Date; last_seen_at: Date | null; description: string | null }
  >(
    `SELECT u.id, u.kind, u.login, u.name, u.email, u.emails, u.avatar_url, u.description, u.last_seen_at,
            m.owner, m.guest, m.created_at
       FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id
      WHERE m.org_id = $1 AND NOT ${DATABASE_ACCOUNT('m')}
      ORDER BY m.owner DESC, m.guest, u.login_lower`,
    [orgId],
  )
  return rows.map((row) => ({
    ...toUser(row),
    owner: row.owner,
    guest: row.guest,
    joinedAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    description: row.description,
  }))
}

/**
 * Locks the org row and checks a new seat fits under the members limit: the
 * account's own, which the operator sets, or the beta's. The org admin API's
 * service accounts take no seat.
 */
async function reserveSeat(tx: Tx, orgId: string): Promise<void> {
  const locked = await tx.query<{ max_members: number | null }>('SELECT max_members FROM platform.orgs WHERE id = $1 FOR UPDATE', [orgId])
  const limit = locked.rows[0]?.max_members ?? LIMITS.membersPerOrg
  const { rows } = await tx.query<{ count: string }>(
    `SELECT (SELECT count(*) FROM platform.memberships m JOIN platform.orgs o ON o.id = m.org_id
              WHERE m.org_id = $1 AND m.user_id IS DISTINCT FROM o.org_admin_id AND NOT ${DATABASE_ACCOUNT('m')})
          + (SELECT count(*) FROM platform.invites WHERE org_id = $1 AND ${OPEN_INVITE}) AS count`,
    [orgId],
  )
  if (Number(rows[0]?.count ?? 0) >= limit) {
    throw new TenancyError('limit', `This account holds at most ${limit} members and invites.`)
  }
}

const ORG_ADMIN_MANAGED = 'The org-admin service account is managed by Docket Cloud operators through the org master key.'
const DATABASE_ACCOUNT_MANAGED = "A database's service accounts are managed through the org admin API."

/** Everything any of a member's own grants gives, anywhere, and whether they own the account. */
async function heldBy(tx: Tx, orgId: string, userId: string): Promise<{ caps: Capability[]; owner: boolean }> {
  const { rows } = await tx.query<{ owner: boolean; role_caps: string[] | null; add_caps: string[] | null; remove_caps: string[] | null }>(
    `SELECT m.owner, r.caps AS role_caps, g.add_caps, g.remove_caps
       FROM platform.memberships m
       LEFT JOIN platform.grants g ON g.org_id = m.org_id AND g.principal_id = m.user_id
       LEFT JOIN platform.roles r ON r.id = g.role_id
      WHERE m.org_id = $1 AND m.user_id = $2`,
    [orgId, userId],
  )
  const caps = new Set<Capability>()
  for (const row of rows) {
    if (!row.role_caps) continue
    const role = { id: '', name: '', description: null, builtin: false, caps: row.role_caps.filter(isCapability) }
    for (const cap of grantCaps({ role, add: (row.add_caps ?? []).filter(isCapability), remove: (row.remove_caps ?? []).filter(isCapability) })) caps.add(cap)
  }
  return { caps: CAPABILITIES.filter((cap) => caps.has(cap)), owner: rows[0]?.owner ?? false }
}

/**
 * Removes a member and every grant they hold. The actor must manage access
 * on the whole account (or system accounts there, for a system account) and
 * hold everything the member holds; only an owner removes an owner, and an
 * account keeps one. A removed system account is deleted with its membership.
 */
export async function removeMember(tx: Tx, input: { orgId: string; userId: string; actor: Access }): Promise<{ owner: boolean; kind: 'human' | 'service' }> {
  const { rows } = await tx.query<{ kind: 'human' | 'service'; org_admin: boolean; database_account: boolean }>(
    `SELECT u.kind, (m.user_id = o.org_admin_id) IS TRUE AS org_admin, ${DATABASE_ACCOUNT('m')} AS database_account
       FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id JOIN platform.orgs o ON o.id = m.org_id
      WHERE m.org_id = $1 AND m.user_id = $2 FOR UPDATE OF m`,
    [input.orgId, input.userId],
  )
  const row = rows[0]
  if (!row) throw new TenancyError('not-found', 'No such member.')
  if (row.org_admin) throw new TenancyError('forbidden', ORG_ADMIN_MANAGED)
  if (row.database_account) throw new TenancyError('forbidden', DATABASE_ACCOUNT_MANAGED)
  const held = await heldBy(tx, input.orgId, input.userId)
  if (held.owner && !input.actor.owner) throw new TenancyError('forbidden', 'Only an owner can remove an owner.')
  if (!mayGrant(input.actor, ACCOUNT, held.caps, row.kind)) {
    throw new TenancyError('forbidden', 'You cannot remove someone who holds more than you do across the account.')
  }
  if (held.owner) {
    const { rows: owners } = await tx.query<{ count: string }>('SELECT count(*) FROM platform.memberships WHERE org_id = $1 AND owner', [input.orgId])
    if (Number(owners[0]?.count ?? 0) <= 1) throw new TenancyError('last-owner', 'An account needs an owner. Make someone else owner first.')
  }
  await tx.query('DELETE FROM platform.memberships WHERE org_id = $1 AND user_id = $2', [input.orgId, input.userId])
  if (row.kind === 'service') {
    await tx.query("DELETE FROM platform.users WHERE id = $1 AND kind = 'service'", [input.userId])
  }
  return { owner: held.owner, kind: row.kind }
}

/**
 * Adds a system account (§4; tenancy v2 §3.3): anything that is not a
 * person, owned by the account and outliving whoever made it. It reaches
 * nothing until it is given a grant, in the same transaction; its only
 * credentials are API tokens; no person acts for it, and its account's owners
 * get its token notices. Settings › System accounts is the one place that
 * makes them, by someone who manages system accounts somewhere.
 */
export async function createServiceAccount(
  tx: Tx,
  input: { orgId: string; name: string; description: string | null; actorId: string; actor: Access },
): Promise<User> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/.test(input.name)) {
    throw new TenancyError('invalid', 'Name it with 2-40 lowercase letters, digits or hyphens.')
  }
  if (!input.actor.owner && !input.actor.grants.some((grant) => grantCaps(grant).includes('system'))) {
    throw new TenancyError('forbidden', 'You cannot make system accounts.')
  }
  await reserveSeat(tx, input.orgId)
  const id = randomUUID()
  try {
    await tx.query(
      `INSERT INTO platform.users (id, kind, login, service_org_id, description, created_by)
       VALUES ($1, 'service', $2, $3, $4, $5)`,
      [id, input.name, input.orgId, input.description, input.actorId],
    )
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new TenancyError('conflict', 'A system account with that name exists.')
    }
    throw error
  }
  await tx.query('INSERT INTO platform.memberships (org_id, user_id, invited_by) VALUES ($1, $2, $3)', [input.orgId, id, input.actorId])
  return { id, kind: 'service', login: input.name, name: null, email: null, emails: [], avatarUrl: null }
}

/** A system account as Settings › System accounts lists it. */
export interface SystemAccount {
  id: string
  name: string
  description: string | null
  createdAt: Date
  createdByLogin: string | null
  /** Made and managed by the org admin API (`org-admin` and its databases' accounts): shown, never changed here. */
  managed: boolean
  liveTokens: number
  lastUsedAt: Date | null
  /** When its next live token expires. */
  nextExpiry: Date | null
}

/** The account's system accounts: those made in Settings first, then the org admin API's. */
export async function listSystemAccounts(tx: Tx, orgId: string): Promise<SystemAccount[]> {
  const { rows } = await tx.query<{
    id: string
    login: string
    description: string | null
    created_at: Date
    created_by: string | null
    managed: boolean
    live: string
    last_used_at: Date | null
    next_expiry: Date | null
  }>(
    `SELECT u.id, u.login, u.description, u.created_at,
            (SELECT c.login FROM platform.users c WHERE c.id = u.created_by AND c.kind = 'human') AS created_by,
            ((u.id = o.org_admin_id) IS TRUE OR ${DATABASE_ACCOUNT('m')}) AS managed,
            (SELECT count(*) FROM platform.api_tokens t WHERE t.owner_id = u.id AND t.revoked_at IS NULL AND t.expires_at > now()) AS live,
            (SELECT max(t.last_used_at) FROM platform.api_tokens t WHERE t.owner_id = u.id) AS last_used_at,
            (SELECT min(t.expires_at) FROM platform.api_tokens t WHERE t.owner_id = u.id AND t.revoked_at IS NULL AND t.expires_at > now()) AS next_expiry
       FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id JOIN platform.orgs o ON o.id = m.org_id
      WHERE m.org_id = $1 AND u.kind = 'service'
      ORDER BY 6, u.login_lower`,
    [orgId],
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.login,
    description: row.description,
    createdAt: row.created_at,
    createdByLogin: row.created_by,
    managed: row.managed,
    liveTokens: Number(row.live),
    lastUsedAt: row.last_used_at,
    nextExpiry: row.next_expiry,
  }))
}

/** Changes a system account's description; the org admin API's own are left to it. */
export async function describeServiceAccount(tx: Tx, input: { orgId: string; serviceId: string; description: string | null }): Promise<void> {
  const { rows } = await tx.query<{ org_admin: boolean; database_account: boolean }>(
    `SELECT (u.id = o.org_admin_id) IS TRUE AS org_admin, ${DATABASE_ACCOUNT('m')} AS database_account
       FROM platform.users u JOIN platform.memberships m ON m.user_id = u.id AND m.org_id = $1 JOIN platform.orgs o ON o.id = m.org_id
      WHERE u.id = $2 AND u.kind = 'service' FOR UPDATE OF u`,
    [input.orgId, input.serviceId],
  )
  const row = rows[0]
  if (!row) throw new TenancyError('not-found', 'No such system account.')
  if (row.org_admin) throw new TenancyError('forbidden', ORG_ADMIN_MANAGED)
  if (row.database_account) throw new TenancyError('forbidden', DATABASE_ACCOUNT_MANAGED)
  await tx.query('UPDATE platform.users SET description = $2 WHERE id = $1', [input.serviceId, input.description])
}

/** How soon before it expires a system account's token is called out to the account's owners. */
export const TOKEN_NOTICE_DAYS = 14

/** A system account's token that is about to expire, or has just expired: what the account's owners are told. */
export interface TokenNotice {
  accountId: string
  account: string
  tokenId: string
  prefix: string
  name: string | null
  expiresAt: Date
  expired: boolean
}

/**
 * The token notices of an account (tenancy v2 §3.3): every live token of a
 * system account that expires within `TOKEN_NOTICE_DAYS`, and every one that
 * expired in the last `TOKEN_NOTICE_DAYS` and was not replaced by a live token
 * of the same account. No steward: they go to the account's owners.
 */
export async function tokenNotices(tx: Tx, orgId: string, now = new Date()): Promise<TokenNotice[]> {
  const { rows } = await tx.query<{
    account_id: string
    login: string
    id: string
    prefix: string
    description: string | null
    expires_at: Date
  }>(
    `SELECT u.id AS account_id, u.login, t.id, t.prefix, t.description, t.expires_at
       FROM platform.api_tokens t JOIN platform.users u ON u.id = t.owner_id AND u.kind = 'service'
      WHERE t.org_id = $1 AND t.revoked_at IS NULL
        AND t.expires_at BETWEEN $2::timestamptz - make_interval(days => $3) AND $2::timestamptz + make_interval(days => $3)
        AND (t.expires_at > $2 OR NOT EXISTS (
              SELECT 1 FROM platform.api_tokens n
               WHERE n.owner_id = t.owner_id AND n.revoked_at IS NULL AND n.expires_at > $2 AND n.created_at > t.created_at))
      ORDER BY t.expires_at`,
    [orgId, now, TOKEN_NOTICE_DAYS],
  )
  return rows.map((row) => ({
    accountId: row.account_id,
    account: row.login,
    tokenId: row.id,
    prefix: row.prefix,
    name: row.description,
    expiresAt: row.expires_at,
    expired: row.expires_at <= now,
  }))
}

// --- Org admin ------------------------------------------------------------------

/** Org master keys (docs/org-api.md): `dmk_<32 random bytes in base62>`, minted by ops only and shown once. */
export const MASTER_KEY_PREFIX = 'dmk_'
export const DEFAULT_MASTER_KEY_DAYS = 365
export const MAX_MASTER_KEY_DAYS = 730
/** The service account behind the org admin API. It holds no grant: each database's keys belong to that database's accounts. */
export const ORG_ADMIN_LOGIN = 'org-admin'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function base62(bytes: Buffer): string {
  let value = BigInt(`0x${bytes.toString('hex')}`)
  let text = ''
  while (value > 0n) {
    text = (BASE62[Number(value % 62n)] as string) + text
    value /= 62n
  }
  return text.padStart(43, '0')
}

export interface MintedMasterKey {
  id: string
  prefix: string
  /** The key itself: shown once, never stored. */
  key: string
  createdAt: Date
  expiresAt: Date
  orgAdminId: string
  databaseLimit: number
}

/**
 * Mints an org master key. Ops only: no member and no master key can call it.
 * The first mint provisions the org's `org-admin` service account, a
 * provisioner that holds no grant and takes no member seat; later mints reuse
 * it. `databaseLimit`, when given, sets how many databases the org admin API
 * may hold in the org.
 */
export async function mintMasterKey(
  tx: Tx,
  input: { orgId: string; ttlDays?: number; databaseLimit?: number },
): Promise<MintedMasterKey> {
  const days = input.ttlDays ?? DEFAULT_MASTER_KEY_DAYS
  if (!Number.isInteger(days) || days < 1 || days > MAX_MASTER_KEY_DAYS) {
    throw new TenancyError('invalid', `A master key lasts 1-${MAX_MASTER_KEY_DAYS} days.`)
  }
  if (input.databaseLimit !== undefined && (!Number.isInteger(input.databaseLimit) || input.databaseLimit < 1)) {
    throw new TenancyError('invalid', 'The database limit is a whole number of at least 1.')
  }
  const { rows } = await tx.query<{ org_admin_id: string | null }>(
    "SELECT org_admin_id FROM platform.orgs WHERE id = $1 AND status = 'active' FOR UPDATE",
    [input.orgId],
  )
  if (!rows[0]) throw new TenancyError('not-found', 'No such organisation.')
  let orgAdminId = rows[0].org_admin_id
  if (!orgAdminId) {
    orgAdminId = randomUUID()
    try {
      await tx.query(
        `INSERT INTO platform.users (id, kind, login, service_org_id, description)
         VALUES ($1, 'service', $2, $3, 'Acts for the org admin API.')`,
        [orgAdminId, ORG_ADMIN_LOGIN, input.orgId],
      )
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new TenancyError('conflict', `A service account named ${ORG_ADMIN_LOGIN} exists. Remove it first.`)
      }
      throw error
    }
    await tx.query(
      'INSERT INTO platform.memberships (org_id, user_id) VALUES ($1, $2)',
      [input.orgId, orgAdminId],
    )
  }
  const { rows: org } = await tx.query<{ admin_database_limit: number }>(
    `UPDATE platform.orgs SET org_admin_id = $2, admin_database_limit = coalesce($3, admin_database_limit)
      WHERE id = $1 RETURNING admin_database_limit`,
    [input.orgId, orgAdminId, input.databaseLimit ?? null],
  )
  const key = `${MASTER_KEY_PREFIX}${base62(randomBytes(32))}`
  const id = `mk_${randomUUID()}`
  const prefix = key.slice(0, MASTER_KEY_PREFIX.length + 8)
  const { rows: minted } = await tx.query<{ created_at: Date; expires_at: Date }>(
    `INSERT INTO platform.org_master_keys (id, org_id, key_hash, prefix, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5)) RETURNING created_at, expires_at`,
    [id, input.orgId, createHash('sha256').update(key).digest('hex'), prefix, days],
  )
  return {
    id,
    prefix,
    key,
    createdAt: (minted[0] as { created_at: Date }).created_at,
    expiresAt: (minted[0] as { expires_at: Date }).expires_at,
    orgAdminId,
    databaseLimit: (org[0] as { admin_database_limit: number }).admin_database_limit,
  }
}

/**
 * The service account that owns a database's org admin API keys at
 * `permission`, made with a grant on that database alone the first time
 * (platform 0014). It is a guest, so nothing else reaches it.
 */
export async function databaseAccount(
  tx: Tx,
  input: { orgId: string; workspaceId: string; permission: 'write' | 'read' },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>('SELECT platform.database_account($1, $2, $3) AS id', [
    input.orgId,
    input.workspaceId,
    input.permission,
  ])
  return (rows[0] as { id: string }).id
}

/** The org's limit on databases the org admin API may hold, set by ops at mint. */
export async function adminDatabaseLimit(tx: Tx, orgId: string): Promise<number> {
  const { rows } = await tx.query<{ admin_database_limit: number }>(
    'SELECT admin_database_limit FROM platform.orgs WHERE id = $1',
    [orgId],
  )
  if (!rows[0]) throw new TenancyError('not-found', 'No such organisation.')
  return rows[0].admin_database_limit
}

/** A master key as ops sees it: metadata only, never the key or its hash. */
export interface MasterKeyInfo {
  id: string
  prefix: string
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
  lastUsedAt: Date | null
}

/** The org's master keys, newest first, revoked and expired ones included. */
export async function listMasterKeys(tx: Tx, orgId: string): Promise<MasterKeyInfo[]> {
  const { rows } = await tx.query<{ id: string; prefix: string; created_at: Date; expires_at: Date; revoked_at: Date | null; last_used_at: Date | null }>(
    `SELECT id, prefix, created_at, expires_at, revoked_at, last_used_at FROM platform.org_master_keys
      WHERE org_id = $1 ORDER BY created_at DESC, id`,
    [orgId],
  )
  return rows.map((row) => ({
    id: row.id,
    prefix: row.prefix,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  }))
}

export interface RevokedMasterKeys {
  revoked: { id: string; prefix: string }[]
  /** No live master key is left, so the org's `org-admin` account is retired: the access keys the API issued went too. */
  retired: boolean
  /** The org admin API's access keys revoked with the last live master key. */
  accessKeys: number
}

/**
 * Revokes one of the org's master keys by id, or every one not yet revoked.
 * Ops only, like the mint. It takes effect on the next call: keys are looked
 * up on every request. Revoking the org's last live key retires its
 * `org-admin` account by revoking every access key the API issued, whichever
 * database account owns it (or `org-admin`, before platform 0014), so downstream
 * agents lose access; the account stays, for a later mint to reuse. The
 * caller tells API processes to drop cached token lookups when `accessKeys`
 * is above zero. Works on a suspended org too.
 */
export async function revokeMasterKeys(
  tx: Tx,
  input: { orgId: string; keyId?: string; by: string },
): Promise<RevokedMasterKeys> {
  // Serialised with mints, which lock the org row too.
  const { rows: orgs } = await tx.query<{ org_admin_id: string | null }>('SELECT org_admin_id FROM platform.orgs WHERE id = $1 FOR UPDATE', [input.orgId])
  if (!orgs[0]) throw new TenancyError('not-found', 'No such organisation.')
  const { rows: revoked } = await tx.query<{ id: string; prefix: string }>(
    `UPDATE platform.org_master_keys SET revoked_at = now()
      WHERE org_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR id = $2)
      RETURNING id, prefix`,
    [input.orgId, input.keyId ?? null],
  )
  if (input.keyId !== undefined && !revoked.length) throw new TenancyError('not-found', 'This organisation has no unrevoked master key with that id.')
  const { rows: live } = await tx.query<{ count: string }>(
    'SELECT count(*) FROM platform.org_master_keys WHERE org_id = $1 AND revoked_at IS NULL AND expires_at > now()',
    [input.orgId],
  )
  const orgAdminId = orgs[0].org_admin_id
  if (Number(live[0]?.count ?? 0) > 0 || !orgAdminId) return { revoked, retired: false, accessKeys: 0 }
  const tokens = await tx.query(
    `UPDATE platform.api_tokens SET revoked_at = now(), revoked_by = $3
      WHERE org_id = $1 AND revoked_at IS NULL
        AND (owner_id = $2 OR owner_id IN (SELECT user_id FROM platform.database_accounts WHERE org_id = $1))`,
    [input.orgId, orgAdminId, input.by],
  )
  return { revoked, retired: true, accessKeys: tokens.rowCount ?? 0 }
}

// --- Invites --------------------------------------------------------------------

type InviteRow = {
  id: string
  org_id: string
  github_login: string | null
  email: string | null
  role_id: string
  role_name: string
  place_kind: 'account' | 'space' | 'docket'
  place_id: string | null
  owner: boolean
  guest: boolean
  invited_by: string
  invited_by_login: string
  created_at: Date
  expires_at: Date
  emailed_to: string | null
  emailed_at: Date | null
}

function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    orgId: row.org_id,
    githubLogin: row.github_login,
    email: row.email,
    roleId: row.role_id,
    roleName: row.role_name,
    place: placeFromRow(row.place_kind, row.place_id),
    owner: row.owner,
    guest: row.guest,
    invitedBy: row.invited_by,
    invitedByLogin: row.invited_by_login,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    emailedTo: row.emailed_to,
    emailedAt: row.emailed_at,
  }
}

const INVITE_COLUMNS = `i.id, i.org_id, i.github_login, i.email, i.role_id, r.name AS role_name, i.place_kind, i.place_id,
  i.owner, i.guest, i.invited_by, u.login AS invited_by_login, i.created_at, i.expires_at, i.emailed_to, i.emailed_at`
const INVITE_FROM = 'platform.invites i JOIN platform.users u ON u.id = i.invited_by JOIN platform.roles r ON r.id = i.role_id'

async function rolesCaps(tx: Tx, orgId: string, roleId: string): Promise<readonly Capability[] | null> {
  const { rows: roles } = await tx.query<{ caps: string[] }>(
    'SELECT caps FROM platform.roles WHERE id = $1 AND (org_id IS NULL OR org_id = $2)',
    [roleId, orgId],
  )
  const builtin = BUILTIN_ROLES.find((role) => role.id === roleId)
  return builtin?.caps ?? roles[0]?.caps.filter(isCapability) ?? null
}

/** An invite as issued: with its link's secret, which only its SHA-256 is kept of. Shown once, and sent in the email. */
export interface IssuedInvite extends Invite {
  linkSecret: string
}

/** The prefix of an invite link's secret: `/invite/dki_…`. */
export const INVITE_LINK_PREFIX = 'dki_'

function newInviteLink(): { secret: string; hash: string } {
  const secret = `${INVITE_LINK_PREFIX}${randomBytes(24).toString('base64url')}`
  return { secret, hash: inviteLinkHash(secret) }
}

const inviteLinkHash = (secret: string) => createHash('sha256').update(secret, 'utf8').digest('hex')

/** Whether a string has an invite link secret's shape: checked before any lookup. */
export function isInviteLinkSecret(value: string): boolean {
  return new RegExp(`^${INVITE_LINK_PREFIX}[A-Za-z0-9_-]{32}$`).test(value)
}

/**
 * Invites someone by GitHub login or email (§8.1), to a role on a place: what
 * they get when they accept. Anyone who manages access on a place may invite
 * someone to it, with no more than they hold there; a guest sees only what
 * they are given. A GitHub invite also admits them to the beta.
 */
export async function createInvite(
  tx: Tx,
  input: { orgId: string; who: string; roleId: string; place: Place; guest?: boolean; actorId: string; actor: Access; now?: Date },
): Promise<IssuedInvite> {
  const caps = await rolesCaps(tx, input.orgId, input.roleId)
  if (!caps) throw new TenancyError('invalid', 'Choose a role.')
  if (!mayGrant(input.actor, input.place, caps, 'human')) {
    throw new TenancyError('forbidden', 'You can only invite someone to access you hold yourself, where you manage access.')
  }
  const isEmail = input.who.includes('@') && !input.who.trim().startsWith('@')
  const email = isEmail ? normaliseEmail(input.who) : null
  const login = isEmail ? null : normaliseLogin(input.who)
  if (!email && !login) throw new TenancyError('invalid', 'Enter a GitHub login or an email address.')

  const member = await tx.query(
    `SELECT 1 FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id
      WHERE m.org_id = $1 AND u.kind = 'human' AND (u.login_lower = $2 OR lower(u.email) = $3)`,
    [input.orgId, login, email],
  )
  if (member.rowCount) throw new TenancyError('conflict', 'They are already a member.')

  // An expired invite no longer counts; clear it so the unique index allows a fresh one.
  await tx.query(
    `UPDATE platform.invites SET revoked_at = now()
      WHERE org_id = $1 AND (github_login = $2 OR email = $3)
        AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL AND expires_at <= now()`,
    [input.orgId, login, email],
  )
  await reserveSeat(tx, input.orgId)
  const now = input.now ?? new Date()
  const id = randomUUID()
  const link = newInviteLink()
  try {
    await tx.query(
      `INSERT INTO platform.invites (id, org_id, github_login, email, role_id, place_kind, place_id, guest, invited_by, created_at, expires_at, link_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        input.orgId,
        login,
        email,
        input.roleId,
        input.place.kind,
        placeIdOf(input.place),
        input.guest ?? false,
        input.actorId,
        now,
        new Date(now.getTime() + INVITE_TTL_MS),
        link.hash,
      ],
    )
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new TenancyError('conflict', 'They already have an open invite.')
    }
    throw error
  }
  const invite = await inviteById(tx, id)
  if (!invite) throw new Error('invite vanished')
  return { ...invite, linkSecret: link.secret }
}

async function inviteById(tx: Tx, id: string): Promise<Invite | null> {
  const { rows } = await tx.query<InviteRow>(
    `SELECT ${INVITE_COLUMNS} FROM ${INVITE_FROM} WHERE i.id = $1`,
    [id],
  )
  return rows[0] ? toInvite(rows[0]) : null
}

export async function openInvitesOf(tx: Tx, orgId: string): Promise<Invite[]> {
  const { rows } = await tx.query<InviteRow>(
    `SELECT ${INVITE_COLUMNS} FROM ${INVITE_FROM}
      WHERE i.org_id = $1 AND ${open('i')}
      ORDER BY i.created_at DESC`,
    [orgId],
  )
  return rows.map(toInvite)
}

export interface InviteForUser extends Invite {
  orgSlug: string
  orgName: string
}

/** The open invites addressed to a GitHub identity: its login or one of its verified emails. */
export async function openInvitesFor(
  tx: Tx,
  identity: { login: string; emails: readonly string[] },
): Promise<InviteForUser[]> {
  const { rows } = await tx.query<InviteRow & { org_slug: string; org_name: string }>(
    `SELECT ${INVITE_COLUMNS}, o.slug AS org_slug, o.name AS org_name
       FROM ${INVITE_FROM}
       JOIN platform.orgs o ON o.id = i.org_id AND o.status = 'active'
      WHERE (i.github_login = $1 OR i.email = ANY($2::text[]))
        AND ${open('i')}
      ORDER BY i.created_at`,
    [identity.login.toLowerCase(), identity.emails.map((email) => email.toLowerCase())],
  )
  return rows.map((row) => ({ ...toInvite(row), orgSlug: row.org_slug, orgName: row.org_name }))
}

/** Refuses whoever may not give what an invite gives, where it gives it: they may neither cancel nor send it. */
async function mayAnswerFor(tx: Tx, orgId: string, invite: Invite, actor: Access, verb: 'cancel' | 'send'): Promise<void> {
  if (invite.owner) {
    if (!actor.owner) throw new TenancyError('forbidden', `Only an owner can ${verb} an invite to own the account.`)
    return
  }
  const caps = (await rolesCaps(tx, orgId, invite.roleId)) ?? []
  if (!mayGrant(actor, invite.place, caps, 'human')) {
    throw new TenancyError('forbidden', `You can only ${verb} an invite where you manage access.`)
  }
}

/** Cancels an open invite: whoever may give what it gives, where it gives it, may take it back. */
export async function revokeInvite(tx: Tx, input: { orgId: string; inviteId: string; actor: Access }): Promise<Invite> {
  const invite = await inviteById(tx, input.inviteId)
  if (!invite || invite.orgId !== input.orgId) throw new TenancyError('not-found', 'No such invite.')
  await mayAnswerFor(tx, input.orgId, invite, input.actor, 'cancel')
  const { rowCount } = await tx.query(
    `UPDATE platform.invites SET revoked_at = now() WHERE id = $1 AND ${OPEN_INVITE}`,
    [input.inviteId],
  )
  if (!rowCount) throw new TenancyError('not-found', 'That invite is no longer open.')
  return invite
}

/** Joins a user to the account an invite is for, with what it gives. */
async function joinByInvite(tx: Tx, invite: Invite, userId: string): Promise<void> {
  const joined = await tx.query(
    `INSERT INTO platform.memberships (org_id, user_id, owner, guest, invited_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (org_id, user_id) DO NOTHING`,
    [invite.orgId, userId, invite.owner, invite.guest && !invite.owner, invite.invitedBy],
  )
  if (joined.rowCount && !invite.owner) {
    await tx.query(
      `INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id, granted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [`g_${randomUUID()}`, invite.orgId, userId, invite.place.kind, placeIdOf(invite.place), invite.roleId, invite.invitedBy],
    )
  }
}

/**
 * Accepts or declines an invite addressed to this user. Single use: the row
 * is locked and must still be open. Returns the invite and, on accept, the org.
 */
export async function answerInvite(
  tx: Tx,
  input: { inviteId: string; user: { id: string; login: string; emails: readonly string[] }; accept: boolean },
): Promise<InviteForUser> {
  const mine = (await openInvitesFor(tx, input.user)).find((invite) => invite.id === input.inviteId)
  if (!mine) throw new TenancyError('not-found', 'That invite is not open for you.')
  const { rowCount } = await tx.query(
    `UPDATE platform.invites SET ${input.accept ? 'accepted_at = now(), accepted_by = $2' : 'declined_at = now()'}
      WHERE id = $1 AND ${OPEN_INVITE}`,
    input.accept ? [input.inviteId, input.user.id] : [input.inviteId],
  )
  if (!rowCount) throw new TenancyError('not-found', 'That invite is no longer open.')
  if (input.accept) await joinByInvite(tx, mine, input.user.id)
  return mine
}

// --- Invite links (tenancy v2 §6) ---------------------------------------------

/** What an invite link opens: the invite, and whether it can still be answered. */
export interface InviteByLink extends InviteForUser {
  state: 'open' | 'accepted' | 'declined' | 'cancelled' | 'expired'
}

/**
 * The invite a link's secret opens, whatever its state, or null for a link
 * that never was one (or was replaced by a newer one). An invite to an
 * account that is no longer active opens nothing.
 */
export async function inviteByLink(tx: Tx, secret: string, now = new Date()): Promise<InviteByLink | null> {
  if (!isInviteLinkSecret(secret)) return null
  const { rows } = await tx.query<InviteRow & { org_slug: string; org_name: string; accepted_at: Date | null; declined_at: Date | null; revoked_at: Date | null }>(
    `SELECT ${INVITE_COLUMNS}, o.slug AS org_slug, o.name AS org_name, i.accepted_at, i.declined_at, i.revoked_at
       FROM ${INVITE_FROM}
       JOIN platform.orgs o ON o.id = i.org_id AND o.status = 'active'
      WHERE i.link_hash = $1`,
    [inviteLinkHash(secret)],
  )
  const row = rows[0]
  if (!row) return null
  const state = row.accepted_at
    ? 'accepted'
    : row.declined_at
      ? 'declined'
      : row.revoked_at
        ? 'cancelled'
        : row.expires_at <= now
          ? 'expired'
          : 'open'
  return { ...toInvite(row), orgSlug: row.org_slug, orgName: row.org_name, state }
}

/**
 * Whether an invite link lets this GitHub login in: an open invite, by email
 * (the link is how its address was proved) or to this very login. An invite
 * to another login is theirs alone.
 */
export function inviteLinkAdmits(invite: Pick<InviteByLink, 'state' | 'githubLogin'>, login: string): boolean {
  return invite.state === 'open' && (invite.githubLogin === null || invite.githubLogin === login.toLowerCase())
}

/**
 * Accepts or declines an invite by its link (tenancy v2 §6): it works once.
 * Whoever holds the link to an invite by email may answer it; an invite to a
 * GitHub login only that login may.
 */
export async function answerInviteByLink(
  tx: Tx,
  input: { secret: string; user: { id: string; login: string }; accept: boolean },
): Promise<InviteForUser> {
  const invite = await inviteByLink(tx, input.secret)
  if (!invite || invite.state !== 'open') throw new TenancyError('not-found', 'That invite is no longer open.')
  if (!inviteLinkAdmits(invite, input.user.login)) {
    throw new TenancyError('forbidden', `This invite is for @${invite.githubLogin}. Sign in as them to accept it.`)
  }
  const { rowCount } = await tx.query(
    `UPDATE platform.invites SET ${input.accept ? 'accepted_at = now(), accepted_by = $2' : 'declined_at = now()'}
      WHERE id = $1 AND ${OPEN_INVITE}`,
    input.accept ? [invite.id, input.user.id] : [invite.id],
  )
  if (!rowCount) throw new TenancyError('not-found', 'That invite is no longer open.')
  if (input.accept) await joinByInvite(tx, invite, input.user.id)
  return invite
}

/**
 * Sends an open invite again: a new link, for 7 more days, and the old link
 * stops working. Whoever may cancel it may send it again.
 */
export async function reissueInvite(
  tx: Tx,
  input: { orgId: string; inviteId: string; actor: Access; now?: Date },
): Promise<IssuedInvite> {
  const invite = await inviteById(tx, input.inviteId)
  if (!invite || invite.orgId !== input.orgId) throw new TenancyError('not-found', 'No such invite.')
  await mayAnswerFor(tx, input.orgId, invite, input.actor, 'send')
  const now = input.now ?? new Date()
  const link = newInviteLink()
  const { rowCount } = await tx.query(
    `UPDATE platform.invites SET link_hash = $2, expires_at = $3, emailed_to = NULL, emailed_at = NULL WHERE id = $1 AND ${OPEN_INVITE}`,
    [input.inviteId, link.hash, new Date(now.getTime() + INVITE_TTL_MS)],
  )
  if (!rowCount) throw new TenancyError('not-found', 'That invite is no longer open.')
  const fresh = await inviteById(tx, input.inviteId)
  if (!fresh) throw new Error('invite vanished')
  return { ...fresh, linkSecret: link.secret }
}

/**
 * Records that an invite's email was delivered. Only the address the invite
 * was made for is kept: the address on file of a GitHub-login invitee is
 * never stored here, nor shown to whoever invited them.
 */
export async function markInviteEmailed(tx: Tx, input: { inviteId: string }): Promise<void> {
  await tx.query('UPDATE platform.invites SET emailed_to = lower(email), emailed_at = now() WHERE id = $1', [input.inviteId])
}

/**
 * Where an invite's email goes: the address it was made for, or the primary
 * email of the person a GitHub-login invite is for, when they have signed in
 * here before. Null when there is nowhere to send it.
 */
export async function inviteEmailAddress(tx: Tx, invite: Pick<Invite, 'email' | 'githubLogin'>): Promise<string | null> {
  if (invite.email) return invite.email
  if (!invite.githubLogin) return null
  const { rows } = await tx.query<{ email: string | null }>(
    "SELECT email FROM platform.users WHERE kind = 'human' AND login_lower = $1 AND email IS NOT NULL LIMIT 1",
    [invite.githubLogin],
  )
  return rows[0]?.email ?? null
}
