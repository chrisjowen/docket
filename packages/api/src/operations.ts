import { z } from 'zod'

import {
  Account,
  AccessExplained,
  AccessWho,
  API_ERROR_CODES,
  AuditEvent,
  Capability,
  Connection,
  Docket,
  DocketSummary,
  Grant,
  GranteeRef,
  Invite,
  IssuedInvite,
  IssuedToken,
  Me,
  Member,
  Navigation,
  OperatorAccount,
  PlaceRef,
  QuickSearch,
  Role,
  SLUG,
  Space,
  SystemAccount,
  Token,
  Usage,
  type ApiErrorCode,
} from './schemas.js'

/**
 * Every `/api/v1` operation (tenancy v2 §3.5; open-source plan §1): the one
 * definition the server routes and validates by, the UI and the CLI call by,
 * and the OpenAPI document is generated from.
 *
 * A call needs the same capability as the button in the app, held by whoever
 * the credential acts as, on the place the call names. There are no scopes:
 * a token or OAuth connection acts as its owner, narrowed to read-only (it
 * may make only `readOnly` calls) and/or to some dockets (it reaches only
 * those). A browser session sends its CSRF token (`GET /api/v1/me`) as
 * `X-CSRF-Token` on every call that is not a GET.
 */

/**
 * The API's version, `major.minor`: a new minor adds operations or fields, a new major changes or removes them.
 * Every `/api/v1` answer carries it (`X-Docket-Api-Version`), as does the OpenAPI document; a client built for
 * another major, or a newer minor, says so rather than call what is not there.
 */
export const API_VERSION = '1.2'

/** Whether a client built for API `wanted` can use a server answering `served`: the same major, and no newer minor. */
export function compatible(wanted: string, served: string): boolean {
  const [wantMajor, wantMinor] = wanted.split('.').map(Number)
  const [haveMajor, haveMinor] = served.split('.').map(Number)
  return wantMajor === haveMajor && (wantMinor ?? 0) <= (haveMinor ?? 0)
}

/** How a call may authenticate: a browser session cookie, an API token, or an OAuth access token from a named connection. */
export type Credential = 'session' | 'token' | 'oauth'
export const CREDENTIALS: readonly Credential[] = ['session', 'token', 'oauth']
const ANY: readonly Credential[] = CREDENTIALS
const SESSION: readonly Credential[] = ['session']

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** What a call needs, as data and as words. */
export interface Needs {
  /** A capability, held on `on`; or being signed in, a member, an owner, or on the beta list. */
  capability: Capability | 'signed-in' | 'member' | 'owner' | 'allowlisted' | 'operator'
  /** Where it must be held: the account, the place the call names, a space, a docket, or a place a system account reaches. */
  on?: 'account' | 'place' | 'space' | 'docket' | 'system-account' | 'anywhere'
  text: string
}

export interface Operation {
  /** Stable id, `area.verb`: what the UI and the CLI call it by, and the audit action (`api.<id>`). */
  id: string
  method: Method
  /** `/api/v1/...`, with `{name}` path parameters. */
  path: string
  summary: string
  tag: string
  auth: readonly Credential[]
  needs: Needs
  /** A read-only credential may make the call. */
  readOnly: boolean
  params?: z.ZodObject
  query?: z.ZodObject
  body?: z.ZodObject
  /** The success body; null for 204 No Content. */
  response: z.ZodType | null
  status: 200 | 201 | 204
  errors: readonly ApiErrorCode[]
  /** For a streamed answer: its content type and each event's shape. */
  stream?: { contentType: 'text/event-stream'; event: z.ZodType }
  /** The opt-in MCP management tool that makes the same call, at the account's MCP address. */
  mcpTool?: string
}

const AUTH_ERRORS = ['unauthenticated', 'invalid_token', 'rate_limited', 'server_error'] as const satisfies readonly ApiErrorCode[]
const READ_ERRORS = [...AUTH_ERRORS, 'not_found'] as const
const WRITE_ERRORS = [...READ_ERRORS, 'invalid_request', 'csrf', 'forbidden', 'read_only', 'conflict'] as const

