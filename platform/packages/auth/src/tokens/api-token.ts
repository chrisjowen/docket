// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from 'node:crypto'
import { crc32 } from 'node:zlib'

import { namespaceAccess, newTenantId, type Tx } from '@docket/platform-tenancy'

import { SCOPES, credentialScopes, impliedScopes, isScope, type Scope } from '../scopes.js'

/**
 * API tokens for headless agents and CI (§8.3; tenancy v2 §3.4):
 * `dkt_pat_<32 random bytes in base62>_<crc32 in hex>` for a person's own
 * token, `dkt_sys_...` for a system account's. Tokens issued before the two
 * kinds, `dkt_live_...`, keep working. The prefix lets GitHub secret scanning
 * and the server recognise a leaked token; the checksum turns a mistyped token
 * away before any database lookup. Only the SHA-256 of a token is stored, and
 * it is shown once.
 *
 * A token acts as its owner, narrowed: read-only, and/or to some dockets. It
 * never does more than its owner can do on the docket at the moment of each
 * call, and it carries no scopes to choose.
 */
export const TOKEN_PREFIXES = { personal: 'dkt_pat_', system: 'dkt_sys_', legacy: 'dkt_live_' } as const
export type TokenKind = keyof typeof TOKEN_PREFIXES
/** The prefix every token of this server starts with, whichever its kind. */
export const TOKEN_PREFIX = 'dkt_'
const BODY_LENGTH = 43
const TOKEN = /^(dkt_(?:pat|sys|live)_)([0-9A-Za-z]{43})_([0-9a-f]{8})$/
const KNOWN_PREFIX = /^dkt_(?:pat|sys|live)_/
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** Expiry is required: 30 days unless asked, at most 90 for a person's token and a year for a system account's. */
export const DEFAULT_TOKEN_DAYS = 30
export const MAX_TOKEN_DAYS = 90
export const DEFAULT_SYSTEM_TOKEN_DAYS = 90
export const MAX_SYSTEM_TOKEN_DAYS = 365
const DAY_MS = 24 * 60 * 60 * 1000

export class ApiTokenError extends Error {
  override name = 'ApiTokenError'
  constructor(
    readonly code: 'invalid' | 'forbidden' | 'not-found',
    message: string,
  ) {
    super(message)
  }
}

/** 32 bytes as 43 base62 digits, most significant first, zero-padded. */
function base62(bytes: Buffer): string {
  let value = BigInt(`0x${bytes.toString('hex')}`)
  let text = ''
  while (value > 0n) {
    text = (BASE62[Number(value % 62n)] as string) + text
    value /= 62n
  }
  return text.padStart(BODY_LENGTH, '0')
}

const checksum = (prefix: string, body: string) => crc32(`${prefix}${body}`).toString(16).padStart(8, '0')

/** Whether text looks like one of this server's API tokens, well formed or not: what lookups and redaction go by. */
export function isApiTokenText(raw: string): boolean {
  return KNOWN_PREFIX.test(raw)
}

/** The SHA-256 a token is stored and looked up as. */
export function tokenHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** A fresh token's text: a person's (`dkt_pat_`) unless asked for a system account's. */
export function newApiToken(kind: Exclude<TokenKind, 'legacy'> = 'personal'): string {
  const prefix = TOKEN_PREFIXES[kind]
  const body = base62(randomBytes(32))
  return `${prefix}${body}_${checksum(prefix, body)}`
}

/**
 * Reads a token without touching the database: `ok` is false for anything
 * that is not a well-formed token with a matching checksum. `prefix` is what
 * the UI and the audit log name it by (its kind's prefix and 8 more characters).
 */
export function parseApiToken(raw: string): { prefix: string; ok: boolean } {
  const match = TOKEN.exec(raw)
  if (!match) {
    const known = KNOWN_PREFIX.exec(raw)?.[0]
    return { prefix: known ? raw.slice(0, known.length + 8) : '', ok: false }
  }
  const prefix = match[1] as string
  const body = match[2] as string
  return { prefix: `${prefix}${body.slice(0, 8)}`, ok: match[3] === checksum(prefix, body) }
}

