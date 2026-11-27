// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { Tx } from './db.js'
import { INVITE_TTL_MS, LIMITS, PROVISIONING_TIMEOUT_MS } from './limits.js'
import {
  canChangeRole,
  isAccountRole,
  isNamespacePermission,
  isRole,
  namespacePermission,
  type AccountRole,
  type NamespacePermission,
  type Role,
} from './roles.js'

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
  role: Role
  joinedAt: Date
  lastSeenAt: Date | null
  description: string | null
  /** A service account's accountable person, by login, while they are a member: who its tokens act for. */
  actsFor: string | null
}

export interface Invite {
  id: string
  orgId: string
  githubLogin: string | null
  email: string | null
  role: Role
  invitedBy: string
  invitedByLogin: string
  createdAt: Date
  expiresAt: Date
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
    throw new TenancyError('limit', `The beta is full: it holds ${maxOrgs} organisations.`)
  }
  const taken = await tx.query('SELECT 1 FROM platform.orgs WHERE slug = $1', [input.slug])
  if (taken.rowCount) throw new TenancyError('conflict', 'That name is taken.')
  await tx.query('INSERT INTO platform.orgs (id, slug, name, created_by) VALUES ($1, $2, $3, $4)', [
    input.id,
    input.slug,
    input.name,
    input.ownerId,
  ])
  await tx.query("INSERT INTO platform.memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')", [
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
  role: Role
  /** The member's account role, which decides with their grants which namespaces they reach. */
  accountRole: AccountRole
}

type MembershipRow = { id: string; slug: string; name: string; status: Org['status']; role: string; account_role: string }

function membershipOf(row: MembershipRow): OrgMembership | null {
  if (!isRole(row.role) || !isAccountRole(row.account_role)) return null
  return { org: { id: row.id, slug: row.slug, name: row.name, status: row.status }, role: row.role, accountRole: row.account_role }
}

/**
 * The org at `slug`, if `userId` is a member of it. Anything else - no such
 * org, not a member, a deleted org - is null, which routes answer as 404 (§5.5).
 */
export async function membershipBySlug(tx: Tx, slug: string, userId: string): Promise<OrgMembership | null> {
  const { rows } = await tx.query<MembershipRow>(
    `SELECT o.id, o.slug, o.name, o.status, m.role, m.account_role
       FROM platform.orgs o JOIN platform.memberships m ON m.org_id = o.id
      WHERE o.slug = $1 AND m.user_id = $2 AND o.status = 'active'`,
    [slug, userId],
  )
  const row = rows[0]
  return row ? membershipOf(row) : null
}

export async function membershipsOf(tx: Tx, userId: string): Promise<OrgMembership[]> {
  const { rows } = await tx.query<MembershipRow>(
    `SELECT o.id, o.slug, o.name, o.status, m.role, m.account_role
       FROM platform.orgs o JOIN platform.memberships m ON m.org_id = o.id
      WHERE m.user_id = $1 AND o.status = 'active'
      ORDER BY o.name`,
    [userId],
  )
  return rows.flatMap((row) => membershipOf(row) ?? [])
}

/** The member's grants in the org: each namespace (workspace id) they were given, with its permission. */
export async function namespaceGrantsOf(tx: Tx, orgId: string, userId: string): Promise<Map<string, NamespacePermission>> {
  const { rows } = await tx.query<{ namespace_id: string; permission: string }>(
    'SELECT namespace_id, permission FROM platform.namespace_grants WHERE org_id = $1 AND principal_id = $2',
    [orgId, userId],
  )
  return new Map(rows.flatMap((row) => (isNamespacePermission(row.permission) ? [[row.namespace_id, row.permission] as const] : [])))
}

/** The member's current role in the org, or null. */
export async function roleOf(tx: Tx, orgId: string, userId: string): Promise<Role | null> {
  const { rows } = await tx.query<{ role: string }>(
    'SELECT role FROM platform.memberships WHERE org_id = $1 AND user_id = $2',
    [orgId, userId],
  )
  const role = rows[0]?.role
  return isRole(role) ? role : null
}

/** What a member reaches in one namespace: their org role, their account role, and their permission there (null: none). */
export interface NamespaceAccess {
  role: Role
  accountRole: AccountRole
  permission: NamespacePermission | null
}

/**
 * A member's access to one namespace (a workspace) now: their account role
 * joined with their grant there (`namespacePermission`). Null when they are
 * not a member of the org.
 */
export async function namespaceAccess(tx: Tx, orgId: string, namespaceId: string, userId: string): Promise<NamespaceAccess | null> {
  const { rows } = await tx.query<{ role: string; account_role: string; permission: string | null }>(
    `SELECT m.role, m.account_role, g.permission
       FROM platform.memberships m
       LEFT JOIN platform.namespace_grants g ON g.org_id = m.org_id AND g.principal_id = m.user_id AND g.namespace_id = $2
      WHERE m.org_id = $1 AND m.user_id = $3`,
    [orgId, namespaceId, userId],
  )
  const row = rows[0]
  if (!row || !isRole(row.role) || !isAccountRole(row.account_role)) return null
  const grants = isNamespacePermission(row.permission) ? [row.permission] : []
  return { role: row.role, accountRole: row.account_role, permission: namespacePermission(row.account_role, grants) }
}

// --- Members ------------------------------------------------------------------

/** Whether membership `m` is one of the org admin API's database accounts (platform 0014): not a member anyone manages. */
const DATABASE_ACCOUNT = (m: string) =>
  `EXISTS (SELECT 1 FROM platform.database_accounts d WHERE d.org_id = ${m}.org_id AND d.user_id = ${m}.user_id)`

export async function listMembers(tx: Tx, orgId: string): Promise<Member[]> {
  const { rows } = await tx.query<
    UserRow & { role: string; created_at: Date; last_seen_at: Date | null; description: string | null; acts_for: string | null }
  >(
    `SELECT u.id, u.kind, u.login, u.name, u.email, u.emails, u.avatar_url, u.description, u.last_seen_at,
            m.role, m.created_at,
            (SELECT a.login FROM platform.users a JOIN platform.memberships am ON am.user_id = a.id AND am.org_id = m.org_id
              WHERE a.id = u.accountable_user_id AND a.kind = 'human') AS acts_for
       FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id
      WHERE m.org_id = $1 AND NOT ${DATABASE_ACCOUNT('m')}
      ORDER BY array_position(ARRAY['owner','admin','editor','viewer'], m.role), u.login_lower`,
    [orgId],
  )
  return rows.flatMap((row) =>
    isRole(row.role)
      ? [
          {
            ...toUser(row),
            role: row.role,
            joinedAt: row.created_at,
            lastSeenAt: row.last_seen_at,
            description: row.description,
            actsFor: row.acts_for,
          },
        ]
      : [],
  )
}

/** Locks the org row and checks a new seat fits under the members limit. The org admin API's service accounts take no seat. */
async function reserveSeat(tx: Tx, orgId: string): Promise<void> {
  await tx.query('SELECT 1 FROM platform.orgs WHERE id = $1 FOR UPDATE', [orgId])
  const { rows } = await tx.query<{ count: string }>(
    `SELECT (SELECT count(*) FROM platform.memberships m JOIN platform.orgs o ON o.id = m.org_id
              WHERE m.org_id = $1 AND m.user_id IS DISTINCT FROM o.org_admin_id AND NOT ${DATABASE_ACCOUNT('m')})
          + (SELECT count(*) FROM platform.invites WHERE org_id = $1 AND ${OPEN_INVITE}) AS count`,
    [orgId],
  )
  if (Number(rows[0]?.count ?? 0) >= LIMITS.membersPerOrg) {
    throw new TenancyError('limit', `An organisation holds at most ${LIMITS.membersPerOrg} members and invites.`)
  }
}

const ORG_ADMIN_MANAGED = 'The org-admin service account is managed by Docket Cloud operators through the org master key.'
const DATABASE_ACCOUNT_MANAGED = "A database's service accounts are managed through the org admin API."

async function ownerCount(tx: Tx, orgId: string): Promise<number> {
  const { rows } = await tx.query<{ count: string }>(
    "SELECT count(*) FROM platform.memberships WHERE org_id = $1 AND role = 'owner'",
    [orgId],
  )
  return Number(rows[0]?.count ?? 0)
}

/** Changes a member's role, as `actorRole` allows; an org always keeps an owner. Returns the old role. */
export async function changeRole(
  tx: Tx,
  input: { orgId: string; userId: string; role: Role; actorRole: Role },
): Promise<Role> {
  const { rows } = await tx.query<{ role: string; org_admin: boolean; database_account: boolean }>(
    `SELECT m.role, (m.user_id = o.org_admin_id) IS TRUE AS org_admin, ${DATABASE_ACCOUNT('m')} AS database_account
       FROM platform.memberships m JOIN platform.orgs o ON o.id = m.org_id
      WHERE m.org_id = $1 AND m.user_id = $2 FOR UPDATE OF m`,
    [input.orgId, input.userId],
  )
  const from = rows[0]?.role
  if (!isRole(from)) throw new TenancyError('not-found', 'No such member.')
  if (rows[0]?.org_admin) throw new TenancyError('forbidden', ORG_ADMIN_MANAGED)
  if (rows[0]?.database_account) throw new TenancyError('forbidden', DATABASE_ACCOUNT_MANAGED)
  if (!canChangeRole(input.actorRole, from, input.role)) {
    throw new TenancyError('forbidden', 'Your role cannot make that change.')
  }
  if (from === 'owner' && input.role !== 'owner' && (await ownerCount(tx, input.orgId)) <= 1) {
    throw new TenancyError('last-owner', 'An organisation needs an owner. Make someone else owner first.')
  }
  await tx.query('UPDATE platform.memberships SET role = $3 WHERE org_id = $1 AND user_id = $2', [
    input.orgId,
    input.userId,
    input.role,
  ])
  return from
}

/** Removes a member. A removed service account is deleted with its membership. Returns the old role. */
export async function removeMember(
  tx: Tx,
  input: { orgId: string; userId: string; actorRole: Role },
): Promise<Role> {
  const { rows } = await tx.query<{ role: string; kind: string; org_admin: boolean; database_account: boolean }>(
    `SELECT m.role, u.kind, (m.user_id = o.org_admin_id) IS TRUE AS org_admin, ${DATABASE_ACCOUNT('m')} AS database_account
       FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id JOIN platform.orgs o ON o.id = m.org_id
      WHERE m.org_id = $1 AND m.user_id = $2 FOR UPDATE OF m`,
    [input.orgId, input.userId],
  )
  const row = rows[0]
  if (!row || !isRole(row.role)) throw new TenancyError('not-found', 'No such member.')
  if (row.org_admin) throw new TenancyError('forbidden', ORG_ADMIN_MANAGED)
  if (row.database_account) throw new TenancyError('forbidden', DATABASE_ACCOUNT_MANAGED)
  if (!canChangeRole(input.actorRole, row.role, null)) {
    throw new TenancyError('forbidden', 'Your role cannot remove that member.')
  }
  if (row.role === 'owner' && (await ownerCount(tx, input.orgId)) <= 1) {
    throw new TenancyError('last-owner', 'An organisation needs an owner. Make someone else owner first.')
  }
  await tx.query('DELETE FROM platform.memberships WHERE org_id = $1 AND user_id = $2', [input.orgId, input.userId])
  if (row.kind === 'service') {
    await tx.query("DELETE FROM platform.users WHERE id = $1 AND kind = 'service'", [input.userId])
  }
  return row.role
}

/** Adds a service account (§4): a non-human member whose only credentials will be API tokens. */
export async function createServiceAccount(
  tx: Tx,
  input: { orgId: string; name: string; description: string | null; role: Role; actorId: string; actorRole: Role },
): Promise<User> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/.test(input.name)) {
    throw new TenancyError('invalid', 'Name it with 2-40 lowercase letters, digits or hyphens.')
  }
  if (input.role === 'owner' || !canChangeRole(input.actorRole, input.role, input.role)) {
    throw new TenancyError('forbidden', 'Your role cannot give a service account that role.')
  }
  await reserveSeat(tx, input.orgId)
  const id = randomUUID()
  try {
    // It acts for whoever made it until an admin names someone else (trust design §3.4).
    await tx.query(
      `INSERT INTO platform.users (id, kind, login, service_org_id, description, created_by, accountable_user_id)
       VALUES ($1, 'service', $2, $3, $4, $5, $5)`,
      [id, input.name, input.orgId, input.description, input.actorId],
    )
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new TenancyError('conflict', 'A service account with that name exists.')
    }
    throw error
  }
  await tx.query('INSERT INTO platform.memberships (org_id, user_id, role, invited_by) VALUES ($1, $2, $3, $4)', [
    input.orgId,
    id,
    input.role,
    input.actorId,
  ])
  return { id, kind: 'service', login: input.name, name: null, email: null, emails: [], avatarUrl: null }
}