const acct = z.object({ acct: SLUG })
const withAcct = <T extends z.ZodRawShape>(shape: T) => acct.extend(shape)
const name = z.string().trim().min(1).max(80)
const caps = z.array(Capability).max(12)
const tokenInput = {
  name: z.string().max(80).optional().describe('What it is for: "CI", "laptop"'),
  days: z.number().int().min(1).max(365).optional().describe('Days until it expires: at most 90 for a personal token, 365 for a system account'),
  read_only: z.boolean().optional(),
  dockets: z.array(SLUG).min(1).max(100).nullable().optional().describe('The dockets it reaches, by slug; null or omitted: every docket its owner reaches'),
}

type Definition = Omit<Operation, 'readOnly' | 'errors' | 'auth'> & { auth?: readonly Credential[]; errors?: readonly ApiErrorCode[] }

/** An operation: GETs are read-only and answer the read errors; anything else may also be refused or invalid. */
function op<const D extends Definition>(definition: D): D & Pick<Operation, 'readOnly' | 'errors' | 'auth'> {
  const readOnly = definition.method === 'GET'
  return { auth: ANY, errors: readOnly ? READ_ERRORS : WRITE_ERRORS, readOnly, ...definition }
}

export const OPERATIONS = [
  // --- Who you are -------------------------------------------------------------
  op({
    id: 'me.get',
    method: 'GET',
    path: '/api/v1/me',
    tag: 'Me',
    summary: 'Who is calling, through what, and their accounts; a session also gets its CSRF token here.',
    needs: { capability: 'signed-in', text: 'Signed in, or any live token or connection' },
    response: Me,
    status: 200,
    errors: AUTH_ERRORS,
  }),
  op({
    id: 'me.tokens.list',
    method: 'GET',
    path: '/api/v1/me/tokens',
    tag: 'Me',
    summary: 'Your own personal access tokens in one account.',
    query: z.object({ account: SLUG }),
    needs: { capability: 'member', on: 'account', text: 'A member of the account' },
    response: z.object({ tokens: z.array(Token) }),
    status: 200,
  }),
  op({
    id: 'me.tokens.create',
    method: 'POST',
    path: '/api/v1/me/tokens',
    tag: 'Me',
    summary: 'Issues a personal access token that acts as you, narrowed to read-only or some dockets. Only your own browser session can.',
    auth: SESSION,
    body: z.object({ account: SLUG, ...tokenInput }),
    needs: { capability: 'read', on: 'anywhere', text: 'Your own session; you reach every docket you name' },
    response: IssuedToken,
    status: 201,
  }),
  op({
    id: 'me.tokens.update',
    method: 'PATCH',
    path: '/api/v1/me/tokens/{id}',
    tag: 'Me',
    summary: 'Renames one of your tokens.',
    params: z.object({ id: z.string().min(1).max(80) }),
    body: z.object({ name: z.string().max(80) }),
    needs: { capability: 'member', text: 'Your own token' },
    response: Token,
    status: 200,
  }),
  op({
    id: 'me.tokens.revoke',
    method: 'DELETE',
    path: '/api/v1/me/tokens/{id}',
    tag: 'Me',
    summary: 'Revokes one of your tokens: its next call fails.',
    params: z.object({ id: z.string().min(1).max(80) }),
    needs: { capability: 'member', text: 'Your own token' },
    response: null,
    status: 204,
  }),
  op({
    id: 'me.connections.list',
    method: 'GET',
    path: '/api/v1/me/connections',
    tag: 'Me',
    summary: 'Your named OAuth connections (AI clients you signed in) in one account.',
    query: z.object({ account: SLUG }),
    needs: { capability: 'member', on: 'account', text: 'A member of the account' },
    response: z.object({ connections: z.array(Connection) }),
    status: 200,
  }),
  op({
    id: 'me.connections.update',
    method: 'PATCH',
    path: '/api/v1/me/connections/{id}',
    tag: 'Me',
    summary: 'Renames one of your connections.',
    params: z.object({ id: z.string().min(1).max(200) }),
    body: z.object({ account: SLUG, name: z.string().max(80) }),
    needs: { capability: 'member', text: 'Your own connection' },
    response: Connection,
    status: 200,
  }),
  op({
    id: 'me.connections.revoke',
    method: 'DELETE',
    path: '/api/v1/me/connections/{id}',
    tag: 'Me',
    summary: 'Revokes one of your connections, with every token issued under it.',
    params: z.object({ id: z.string().min(1).max(200) }),
    query: z.object({ account: SLUG }),
    needs: { capability: 'member', text: 'Your own connection' },
    response: null,
    status: 204,
  }),

  // --- The platform operator ---------------------------------------------------
  op({
    id: 'operator.accounts.list',
    method: 'GET',
    path: '/api/v1/operator/accounts',
    tag: 'Operator',
    summary: "Every account on the platform: owners, people, system accounts, open invites, limits and whether it is suspended. Nothing of an account's content.",
    auth: SESSION,
    needs: { capability: 'operator', text: 'A platform operator (DOCKET_PLATFORM_ADMINS), in their own browser session' },
    response: z.object({
      accounts: z.array(OperatorAccount),
      defaults: z.object({ max_members: z.number().int(), max_dockets: z.number().int() }),
      platform: z.object({ live: z.number().int(), max: z.number().int() }),
    }),
    status: 200,
  }),
  op({
    id: 'operator.accounts.update',
    method: 'PATCH',
    path: '/api/v1/operator/accounts/{acct}',
    tag: 'Operator',
    summary: 'Suspends or resumes an account, and sets its own limits on seats and dockets (null: the beta’s). A suspended account is not served; nothing in it is lost.',
    auth: SESSION,
    params: acct,
    body: z.object({
      suspended: z.boolean().optional(),
      reason: z.string().trim().max(300).optional().describe('Why it is suspended: shown to operators'),
      max_members: z.number().int().min(1).max(10_000).nullable().optional(),
      max_dockets: z.number().int().min(1).max(1_000).nullable().optional(),
    }),
    needs: { capability: 'operator', text: 'A platform operator (DOCKET_PLATFORM_ADMINS), in their own browser session' },
    response: OperatorAccount,
    status: 200,
  }),

  // --- Accounts ----------------------------------------------------------------
  op({
    id: 'accounts.list',
    method: 'GET',
    path: '/api/v1/accounts',
    tag: 'Accounts',
    summary: "The accounts you are in; a token's or connection's own account.",
    needs: { capability: 'signed-in', text: 'Signed in' },
    response: z.object({ accounts: z.array(Account) }),
    status: 200,
  }),
  op({
    id: 'accounts.create',
    method: 'POST',
    path: '/api/v1/accounts',
    tag: 'Accounts',
    summary: 'Creates an account, with you as its owner, and sets up its stores.',
    auth: SESSION,
    body: z.object({ name, slug: SLUG }),
    needs: { capability: 'allowlisted', text: 'Signed in, on the beta list' },
    response: Account,
    status: 201,
  }),
  op({
    id: 'accounts.get',
    method: 'GET',
    path: '/api/v1/accounts/{acct}',
    tag: 'Accounts',
    summary: 'One account, and what you may do on the whole of it.',
    params: acct,
    needs: { capability: 'member', on: 'account', text: 'A member of the account' },
    response: Account,
    status: 200,
  }),
  op({
    id: 'accounts.update',
    method: 'PATCH',
    path: '/api/v1/accounts/{acct}',
    tag: 'Accounts',
    summary: "Renames the account, or transfers its ownership to another member (who becomes an owner, and you no longer one).",
    params: acct,
    body: z.object({
      name: name.optional(),
      owner: z.string().min(1).max(80).optional().describe('The login or id of the person who becomes owner in your place'),
    }),
    needs: { capability: 'owner', on: 'account', text: 'Owner' },
    response: Account,
    status: 200,
  }),
  op({
    id: 'accounts.delete',
    method: 'DELETE',
    path: '/api/v1/accounts/{acct}',
    tag: 'Accounts',
    summary: 'Deletes the account: it stops being served, and every token and connection in it stops working.',
    params: acct,
    needs: { capability: 'owner', on: 'account', text: 'Owner' },
    response: null,
    status: 204,
  }),

  op({
    id: 'accounts.navigation',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/navigation',
    tag: 'Accounts',
    summary: "What the app's sidebar shows you in an account: your role, its spaces and the dockets you see, token notices and the month's AI spend.",
    params: acct,
    needs: { capability: 'member', on: 'account', text: 'A member of the account; a guest sees only what they hold something in' },
    response: Navigation,
    status: 200,
  }),
  op({
    id: 'accounts.search',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/search',
    tag: 'Accounts',
    summary: "The command menu's direct search (no AI) over the dockets `ws` names, or every docket you read: the first few of each kind of result.",
    params: acct,
    query: z.object({
      q: z.string().max(200).optional(),
      ws: z.string().max(4100).optional().describe('Docket slugs, comma-separated; omitted: every docket you read'),
    }),
    needs: { capability: 'read', on: 'anywhere', text: 'Read and ask on a docket; it searches only the dockets you read' },
    response: QuickSearch,
    status: 200,
  }),

  // --- Users -------------------------------------------------------------------
  op({
    id: 'members.list',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/members',
    tag: 'Users',
    summary: "The account's users and system accounts, and how each one's access reads.",
    params: acct,
    needs: { capability: 'member', on: 'account', text: 'A member who is not a guest' },
    response: z.object({ members: z.array(Member) }),
    status: 200,
  }),
  op({
    id: 'members.update',
    method: 'PATCH',
    path: '/api/v1/accounts/{acct}/members/{user}',
    tag: 'Users',
    summary: 'Makes a user an owner of the account, or no longer one (transfer ownership).',
    params: withAcct({ user: z.string().min(1).max(80) }),
    body: z.object({ owner: z.boolean() }),
    needs: { capability: 'owner', on: 'account', text: 'Owner' },
    response: Member,
    status: 200,
  }),
  op({
    id: 'members.remove',
    method: 'DELETE',
    path: '/api/v1/accounts/{acct}/members/{user}',
    tag: 'Users',
    summary: 'Removes a user from the account, with every grant they hold.',
    params: withAcct({ user: z.string().min(1).max(80) }),
    needs: { capability: 'access', on: 'account', text: 'Manage access on the account, holding all they hold' },
    response: null,
    status: 204,
  }),
  op({
    id: 'invites.list',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/invites',
    tag: 'Users',
    summary: 'Open invites, where you manage access.',
    params: acct,
    needs: { capability: 'access', on: 'anywhere', text: 'Manage access somewhere in the account' },
    response: z.object({ invites: z.array(Invite) }),
    status: 200,
  }),
  op({
    id: 'invites.create',
    method: 'POST',
    path: '/api/v1/accounts/{acct}/invites',
    tag: 'Users',
    summary:
      'Invites someone by GitHub login or email to a role on a place. The invite is a link that works once, for 7 days, returned here once and emailed when there is an address to send it to; over MCP the link is left out.',
    params: acct,
    body: z.object({ to: z.string().trim().min(1).max(254), place: PlaceRef, role: z.string().min(1).max(80), guest: z.boolean().optional() }),
    needs: { capability: 'access', on: 'place', text: 'Manage access on that place, holding what the role gives' },
    response: IssuedInvite,
    status: 201,
    mcpTool: 'admin_invite',
  }),
  op({
    id: 'invites.resend',
    method: 'POST',
    path: '/api/v1/accounts/{acct}/invites/{id}/resend',
    tag: 'Users',
    summary: 'Sends an open invite again: a new link, for 7 more days, emailed again; the old link stops working.',
    params: withAcct({ id: z.string().min(1).max(80) }),
    needs: { capability: 'access', on: 'place', text: 'Manage access where it gives access' },
    response: IssuedInvite,
    status: 200,
  }),
  op({
    id: 'invites.revoke',
    method: 'DELETE',
    path: '/api/v1/accounts/{acct}/invites/{id}',
    tag: 'Users',
    summary: 'Cancels an open invite.',
    params: withAcct({ id: z.string().min(1).max(80) }),
    needs: { capability: 'access', on: 'place', text: 'Manage access where it gives access' },
    response: null,
    status: 204,
  }),

  // --- Access: a role on a place -----------------------------------------------
  op({
    id: 'access.explain',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/access',
    tag: 'Access',
    summary: 'What you may do on a place, and the grants that say so.',
    params: acct,
    query: z.object({ place: PlaceRef }),
    needs: { capability: 'member', on: 'place', text: 'A member who sees the place' },
    response: AccessExplained,
    status: 200,
  }),
  op({
    id: 'access.who',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/access/who',
    tag: 'Access',
    summary: 'Who reaches a place and why, the grants on the bigger places that cover it, and whom you may give access there.',
    params: acct,
    query: z.object({ place: PlaceRef }),
    needs: { capability: 'access', on: 'place', text: 'Manage access, or Manage system accounts, on the place' },
    response: AccessWho,
    status: 200,
  }),
  op({
    id: 'grants.list',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/grants',
    tag: 'Access',
    summary: "Grants: everyone's where you manage access, otherwise your own. Filter by place or by who.",
    params: acct,
    query: z.object({ place: PlaceRef.optional(), who: GranteeRef.optional() }),
    needs: { capability: 'member', text: 'A member; others’ grants only where you manage access' },
    response: z.object({ grants: z.array(Grant) }),
    status: 200,
  }),
  op({
    id: 'grants.create',
    method: 'POST',
    path: '/api/v1/accounts/{acct}/grants',
    tag: 'Access',
    summary: 'Gives someone a role on a place, adjusted by single capabilities; replaces their grant there.',
    params: acct,
    body: z.object({ who: GranteeRef, place: PlaceRef, role: z.string().min(1).max(80), add: caps.optional(), remove: caps.optional() }),
    needs: { capability: 'access', on: 'place', text: 'Manage access on that place (Manage system accounts, for a system account), holding what it gives' },
    response: Grant,
    status: 201,
    mcpTool: 'admin_set_access',
  }),
  op({
    id: 'grants.replace',
    method: 'PUT',
    path: '/api/v1/accounts/{acct}/grants/{id}',
    tag: 'Access',
    summary: "Changes a grant's role and adjustments.",
    params: withAcct({ id: z.string().min(1).max(80) }),
    body: z.object({ role: z.string().min(1).max(80), add: caps.optional(), remove: caps.optional() }),
    needs: { capability: 'access', on: 'place', text: 'Manage access on its place, holding what it gives before and after' },
    response: Grant,
    status: 200,
    mcpTool: 'admin_set_access',
  }),
  op({
    id: 'grants.adjust',
    method: 'PATCH',
    path: '/api/v1/accounts/{acct}/grants/{id}',
    tag: 'Access',
    summary: 'Adds or removes single capabilities on one grant: one user, one extra capability.',
    params: withAcct({ id: z.string().min(1).max(80) }),
    body: z.object({ add: caps.optional(), remove: caps.optional() }),
    needs: { capability: 'access', on: 'place', text: 'Manage access on its place, holding what it gives before and after' },
    response: Grant,
    status: 200,
    mcpTool: 'admin_set_access',
  }),
  op({
    id: 'grants.delete',
    method: 'DELETE',
    path: '/api/v1/accounts/{acct}/grants/{id}',
    tag: 'Access',
    summary: 'Takes a grant away.',
    params: withAcct({ id: z.string().min(1).max(80) }),
    needs: { capability: 'access', on: 'place', text: 'Manage access on its place, holding what it gives' },
    response: null,
    status: 204,
    mcpTool: 'admin_set_access',
  }),

  // --- Roles -------------------------------------------------------------------
  op({
    id: 'roles.list',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/roles',
    tag: 'Roles',
    summary: 'The built-in roles (Reader, Writer, Admin) and the account’s own.',
    params: acct,
    needs: { capability: 'member', text: 'A member' },
    response: z.object({ roles: z.array(Role) }),
    status: 200,
  }),
  op({
    id: 'roles.create',
    method: 'POST',
    path: '/api/v1/accounts/{acct}/roles',
    tag: 'Roles',
    summary: 'Makes one of the account’s own roles.',
    params: acct,
    body: z.object({ name: z.string().trim().min(1).max(60), description: z.string().max(200).nullable().optional(), caps: caps.min(1) }),
    needs: { capability: 'access', on: 'account', text: 'Admin on the whole account' },
    response: Role,
    status: 201,
  }),
  op({
    id: 'roles.update',
    method: 'PUT',
    path: '/api/v1/accounts/{acct}/roles/{id}',
    tag: 'Roles',
    summary: 'Changes one of the account’s own roles, for everyone who holds it. The built-in roles are fixed.',
    params: withAcct({ id: z.string().min(1).max(80) }),
    body: z.object({ name: z.string().trim().min(1).max(60), description: z.string().max(200).nullable().optional(), caps: caps.min(1) }),
    needs: { capability: 'access', on: 'account', text: 'Admin on the whole account' },
    response: Role,
    status: 200,
  }),
  op({
    id: 'roles.delete',
    method: 'DELETE',
    path: '/api/v1/accounts/{acct}/roles/{id}',
    tag: 'Roles',
    summary: 'Deletes one of the account’s own roles that no one holds.',
    params: withAcct({ id: z.string().min(1).max(80) }),
    needs: { capability: 'access', on: 'account', text: 'Admin on the whole account' },
    response: null,
    status: 204,
  }),

  // --- Spaces ------------------------------------------------------------------
  op({
    id: 'spaces.list',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/spaces',
    tag: 'Spaces',
    summary: 'The spaces you see, General first.',
    params: acct,
    needs: { capability: 'member', text: 'A member; a guest sees only spaces where they hold something' },
    response: z.object({ spaces: z.array(Space) }),
    status: 200,
  }),
  op({
    id: 'spaces.create',
    method: 'POST',
    path: '/api/v1/accounts/{acct}/spaces',
    tag: 'Spaces',
    summary: 'Makes a space, for a team, department or client.',
    params: acct,
    body: z.object({ name, slug: SLUG, description: z.string().max(300).optional() }),
    needs: { capability: 'access', on: 'account', text: 'Admin on the whole account' },
    response: Space,
    status: 201,
    mcpTool: 'admin_create_space',
  }),
  op({
    id: 'spaces.get',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/spaces/{space}',
    tag: 'Spaces',
    summary: 'One space, and what you may do on it.',
    params: withAcct({ space: SLUG }),
    needs: { capability: 'member', on: 'space', text: 'A member who sees the space' },
    response: Space,
    status: 200,
  }),
  op({
    id: 'spaces.update',
    method: 'PATCH',
    path: '/api/v1/accounts/{acct}/spaces/{space}',
    tag: 'Spaces',
    summary: 'Renames a space or changes its description.',
    params: withAcct({ space: SLUG }),
    body: z.object({ name: name.optional(), description: z.string().max(300).nullable().optional() }),
    needs: { capability: 'settings', on: 'space', text: 'Change settings on the space' },
    response: Space,
    status: 200,
  }),

  // --- Dockets -----------------------------------------------------------------
  op({
    id: 'dockets.list',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/dockets',
    tag: 'Dockets',
    summary: 'The dockets you see, with what you may do in each. Filter by space.',
    params: acct,
    query: z.object({ space: SLUG.optional() }),
    needs: { capability: 'member', text: 'A member; a guest sees only dockets where they hold something' },
    response: z.object({ dockets: z.array(Docket) }),
    status: 200,
  }),
  op({
    id: 'dockets.create',
    method: 'POST',
    path: '/api/v1/accounts/{acct}/dockets',
    tag: 'Dockets',
    summary: 'Makes a docket in a space from a template, a copy of another docket or an ontology, with its initial access.',
    params: acct,
    body: z.object({
      space: SLUG,
      name,
      slug: SLUG.optional(),
      template: z.string().min(1).max(80).optional().describe('A built-in template id (sdlc, crm, blank...) or one of the account’s own (org:<id>)'),
      copy_from: SLUG.optional().describe('Another docket to copy the ontology of'),
      inline_yaml: z.string().max(256 * 1024).optional().describe('An ontology, as YAML'),
      grants: z.array(z.object({ who: GranteeRef, role: z.string().min(1).max(80) })).max(50).optional(),
    }),
    needs: { capability: 'create', on: 'space', text: 'Create dockets on the space; Manage access there to give initial access' },
    response: Docket,
    status: 201,
    mcpTool: 'admin_create_docket',
  }),
  op({
    id: 'dockets.get',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/dockets/{docket}',
    tag: 'Dockets',
    summary: 'One docket, and what you may do in it.',
    params: withAcct({ docket: SLUG }),
    needs: { capability: 'read', on: 'docket', text: 'Read and ask on the docket' },
    response: Docket,
    status: 200,
  }),
  op({
    id: 'dockets.summary',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/dockets/{docket}/summary',
    tag: 'Dockets',
    summary: "A docket's header: its documents, open ontology drafts and published schema version.",
    params: withAcct({ docket: SLUG }),
    needs: { capability: 'read', on: 'docket', text: 'Read and ask on the docket' },
    response: DocketSummary,
    status: 200,
  }),
  op({
    id: 'dockets.update',
    method: 'PATCH',
    path: '/api/v1/accounts/{acct}/dockets/{docket}',
    tag: 'Dockets',
    summary: 'Renames a docket, or moves it to another space (whose grants then cover it instead).',
    params: withAcct({ docket: SLUG }),
    body: z.object({ name: name.optional(), space: SLUG.optional() }),
    needs: { capability: 'settings', on: 'docket', text: 'Change settings on the docket; to move it, also Create dockets and Manage access on the space it goes to' },
    response: Docket,
    status: 200,
    mcpTool: 'admin_update_docket',
  }),
  op({
    id: 'dockets.delete',
    method: 'DELETE',
    path: '/api/v1/accounts/{acct}/dockets/{docket}',
    tag: 'Dockets',
    summary: 'Deletes a docket and everything in it, revoking every token and connection that reached only it.',
    params: withAcct({ docket: SLUG }),
    needs: { capability: 'delete', on: 'docket', text: 'Delete on the docket' },
    response: null,
    status: 204,
  }),

  // --- System accounts ---------------------------------------------------------
  op({
    id: 'system-accounts.list',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/system-accounts',
    tag: 'System accounts',
    summary: 'The system accounts that reach places where you manage system accounts or access.',
    params: acct,
    needs: { capability: 'system', on: 'anywhere', text: 'Manage system accounts (or access) somewhere in the account' },
    response: z.object({ system_accounts: z.array(SystemAccount) }),
    status: 200,
  }),
  op({
    id: 'system-accounts.create',
    method: 'POST',
    path: '/api/v1/accounts/{acct}/system-accounts',
    tag: 'System accounts',
    summary: 'Makes a system account and gives it access, in one step: anything that is not a person.',
    params: acct,
    body: z.object({
      name: SLUG,
      description: z.string().max(200).optional(),
      grants: z.array(z.object({ place: PlaceRef, role: z.string().min(1).max(80), add: caps.optional(), remove: caps.optional() })).min(1).max(20),
    }),
    needs: { capability: 'system', on: 'place', text: 'Manage system accounts on every place it will reach' },
    response: SystemAccount,
    status: 201,
    mcpTool: 'admin_create_system_account',
  }),
  op({
    id: 'system-accounts.get',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/system-accounts/{id}',
    tag: 'System accounts',
    summary: 'One system account, with its grants.',
    params: withAcct({ id: z.string().min(1).max(80) }),
    needs: { capability: 'system', on: 'system-account', text: 'Manage system accounts on a place it reaches' },
    response: SystemAccount,
    status: 200,
  }),
  op({
    id: 'system-accounts.delete',
    method: 'DELETE',
    path: '/api/v1/accounts/{acct}/system-accounts/{id}',
    tag: 'System accounts',
    summary: 'Removes a system account, revoking its tokens.',
    params: withAcct({ id: z.string().min(1).max(80) }),
    needs: { capability: 'system', on: 'system-account', text: 'Manage system accounts on a place it reaches, holding what it holds' },
    response: null,
    status: 204,
  }),
  op({
    id: 'system-accounts.tokens.list',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/system-accounts/{id}/tokens',
    tag: 'System accounts',
    summary: "A system account's tokens.",
    params: withAcct({ id: z.string().min(1).max(80) }),
    needs: { capability: 'system', on: 'system-account', text: 'Manage system accounts on a place it reaches' },
    response: z.object({ tokens: z.array(Token) }),
    status: 200,
  }),
  op({
    id: 'system-accounts.tokens.create',
    method: 'POST',
    path: '/api/v1/accounts/{acct}/system-accounts/{id}/tokens',
    tag: 'System accounts',
    summary: 'Issues a token that acts as the system account (never over MCP).',
    params: withAcct({ id: z.string().min(1).max(80) }),
    body: z.object(tokenInput),
    needs: { capability: 'system', on: 'system-account', text: 'Manage system accounts on a place it reaches' },
    response: IssuedToken,
    status: 201,
  }),
  op({
    id: 'system-accounts.tokens.revoke',
    method: 'DELETE',
    path: '/api/v1/accounts/{acct}/system-accounts/{id}/tokens/{token}',
    tag: 'System accounts',
    summary: "Revokes one of a system account's tokens.",
    params: withAcct({ id: z.string().min(1).max(80), token: z.string().min(1).max(80) }),
    needs: { capability: 'system', on: 'system-account', text: 'Manage system accounts on a place it reaches' },
    response: null,
    status: 204,
  }),

  // --- Oversight ---------------------------------------------------------------
  op({
    id: 'audit.list',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/audit',
    tag: 'Oversight',
    summary: "The account's audit log, newest first: who, through what, did what.",
    params: acct,
    query: z.object({
      docket: SLUG.optional(),
      action: z.string().max(200).optional(),
      since: z.iso.datetime({ offset: true }).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
    needs: { capability: 'audit', on: 'account', text: 'See audit and usage on the account (on the docket, with docket=)' },
    response: z.object({ events: z.array(AuditEvent) }),
    status: 200,
  }),
  op({
    id: 'usage.get',
    method: 'GET',
    path: '/api/v1/accounts/{acct}/usage',
    tag: 'Oversight',
    summary: 'What the account holds and how much it was used in the last 30 days.',
    params: acct,
    needs: { capability: 'audit', on: 'account', text: 'See audit and usage on the account' },
    response: Usage,
    status: 200,
    mcpTool: 'admin_usage',
  }),
] as const satisfies readonly Operation[]

export type OperationId = (typeof OPERATIONS)[number]['id']

const BY_ID = new Map<string, Operation>(OPERATIONS.map((operation) => [operation.id, operation]))

/** One operation, by id. */
export function operation(id: OperationId): Operation {
  return BY_ID.get(id) as Operation
}

/** The JSON a call sends, by operation id. */
export type RequestBody<Id extends OperationId> = Extract<(typeof OPERATIONS)[number], { id: Id }> extends { body: infer B extends z.ZodType } ? z.input<B> : never

/** The JSON a call answers with, by operation id. */
export type ResponseBody<Id extends OperationId> = Extract<(typeof OPERATIONS)[number], { id: Id }> extends { response: infer R extends z.ZodType } ? z.output<R> : null

export { API_ERROR_CODES }
