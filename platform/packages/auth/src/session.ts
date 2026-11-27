// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from 'node:crypto'

import type { Tx } from '@docket/platform-tenancy'

/** Idle timeout 7 days, absolute timeout 30 days (§8.1). */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000
/** `last_seen_at` is written at most this often, so reads stay cheap. */
const TOUCH_EVERY_MS = 60 * 1000

export const SESSION_COOKIE = 'docket_session'

/** An opaque, unguessable id: 32 random bytes. Only its SHA-256 reaches the database. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export interface Session {
  userId: string
  createdAt: Date
  expiresAt: Date
}

export async function createSession(
  tx: Tx,
  input: { userId: string; ip: string | null; userAgent: string | null; now?: Date },
): Promise<{ id: string; expiresAt: Date }> {
  const id = newSecret()
  const now = input.now ?? new Date()
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS)
  await tx.query(
    `INSERT INTO platform.sessions (id_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $3, $4, $5, $6)`,
    [hashSecret(id), input.userId, now, expiresAt, input.ip, input.userAgent?.slice(0, 512) ?? null],
  )
  return { id, expiresAt }
}

/** The live session behind a cookie: not revoked, not idle for 7 days, not older than 30. */
export async function readSession(tx: Tx, id: string, now: Date = new Date()): Promise<Session | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return null
  const { rows } = await tx.query<{ user_id: string; created_at: Date; last_seen_at: Date; expires_at: Date }>(
    `SELECT user_id, created_at, last_seen_at, expires_at FROM platform.sessions
      WHERE id_hash = $1 AND revoked_at IS NULL`,
    [hashSecret(id)],
  )
  const row = rows[0]
  if (!row) return null
  if (row.expires_at <= now || now.getTime() - row.last_seen_at.getTime() >= SESSION_IDLE_MS) return null
  if (now.getTime() - row.last_seen_at.getTime() >= TOUCH_EVERY_MS) {
    await tx.query('UPDATE platform.sessions SET last_seen_at = $2 WHERE id_hash = $1', [hashSecret(id), now])
    await tx.query('UPDATE platform.users SET last_seen_at = $2 WHERE id = $1', [row.user_id, now])
  }
  return { userId: row.user_id, createdAt: row.created_at, expiresAt: row.expires_at }
}

export async function revokeSession(tx: Tx, id: string): Promise<void> {
  await tx.query('UPDATE platform.sessions SET revoked_at = now() WHERE id_hash = $1 AND revoked_at IS NULL', [
    hashSecret(id),
  ])
}

/** `HttpOnly; Secure; SameSite=Lax` (§8.1). `secure` is false only for a plain-HTTP local preview. */
export function sessionCookieOptions(input: { secure: boolean; expiresAt: Date }) {
  return {
    path: '/',
    httpOnly: true,
    secure: input.secure,
    sameSite: 'lax' as const,
    expires: input.expiresAt,
  }
}
