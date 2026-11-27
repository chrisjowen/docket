# The public API (`/api/v1`) and an account's MCP address

**Audience:** the web UI, the CLI, and integrations that manage an account · **Defined in:** [`@docket/api`](../../packages/api) · **Served by:** `apps/server` (`src/lib/server/api/`, `src/lib/server/mcp-account.ts`)

## The rule

A call needs the same capability as the button in the app, held by whoever
the credential acts as, on the place the call names (tenancy v2 §3.5). There
are no scopes: what someone may do on a place is `capsAt` over every grant
that covers it, the same resolver the app's pages, MCP and OAuth consent use.

## Credentials

| Credential | How | Narrowed |
| --- | --- | --- |
| Browser session | The session cookie; every call that is not a GET sends the session's CSRF token as `X-CSRF-Token` (`GET /api/v1/me` returns it). | Never: it is the person. |
| Personal token (`dkt_pat_`) | `Authorization: Bearer …` | Read-only, and/or to chosen dockets |
| System account token (`dkt_sys_`) | `Authorization: Bearer …` | Read-only, and/or to chosen dockets |
| OAuth access token from a named connection | `Authorization: Bearer …` | What the connection was given at consent |

All of them resolve to the same principal and the same capabilities. A
read-only credential may make only read-only calls (GETs: `read_only`
otherwise). One limited to some dockets holds its owner's capabilities on
those dockets and nothing on the account or any space. Personal tokens are
minted only from the person's own browser session; nothing mints a token over
MCP.

## Operations

Every operation - its method and path, the credentials it takes, the
capability it needs and where, whether a read-only credential may call it,
its path, query and body schemas, its response and every error - is one entry
in `OPERATIONS` in `@docket/api`. The server routes and validates by it, the
UI imports it, and `GET /api/v1/openapi.json` publishes it as OpenAPI 3.1
(`x-docket-needs`, `x-docket-read-only`, `x-docket-mcp-tool`).

| Area | Operations |
| --- | --- |
| You | `GET /me`; `GET/POST /me/tokens`, `PATCH/DELETE /me/tokens/{id}`; `GET /me/connections`, `PATCH/DELETE /me/connections/{id}` |
| Accounts | `GET/POST /accounts`; `GET/PATCH /accounts/{acct}` |
| Users | `GET …/members`, `PATCH/DELETE …/members/{user}`; `GET/POST …/invites`, `DELETE …/invites/{id}` |
| Access | `GET …/access?place=`; `GET/POST …/grants`, `PUT/PATCH/DELETE …/grants/{id}` |
| Roles | `GET/POST …/roles`, `PUT/DELETE …/roles/{id}` |
| Spaces | `GET/POST …/spaces`, `GET/PATCH …/spaces/{space}` |
| Dockets | `GET/POST …/dockets`, `GET/PATCH/DELETE …/dockets/{docket}` |
| System accounts | `GET/POST …/system-accounts`, `GET/DELETE …/system-accounts/{id}`, `GET/POST …/system-accounts/{id}/tokens`, `DELETE …/tokens/{token}` |
| Oversight | `GET …/audit`, `GET …/usage` |

`…` is `/api/v1/accounts/{acct}`. A place is named `account`,
`space:<slug>` or `docket:<slug>`; a person by login, a system account by
name, or `everyone`; a role by id or name. Account settings, and models and
background agents per space or docket, come with storage and AI per space.

An account the caller is not in, a docket or space they cannot see, and a
grant they neither hold nor manage all answer 404; one they see but may not
change answers 403. Every refusal is
`{ "error", "error_description", "request_id" }`, with `issues` naming what
was wrong in an invalid request. Each call is rate limited per caller and
recorded once in the account's audit log as `api.<operation id>`, with who and
through what (`user:…`, `token:…`, `oauth:…/conn:…`), in the transaction that
made its change.

## An account's MCP address

`POST /mcp/{acct}` is one MCP address for every docket the caller may use,
beside each docket's own (`/mcp/{acct}/{docket}`), which is unchanged.

- `docket_list` lists the dockets the connection or token may use, with
  their space and what it can do in each.
- Every docket tool takes `docket`, its enum the dockets where that tool may
  run; read tools also take `dockets` to look in several at once, and each
  result says which docket it came from.
- Which docket a call uses: the one a credential limited to a single docket
  implies; else the one named, if the credential reaches it; else, for a read,
  the only one it reaches; else the call fails and lists the choices. A write
  never falls back to a default.
- `?read_only=1` drops the write tools.
- `?admin=1` opts in to the management tools - `admin_access`,
  `admin_set_access`, `admin_invite`, `admin_create_space`,
  `admin_create_docket`, `admin_update_docket`,
  `admin_create_system_account`, `admin_usage` - each offered only when the
  caller holds its capability somewhere, and each making the same call, with
  the same checks and audit, as `/api/v1`. None mints a token.

OAuth clients sign in for it with the account's MCP URL as the resource
indicator (RFC 8707). The consent screen then asks which of the account's
dockets the connection reaches - every docket by default, or chosen ones -
and stores them on the connection; its tokens carry the account, not a
docket. Writes are the caller's own evidence: a person's through their
connection or token, a system account's as itself, with no person acting for
it.
