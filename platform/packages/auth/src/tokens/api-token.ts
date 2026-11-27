// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from 'node:crypto'
import { crc32 } from 'node:zlib'

import { namespaceAccess, newTenantId, type Role, type Tx } from '@docket/platform-tenancy'

import { SCOPES, impliedScopes, isScope, namespaceScopes, type Scope } from '../scopes.js'

/**
 * API tokens for headless agents and CI (§8.3):
 * `dkt_live_<32 random bytes in base62>_<crc32 in hex>`. The prefix lets
 * GitHub secret scanning and the cloud recognise a leaked token; the checksum
 * turns a mistyped token away before any database lookup. Only the SHA-256 of
 * a token is stored, and it is shown once.
 */
export const TOKEN_PREFIX = 'dkt_live_'
const BODY_LENGTH = 43
const TOKEN = /^dkt_live_([0-9A-Za-z]{43})_([0-9a-f]{8})$/
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** Expiry is required: 30 days unless asked, at most 90 (§8.3). */
export const DEFAULT_TOKEN_DAYS = 30
export const MAX_TOKEN_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

export class ApiTokenError extends Error {
  override name = 'ApiTokenError'
  constructor(
    readonly code: 'invalid' | 'forbidden',
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

const checksum = (body: string) => crc32(`${TOKEN_PREFIX}${body}`).toString(16).padStart(8, '0')

/** The SHA-256 a token is stored and looked up as. */
export function tokenHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** A fresh token's text. */
export function newApiToken(): string {
  const body = base62(randomBytes(32))
  return `${TOKEN_PREFIX}${body}_${checksum(body)}`
}

/**
 * Reads a token without touching the database: `ok` is false for anything
 * that is not a well-formed token with a matching checksum. `prefix` is what
 * the UI and the audit log name it by (`dkt_live_` and 8 more characters).
 */
export function parseApiToken(raw: string): { prefix: string; ok: boolean } {
  const match = TOKEN.exec(raw)
  if (!match) return { prefix: raw.startsWith(TOKEN_PREFIX) ? raw.slice(0, TOKEN_PREFIX.length + 8) : '', ok: false }
  const body = match[1] as string
  return { prefix: `${TOKEN_PREFIX}${body.slice(0, 8)}`, ok: match[2] === checksum(body) }
}

export interface IssueApiTokenInput {
  orgId: string
  workspaceId: string
  /** The member the token acts as: the creator, or a service account. */
  ownerId: string
  createdBy: string
  scopes: readonly string[]
  /**
   * The roles the workspace lets change its ontology over MCP: a token
   * carries `ontology:write` only when its owner's role is one of them.
   */
  ontologyWriters?: readonly Role[]
  /** Days until it expires: 1 to 90, default 30. */
  expiresInDays?: number
  description?: string | null
  now?: Date
}

/**
 * Issues a token bound to one workspace (§8.3). Its scopes must fit the
 * owner's permission on that workspace now: Read access gives read-only
 * tokens, and an owner with no access there gets none (§4; tenancy design
 * §5.1). Runs in a `withPlatform` transaction; the caller checks the creator
 * may create it and writes the audit event. The token's text is returned once
 * and never stored.
 */
export async function issueApiToken(tx: Tx, input: IssueApiTokenInput): Promise<{ token: string; id: string; prefix: string; expiresAt: Date }> {
  const asked = [...new Set(input.scopes)]
  if (asked.length === 0) throw new ApiTokenError('invalid', 'Choose at least one scope.')
  const unknown = asked.filter((scope) => !isScope(scope))
  if (unknown.length) throw new ApiTokenError('invalid', `Unknown scope ${unknown.join(', ')}; the scopes are ${SCOPES.join(', ')}.`)
  const days = input.expiresInDays ?? DEFAULT_TOKEN_DAYS
  if (!Number.isInteger(days) || days < 1 || days > MAX_TOKEN_DAYS) {
    throw new ApiTokenError('invalid', `A token expires in 1 to ${MAX_TOKEN_DAYS} days.`)
  }
  const description = input.description?.trim() || null
  if (description && description.length > 200) throw new ApiTokenError('invalid', 'Keep the description under 200 characters.')

  const access = await namespaceAccess(tx, input.orgId, input.workspaceId, input.ownerId)
  if (access === null) throw new ApiTokenError('forbidden', 'The token owner is not a member of this organisation.')
  if (access.permission === null) throw new ApiTokenError('forbidden', 'The token owner has no access to this workspace.')
  const allowed = new Set(namespaceScopes(access, input.ontologyWriters))
  const scopes = impliedScopes(asked as Scope[])
  const beyond = scopes.filter((scope) => !allowed.has(scope))
  if (beyond.length) {
    const why = beyond.includes('ontology:write') && access.permission !== 'read' ? ` here: this workspace's settings do not let the ${access.role} role change the ontology over MCP` : ''
    throw new ApiTokenError('forbidden', `A token with ${access.permission} access to this workspace cannot carry ${beyond.join(', ')}${why}.`)
  }

  const token = newApiToken()
  const { prefix } = parseApiToken(token)
  const id = `tok_${newTenantId()}`
  const now = input.now ?? new Date()
  const expiresAt = new Date(now.getTime() + days * DAY_MS)
  await tx.query(
    `INSERT INTO platform.api_tokens (id, token_hash, prefix, org_id, workspace_id, owner_id, scopes, description,
                                      created_by, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, tokenHash(token), prefix, input.orgId, input.workspaceId, input.ownerId, scopes, description, input.createdBy, now, expiresAt],
  )
  return { token, id, prefix, expiresAt }
}

export interface ApiTokenRecord {
  id: string
  prefix: string
  workspaceId: string
  ownerId: string
  ownerLogin: string
  ownerKind: 'human' | 'service'
  scopes: Scope[]
  description: string | null
  createdBy: string
  createdAt: Date
  expiresAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}

/** A workspace's tokens, newest first; `ownerId` narrows them to one member's. Never the token text. */
export async function listApiTokens(
  tx: Tx,
  input: { orgId: string; workspaceId: string; ownerId?: string; all?: boolean },
): Promise<ApiTokenRecord[]> {
  const { rows } = await tx.query<{
    id: string
    prefix: string
    workspace_id: string
    owner_id: string
    login: string
    kind: 'human' | 'service'
    scopes: string[]
    description: string | null
    created_by: string
    created_at: Date
    expires_at: Date
    last_used_at: Date | null
    revoked_at: Date | null
  }>(
    `SELECT t.id, t.prefix, t.workspace_id, t.owner_id, u.login, u.kind, t.scopes, t.description, t.created_by,
            t.created_at, t.expires_at, t.last_used_at, t.revoked_at
       FROM platform.api_tokens t JOIN platform.users u ON u.id = t.owner_id
      WHERE t.org_id = $1 AND t.workspace_id = $2 AND ($3::text IS NULL OR t.owner_id = $3)
      ORDER BY t.created_at DESC${input.all ? '' : ' LIMIT 200'}`,
    [input.orgId, input.workspaceId, input.ownerId ?? null],
  )
  return rows.map((row) => ({
    id: row.id,
    prefix: row.prefix,
    workspaceId: row.workspace_id,
    ownerId: row.owner_id,
    ownerLogin: row.login,
    ownerKind: row.kind,
    scopes: row.scopes.filter(isScope),
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }))
}
