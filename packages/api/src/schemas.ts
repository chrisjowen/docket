import { z } from 'zod'

/**
 * The records `/api/v1` reads and writes, as JSON on the wire: snake_case
 * fields, ISO 8601 timestamps, and spaces, dockets and people named by their
 * slugs and logins, with their ids alongside.
 */

/** The capabilities, the only permission vocabulary there is (tenancy v2 §3.1), in the order the UI lists them. */
export const CAPABILITIES = ['read', 'write', 'propose', 'publish', 'decide', 'create', 'access', 'system', 'tokens', 'settings', 'delete', 'audit'] as const
export type Capability = (typeof CAPABILITIES)[number]
export const Capability = z.enum(CAPABILITIES)

const timestamp = z.iso.datetime({ offset: true })
const slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, 'a slug: 1-40 lowercase letters, digits and hyphens')

/**
 * A place, as a request names it: the whole account, a space or a docket,
 * by slug. `account`, `space:engineering` or `docket:payments`.
 */
export const PlaceRef = z
  .string()
  .regex(/^(?:account|space:[a-z0-9-]{1,40}|docket:[a-z0-9-]{1,40})$/, 'account, space:<slug> or docket:<slug>')
  .describe('account, space:<slug> or docket:<slug>')

/** A place, as a response shows it. */
export const Place = z.object({
  kind: z.enum(['account', 'space', 'docket']),
  /** Null for the account. */
  id: z.string().nullable(),
  slug: z.string().nullable(),
  name: z.string(),
  /** The place as a request names it. */
  ref: z.string(),
})

/** Who a grant or invite is for, as a request names them: `everyone`, or a member's login or id. */
export const GranteeRef = z.string().min(1).max(80).describe('everyone, or a member: a login, a system account name or a user id')

export const Grantee = z.union([
  z.object({ kind: z.literal('everyone'), name: z.string() }),
  z.object({ kind: z.enum(['user', 'system']), id: z.string(), login: z.string(), name: z.string().nullable(), guest: z.boolean() }),
])

export const RoleRef = z.object({ id: z.string(), name: z.string() })

export const Role = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  caps: z.array(Capability),
  builtin: z.boolean(),
  /** How many grants give it. */
  grants: z.number().int(),
})

export const Grant = z.object({
  id: z.string(),
  who: Grantee,
  place: Place,
  role: RoleRef,
  add: z.array(Capability),
  remove: z.array(Capability),
  /** What it gives: the role's capabilities, plus `add`, minus `remove`. */
  caps: z.array(Capability),
  /** How it reads: "Writer + Publish ontology changes". */
  label: z.string(),
  granted_by: z.string().nullable(),
  created_at: timestamp,
  /** Whether the caller may change or remove it. */
  may_change: z.boolean(),
})

export const Account = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  owner: z.boolean(),
  guest: z.boolean(),
  /** What the caller may do on the whole account. */
  caps: z.array(Capability),
  /** The account's MCP address: one for all its dockets, with a `docket` argument. */
  mcp_url: z.string(),
})

export const Space = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  general: z.boolean(),
  /** What the caller may do on the space. */
  caps: z.array(Capability),
})

export const DocketRef = z.object({ id: z.string(), slug: z.string(), name: z.string() })

export const Docket = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  space: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  /** What the caller may do on the docket. */
  caps: z.array(Capability),
  created_at: timestamp,
  /** The docket's own ("pinned") MCP address. */
  mcp_url: z.string(),
})

export const Member = z.object({
  id: z.string(),
  login: z.string(),
  name: z.string().nullable(),
  kind: z.enum(['human', 'service']),
  owner: z.boolean(),
  guest: z.boolean(),
  /** How their access reads across the account: Owner, a role on the account, "Writer on General"... */
  role: z.string(),
  joined_at: timestamp,
})

export const Invite = z.object({
  id: z.string(),
  /** The GitHub login or the email address it is for. */
  to: z.string(),
  role: RoleRef,
  place: Place,
  guest: z.boolean(),
  owner: z.boolean(),
  invited_by: z.string(),
  created_at: timestamp,
  expires_at: timestamp,
})

