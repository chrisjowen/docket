# Self-hosting Docket: `docket serve`

`docket serve` runs a self-hosted, single-tenant Docket server. Several
people and agents connect to it over MCP, from wherever they work: Claude Code
on a laptop, an agent in CI, the MCP Inspector. They all read and write the
same ontology and the same documents. It offers the same MCP surface as Docket
Cloud and as docket's own local MCP server (`docket open`): the same eleven
tools, with the same names, input schemas, annotations, argument checks and
result shapes. A parity test holds all three to it
(`packages/server/src/mcp/parity.test.ts`).

By default it needs no database. Each workspace is a project's own docket,
its Markdown files, indexed by the project's own projections (jsonl, unless
the project sets up others). Postgres is an opt-in, as the canonical store
and as a projection, and so is SQLite as a projection.

`docket serve` is part of `@chrisjowen/docket`'s CLI. It runs on
[`@chrisjowen/docket-server`](../packages/server), the core Docket Cloud is
also built on, so it is installed alongside docket:

```bash
npm install -g @chrisjowen/docket @chrisjowen/docket-server
npm install -g pg     # only for a Postgres database
```

## Quick start: no database

In a project that has a docket (`docket init` makes one):

```bash
docket serve token create ada --role owner      # shown once; only its hash is kept
docket serve token create ci-bot --role editor
docket serve                                    # http://127.0.0.1:4390, this machine only
```

```text
docket serve http://127.0.0.1:4390  (the projects' own files - no database)
  platform  MCP http://127.0.0.1:4390/mcp/platform  (/srv/platform)
  MCP also at http://127.0.0.1:4390/mcp
  page  http://127.0.0.1:4390/  (sign in with a token)
  health  http://127.0.0.1:4390/healthz, http://127.0.0.1:4390/readyz
  ontology published over MCP by: owner
  docket_ask is off: no ai model configured (docket_search needs none)
```

The workspace is named after the project's directory. Connect an MCP client
with the token in the `Authorization` header:

```bash
claude mcp add --transport http docket https://docket.example.com/mcp/platform \
  --header "Authorization: Bearer dks_…"
```

```json
{
  "mcpServers": {
    "docket": {
      "type": "http",
      "url": "https://docket.example.com/mcp/platform",
      "headers": { "Authorization": "Bearer ${DOCKET_TOKEN}" }
    }
  }
}
```

To reach it from other machines, listen on every interface (`--host 0.0.0.0`)
behind a reverse proxy that terminates TLS, and set `publicUrl` to the URL
clients use. `docket serve` speaks plain HTTP itself, and warns when it listens
beyond this machine without an `https` `publicUrl`. A token must never cross a
network in the clear.

The server keeps its own state in `.docket-server/` beside its config (or in
the project, with no config file): the tokens file and the audit log. Add it
to `.gitignore`.

## Where the documents live

### A project's files (the default)

Each workspace is a project directory with a `.docket.yaml`. Writes go
through the same local tools as `docket open`'s MCP server. A
`docket_remember` merges into the resource's document in place, or makes a
new one beside the project's other documents of its type. Supersessions,
published ontology versions and drafts are files under the docket's root too,
so git keeps their history.

**Several writers.** Writes take turns: inside the server, and across
processes on the project's lock file (`.docket/.cache/write.lock`). So
`docket open`'s MCP server, a second `docket serve` and anyone else writing
through docket wait their turn, and nothing is written over. A publish made
against an ontology version that is no longer the head (`expectedHead`) is
refused, so two people cannot publish over each other's change.

**Search.** The project's projections are synced after every write, one sync
at a time, and once a minute for files changed beside the server (a
`git pull`, say). With no adapters configured beyond `docket init`'s, that is
the jsonl index in `.docket/.index`. To use SQLite or Postgres for search, add
it to the project as usual (`docket adapter add sqlite`).

### Postgres (opt in)

Set `database.url`, or `DOCKET_DATABASE_URL`:

```bash
DOCKET_DATABASE_URL=postgres://docket:…@db:5432/docket docket serve
```

The canonical store is then the same store Docket Cloud runs, in one schema
(`database.schema`, `public` by default), migrated on start. Writes are
serialised by the store's row locks and `expectedHead`. Each configured
workspace is created on first start. Its first ontology is its `ontology`
file, else its project's (when it has a `path` with a docket), else docket's
default (`sdlc`). An outbox loop projects every write into the configured
`projections`, in-process:

| `projections` entry | Where the index lives | Needs |
| --- | --- | --- |
| `jsonl` (the default) | `<dataDir>/index/<workspace>/.index` | nothing |
| `sqlite` | one file under `<dataDir>/index/<workspace>/` | `better-sqlite3` |
| `postgres` | its own schema in the same database (`urlEnv: DOCKET_DATABASE_URL`) | `pg` |
| `{ id, module, config }` | any docket adapter, configured as in `.docket.yaml` | its package |