/**
 * Names the person a service account acts for: a human member of its org,
 * whose evidence its tokens give when an agent cites no source. Returns the
 * login it acted for before, if anyone.
 */
export async function setAccountable(
  tx: Tx,
  input: { orgId: string; serviceId: string; accountableLogin: string },
): Promise<{ service: string; before: string | null; after: string }> {
  const { rows: services } = await tx.query<{ login: string; before: string | null; org_admin: boolean; database_account: boolean }>(
    `SELECT u.login, (SELECT a.login FROM platform.users a WHERE a.id = u.accountable_user_id) AS before,
            (u.id = o.org_admin_id) IS TRUE AS org_admin, ${DATABASE_ACCOUNT('m')} AS database_account
       FROM platform.users u JOIN platform.memberships m ON m.user_id = u.id AND m.org_id = $1 JOIN platform.orgs o ON o.id = m.org_id
      WHERE u.id = $2 AND u.kind = 'service' FOR UPDATE OF u`,
    [input.orgId, input.serviceId],
  )
  const service = services[0]
  if (!service) throw new TenancyError('not-found', 'No such service account.')
  if (service.org_admin) throw new TenancyError('forbidden', ORG_ADMIN_MANAGED)
  if (service.database_account) throw new TenancyError('forbidden', DATABASE_ACCOUNT_MANAGED)
  const { rows: people } = await tx.query<{ id: string; login: string }>(
    `SELECT u.id, u.login FROM platform.users u JOIN platform.memberships m ON m.user_id = u.id AND m.org_id = $1
      WHERE u.kind = 'human' AND u.login_lower = lower($2)`,
    [input.orgId, input.accountableLogin.trim().replace(/^@/, '')],
  )
  const person = people[0]
  if (!person) throw new TenancyError('invalid', 'A service account acts for a person who is a member of this organisation.')
  await tx.query('UPDATE platform.users SET accountable_user_id = $2 WHERE id = $1', [input.serviceId, person.id])
  return { service: service.login, before: service.before, after: person.login }
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
      "INSERT INTO platform.memberships (org_id, user_id, role, account_role) VALUES ($1, $2, 'editor', 'provisioner')",
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
  role: string
  invited_by: string
  invited_by_login: string
  created_at: Date
  expires_at: Date
}

