// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import type { Tx } from './db.js'
import { TenancyError, inviteByLink, inviteLinkAdmits, mayEnterBeta, normaliseEmail, normaliseLogin, openInvitesFor, upsertGitHubUser, type GitHubIdentity, type User } from './model.js'

/**
 * One way into the same users table for every sign-in provider (§8.1). A
 * person is a user; each way they sign in is an identity of that user, keyed
 * by provider, issuer and the provider's stable subject (GitHub's numeric id,
 * an OIDC `sub`, a password login), never by a login or an email, which can
 * change hands. A new identity always makes a new user: two identities are
 * never linked because their emails match, so signing in with a second
 * provider is an explicit link, not a guess.
 *
 * A user who signs in other than with GitHub gets a login that cannot be a
 * GitHub login (it has a `.` or `_`), so they can never take a GitHub user's
 * login, nor a GitHub invite, allowlist entry or platform-admin entry
 * addressed to one.
 */

export type IdentityProvider = 'github' | 'oidc' | 'password'

/** The issuer of every GitHub identity: users.github_id is GitHub's own key, so one GitHub per server. */
export const GITHUB_ISSUER = 'github'
/** The issuer of every password identity: this server. */
export const PASSWORD_ISSUER = 'local'

/** An identity a provider vouched for, as the resolver takes it. */
export type ExternalIdentity =
  | { provider: 'github'; github: GitHubIdentity }
  | {
      provider: 'oidc' | 'password'
      issuer: string
      subject: string
      /** The login a new user gets, before a number is added to make it unique: never a GitHub login (`isGitHubLogin`). */
      login: string
      name: string | null
      avatarUrl: string | null
      /** Verified emails only, lowercase. */
      emails: string[]
    }

const SEGMENT = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?'
const OTHER_LOGIN = new RegExp(`^${SEGMENT}(?:[._]${SEGMENT})+$`)
const MAX_LOGIN = 64

/** Whether a login is a GitHub one (letters, digits and single hyphens, up to 39). */
export function isGitHubLogin(login: string): boolean {
  return normaliseLogin(login) === login
}

/**
 * A login of a user who signs in other than with GitHub, as stored: lowercase,
 * with a `.` or `_` between parts (`jo.bloggs`, `ops_admin`). Null when it
 * cannot be one.
 */
export function normaliseOtherLogin(value: string): string | null {
  const login = value.trim().replace(/^@/, '').toLowerCase()
  return login.length <= MAX_LOGIN && OTHER_LOGIN.test(login) ? login : null
}

/** Any login a user can have: a GitHub login, or another provider's (`normaliseOtherLogin`). */
export function normaliseAnyLogin(value: string): string | null {
  return normaliseLogin(value) ?? normaliseOtherLogin(value)
}

/**
 * The login an OIDC user gets: what the provider calls them (preferred
 * username, else the email's local part), made safe, then `.<provider>`:
 * `jo.okta`. Unique-making happens in `resolveIdentity`.
 */
export function oidcLogin(provider: string, input: { username: string | null; email: string | null }): string {
  const raw = input.username?.split('@')[0] || input.email?.split('@')[0] || 'user'
  const base =
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30)
      .replace(/-+$/, '') || 'user'
  const suffix = provider.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'sso'
  return `${base}.${suffix}`
}

type UserRow = { id: string; kind: 'human' | 'service'; login: string; name: string | null; email: string | null; emails: string[]; avatar_url: string | null }
const USER_COLUMNS = 'id, kind, login, name, email, emails, avatar_url'
const toUser = (row: UserRow): User => ({ id: row.id, kind: row.kind, login: row.login, name: row.name, email: row.email, emails: row.emails, avatarUrl: row.avatar_url })

const keyOf = (identity: Extract<ExternalIdentity, { issuer: string }>) => ({ provider: identity.provider, issuer: identity.issuer, subject: identity.subject })