/** A token's name: what the UI, its audit entries and the evidence it files call it. */
export function tokenName(value: string | null | undefined): string | null {
  // eslint-disable-next-line no-control-regex
  const name = (value ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (name.length > 200) throw new ApiTokenError('invalid', 'Keep the name under 200 characters.')
  return name || null
}

export interface IssueApiTokenInput {
  orgId: string
  /** The member or system account the token acts as. */
  ownerId: string
  createdBy: string
  /** Reads only, whatever its owner may do. */
  readOnly?: boolean
  /** The dockets it reaches, by workspace id; null or absent: every docket its owner reaches. */
  dockets?: readonly string[] | null
  /**
   * A ceiling of the scopes an older API spoke in (the CLI's and the org
   * admin API's), kept when read-only cannot say the same.
   */
  legacyScopes?: readonly Scope[] | null
  /** Days until it expires: 1 to 90 for a person's token (default 30), 1 to 365 for a system account's (default 90). */
  expiresInDays?: number
  name?: string | null
  now?: Date
}

/**
 * Issues a token (tenancy v2 §3.4). Its owner must be a member of the org and,
 * when it names dockets, reach each of them now. It acts as its owner from
 * then on, narrowed as asked, so it needs no scopes. Runs in a `withPlatform`
 * transaction; the caller checks the creator may create it and writes the
 * audit event. The token's text is returned once and never stored.
 */
export async function issueApiToken(
  tx: Tx,
  input: IssueApiTokenInput,
): Promise<{ token: string; id: string; prefix: string; expiresAt: Date; kind: Exclude<TokenKind, 'legacy'>; readOnly: boolean }> {
  const { rows: owners } = await tx.query<{ kind: 'human' | 'service' }>(
    `SELECT u.kind FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id WHERE m.org_id = $1 AND m.user_id = $2`,
    [input.orgId, input.ownerId],
  )
  const owner = owners[0]
  if (!owner) throw new ApiTokenError('forbidden', 'The token owner is not a member of this organisation.')
  const kind = owner.kind === 'service' ? 'system' : 'personal'
  const [fallback, most] = kind === 'system' ? [DEFAULT_SYSTEM_TOKEN_DAYS, MAX_SYSTEM_TOKEN_DAYS] : [DEFAULT_TOKEN_DAYS, MAX_TOKEN_DAYS]
  const days = input.expiresInDays ?? fallback
  if (!Number.isInteger(days) || days < 1 || days > most) {
    throw new ApiTokenError('invalid', `A ${kind === 'system' ? "system account's" : 'personal'} token expires in 1 to ${most} days.`)
  }
  const name = tokenName(input.name)
  const legacy = input.legacyScopes ? impliedScopes(input.legacyScopes) : null
  if (legacy && (legacy.length === 0 || !legacy.every(isScope))) throw new ApiTokenError('invalid', `Scopes are ${SCOPES.join(', ')}.`)

  const dockets = input.dockets ? [...new Set(input.dockets)] : null
  if (dockets && dockets.length === 0) throw new ApiTokenError('invalid', 'Choose at least one docket, or every docket.')
  let readOnly = input.readOnly ?? false
  for (const docket of dockets ?? []) {
    const access = await namespaceAccess(tx, input.orgId, docket, input.ownerId)
    if (!access?.permission) throw new ApiTokenError('forbidden', 'The token owner has no access to one of those dockets.')
    if (access.permission === 'read') readOnly = true
  }
  if (legacy && credentialScopes({ readOnly, legacy }).length === 0) {
    throw new ApiTokenError('invalid', 'A token must be able to read.')
  }

  const token = newApiToken(kind)
  const { prefix } = parseApiToken(token)
  const id = `tok_${newTenantId()}`
  const now = input.now ?? new Date()
  const expiresAt = new Date(now.getTime() + days * DAY_MS)
  await tx.query(
    `INSERT INTO platform.api_tokens (id, token_hash, prefix, org_id, owner_id, read_only, dockets, legacy_scopes, description,
                                      created_by, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, tokenHash(token), prefix, input.orgId, input.ownerId, readOnly, dockets, legacy, name, input.createdBy, now, expiresAt],
  )
  return { token, id, prefix, expiresAt, kind, readOnly }
}

export interface ApiTokenRecord {
  id: string
  prefix: string
  /** The dockets it reaches, by workspace id; null: every docket its owner reaches. */
  dockets: string[] | null
  readOnly: boolean
  ownerId: string
  ownerLogin: string
  ownerKind: 'human' | 'service'
  /** The most it can do, in the scopes MCP's tools are checked against: read-only and any legacy ceiling, applied. */
  scopes: Scope[]
  /** Its name (stored as its description). */
  description: string | null
  createdBy: string
  createdAt: Date
  expiresAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}

type TokenRow = {
  id: string
  prefix: string
  dockets: string[] | null
  read_only: boolean
  legacy_scopes: string[] | null
  owner_id: string
  login: string
  kind: 'human' | 'service'
  description: string | null
  created_by: string
  created_at: Date
  expires_at: Date
  last_used_at: Date | null
  revoked_at: Date | null
}

const record = (row: TokenRow): ApiTokenRecord => ({
  id: row.id,
  prefix: row.prefix,
  dockets: row.dockets,
  readOnly: row.read_only,
  ownerId: row.owner_id,
  ownerLogin: row.login,
  ownerKind: row.kind,
  scopes: credentialScopes({ readOnly: row.read_only, legacy: row.legacy_scopes }),
  description: row.description,
  createdBy: row.created_by,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at,
})

/**
 * An org's tokens, newest first, never their text. `workspaceId` keeps those
 * that reach that docket (named on it, or reaching every docket: then their
 * owner's own access decides); `pinnedTo` only those named on that one
 * docket alone; `ownerId` one member's or system account's.
 */
export async function listApiTokens(
  tx: Tx,
  input: { orgId: string; workspaceId?: string; pinnedTo?: string; ownerId?: string; all?: boolean },
): Promise<ApiTokenRecord[]> {
  const { rows } = await tx.query<TokenRow>(
    `SELECT t.id, t.prefix, t.dockets, t.read_only, t.legacy_scopes, t.owner_id, u.login, u.kind, t.description, t.created_by,
            t.created_at, t.expires_at, t.last_used_at, t.revoked_at
       FROM platform.api_tokens t JOIN platform.users u ON u.id = t.owner_id
      WHERE t.org_id = $1 AND ($2::text IS NULL OR t.dockets IS NULL OR $2 = ANY (t.dockets))
        AND ($3::text IS NULL OR t.dockets = ARRAY[$3]) AND ($4::text IS NULL OR t.owner_id = $4)
      ORDER BY t.created_at DESC${input.all ? '' : ' LIMIT 200'}`,
    [input.orgId, input.workspaceId ?? null, input.pinnedTo ?? null, input.ownerId ?? null],
  )
  return rows.map(record)
}

/** Renames a live token; `ownerId` limits it to that owner's. Returns its prefix and its name before. */
export async function renameApiToken(
  tx: Tx,
  input: { orgId: string; tokenId: string; name: string; ownerId?: string },
): Promise<{ prefix: string; before: string | null; after: string | null }> {
  const name = tokenName(input.name)
  const { rows } = await tx.query<{ prefix: string; before: string | null }>(
    `UPDATE platform.api_tokens t SET description = $3
       FROM (SELECT id, description FROM platform.api_tokens WHERE id = $1 FOR UPDATE) old
      WHERE t.id = old.id AND t.org_id = $2 AND t.revoked_at IS NULL AND ($4::text IS NULL OR t.owner_id = $4)
      RETURNING t.prefix, old.description AS before`,
    [input.tokenId, input.orgId, name, input.ownerId ?? null],
  )
  const row = rows[0]
  if (!row) throw new ApiTokenError('not-found', 'No such live token.')
  return { prefix: row.prefix, before: row.before, after: name }
}
