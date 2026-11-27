// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import type { Tx } from './db.js'
import { TenancyError, allowlistAccount, normaliseEmail, normaliseLogin, type GitHubIdentity } from './model.js'

/**
 * The beta waitlist (platform.waitlist): teams asking to join, by signing in
 * with GitHub while not on the beta list, or, formerly, through the landing
 * page's email form (now removed; see `joinWaitlist`). Joining never grants access; a platform admin's invite does, by adding
 * the entry's verified GitHub account to the beta allowlist. Every function runs inside a
 * `withPlatform` transaction.
 */

/** Team sizes the form offers, as stored. */
export const TEAM_SIZES = ['1', '2-5', '6-20', '21-50', '51+'] as const
export type TeamSize = (typeof TEAM_SIZES)[number]

export function isTeamSize(value: unknown): value is TeamSize {
  return typeof value === 'string' && (TEAM_SIZES as readonly string[]).includes(value)
}

export interface WaitlistEntry {
  id: string
  via: 'email' | 'github'
  email: string | null
  teamName: string | null
  teamSize: TeamSize | null
  /** The login GitHub verified, set exactly when `githubVerified` is. */
  githubLogin: string | null
  githubVerified: boolean
  note: string | null
  status: 'waiting' | 'invited'
  createdAt: Date
  invitedAt: Date | null
  invitedByLogin: string | null
  /** The entry's GitHub account (or, pending a sign-in, its login) is on the beta allowlist, however it got there. */
  allowlisted: boolean
}

/** What the landing page's former email form asked for, already checked. */
export interface WaitlistRequest {
  email: string
  teamName: string
  teamSize: TeamSize | null
  note: string | null
}

export interface Joined {
  id: string
  /** False when the email or GitHub account was already on the list: nothing changed. */
  created: boolean
}

type EntryRow = {
  id: string
  via: 'email' | 'github'
  email: string | null
  team_name: string | null
  team_size: TeamSize | null
  github_id: string | null
  github_login: string | null
  note: string | null
  status: 'waiting' | 'invited'
  created_at: Date
  invited_at: Date | null
  invited_by_login: string | null
  allowlisted: boolean
}

const ENTRY = `
  SELECT w.id, w.via, w.email, w.team_name, w.team_size, w.github_id, w.github_login, w.note, w.status,
         w.created_at, w.invited_at, u.login AS invited_by_login,
         EXISTS (
           SELECT 1 FROM platform.beta_allowlist a
            WHERE a.github_id = w.github_id OR (a.github_id IS NULL AND a.github_login = w.github_login)
         ) AS allowlisted
    FROM platform.waitlist w
    LEFT JOIN platform.users u ON u.id = w.invited_by`

function toEntry(row: EntryRow): WaitlistEntry {
  return {
    id: row.id,
    via: row.via,
    email: row.email,
    teamName: row.team_name,
    teamSize: row.team_size,
    githubLogin: row.github_login,
    githubVerified: row.github_id !== null,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    invitedAt: row.invited_at,
    invitedByLogin: row.invited_by_login,
    allowlisted: row.allowlisted,
  }
}

/** Waitlist writes take turns, so the one-row-per-email-or-account rule holds without unique-violation retries. */
async function lock(tx: Tx): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('docket-cloud:waitlist'))")
}

/**
 * Adds an email-only entry, as the landing page's email form did before that
 * form was removed; kept for the entries it already created and for tests.
 * An email already on the list changes nothing: nothing may rewrite someone
 * else's entry.
 */
export async function joinWaitlist(tx: Tx, request: WaitlistRequest): Promise<Joined> {
  await lock(tx)
  const existing = await tx.query<{ id: string }>('SELECT id FROM platform.waitlist WHERE email = $1', [request.email])
  if (existing.rows[0]) return { id: existing.rows[0].id, created: false }
  const id = randomUUID()
  await tx.query(
    `INSERT INTO platform.waitlist (id, via, email, team_name, team_size, note)
     VALUES ($1, 'email', $2, $3, $4, $5)`,
    [id, request.email, request.teamName, request.teamSize, request.note],
  )
  return { id, created: true }
}

/**
 * Records a GitHub sign-in that the beta refused. The account's own entry is
 * kept up to date with its current login; an entry the form made with one of
 * the account's verified emails becomes the account's.
 */
