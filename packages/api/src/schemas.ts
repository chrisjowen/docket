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
  /** Whether its email was delivered; false when none was, or it was sent again since. */
  emailed: z.boolean(),
  /** The address it was emailed to, when it was made for one; null for a GitHub login, whose address on file is never shown. */
  emailed_to: z.string().nullable(),
})

/**
 * An invite as made or sent again: with its link, which works once, for 7
 * days, and is shown only now (and in its email). Never returned over MCP.
 */
export const IssuedInvite = Invite.extend({
  link: z.string().describe('The invite link: /invite/dki_…; whoever opens it signs in and accepts'),
})

/**
 * An account as the platform operator sees it (operator console): who owns
 * it, how many people, system accounts and open invites it has, its limits
 * and whether it is suspended. Never anything of its content.
 */
export const OperatorAccount = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['provisioning', 'active', 'suspended']),
  created_at: timestamp,
  owners: z.array(z.string()),
  people: z.number().int(),
  system_accounts: z.number().int(),
  open_invites: z.number().int(),
  /** Its own limits; null: the beta's, which `defaults` gives. */
  limits: z.object({ max_members: z.number().int().nullable(), max_dockets: z.number().int().nullable() }),
  suspended: z.object({ at: timestamp, by: z.string().nullable(), reason: z.string().nullable() }).nullable(),
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
  /** Runs the platform (`DOCKET_PLATFORM_ADMINS`): sees its admin pages. */
  platform_admin: z.boolean(),
  accounts: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string(), owner: z.boolean(), guest: z.boolean() })),
})

/**
 * What the app's sidebar shows a member of an account (`accounts.navigation`):
 * their role, what they may do on the whole account and where they manage
 * access, its spaces and the dockets they see - numbered across the account,
 * so a docket keeps its number whoever is looking - token notices for its
 * owners, and the month's AI spend.
 */
export const Navigation = z.object({
  account: z.object({ slug: z.string(), name: z.string() }),
  /** How their access reads across the account: Owner, or their role there. */
  role: z.string(),
  /** What they may do on the whole account. */
  caps: z.array(Capability),
  owner: z.boolean(),
  /** Admin on the whole account: may change its roles. */
  account_admin: z.boolean(),
  /** Manages access, or system accounts, somewhere in the account. */
  manages_access: z.boolean(),
  manages_system_accounts: z.boolean(),
  /** May make a space. */
  creates_spaces: z.boolean(),
  /** The spaces they see, General first; `create`: they may add a docket there. */
  spaces: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string(), general: z.boolean(), create: z.boolean() })),
  /** The dockets they see; `open` is false for one they see but may not read. */
  dockets: z.array(z.object({ slug: z.string(), name: z.string(), space_id: z.string(), number: z.string(), open: z.boolean() })),
  /** System account tokens about to expire or just expired: for the account's owners. */
  token_notices: z.object({ expiring: z.number().int(), expired: z.number().int() }),
  ai: z.object({ spent_usd: z.number(), cap_usd: z.number(), fraction: z.number(), warned: z.boolean() }),
})

/** A docket's header (`dockets.summary`): how many documents it holds, its open ontology drafts, and its schema. */
export const DocketSummary = z.object({
  docket: z.string(),
  documents: z.number().int(),
  drafts: z.number().int(),
  /** The published ontology version, or null before the first. */
  schema: z
    .object({ version: z.number().int(), published_at: timestamp.nullable(), published_by: z.string(), message: z.string().nullable() })
    .nullable(),
})

/**
 * The command menu's direct search (`accounts.search`): the first few of each
 * kind of result, as the app's Ask draws them, and the type colours they use.
 */
export const QuickSearch = z.object({
  records: z.array(z.record(z.string(), z.unknown())),
  groups: z.object({
    notes: z.array(z.record(z.string(), z.unknown())),
    memory: z.array(z.record(z.string(), z.unknown())),
    exhibits: z.array(z.record(z.string(), z.unknown())),
    entries: z.array(z.record(z.string(), z.unknown())),
  }),
  slots: z.record(z.string(), z.unknown()),
})