/** The user an identity is attached to, if it is attached to one. */
export async function identityUser(tx: Tx, key: { provider: IdentityProvider; issuer: string; subject: string }): Promise<User | null> {
  const { rows } = await tx.query<UserRow>(
    `SELECT ${USER_COLUMNS.split(', ').map((column) => `u.${column}`).join(', ')}
       FROM platform.identities i JOIN platform.users u ON u.id = i.user_id
      WHERE i.provider = $1 AND i.issuer = $2 AND i.subject = $3`,
    [key.provider, key.issuer, key.subject],
  )
  return rows[0] ? toUser(rows[0]) : null
}

/**
 * The user behind an identity, made on its first sign-in and refreshed from
 * the provider on every one after: name, avatar and verified emails follow
 * the provider, the login stays as it was first given. A GitHub identity is
 * keyed by GitHub's id as it always was (`upsertGitHubUser`).
 */
export async function resolveIdentity(tx: Tx, identity: ExternalIdentity): Promise<User> {
  if (identity.provider === 'github') return upsertGitHubUser(tx, identity.github)
  const key = keyOf(identity)
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`docket:identity:${key.provider}:${key.issuer}:${key.subject}`])
  const emails = [...new Set(identity.emails.map((email) => normaliseEmail(email)).filter((email): email is string => email !== null))]
  const existing = await identityUser(tx, identity)
  if (existing) {
    const { rows } = await tx.query<UserRow>(
      `UPDATE platform.users SET name = $2, email = $3, emails = $4, avatar_url = $5, last_seen_at = now()
        WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [existing.id, identity.name, emails[0] ?? null, emails, identity.avatarUrl],
    )
    await recordIdentity(tx, key, existing.id)
    return toUser(rows[0] as UserRow)
  }
  const login = normaliseOtherLogin(identity.login)
  if (!login) throw new TenancyError('invalid', `not a login for ${identity.provider} sign-in: ${JSON.stringify(identity.login)} (it has a "." or "_", so it is never a GitHub login)`)
  const id = randomUUID()
  // A password login is the operator's choice and must be free; an OIDC one gets a number until it is.
  for (let attempt = 1; attempt <= 100; attempt++) {
    const candidate = attempt === 1 ? login : `${login.slice(0, MAX_LOGIN - String(attempt).length - 1)}-${attempt}`
    const { rows } = await tx.query<UserRow>(
      `INSERT INTO platform.users (id, kind, login, name, email, emails, avatar_url, last_seen_at)
       VALUES ($1, 'human', $2, $3, $4, $5, $6, now())
       ON CONFLICT (login_lower) WHERE kind = 'human' DO NOTHING
       RETURNING ${USER_COLUMNS}`,
      [id, candidate, identity.name, emails[0] ?? null, emails, identity.avatarUrl],
    )
    if (rows[0]) {
      await recordIdentity(tx, key, id)
      return toUser(rows[0])
    }
    if (identity.provider === 'password') break
  }
  throw new TenancyError('conflict', `the login ${login} is already taken`)
}

async function recordIdentity(tx: Tx, key: { provider: string; issuer: string; subject: string }, userId: string): Promise<void> {
  const { rows } = await tx.query<{ user_id: string }>(
    `INSERT INTO platform.identities (provider, issuer, subject, user_id, last_seen_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (provider, issuer, subject) DO UPDATE SET last_seen_at = now()
     RETURNING user_id`,
    [key.provider, key.issuer, key.subject, userId],
  )
  if (rows[0]?.user_id !== userId) throw new TenancyError('conflict', 'that identity belongs to another user')
}

/** Every identity a user signs in with, oldest first. */
export async function identitiesOf(tx: Tx, userId: string): Promise<{ provider: IdentityProvider; issuer: string; subject: string; lastSeenAt: Date | null }[]> {
  const { rows } = await tx.query<{ provider: IdentityProvider; issuer: string; subject: string; last_seen_at: Date | null }>(
    'SELECT provider, issuer, subject, last_seen_at FROM platform.identities WHERE user_id = $1 ORDER BY created_at, provider, issuer, subject',
    [userId],
  )
  return rows.map((row) => ({ provider: row.provider, issuer: row.issuer, subject: row.subject, lastSeenAt: row.last_seen_at }))
}

// --- Who may sign in ----------------------------------------------------------

/** An entry of the sign-in allowlist beside GitHub logins: a verified email, a whole email domain, or a non-GitHub login. */
export type SigninAllowEntry = { kind: 'email' | 'domain' | 'login'; value: string }

/**
 * An allow-list entry as written in config: `ada@example.com`, `@example.com`
 * (every verified email there), or a non-GitHub login (`jo.okta`). Null for a
 * GitHub login (those go to the beta allowlist) or anything else.
 */
export function signinAllowEntry(raw: string): SigninAllowEntry | null {
  const text = raw.trim().toLowerCase()
  if (text.startsWith('@')) {
    const domain = text.slice(1)
    return normaliseEmail(`x@${domain}`) ? { kind: 'domain', value: domain } : null
  }
  if (text.includes('@')) {
    const email = normaliseEmail(text)
    return email ? { kind: 'email', value: email } : null
  }
  const login = normaliseOtherLogin(text)
  return login ? { kind: 'login', value: login } : null
}

/** Replaces the sign-in allowlist with the config's entries: the config is its source, so an entry taken out stops admitting anyone. */
export async function replaceSigninAllowlist(tx: Tx, entries: readonly SigninAllowEntry[]): Promise<void> {
  await tx.query('DELETE FROM platform.signin_allowlist')
  for (const entry of entries) {
    await tx.query('INSERT INTO platform.signin_allowlist (kind, value) VALUES ($1, $2) ON CONFLICT DO NOTHING', [entry.kind, entry.value.toLowerCase()])
  }
}

/** Whether any of these verified emails, or the non-GitHub login, is on the sign-in allowlist. */
async function onSigninAllowlist(tx: Tx, emails: readonly string[], login: string | null): Promise<boolean> {
  const lower = emails.map((email) => email.toLowerCase())
  const { rowCount } = await tx.query(
    `SELECT 1 FROM platform.signin_allowlist
      WHERE (kind = 'email' AND value = ANY($1::text[]))
         OR (kind = 'domain' AND value = ANY($2::text[]))
         OR (kind = 'login' AND value = $3)
      LIMIT 1`,
    [lower, lower.map((email) => email.split('@')[1] ?? ''), login],
  )
  return (rowCount ?? 0) > 0
}

/**
 * Whether an identity may sign in (§8.1), for every provider alike: an
 * identity already attached to a member of an active account, one of its
 * verified emails on the sign-in allowlist (exactly, or by domain), or an open
 * invite to one of them. A GitHub identity may also through the beta
 * allowlist and a GitHub-login invite, as before (`mayEnterBeta`). An open
 * invite's link (`inviteLink`, the secret it carries) lets its holder in too.
 */
export async function mayEnter(tx: Tx, identity: ExternalIdentity, options: { inviteLink?: string | null } = {}): Promise<boolean> {
  // Holding an open invite's link (tenancy v2 §6): an invite by email lets in whoever holds it, one to a GitHub login only that login.
  if (options.inviteLink) {
    const invite = await inviteByLink(tx, options.inviteLink)
    const login = identity.provider === 'github' ? identity.github.login : null
    if (invite && (invite.githubLogin === null ? invite.state === 'open' : login !== null && inviteLinkAdmits(invite, login))) return true
  }
  if (identity.provider === 'github') {
    if (await mayEnterBeta(tx, identity.github)) return true
    return onSigninAllowlist(tx, identity.github.emails, null)
  }
  const existing = await identityUser(tx, identity)
  if (existing) {
    const member = await tx.query(
      `SELECT 1 FROM platform.memberships m JOIN platform.orgs o ON o.id = m.org_id AND o.status = 'active' WHERE m.user_id = $1 LIMIT 1`,
      [existing.id],
    )
    if (member.rowCount) return true
  }
  if (await onSigninAllowlist(tx, identity.emails, existing?.login ?? null)) return true
  // A login that is not a GitHub one never matches a GitHub-login invite, so only the emails count here.
  return (await openInvitesFor(tx, { login: existing?.login ?? identity.login, emails: identity.emails })).length > 0
}
