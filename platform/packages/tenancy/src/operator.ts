// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from './db.js'
import { LIMITS } from './limits.js'
import { TenancyError, type Org } from './model.js'

/**
 * The operator console's view of the platform (tenancy v2 §3.5, phase 6.3):
 * every account, and what the platform operator may change about one -
 * suspend it, resume it, and set its own limits on seats and dockets in place
 * of the beta's. Nothing here reads an account's content: no docket, no
 * document, no name inside the account but its own and its owners'. Every
 * function runs inside a `withPlatform` transaction.
 */

export interface AccountLimits {
  /** Seats: people, system accounts and open invites. Null: the beta's. */
  maxMembers: number | null
  /** Dockets. Null: the beta's. */
  maxDockets: number | null
}

/** What a limit is when the operator set none. */
export const DEFAULT_ACCOUNT_LIMITS = { maxMembers: LIMITS.membersPerOrg, maxDockets: LIMITS.workspacesPerOrg } as const

export interface OperatorAccount {
  id: string
  slug: string
  name: string
  status: Org['status']
  createdAt: Date
  /** Its owners' logins. */
  owners: string[]
  /** People in it, guests included. */
  people: number
  systemAccounts: number
  openInvites: number
  limits: AccountLimits
  suspended: { at: Date; by: string | null; reason: string | null } | null
}

type Row = {
  id: string
  slug: string
  name: string
  status: Org['status']
  created_at: Date
  owners: string[]
  people: string
  system_accounts: string
  open_invites: string
  max_members: number | null
  max_dockets: number | null
  suspended_at: Date | null
  suspended_by_login: string | null
  suspended_reason: string | null
}

const COLUMNS = `o.id, o.slug, o.name, o.status, o.created_at, o.max_members, o.max_dockets, o.suspended_at, o.suspended_reason,
  sb.login AS suspended_by_login,
  coalesce((SELECT array_agg(u.login ORDER BY u.login) FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id
             WHERE m.org_id = o.id AND m.owner), '{}') AS owners,
  (SELECT count(*) FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id WHERE m.org_id = o.id AND u.kind = 'human') AS people,
  (SELECT count(*) FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id WHERE m.org_id = o.id AND u.kind = 'service') AS system_accounts,
  (SELECT count(*) FROM platform.invites i WHERE i.org_id = o.id AND i.accepted_at IS NULL AND i.declined_at IS NULL
      AND i.revoked_at IS NULL AND i.expires_at > now()) AS open_invites`

const toAccount = (row: Row): OperatorAccount => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  status: row.status,
  createdAt: row.created_at,
  owners: row.owners,
  people: Number(row.people),
  systemAccounts: Number(row.system_accounts),
  openInvites: Number(row.open_invites),
  limits: { maxMembers: row.max_members, maxDockets: row.max_dockets },
  suspended: row.suspended_at ? { at: row.suspended_at, by: row.suspended_by_login, reason: row.suspended_reason } : null,
})

/** Every account on the platform that has not been deleted, newest first. */
export async function operatorAccounts(tx: Tx): Promise<OperatorAccount[]> {
  const { rows } = await tx.query<Row>(
    `SELECT ${COLUMNS} FROM platform.orgs o LEFT JOIN platform.users sb ON sb.id = o.suspended_by
      WHERE o.status <> 'deleted' ORDER BY o.created_at DESC, o.slug`,
  )
  return rows.map(toAccount)
}

/** One account, by its address. */
export async function operatorAccount(tx: Tx, slug: string): Promise<OperatorAccount | null> {
  const { rows } = await tx.query<Row>(
    `SELECT ${COLUMNS} FROM platform.orgs o LEFT JOIN platform.users sb ON sb.id = o.suspended_by
      WHERE o.slug = $1 AND o.status <> 'deleted'`,
    [slug],
  )
  return rows[0] ? toAccount(rows[0]) : null
}

/**
 * Suspends an active account, or resumes a suspended one. A suspended
 * account is not served: its pages, API, MCP addresses, tokens and
 * connections answer as if it did not exist, and its data stays as it was.
 * Returns the status it had.
 */
export async function setAccountSuspended(
  tx: Tx,
  input: { orgId: string; suspended: boolean; reason?: string | null; by: string },
): Promise<Org['status']> {
  const { rows } = await tx.query<{ status: Org['status'] }>('SELECT status FROM platform.orgs WHERE id = $1 FOR UPDATE', [input.orgId])
  const was = rows[0]?.status
  if (!was || was === 'deleted') throw new TenancyError('not-found', 'No such account.')
  if (was === 'provisioning') throw new TenancyError('conflict', 'That account is still being set up.')
  if (input.suspended) {
    const reason = input.reason?.trim() || null
    if (reason && reason.length > 300) throw new TenancyError('invalid', 'Say why in at most 300 characters.')
    if (was === 'active') {
      await tx.query(
        "UPDATE platform.orgs SET status = 'suspended', suspended_at = now(), suspended_by = $2, suspended_reason = $3 WHERE id = $1",
        [input.orgId, input.by, reason],
      )
    }
  } else if (was === 'suspended') {
    await tx.query("UPDATE platform.orgs SET status = 'active', suspended_at = NULL, suspended_by = NULL, suspended_reason = NULL WHERE id = $1", [input.orgId])
  }
  return was
}

/** A limit as a form or a request gives it: a whole number in range, or null for the beta's. */
function limitOf(value: number | null | undefined, max: number, what: string): number | null | undefined {
  if (value === undefined || value === null) return value
  if (!Number.isInteger(value) || value < 1 || value > max) throw new TenancyError('invalid', `${what} is a whole number from 1 to ${max}, or blank for the beta's.`)
  return value
}

/**
 * Sets an account's own limits, in place of the beta's; null puts the beta's
 * back, and a limit left out stays. Lowering one below what the account
 * already holds keeps everything it has and refuses anything new.
 */
export async function setAccountLimits(tx: Tx, input: { orgId: string; maxMembers?: number | null; maxDockets?: number | null }): Promise<AccountLimits> {
  const maxMembers = limitOf(input.maxMembers, 10_000, 'Seats')
  const maxDockets = limitOf(input.maxDockets, 1_000, 'Dockets')
  const { rows } = await tx.query<{ max_members: number | null; max_dockets: number | null }>(
    `UPDATE platform.orgs SET
       max_members = CASE WHEN $2 THEN $3::integer ELSE max_members END,
       max_dockets = CASE WHEN $4 THEN $5::integer ELSE max_dockets END
     WHERE id = $1 AND status <> 'deleted'
     RETURNING max_members, max_dockets`,
    [input.orgId, maxMembers !== undefined, maxMembers ?? null, maxDockets !== undefined, maxDockets ?? null],
  )
  if (!rows[0]) throw new TenancyError('not-found', 'No such account.')
  return { maxMembers: rows[0].max_members, maxDockets: rows[0].max_dockets }
}

/** The account's limits as they apply: its own, or the beta's. */
export async function accountLimits(tx: Tx, orgId: string): Promise<{ maxMembers: number; maxDockets: number }> {
  const { rows } = await tx.query<{ max_members: number | null; max_dockets: number | null }>('SELECT max_members, max_dockets FROM platform.orgs WHERE id = $1', [orgId])
  return { maxMembers: rows[0]?.max_members ?? DEFAULT_ACCOUNT_LIMITS.maxMembers, maxDockets: rows[0]?.max_dockets ?? DEFAULT_ACCOUNT_LIMITS.maxDockets }
}