/**
 * Who reaches a place (`access.who`), for whoever manages access or system
 * accounts there: everyone who may do something there and why, the grants on
 * the bigger places that cover it (changed there, not here), and whom the
 * caller may give access there.
 */
export const AccessWho = z.object({
  place: Place,
  reach: z.array(
    z.object({
      id: z.string(),
      login: z.string(),
      name: z.string().nullable(),
      kind: z.enum(['human', 'service']),
      guest: z.boolean(),
      /** "Owner", "Can write", "Admin"... */
      summary: z.string(),
      /** Capabilities beyond what `summary` says. */
      extra: z.array(Capability),
      caps: z.array(Capability),
      because: z.array(z.string()),
    }),
  ),
  /** The grants on the space a docket is in, and on the whole account: they cover this place too. */
  covering: z.array(Grant),
  /** Whom the caller may give access here: `everyone`, or a member's id. */
  candidates: z.array(z.object({ ref: z.string(), label: z.string() })),
})

/**
 * What models do (tenancy v2 §5): `cypher` writes graph queries and runs the
 * background work (enrichment, consolidation, summaries); `synthesis` writes
 * answers and drives the Ask agent.
 */
export const MODEL_USES = ['cypher', 'synthesis'] as const
export type ModelUse = (typeof MODEL_USES)[number]

/** The model providers a space may pay with its own key for. */
export const AI_PROVIDERS = ['openrouter', 'anthropic', 'openai'] as const
export const AiProvider = z.enum(AI_PROVIDERS)

/** Whose choice a resolved setting is: a place's own, or the platform's default. */
export const SettingsSource = z.enum(['platform', 'account', 'space', 'docket'])

/** One use's model at a place: its own choice, what runs, and what it may choose from. */
export const ModelSetting = z.object({
  /** How the app names the use: "Answers and the Ask agent". */
  label: z.string(),
  /** This place's own choice; null: it runs what the place above it runs. */
  own: z.string().nullable(),
  /** The model that runs here, and whose choice it is; null only when nothing it may choose is served by its space's own key. */
  model: z.string().nullable(),
  from: SettingsSource,
  /** What would run here if this place chose nothing. */
  inherited: z.object({ model: z.string().nullable(), from: SettingsSource }),
  /** The models this place may choose from: the platform's list, narrowed by every place above it and by its space's own key. */
  choices: z.array(z.string()),
  /** This place's own limit on what the places inside it may choose (none for a docket); empty: no limit. */
  allowed: z.array(z.string()),
})

/**
 * A place's storage and AI settings (tenancy v2 §5), as whoever may change
 * them sees them: its models per use, whose key pays for its AI (never the
 * key: only its provider and last four characters), the monthly caps that
 * hold there, a space's storage, and a docket's background agents.
 */
export const PlaceSettings = z.object({
  place: Place,
  models: z.object({ cypher: ModelSetting, synthesis: ModelSetting }),
  key: z.union([
    z.object({ from: z.literal('account') }),
    z.object({ from: z.literal('space'), space: z.string(), provider: AiProvider, hint: z.string() }),
  ]),
  budget: z.object({
    /** The account's monthly AI cap, in US dollars. */
    monthly_cap_usd: z.number(),
    /** The space's own slice of that cap; null: none of its own. */
    space_slice_usd: z.number().nullable(),
  }),
  /** A space's own Neo4j instance (`own`), or the account's (`account`); null for the account or a docket. */
  storage: z
    .object({
      graph: z.enum(['account', 'own']),
      /** The space's own instance, while it is asked for, made, or given up. */
      status: z.string().nullable(),
      last_error: z.string().nullable(),
    })
    .nullable(),
  /** A docket's background agents; null for the account or a space. */
  agents: z
    .object({
      enrichment: z.object({ enabled: z.boolean(), schedule: z.enum(['nightly', 'weekly']), monthly_limit_usd: z.number() }),
      cognee: z.object({ enabled: z.boolean(), floor: z.number(), monthly_limit_usd: z.number(), available: z.boolean() }),
    })
    .nullable(),
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