export async function joinWaitlistWithGitHub(tx: Tx, identity: GitHubIdentity): Promise<Joined> {
  await lock(tx)
  const login = identity.login.toLowerCase()
  const own = await tx.query<{ id: string }>(
    'UPDATE platform.waitlist SET github_login = $2, updated_at = now() WHERE github_id = $1 RETURNING id',
    [identity.id, login],
  )
  if (own.rows[0]) return { id: own.rows[0].id, created: false }

  const emails = identity.emails.map((email) => normaliseEmail(email)).filter((email): email is string => email !== null)
  const claimed = await tx.query<{ id: string }>(
    `UPDATE platform.waitlist SET github_id = $2, github_login = $3, updated_at = now()
      WHERE id = (SELECT id FROM platform.waitlist WHERE github_id IS NULL AND email = ANY($1::text[]) ORDER BY created_at LIMIT 1)
      RETURNING id`,
    [emails, identity.id, login],
  )
  if (claimed.rows[0]) return { id: claimed.rows[0].id, created: false }

  // Another entry may hold the primary email (an account that has since lost it): join without one.
  const primary = emails[0] ?? null
  const taken = primary ? (await tx.query('SELECT 1 FROM platform.waitlist WHERE email = $1', [primary])).rowCount : 0
  const id = randomUUID()
  await tx.query(
    `INSERT INTO platform.waitlist (id, via, email, github_id, github_login) VALUES ($1, 'github', $2, $3, $4)`,
    [id, taken ? null : primary, identity.id, login],
  )
  return { id, created: true }
}

/**
 * The details a GitHub-joined person adds on the invite-only page. Their
 * email changes only when no other entry has it.
 */
export async function describeWaitlistEntry(
  tx: Tx,
  githubId: number,
  details: { email: string; teamName: string; teamSize: TeamSize | null; note: string | null },
): Promise<string | null> {
  await lock(tx)
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE platform.waitlist w SET
       email = CASE WHEN EXISTS (SELECT 1 FROM platform.waitlist o WHERE o.email = $2 AND o.id <> w.id) THEN w.email ELSE $2 END,
       team_name = $3, team_size = $4, note = $5, updated_at = now()
     WHERE github_id = $1 RETURNING id`,
    [githubId, details.email, details.teamName, details.teamSize, details.note],
  )
  return rows[0]?.id ?? null
}

/** The GitHub account's own entry, for the invite-only page. */
export async function waitlistEntryOf(tx: Tx, githubId: number): Promise<WaitlistEntry | null> {
  const { rows } = await tx.query<EntryRow>(`${ENTRY} WHERE w.github_id = $1`, [githubId])
  return rows[0] ? toEntry(rows[0]) : null
}

/** The whole list, newest first, for a platform admin. */
export async function listWaitlist(tx: Tx, options: { status?: 'waiting' | 'invited' } = {}): Promise<WaitlistEntry[]> {
  const { rows } = options.status
    ? await tx.query<EntryRow>(`${ENTRY} WHERE w.status = $1 ORDER BY w.created_at DESC, w.id`, [options.status])
    : await tx.query<EntryRow>(`${ENTRY} ORDER BY w.created_at DESC, w.id`)
  return rows.map(toEntry)
}

/**
 * Invites an entry into the beta: its verified GitHub account joins the
 * allowlist, the beta's existing invite (the account's next GitHub sign-in,
 * under any login, gets in). An entry from the form has no verified account until its person
 * signs in with GitHub (`joinWaitlistWithGitHub`), so it cannot be invited yet.
 */
export async function inviteFromWaitlist(tx: Tx, input: { id: string; invitedBy: string }): Promise<WaitlistEntry> {
  await lock(tx)
  const { rows } = await tx.query<{ github_id: string | null; github_login: string | null; status: string }>(
    'SELECT github_id, github_login, status FROM platform.waitlist WHERE id = $1 FOR UPDATE',
    [input.id],
  )
  const entry = rows[0]
  if (!entry) throw new TenancyError('not-found', 'That waitlist entry no longer exists.')
  if (entry.status === 'invited') throw new TenancyError('conflict', 'That entry is already invited.')
  if (entry.github_id === null || entry.github_login === null) {
    throw new TenancyError('conflict', 'That entry needs a GitHub sign-in before it can be invited.')
  }
  await allowlistAccount(tx, { id: Number(entry.github_id), login: entry.github_login }, 'invited from the waitlist')
  await tx.query(
    "UPDATE platform.waitlist SET status = 'invited', invited_at = now(), invited_by = $2, updated_at = now() WHERE id = $1",
    [input.id, input.invitedBy],
  )
  const invited = await tx.query<EntryRow>(`${ENTRY} WHERE w.id = $1`, [input.id])
  return toEntry(invited.rows[0] as EntryRow)
}

/**
 * At GitHub sign-in: an invited entry whose account signs in under a new login
 * takes that login, and the account is on the allowlist (the invite put it
 * there, keyed by its id). Returns whether the entry changed.
 */
export async function claimWaitlistInvite(tx: Tx, identity: GitHubIdentity): Promise<boolean> {
  const login = normaliseLogin(identity.login)
  if (!login) return false
  await lock(tx)
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE platform.waitlist SET github_login = $2, updated_at = now()
      WHERE status = 'invited' AND github_id = $1 AND github_login <> $2
      RETURNING id`,
    [identity.id, login],
  )
  if (!rows[0]) return false
  await allowlistAccount(tx, { id: identity.id, login }, 'invited from the waitlist, signed in under a new login')
  return true
}