export const SystemAccount = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Made and managed by the org admin API: shown, never changed here. */
  managed: z.boolean(),
  live_tokens: z.number().int(),
  last_used_at: timestamp.nullable(),
  next_expiry: timestamp.nullable(),
  created_at: timestamp,
  created_by: z.string().nullable(),
  grants: z.array(Grant),
})

export const Token = z.object({
  id: z.string(),
  prefix: z.string(),
  name: z.string().nullable(),
  /** `@login` for a person, the name for a system account. */
  owner: z.string(),
  owner_kind: z.enum(['human', 'service']),
  read_only: z.boolean(),
  /** The dockets it reaches; null: every docket its owner reaches. */
  dockets: z.array(DocketRef).nullable(),
  created_at: timestamp,
  expires_at: timestamp,
  last_used_at: timestamp.nullable(),
  status: z.enum(['live', 'revoked', 'expired']),
})

/** A token just issued: its text, shown this once. */
export const IssuedToken = z.object({
  id: z.string(),
  prefix: z.string(),
  token: z.string(),
  read_only: z.boolean(),
  expires_at: timestamp,
})

export const Connection = z.object({
  id: z.string(),
  name: z.string(),
  client: z.string(),
  client_id: z.string(),
  read_only: z.boolean(),
  dockets: z.array(DocketRef).nullable(),
  created_at: timestamp,
  last_used_at: timestamp.nullable(),
  expires_at: timestamp.nullable(),
})

export const AuditEvent = z.object({
  at: timestamp,
  actor: z.string(),
  action: z.string(),
  outcome: z.enum(['ok', 'denied', 'error', 'invalid']),
  docket: z.string().nullable(),
  target: z.array(z.string()),
  request_id: z.string().nullable(),
})

export const Usage = z.object({
  dockets: z.number().int(),
  spaces: z.number().int(),
  members: z.number().int(),
  system_accounts: z.number().int(),
  live_tokens: z.number().int(),
  calls_30d: z.number().int(),
})

/** What the caller may do on a place, and the grants that say so. */
export const AccessExplained = z.object({
  place: Place,
  owner: z.boolean(),
  caps: z.array(Capability),
  /** "Writer on Engineering (space), given to everyone" */
  because: z.array(z.string()),
})

/** Who is calling, and through what. */
export const Me = z.object({
  user: z.object({ id: z.string(), login: z.string(), name: z.string().nullable(), kind: z.enum(['human', 'service']) }),
  /** How the request authenticated. */
  via: z.enum(['session', 'token', 'oauth']),
  /** The session's CSRF token, which every mutation it makes sends as `X-CSRF-Token`; null for a bearer. */
  csrf: z.string().nullable(),
  /** The token or connection, for a bearer. */
  credential: z
    .object({ id: z.string(), name: z.string().nullable(), read_only: z.boolean(), dockets: z.array(z.string()).nullable(), account: z.string() })
    .nullable(),
  /** May create accounts (on the beta list). */
  allowlisted: z.boolean(),
  accounts: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string(), owner: z.boolean(), guest: z.boolean() })),
})

export const SLUG = slug

/** The error every `/api/v1` refusal answers with. */
export const API_ERROR_CODES = [
  'invalid_request',
  'unauthenticated',
  'invalid_token',
  'csrf',
  'forbidden',
  'read_only',
  'not_found',
  'method_not_allowed',
  'conflict',
  'rate_limited',
  'server_error',
] as const
export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export const ApiError = z.object({
  error: z.enum(API_ERROR_CODES),
  error_description: z.string(),
  request_id: z.string(),
  /** For `invalid_request`: what in the request was wrong, by path. */
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
})
export type ApiError = z.infer<typeof ApiError>

/** The HTTP status each error code answers with. */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  invalid_token: 401,
  csrf: 403,
  forbidden: 403,
  read_only: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  rate_limited: 429,
  server_error: 500,
}