function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    orgId: row.org_id,
    githubLogin: row.github_login,
    email: row.email,
    role: isRole(row.role) ? row.role : 'viewer',
    invitedBy: row.invited_by,
    invitedByLogin: row.invited_by_login,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

const INVITE_COLUMNS = `i.id, i.org_id, i.github_login, i.email, i.role, i.invited_by,
  u.login AS invited_by_login, i.created_at, i.expires_at`

/** Invites someone by GitHub login or email (§8.1). A GitHub invite also admits them to the beta. */
export async function createInvite(
  tx: Tx,
  input: { orgId: string; who: string; role: Role; actorId: string; actorRole: Role; now?: Date },
): Promise<Invite> {
  if (!canChangeRole(input.actorRole, input.role, input.role)) {
    throw new TenancyError('forbidden', 'Your role cannot invite someone with that role.')
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
  try {
    await tx.query(
      `INSERT INTO platform.invites (id, org_id, github_login, email, role, invited_by, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, input.orgId, login, email, input.role, input.actorId, now, new Date(now.getTime() + INVITE_TTL_MS)],
    )
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new TenancyError('conflict', 'They already have an open invite.')
    }
    throw error
  }
  const invite = await inviteById(tx, id)
  if (!invite) throw new Error('invite vanished')
  return invite
}

async function inviteById(tx: Tx, id: string): Promise<Invite | null> {
  const { rows } = await tx.query<InviteRow>(
    `SELECT ${INVITE_COLUMNS} FROM platform.invites i JOIN platform.users u ON u.id = i.invited_by WHERE i.id = $1`,
    [id],
  )
  return rows[0] ? toInvite(rows[0]) : null
}

export async function openInvitesOf(tx: Tx, orgId: string): Promise<Invite[]> {
  const { rows } = await tx.query<InviteRow>(
    `SELECT ${INVITE_COLUMNS} FROM platform.invites i JOIN platform.users u ON u.id = i.invited_by
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
       FROM platform.invites i
       JOIN platform.users u ON u.id = i.invited_by
       JOIN platform.orgs o ON o.id = i.org_id AND o.status = 'active'
      WHERE (i.github_login = $1 OR i.email = ANY($2::text[]))
        AND ${open('i')}
      ORDER BY i.created_at`,
    [identity.login.toLowerCase(), identity.emails.map((email) => email.toLowerCase())],
  )
  return rows.map((row) => ({ ...toInvite(row), orgSlug: row.org_slug, orgName: row.org_name }))
}

/** Cancels an open invite. */
export async function revokeInvite(tx: Tx, input: { orgId: string; inviteId: string }): Promise<Invite> {
  const invite = await inviteById(tx, input.inviteId)
  if (!invite || invite.orgId !== input.orgId) throw new TenancyError('not-found', 'No such invite.')
  const { rowCount } = await tx.query(
    `UPDATE platform.invites SET revoked_at = now() WHERE id = $1 AND ${OPEN_INVITE}`,
    [input.inviteId],
  )
  if (!rowCount) throw new TenancyError('not-found', 'That invite is no longer open.')
  return invite
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
  if (input.accept) {
    await tx.query(
      `INSERT INTO platform.memberships (org_id, user_id, role, invited_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [mine.orgId, input.user.id, mine.role, mine.invitedBy],
    )
  }
  return mine
}