Document bodies are stored as plaintext by default. With
`codec: { localKey: { file: ./docket.key } }` (or `DOCKET_CODEC_KEY_FILE`),
they are sealed with AES-256-GCM under one key: 32 random bytes, or their hex
or base64, kept outside the database (`openssl rand -hex 32 > docket.key`).
The search index is plaintext either way.

The page's graph is read from the store. Its questions, adapter status and
evidence views are not yet served over Postgres: ask over MCP.

## Configuration

`docket serve` reads `--config <file>`, else `$DOCKET_SERVE_CONFIG`, else
`docket-server.yaml` in the working directory if there is one. The environment
overrides the file, and the command line overrides both. Paths in the file
resolve from its directory.

```yaml
# docket-server.yaml
listen: { host: 0.0.0.0, port: 4390 }
publicUrl: https://docket.example.com      # what clients reach it at; links and challenges use it
dataDir: ./state                           # tokens and the audit log (and a Postgres server's projections)

workspaces:
  - slug: platform                         # /mcp/platform
    path: /srv/platform                    # files: the project; Postgres: where a new workspace's ontology comes from
  - slug: research
    path: /srv/research
    # ontology: ./research.yaml            # Postgres: the ontology a new workspace starts with

# database:                                # leave out for no database
#   url: postgres://docket:…@db:5432/docket   # or urlEnv: DATABASE_URL
#   schema: public
# codec: { localKey: { file: ./docket.key } }
# projections: [jsonl]                     # Postgres only: jsonl, sqlite, postgres, or { id, module, config }

auth:
  tokensFile: ./state/tokens.yaml          # where `docket serve token` keeps hashes
  tokens: []                               # or tokens given here, read-only: { name, sha256, role, scopes, workspaces }

ontology:
  mcpWriters: [owner]                      # roles whose tokens may publish the ontology over MCP

# ai: { provider: claude, model: haiku }   # or { provider: ollama, model: qwen2.5:7b, url: http://ollama:11434 }
ui: true                                   # the page, behind a token sign-in
```

| Variable | Sets |
| --- | --- |
| `DOCKET_SERVE_CONFIG` | the config file |
| `DOCKET_SERVE_HOST`, `DOCKET_SERVE_PORT` | `listen` |
| `DOCKET_PUBLIC_URL` | `publicUrl` |
| `DOCKET_DATA_DIR` | `dataDir` |
| `DOCKET_WORKSPACES` | `workspaces`: `platform,research`, or `platform=/srv/platform,…` |
| `DOCKET_DATABASE_URL`, `DOCKET_DATABASE_SCHEMA` | `database`: opts into Postgres |
| `DOCKET_CODEC_KEY_FILE` | `codec: { localKey: { file } }` |
| `DOCKET_PROJECTIONS` | `projections`: `jsonl,sqlite` |
| `DOCKET_TOKENS_FILE` | `auth.tokensFile` |
| `DOCKET_ONTOLOGY_MCP_WRITERS` | `ontology.mcpWriters`: `owner,admin` |
| `DOCKET_SERVE_UI` | `ui`: `false` turns the page off |

## Tokens, roles and scopes

There is no sign-in service. Every caller holds a static bearer token, each
with a role:

| Role | May |
| --- | --- |
| `viewer` | search, get, ask, read the ontology |
| `editor` | also write (remember, update notes, add evidence, retire, supersede) and propose ontology changes |
| `admin`, `owner` | the same, and rebuild the projections; publish the ontology over MCP when `ontology.mcpWriters` names their role |

```bash
docket serve token create ada --role owner
docket serve token create ci-bot --role editor --workspace platform --scopes docket:read,docket:write
docket serve token list
docket serve token revoke ci-bot
```

- A token is shown once, when it is made, and the server keeps only its
  SHA-256. Tokens begin `dks_`.
- Its role and its scopes are both upper bounds. On every call the server cuts
  the token's scopes to what its role allows now. `ontology:write` (publishing)
  is effective only while `ontology.mcpWriters` names the role, so by default
  only owners publish over MCP. An editor's token simply does not list
  `docket_publish_ontology_change`, and a call to it is refused with
  `403 insufficient_scope`. The publish itself checks the role again before it
  writes, so a mis-wired setting cannot let an editor through.
- `--workspace` limits a token to some workspaces. Without it, it opens every
  workspace the server serves.
- The tokens file is re-read when it changes, so a revoked token, or one
  whose role changed, takes effect on its next call. No restart is needed.
- Tokens go in the `Authorization: Bearer` header only. A request with a token
  in its URL is refused with 400, since URLs end up in logs. Thirty refused
  credentials in a minute from one address are answered with 429 for the rest
  of that minute.
