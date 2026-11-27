// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto'

import {
  PASSWORD_ISSUER,
  TenancyError,
  identityUser,
  normaliseEmail,
  normaliseOtherLogin,
  resolveIdentity,
  type Tx,
  type User,
} from '@docket/platform-tenancy'

/**
 * Password sign-in (§8.1): people the operator lists in the server's config,
 * each with a password read from a mounted file or a variable. Only a salted
 * scrypt hash is stored. The config is the list's source: the server makes
 * each listed user on its first start, sets their hash whenever their
 * password no longer matches it (so changing the secret and restarting is
 * the reset), and stops the password of anyone taken off the list. There is
 * no self-service registration: without verified email, a sign-up could
 * claim another person's invites.
 */

/** OWASP's scrypt parameters: N = 2^17, r = 8, p = 1 (128 MiB per hash). */
const PARAMS = { N: 2 ** 17, r: 8, p: 1 } as const
const KEY_LENGTH = 32
const MAX_PASSWORD = 1024
/** At least this long: a password the operator set for someone, not a PIN. */
export const MIN_PASSWORD = 12

function scrypt(password: string, salt: Buffer, length: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((done, fail) => scryptCallback(password, salt, length, options, (error, key) => (error ? fail(error) : done(key))))
}

const memoryFor = (N: number, r: number) => 128 * N * r * 2

/** `scrypt$<N>$<r>$<p>$<salt>$<hash>`, base64url. */
export async function hashPassword(password: string): Promise<string> {
  if (password.length > MAX_PASSWORD) throw new TenancyError('invalid', `a password is at most ${MAX_PASSWORD} characters`)
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: memoryFor(PARAMS.N, PARAMS.r) })
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$')
}

/** Whether the password matches the stored hash, in constant time; false for a hash it cannot read. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt' || password.length > MAX_PASSWORD) return false
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number]
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 2 ** 20 || r > 32 || p > 16) return false
  const salt = Buffer.from(parts[4] as string, 'base64url')
  const expected = Buffer.from(parts[5] as string, 'base64url')
  if (expected.length < 16) return false
  const key = await scrypt(password, salt, expected.length, { N, r, p, maxmem: memoryFor(N, r) })
  return timingSafeEqual(key, expected)
}

/** A hash no password matches, checked when the login is unknown so a miss takes as long as a wrong password. */
let decoy: Promise<string> | undefined

/** One password user as the config lists them. */
export interface PasswordUser {
  /** Not a GitHub login: it has a `.` or `_` (`jo.bloggs`, `ops_admin`). */
  login: string
  name: string | null
  email: string | null
  password: string
}

/**
 * Brings the password users in line with the config: each one made or
 * refreshed (name, email), their hash set when their password changed, and
 * the password of every password user no longer listed removed. Returns what
 * changed.
 */
export async function syncPasswordUsers(tx: Tx, users: readonly PasswordUser[]): Promise<{ created: string[]; reset: string[]; removed: string[] }> {
  const created: string[] = []
  const reset: string[] = []
  const listed: string[] = []
  for (const entry of users) {
    const login = normaliseOtherLogin(entry.login)
    if (!login) throw new TenancyError('invalid', `a password user's login has a "." or "_", so it is never a GitHub login: ${JSON.stringify(entry.login)}`)
    if (entry.password.length < MIN_PASSWORD) throw new TenancyError('invalid', `${login}'s password is shorter than ${MIN_PASSWORD} characters`)
    const email = entry.email === null ? null : normaliseEmail(entry.email)
    if (entry.email !== null && !email) throw new TenancyError('invalid', `${login}'s email is not an email address`)
    listed.push(login)
    const known = await identityUser(tx, { provider: 'password', issuer: PASSWORD_ISSUER, subject: login })
    // The operator vouches for the email they wrote, so it counts as verified: it can answer an invite.
    const user = await resolveIdentity(tx, { provider: 'password', issuer: PASSWORD_ISSUER, subject: login, login, name: entry.name, avatarUrl: null, emails: email ? [email] : [] })
    if (!known) created.push(login)
    const { rows } = await tx.query<{ hash: string }>('SELECT hash FROM platform.password_credentials WHERE user_id = $1', [user.id])
    const current = rows[0]?.hash
    if (current && (await verifyPassword(entry.password, current))) continue
    await tx.query(
      `INSERT INTO platform.password_credentials (user_id, hash) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET hash = EXCLUDED.hash, updated_at = now()`,
      [user.id, await hashPassword(entry.password)],
    )
    if (known) reset.push(login)
  }
  const { rows } = await tx.query<{ subject: string }>(
    `DELETE FROM platform.password_credentials c USING platform.identities i
      WHERE i.user_id = c.user_id AND i.provider = 'password' AND i.issuer = $1 AND NOT (i.subject = ANY($2::text[]))
      RETURNING i.subject`,
    [PASSWORD_ISSUER, listed],
  )
  return { created, reset, removed: rows.map((row) => row.subject) }
}

/** The user a login and password sign in as, or null: an unknown login and a wrong password look the same, and take as long. */
export async function passwordSignIn(tx: Tx, input: { login: string; password: string }): Promise<User | null> {
  const login = normaliseOtherLogin(input.login)
  const user = login ? await identityUser(tx, { provider: 'password', issuer: PASSWORD_ISSUER, subject: login }) : null
  const { rows } = user ? await tx.query<{ hash: string }>('SELECT hash FROM platform.password_credentials WHERE user_id = $1', [user.id]) : { rows: [] }
  const hash = rows[0]?.hash
  if (!user || !hash) {
    await verifyPassword(input.password, await (decoy ??= hashPassword(randomBytes(16).toString('hex'))))
    return null
  }
  if (!(await verifyPassword(input.password, hash))) return null
  await tx.query("UPDATE platform.identities SET last_seen_at = now() WHERE provider = 'password' AND issuer = $1 AND subject = $2", [PASSWORD_ISSUER, login])
  await tx.query('UPDATE platform.users SET last_seen_at = now() WHERE id = $1', [user.id])
  return user
}
