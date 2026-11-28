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

A credential made before scopes went keeps what it had, never more. An API
token or connection that still carries its old scope ceiling (platform
migration 0015) is read-only here, whatever that ceiling lets it write
through MCP. An OAuth grant made before named connections is bound to its one
docket's MCP address and is refused here (`invalid_token`).

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
| Accounts | `GET/POST /accounts`; `GET/PATCH/DELETE /accounts/{acct}` (rename, transfer ownership with `{ owner }`, delete: owners only); `GET …/navigation` (the app's sidebar), `GET …/search` (the command menu's direct search) |
| Users | `GET …/members`, `PATCH/DELETE …/members/{user}`; `GET/POST …/invites`, `POST …/invites/{id}/resend`, `DELETE …/invites/{id}` |
| Access | `GET …/access?place=`, `GET …/access/who?place=`; `GET/POST …/grants`, `PUT/PATCH/DELETE …/grants/{id}` |
| Roles | `GET/POST …/roles`, `PUT/DELETE …/roles/{id}` |
| Spaces | `GET/POST …/spaces`, `GET/PATCH …/spaces/{space}` (rename; its own Neo4j or the account's with `graph`; its own provider key or the account's with `ai_key`) |
| Dockets | `GET/POST …/dockets`, `GET/PATCH/DELETE …/dockets/{docket}`, `GET …/dockets/{docket}/summary` |
| Settings | `GET/PATCH …/settings` (the account's models, its limits on what spaces and dockets choose, and its monthly cap); `GET/PATCH …/spaces/{space}/settings` (a space's models, limits and slice of the cap); `GET/PATCH …/dockets/{docket}/settings` (a docket's models and background agents) |
| System accounts | `GET/POST …/system-accounts`, `GET/DELETE …/system-accounts/{id}`, `GET/POST …/system-accounts/{id}/tokens`, `DELETE …/tokens/{token}` |
| Oversight | `GET …/audit`, `GET …/usage` |
| Operator | `GET /operator/accounts`, `PATCH /operator/accounts/{acct}` |

The web UI ([`packages/docket-ui/cloud`](../../packages/docket-ui/cloud))
draws its pages from these operations alone; `navigation`, `search`,
`summary` and `access/who` are what the app's frame and a place's Access tab
show.

**Versions.** `API_VERSION` in `@docket/api` is `major.minor`: a new minor
adds operations or fields, a new major changes or removes them. Every answer
carries it as `X-Docket-Api-Version`, and the OpenAPI document as its
`info.version`; a client built for another major, or a newer minor, refuses
rather than call what is not there.

`…` is `/api/v1/accounts/{acct}`. A place is named `account`,
`space:<slug>` or `docket:<slug>`; a person by login, a system account by
name, or `everyone`; a role by id or name.

An invite is a link that works once, for 7 days (`/invite/dki_…`). Making
one (`POST …/invites`) or sending it again (`POST …/invites/{id}/resend`,
which makes a new link and ends the old one) returns its `link` that once,
and emails it to the invite's address, or to a GitHub login's address when
that person has signed in before. `emailed` says whether the email was
delivered (never when `DOCKET_MAIL` is `log` or `none`); `emailed_to` is the
address the invite was made for, and is null for an invite to a GitHub login:
that person's address on file is never shown to whoever invites them. Whoever holds the link to
an invite by email may sign in and accept it; an invite to a GitHub login
only that login may. `admin_invite` over MCP never returns the link.

The operator operations are the operator console's (`/admin/accounts`), for
the platform's operators (`DOCKET_PLATFORM_ADMINS`) in their own browser
session; any token, and anyone else, is refused (403). They list every
account with its owners, its counts of people, system accounts and open
invites, its limits and whether it is suspended, never anything of its
content; and they suspend or resume an account (`{ suspended, reason }`) and
set its own limits on seats and dockets (`{ max_members, max_dockets }`, null
for the beta's). A suspended account is not served: its pages, API and MCP
addresses answer as if it did not exist, its tokens and connections stop
working (401), and nothing in it is lost. Each change is recorded in the
platform's audit log as `api.operator.accounts.update`.

**Settings.** A place's settings resolve account, then space, then docket
(tenancy v2 §5), and every change goes through that resolver: a place
chooses only models every place above it allows (and, in a space that pays
with its own key, that its provider serves), limits the places inside it only
to models it may choose itself, and a space's slice is at most the account's
cap. A `PATCH` changes only what it sends; `null` clears a place's own choice,
so it runs what the place above it runs. Each needs Change settings on its
place. Setting the account's monthly cap needs an owner, as it is what the
account pays; changing a docket's enrichment needs Change settings on the
account, as in the app, since it spends the account's AI and may publish what
it needs onto the ontology. The account always pays Docket's provider and
keeps its records and graph on Docket's stores, so its settings are its
models, limits and cap; a space's own key and Neo4j are on
`PATCH …/spaces/{space}`.

A space's provider key is write-only: no answer, log line or audit event
carries it, only its provider and last four characters. It is never taken
over MCP.

Not here yet, from the management tasks of tenancy v2 §3.5:

- Billing (`PATCH /accounts/{acct}`): the product has no billing to manage.
- Background agent defaults for an account or a space: enrichment and cognee
  are set per docket.

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
- `?admin=1` opts in to the management tools - `admin_set_access`, `admin_invite`, `admin_create_space`,
  `admin_create_docket`, `admin_update_docket`, `admin_update_settings`,
  `admin_create_system_account`, `admin_usage` - each offered only when the
  caller holds its capability somewhere, and each making the same call, with
  the same checks and audit, as `/api/v1`. None mints a token, and none is
  offered to a read-only credential or one made before scopes went.
  `admin_update_settings` names exactly one place, `space:<slug>` or
  `docket:<slug>`, and makes that place's `PATCH …/settings` call.

OAuth clients sign in for it with the account's MCP URL as the resource
indicator (RFC 8707). The consent screen then asks which of the account's
dockets the connection reaches - every docket by default, or chosen ones -
and stores them on the connection; its tokens carry the account, not a
docket. Writes are the caller's own evidence: a person's through their
connection or token, a system account's as itself, with no person acting for
it.