- Tokens can also be given in the config file (`auth.tokens`, with their
  `sha256`), for a deployment that mounts its secrets. The token commands do
  not change those.

Every request that authenticates is recorded in `<dataDir>/audit.jsonl`: who,
what, the outcome, the latency and the resource it named. Its arguments are
recorded only as a digest, since they hold the workspace's content. Refused
credentials are recorded too.

## Endpoints

| | |
| --- | --- |
| `POST /mcp/{workspace}` | the workspace's MCP endpoint: Streamable HTTP, one JSON-RPC message per POST, JSON answers, no sessions (as in [docs/mcp.md](mcp.md)) |
| `POST /mcp` | the same, when the server serves one workspace |
| `POST /mcp/{org}/{workspace}` | the same, at Docket Cloud's path; the org is ignored |
| `GET /.well-known/oauth-protected-resource/mcp/…` | the resource's metadata (RFC 9728): bearer tokens in the header |
| `GET /healthz` | the process is up: `{ status, service, version, store }` |
| `GET /readyz` | it can answer: its projects can be read, or its database reached (503 otherwise) |
| `/api/w/{workspace}/me`, `…/documents`, `…/documents/push` | the documents API `docket cloud` calls; also at `/api/o/{org}/w/{workspace}/…` |
| `POST /api/w/{workspace}/rebuild` | an owner or admin resets the workspace's projections and projects everything again |
| `/login`, `/logout`, `/` | `docket open`'s page, read-only, after signing in with a token |

## `docket cloud` against `docket serve`

The documents API is the same as Docket Cloud's, for one tenant, so
`docket cloud link`, `push`, `pull` and `status` work against the server with
a token in an environment variable:

```bash
docket cloud link self/platform --url https://docket.example.com --token-env DOCKET_TOKEN
DOCKET_TOKEN=dks_… docket cloud push              # this checkout's files, validated as one push
DOCKET_TOKEN=dks_… docket cloud pull --resources  # what was written on the server
```

Any org name will do: the server has one tenant. `docket cloud login` is for
Docket Cloud's sign-in, which a self-hosted server does not have, so use
`--token-env`.

Over files, a push writes the checkout's documents into the project at their
paths, and `<root>/pushed.yaml` records which checkout each came from. A
checkout's next push updates or removes only its own documents. A path that
already holds another document is refused, unless the text is the same. A
document must be under the project's docket root, and every changed document
is validated against the ontology before anything is written. Over Postgres,
pushed documents are `cli` documents keyed by the checkout, as in Docket Cloud.

## The page

With `ui` on (the default), the server serves `docket open`'s page. The
browser signs in at `/login` with a token, which is checked there and never
kept: the browser gets an opaque, `HttpOnly`, `SameSite=Lax` session cookie
for twelve hours, which ends early if the token is revoked or its scopes
narrow below `docket:read`. The page reads
only. It browses the graph, asks and searches, and shows evidence and how
the index stands. It never starts a sync, since the server keeps the index
in sync itself. Its answers are summarised with the server's `ai` model, and
not at all without one.

## `docket_ask`

`docket_ask` writes a summary with a model. Without `ai` set, it answers that
asking is off on this server, and `docket_search`, which needs no model,
works as before. Set `ai` to the same model sections `.docket.yaml`'s
`summarize` takes: the `claude` CLI (`{ provider: claude, model: haiku }`,
signed in on the server), or an Ollama model
(`{ provider: ollama, model: qwen2.5:7b, url: http://ollama:11434 }`).

## Running it

- **Health.** Point the load balancer at `/readyz` and the liveness check at
  `/healthz`.
- **Rebuilding.** `docket serve --rebuild` resets every workspace's
  projections and projects everything again before it answers.
  `POST /api/w/{workspace}/rebuild` with an owner's or admin's token does one
  workspace while the server runs. Projections are derived data and can be
  rebuilt from the canonical documents at any time.
- **Backups.** Over files, the project is the backup: commit it, or snapshot
  the volume. Over Postgres, `pg_dump` the database, and keep the codec key
  with it.
- **Stopping.** `SIGINT` or `SIGTERM` stops taking requests, waits for the
  sync in hand (or, over Postgres, the workspace being projected), then
  exits.

## What stays in Docket Cloud

The self-hosted server is the shared core: the MCP surface, ontology writes
with the change check and migrations, search, the documents API, and a choice
of store. Docket Cloud adds what a hosted, multi-tenant service needs:
organisations and members, sign-in with GitHub and OAuth for MCP clients, SSO,
per-organisation encryption keys, the hash-chained audit log, rate limits and
AI budgets, enrichment and consolidation, repository connections, the Cloud
web app, and hosted operations.
