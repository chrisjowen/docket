# Changelog

Changes to `@chrisjowen/docket`. Earlier releases are described on the
repository's [GitHub releases](https://github.com/chrisjowen/docket/releases).

## Unreleased

- Deploy a multi-tenant server with Docker Compose or Helm using the same
  `docket-server.yaml`. The image runs the worker inline or separately with
  `docket serve worker --config`.

### The multi-tenant server from `docket serve` and `docket open`

- `docket serve --config docket-server.yaml` runs the multi-tenant Docket
  server when the file says `version: 1` and `mode: multi-tenant`: the API,
  MCP, OAuth, sign-in and the web app on one port, and the worker in the same
  process. `--no-ui` serves it headless; `--no-worker` runs the API alone. It
  runs on `@docket/server-platform` (`platform/`, AGPL-3.0-only), loaded only
  for such a file.
- `docket open --config docket-server.yaml` runs the same file as a local
  preview, in development, and opens the browser.
- `docket open --no-ui` and `docket serve --no-ui` serve the API and MCP
  without the web pages. A single-tenant `docket serve` and a plain
  `docket open` are otherwise unchanged.
- The multi-tenant server signs people in with GitHub, any OpenID Connect
  provider, or a password the operator gives them, all as users of the same
  platform, and calls OpenRouter or any OpenAI-compatible model endpoint; the
  start-up lines say which.

### Users, system accounts, tokens and named connections (multi-tenant server)

- Two kinds of identity: users (people) and system accounts (anything that
  is not a person). Settings › System accounts is the one place to create a
  system account, choose what it may do, and issue, rename and revoke its
  tokens. No person acts for a system account: its writes are its own, so
  its evidence cites a source. Its tokens last up to a year, and the
  account's owners are told two weeks before one expires.
- A token or OAuth connection acts as its owner and can only be narrowed: to
  read-only, and to every docket the owner reaches or chosen ones. There are
  no scopes to choose. Personal tokens start `dkt_pat_`, system account
  tokens `dkt_sys_`; `dkt_live_` tokens keep working.
- Every OAuth sign-in is a named connection, prefilled at consent from the
  client's name and the device ("Claude Code — Mac"), with its dockets and
  read-only chosen there. *Your tokens & connections* lists them with your
  personal tokens, to rename or revoke.
- Activity and evidence record who and through what: "alice via 'Claude Code
  — work laptop'", "github-sync with token 'actions'".
- Existing tokens and OAuth grants keep exactly what they could do: each
  stays on its one docket, read-only when it only read, with any narrower
  scopes kept as its ceiling.

### Access is a role on a place (multi-tenant server)

- Someone gets a role on a place: on the whole account, which covers every
  docket in it, or on one docket. Everything someone is given adds up. A role
  is a bundle of capabilities - Read and ask, Write knowledge, Propose and
  Publish ontology changes, Decide proposals, Create dockets, Manage access,
  Manage system accounts, Manage tokens, Change settings, Delete, See audit
  and usage. Reader, Writer and Admin are built in; an account makes its own
  in Settings › Roles.
- Any one grant can add or remove single capabilities for that person alone:
  "Writer + Publish ontology changes" on one docket lets one person publish
  there, in the app or straight from an MCP client. It replaces the docket
  setting that let a whole role publish over MCP.
- One resolver decides every surface: the web app's buttons and requests,
  MCP, the CLI's API and OAuth consent all ask what the caller may do on that
  docket. Owner and guest are flags on a member: an owner may do everything
  and administers the account; a guest sees only what they are given.
- A docket's Access tab shows what you may do there and why; whoever manages
  access there sees everyone who reaches it, and gives, adjusts and removes
  grants. Users lists each person's role on the whole account, with Explain
  for every grant they hold. Invites carry a role on a place, as a guest or
  not, and anyone who manages access somewhere invites people to it. A system
  account gets its access the same way, from Settings › System accounts.
- Nobody can give, change or take away more than they hold on that place.
- Existing members keep exactly what they could do: owners stay owners,
  admins become Admin, editors Writer and viewers Reader on the whole
  account, and a database account keeps its one docket. Before anything
  changes, the migration works out everyone's access to every docket both
  ways and stops if any answer differs. Whoever could publish an ontology,
  in the app or over MCP, keeps Publish ontology changes; because publishing
  is now one capability, admins and owners may also publish over MCP.

### Spaces, and New docket as its own page (multi-tenant server)

- An account holds spaces, and a space holds dockets: a space groups dockets
  for a team, a department or a client. Every account starts with General,
  which everyone at the account reads unless you change that. A role on a
  space covers every docket in it, including dockets added later; admins on a
  space read every docket in it, so to keep something from them, put it in
  another space.
- The sidebar lists spaces under **Spaces +**, each with its dockets and its
  own **+** for a new docket. Admins on the whole account make spaces. A
  space's page lists its dockets, and its Users & system accounts tab shows
  who reaches it and why, gives, adjusts and removes roles on it, and invites
  people who are not in the account yet straight into it: anyone who manages
  access on a space may.
- New docket is its own page, opened from a space's +, with the space already
  chosen. It searches templates by name, domain or record type, drafts an
  ontology with AI from a description of your domain, and sets initial
  access: who gets a role on the new docket beyond everyone the space already
  gives access. A drafted docket keeps its space and initial access until it
  is accepted. Creating a docket takes Create dockets on its space. The old
  `/o/{org}/workspaces/new` address opens General's New docket page.
- Existing dockets move to General, and so do the account-wide Writer and
  Reader grants: with every docket in General, nobody's access to any docket
  changes, and a docket later made in another space is no longer covered by
  them. A Writer or Reader grant that adds a managing capability stays on the
  account, as do Admin and the account's own roles; open invites to Writer or
  Reader on the account invite to General. General gets Reader for everyone
  unless that would let someone read a docket they cannot read now. The
  migration works out everyone's access to every docket before and after and
  stops if any answer differs.

### API v1 and one MCP address per account (multi-tenant server)

- `/api/v1/accounts/{account}/…` manages an account the way the app does:
  the account itself (rename, transfer ownership, delete: owners only),
  invites, grants (give, change, adjust by single capabilities, remove),
  roles, spaces, dockets (create from a template, a copy or YAML with initial
  access; rename, move, delete), system accounts and their tokens, users and
  owners, the audit log and usage. `/api/v1/me` says who is calling and
  through what; `/api/v1/me/tokens` and `/api/v1/me/connections` manage your
  own. Each call needs the same capability as the button in the app, held by
  whoever the credential acts as, on the place it names.
- A browser session (sending its CSRF token as `X-CSRF-Token`) and a bearer
  token or OAuth connection resolve to the same person or system account and
  the same capabilities. A read-only credential makes only reads; one limited
  to some dockets acts only on them. A personal token is minted only from your
  own browser session, never with a token.
- Every operation, the credentials it takes, the capability it needs, its
  request and response schemas and its errors are defined once in
  `@docket/api` (`packages/api`), which the server routes and validates by and
  the UI can import. `GET /api/v1/openapi.json` publishes them as OpenAPI 3.1.
- `/mcp/{account}` is one MCP address for every docket you may use: each
  docket tool takes a `docket` argument (read tools also take `dockets`, to
  look in several at once), and `docket_list` shows the dockets and what you
  can do in each. A connection or token limited to one docket implies it; a
  read with one docket to choose from uses it; a write always names one.
  `?read_only=1` drops the write tools. Each docket's own address
  (`/mcp/{account}/{docket}`) is unchanged.
- `?admin=1` at the account address adds `admin_*` tools - give and remove
  access, invite, create spaces, dockets and system accounts, rename or move
  a docket, see usage - for a caller who can manage something, checked as the
  API checks them. No tool ever mints a token.
- OAuth sign-in accepts the account's MCP URL as the resource. Consent then
  asks which of the account's dockets the connection reaches (every docket by
  default, or chosen ones) and stores them on the connection.
- `/api/admin/o/{org}/…`, the org admin API with master keys, is unchanged,
  as are existing tokens, OAuth clients and grants. On `/api/v1` a token or
  connection that still carries its old scope ceiling is read-only, and an
  OAuth grant made before named connections is refused.
- A docket's Access tab is drawn by the server's new web UI
  (`packages/docket-ui/cloud`, AGPL-3.0-only), a static app that calls
  `/api/v1` alone. It is bundled with the server by default (`--no-ui` turns
  it off with the other pages) and can also be hosted on its own in front of
  the server, which checks the API version before serving. The other pages
  move to it a feature at a time.

### Storage and AI per space (multi-tenant server)

- AI settings resolve account, then space, then docket. The account chooses
  its models, as before, and may limit which models its spaces and dockets
  choose from; a space may choose others within that list, and a docket its
  own within its space's. Owners see on Settings › AI which spaces and
  dockets chose something of their own.
- A space's Settings tab, for whoever may change settings on it, chooses its
  models, gives it a slice of the account's monthly AI cap (never more than
  the cap), and takes its own OpenRouter, Anthropic or OpenAI key. The key is
  sealed with the account's own encryption key; only its last four characters
  are ever shown or recorded again. Calls for the space's dockets go to that
  provider on that key and are still metered. Spend on a space's own key
  never counts toward the account's cap or its owner warning, and a spent
  account cap does not stop it; it counts toward the space's slice, as spend
  on the account's key does. Anthropic and OpenAI report no cost, so calls on
  those keys are recorded but not held to a slice; an OpenRouter key's are.
  Cognify for a docket stops at its space's slice too, and uses the docket's
  models.
- A space can have its own Neo4j instance (one more pod on the box): its
  Settings tab shows how many pods are left (`DOCKET_NEO4J_POD_CAPACITY`,
  default 8). Its dockets move there once it is up and are rebuilt from their
  records; going back moves them to the account's instance and removes the
  pod. Each new docket gets a Qdrant collection of its own.
- Nothing changes for existing accounts: the account's models move to the new
  settings unchanged, and every existing docket keeps the account's Neo4j and
  its shared Qdrant collection. A migration test checks every docket resolves
  to the same models, key and stores before and after.

### Onboarding, invite links and new addresses (multi-tenant server)

- An account's pages are at `/a/{account}` and a docket's at
  `/a/{account}/d/{docket}`. Every old page address (`/o/{org}/…` and
  `/o/{org}/w/{workspace}/…`) redirects permanently to its new one, query
  and all, and a form posted to an old address is posted again to the new
  one. The CLI's `/api/o/{org}/…`, the org admin API's `/api/admin/o/{org}/…`
  and every MCP address are unchanged.
- The app says account where it said organisation or casebook, Home for an
  account's own page, and Chat for asking the record.
- Signing up is seven steps: sign in (an open invite skips you ahead, into
  its account); create your account at `/start`, as its Owner, with what it
  gets spelled out (Postgres, Neo4j, Qdrant and the AI cap); General, with
  what everyone gets there (Reader by default) and optionally more spaces;
  the first docket, on the same New docket page; connecting an AI client,
  one of three ways; inviting users, one row each; and landing in the
  docket's Chat tab. `/orgs/new` redirects to `/start`, and the home page
  offers it to someone in no account yet who may make one.
- An invite is a link that works once, for 7 days (`/invite/dki_…`), shown
  once to whoever invites and emailed to its address. Whoever holds the link
  to an invite by email may sign in and accept it, whatever their GitHub
  account; an invite to a GitHub login stays that login's. Users › Invite can
  send an invite again with a new link; the old one stops working.
  `POST /api/v1/accounts/{acct}/invites` returns the link, and
  `…/invites/{id}/resend` is new; `admin_invite` over MCP never returns it.
- `DOCKET_MAIL` chooses how invite emails are sent: `log` (the default)
  writes each one's address and subject to the log, never its link; `none`
  sends nothing. There is no mail transport yet, so the link is passed on by
  whoever invites.

## 0.16.0

### Confidence comes from policies about sources

The ontology now says where evidence comes from as `sources:` and how much it
is worth as `trust:` policies, in one place, instead of a number on each
evidence kind and `confidence:` rules scattered over types and relationships.

- A source type declares its own `locator` fields - a message id, a URL, a
  section - beside the common ones every source accepts (`repository`,
  `path`, `lines`, `symbol`, `key`, `method`, `endpoint`, `urls`, `commit`),
  and its `attributes`, each saying who may set it (`directory`,
  `connection`, `registry`, or the `reporter` who files the observation).
  Nothing SDLC-specific is built in.
- A policy reads "when the source is X (about type T, with attributes Y), it
  is worth S" or "…, adjust by ±d". The most specific matching `score` policy
  wins, a tie goes to the lower score, and every matching adjustment applies.
  Conditions test attributes and locator fields (`@path: { matches: … }`).
- Observations of one source instance (`identifiedBy` locator fields, or a
  `sourceRef`) count once; distinct instances add up. Evidence that names no
  instance counts by source type, as before. A writer's claimed `attributes`
  count only where the source type lets the reporter set them.
- `trust` also holds `unevidenced`, `fallback` (0.4), `cap` (0.99), the
  `accept` bar a supersede proposal will need (0.75, decisions 0.80) and the
  confidence `bands` (established 0.80, probable 0.50).
- `docket why <id>` explains a resource's confidence and its links': each
  observation, the policy that priced it, the ones it beat, adjustments,
  ignored claims, and which observations count.
- The ontology change check has a new class, `rescore`, for a change that
  moves confidence and nothing else, and lists every resource and link it
  rescores with its band before and after. A rescore is published without
  `acceptNarrowing`.

### People are sources, and agents act for them

- Every write stamps its evidence with the person the writer acts for
  (`principal`): the people directory's `me` or the login for the local MCP
  server, a `docket serve` token's `--acts-for` person, an MCP principal's
  `actsFor`. Who filed it (`observedBy`) is recorded for audit and never
  scored.
- Evidence may leave out `source`: it is then that person's, under the
  ontology's person source (an `identity` source; the templates now ship
  `person`, with role, team and flags set by the directory, and "A person said
  so" / "A lead said so" policies). Legacy `human` evidence written through the
  tools is recorded as `person`.
- A person cited second-hand - an agent writing "Dana said so" for Tom - counts
  as Tom until Dana gives evidence of her own; the write warns
  `confirm-requested`, and `docket why` shows it.
- The people directory: `.docket/people.yaml` for a project, `people:` in
  `docket-server.yaml` for `docket serve`. Policies only trust the attributes
  the person source lets the directory set, and aliases name one person.
- The MCP evidence schema gains `sourceRef`, `attributes` (claims) and
  `locator` (a source's own fields), and `source` becomes optional.

### Supersede is a scored proposal

- `docket_supersede` records a proposal and returns at once with its id,
  status, score and the bar it needs. It is scored by the same policies -
  `about: supersedes`, or about the replaced record's type - and is accepted,
  the older record going out of date as before, only when its score clears
  `trust.accept` (0.75 by default, 0.80 for decisions). Until then it is
  pending and the older record stays current; the answer names the policies
  that would carry it.
- `docket_add_evidence` takes `supersession: <id>` to support a pending
  proposal; a new policy, a person's new role or a confirmation scores it
  again, and reads see the new score at once.
- `docket_get` shows `pendingReplacement` / `pendingReplaces`, and search and
  ask list `pending` proposals beside the records they touch.
- Acceptance is sticky: the ontology change check lists accepted proposals a
  draft would no longer pass, and pending ones it would carry.
- `docket proposals`, `docket confirm <id>` and `docket reject <id>`. A pending
  proposal with no change in 30 days is flagged stale; nothing is dropped.
- Supersessions recorded before are accepted, as they were (`docket serve`'s
  Postgres store marks them grandfathered in migration `core_0002`).

### Existing ontologies score exactly as before

An `evidence:` block and `confidence:` rules still load, with a
`legacy-evidence-settings` warning, and are read as sources and policies that
give every resource and link the same confidence - and the same projection
hash, so nothing reprojects. `docket ontology convert --write` rewrites the
file in the new form without changing a score or any other line. The bundled
templates are now in the new form, with a 0.99 cap and a 0.40 fallback for an
observation no policy prices.

## 0.15.1

### Ask answers with the current record when one has been superseded

`docket ask`, Ask in `docket open` (and in Wheelhouse), and `docket_ask` now
all apply the project's supersessions (`.docket/supersessions.yaml`, written
by `docket_supersede`), as `docket_search` and `docket_get` already did. Before,
only `docket_ask` named the change, and every adapter still ranked the
superseded record where it found it.

- A record gone out of date is ranked after the current ones in each adapter's
  entity hits, its passages and facts, and the references. Nothing is dropped.
- The answer names each one in `changes`, with the record current now and a
  note of the change: `docket ask` prints them first and marks the record
  `out of date` where an adapter lists it, and Ask shows them above the
  summary.
- A summary is told which records are out of date, so it answers with the
  current one.

### `reportedBy` is an evidence field

Writes through the MCP tools keep who reported something, when that was not
the writer, as `reportedBy` on its evidence. docket's parser now accepts that
field, so `docket sync` and `docket validate` no longer warn
`unknown-evidence-field: "reportedBy" ignored` for each entry, and the field
reaches the graph with the rest of the evidence.

## 0.15.0

### `docket_get` draws a resource as its card

`docket_get` now carries the MCP app too (`_meta.ui.resourceUri`
`ui://docket/search.html`, the same page as `docket_search`'s board), so a
host that draws MCP apps, such as Wheelhouse, shows one resource as its card
where it was read: its type and title, its confidence and how it was reached,
its tags, the opening of its notes (or its summary), its attributes, its links
by relationship, the kinds of source its evidence comes from and the evidence
itself, the documents that declare it, and whether it has gone out of date.

- A link, a mention in its notes, its replacement or a record it replaced
  opens that resource's card, through `docket_get`; **Back** returns to what
  the app showed before.
- On `docket_search`'s board, **Show card** on a picked resource opens its
  card.
- The card offers **Open in docket** and full screen where the host does.
- Every Docket MCP server offers it: the definition is the shared surface's,
  so `docket open`'s `/mcp` and `@chrisjowen/docket-server` list the same
  `docket_get`, and the parity test still holds.

## 0.14.0

### `docket serve` as an image, with Docker Compose and a Helm chart

`docket serve` ships as `ghcr.io/chrisjowen/docket`, for linux/amd64 and
linux/arm64: docket and `@chrisjowen/docket-server` on a distroless Node 22
base, running as nonroot, with the drivers docket's opt-in stores load.
[docs/deploy.md](../../docs/deploy.md) covers running it.

- **Docker Compose** (`deploy/compose`): by default one container serving a
  docket kept as files on a volume, made with `docket init` on first start.
  No database. Profiles add Postgres (`postgres`), Neo4j (`graph`), Qdrant
  and an Ollama embedder (`semantic`), and cognee (`cognee`). Nothing pulls
  implicitly (`pull_policy: never`), `down` keeps the volumes, and secrets
  come from `.env` or mounted files, which are kept out of git.
- **Helm** (`deploy/helm/docket`): a single-pod Deployment over a
  PersistentVolumeClaim, a Service, a generic Ingress and NetworkPolicies
  that admit only docket to the stores. Postgres is opt-in, as your own
  (`postgres.external`) or one in the release for evaluation
  (`postgres.bundled`). Neo4j, Qdrant, the embedder and cognee are opt-ins
  too. Every secret comes from an existing Secret, or is generated once and
  kept, and tokens can be read from a Secret (`auth.existingSecret`).
- `deploy/test` checks them: chart lint and render snapshots, and docket
  serve's gates against Compose and against the chart on kind, with no
  database and with Postgres. `.github/workflows/image.yml` runs them on
  every pull request, and publishes the image on each `v<version>` tag.
- Releases `@chrisjowen/docket-server` 0.9.0, where `docket serve` takes a
  variable set to nothing as unset.

## 0.13.0

### `docket serve`: a self-hosted, single-tenant Docket server

`docket serve` serves a docket to several people and agents at once, over
MCP from wherever they work, all writing to one ontology and one set of
documents. It offers Docket's whole MCP surface - the same eleven tools as
Docket Cloud and `docket open` - at `/mcp/<workspace>` (and `/mcp` when it
serves one), with `/healthz`, `/readyz` and `docket open`'s page behind a token
sign-in. It runs on `@chrisjowen/docket-server` 0.8.0, which docket loads only
when serving: install it beside docket. See
[docs/self-hosting.md](../../docs/self-hosting.md).

- **No database by default.** Each workspace is a project's own files,
  written through the same local tools as `docket open`'s MCP server and
  indexed by the project's own projections (jsonl unless it says otherwise),
  synced after every write. Postgres is an opt-in (`DOCKET_DATABASE_URL`), as
  the canonical store with jsonl, SQLite or Postgres projections.
- **Static tokens.** `docket serve token create|list|revoke`: each token has a
  role (owner, admin, editor, viewer), optional narrower scopes and the
  workspaces it opens. It is shown once and only its hash is kept. Bearer
  only, refused in a URL. `ontology.mcpWriters` names the roles that may
  publish the ontology over MCP (owners by default). Without an `ai` model,
  `docket_ask` says it is off and search still works.
- **`docket cloud link|push|pull|status`** work against a `docket serve` URL
  with `--token-env`: the server answers the documents API at Docket Cloud's
  paths for its one tenant. Over files, a push writes the checkout's documents
  into the project, recording which checkout each came from in
  `<root>/pushed.yaml`.

### Writes take turns across processes

The local MCP tools' writes now hold the project's lock file
(`.docket/.cache/write.lock`) as well as queueing within the process, so
`docket open`, `docket serve` and any other docket process writing to the
same project wait their turn instead of writing over each other. A lock left
by a process that died is taken over.

### For hosts

- `@chrisjowen/docket/host`: what a server hosting a project's docket runs it
  with - the project's config, its write lock, `ProjectIndexer` (sync after
  writes, rebuild), the documents API over files (`listProjectDocuments`,
  `pushToProject`), and `docket open`'s page and reads as one request handler
  (`readViews`).
- `localTools` takes `ask` (a server's own model, or `false` to turn
  `docket_ask` off) and `publisher` (who may publish the ontology, re-checked
  on every call). `askWith` takes a `summarize` model of the caller's own.
- `checkoutProblem` joins the workspace core.

## 0.12.0

### Postgres and SQLite adapters, opt-in

Two new adapters ship bundled, for a team that wants ranked full-text search
and graph answers without Neo4j, mem0 or Qdrant. Neither is a default:
`jsonl` stays the only adapter a new docket has, and it needs no database.

- **`docket adapter add postgres`** configures
  [`@docket/adapter-postgres`](../adapter-postgres/README.md)
  (`@chrisjowen/docket/adapters/postgres`): entities and their links in tables
  of its own in Postgres 16 or later, in a schema it migrates itself
  (`docket_index` by default), one scope per checkout. It searches by
  full-text - `websearch_to_tsquery`, ranked by BM25 over the title, type and
  tags, and body, weighted in that order, as Lucene ranks, with a pg_trgm lift
  for a title
  named or misspelt in the query - and, with `semantic` set, by Ollama
  embeddings in pgvector too, fused by reciprocal rank. Its driver is `pg`, an
  optional peer dependency.
- **`docket adapter add sqlite`** configures
  [`@docket/adapter-sqlite`](../adapter-sqlite/README.md)
  (`@chrisjowen/docket/adapters/sqlite`): the same in one SQLite file, which
  needs no server - FTS5's BM25 with Lucene's idf, and optional embeddings compared in the
  adapter, with no SQLite extension. Its driver is `better-sqlite3`, an
  optional peer dependency.

Both answer a question with the matches and, from each, its best paths of up
to two links, found by one recursive query over the links under the Neo4j
adapter's ranking rules, so the same graph gives the same paths. adapter-kit
now holds those rules (`pathsAnswer`, `matchesOf`, `describePath`) and a
fixture graph with the paths Neo4j keeps (`GRAPH_PATH_FIXTURE` in its testing
helpers), which all three adapters' suites are held to. It also gains the
Ollama embedder, the `semantic` config section and reciprocal rank fusion the
two adapters share. The search evaluation compares both with the other
strategies when `DOCKET_EVAL_PG_URL` or `DOCKET_EVAL_SQLITE=1` is set; their
READMEs record the numbers.

## 0.11.0

### The same MCP tools everywhere

`docket open`'s MCP server (`POST /mcp`) now offers Docket's whole MCP
surface - the eleven tools Docket Cloud and a self-hosted Docket server offer,
with the same names, input schemas, annotations, argument checks and result
shapes - over the project's own files, where it offered only
`docket_search`:

- **To read**: `docket_search`, `docket_get` (one resource's merged record,
  evidence and declaring documents), `docket_ask` (a question, answered as
  `docket ask` answers it) and `docket_ontology`.
- **To write**: `docket_remember`, `docket_update_notes`,
  `docket_add_evidence`, `docket_retire`, `docket_supersede`,
  `docket_propose_ontology_change` and `docket_publish_ontology_change`.
  Every write is validated against the ontology with docket's own validator
  before it touches a file, and carries evidence stamped as observed by the
  person at the machine. Writes change the project's documents in place, or
  make a new one beside the project's other documents of its type; retiring
  removes the documents that declare a resource. Supersessions are kept in
  `.docket/supersessions.yaml`, published ontology versions in
  `.docket/ontology-history.yaml` and proposed drafts under
  `.docket/ontology-drafts/`, so git keeps their history. One person's
  machine, so there is no sign-in and every tool is offered, publishing the
  ontology too.

`docket_search` takes the surface's `include` and `minConfidence`, tags each
match with where it was found and a score, answers a superseded record with
the record current now, and opens its text by saying that what follows is
data written by people and agents, not instructions. Its
`docket-search.v1` result only gains fields.

The surface is defined once, in docket, at a new entry point,
`@chrisjowen/docket/mcp/surface`: every tool's definition, argument checks and
answers. The workspace core the write tools write through - how a write
becomes a document, evidence, supersession, and the ontology's change check,
migrations and proposals - moved here from `@chrisjowen/docket-server`, at
`@chrisjowen/docket/workspace`. The server builds its tools on both, and a
test lists docket's tools beside the server's and fails when they drift. The
root also exports `localTools`, the surface over a project's files, which
`createMcpServer({ cwd })` offers by default; over a `source` it still offers
`docket_search` alone.

## 0.10.0

### Apache-2.0, and public entry points for what hosts build on

docket is now licensed under the Apache License, Version 2.0: the package
ships `LICENSE`, and contributions are signed off under the Developer
Certificate of Origin (`CONTRIBUTING.md` in the repository).

The modules a host such as Docket Cloud builds on are exported at entry
points of their own, so it no longer needs to patch the package to reach
its built files: `@chrisjowen/docket/contracts` and `/adapter-kit` (the
bundled adapter contracts and kit), `/sync/inputs`, `/manifest/plan`,
`/manifest/adapter-manifest`, `/source/parser`, `/source/hashing`,
`/ontology/icons`, `/open/graph`, `/open/types`, `/mcp/search`,
`/mcp/types`, `/query/ask`, `/query/snapshot`, `/query/synthesis` and
`/query/legacy`, beside the root and `/adapters/neo4j`, `/adapters/mem0`
and `/adapters/cognee`. Each is the whole module, and the root's exports
are unchanged. A snapshot of every entry point's declarations is part of
the tests, so a change to the public API fails them until it is recorded
on purpose. Nothing docket does changed.

## 0.9.0

### Docket Cloud's look, in docket open and the search app

`docket open`, the `docket_search` MCP app and the casebook inside
Wheelhouse now look like Docket Cloud: its "Case Record" design of ivory
paper, ink and one accent, signal red, in light and dark, set in Instrument
Serif, Geist and Geist Mono. The evidence board is Docket Cloud's network:
each exhibit a case card - its id, type code, title and confidence - on a
dotted canvas, joined by curved connectors; picking one frames it and its
neighbours, draws its links in red and fades the rest. The casebook is laid
out as a docket is in the cloud - a sidebar with Browse, Ask and Adapters, a
breadcrumb bar, serif page titles and tabbed views - with the type and
relationship filters behind the board's Filters button. The search app keeps
this look in every host, following only the host's light or dark theme, so
Docket Cloud returns it the same way once it takes this release.

## 0.8.0

### A cognee adapter

`docket adapter add cognee --url <server>` configures
[`@docket/adapter-cognee`](../adapter-cognee/README.md), which projects
entities into a cognee 1.6.8 dataset over its REST API, cognifies them into
cognee's knowledge graph, and answers with cognee's chunk search - each hit
mapped back to its entity - and, when configured, cognee's cited completion
as a derived fact. The package ships bundled in `dist/bundled/adapter-cognee`,
like the jsonl, neo4j, mem0 and cloud adapters, and is exported as
`@chrisjowen/docket/adapters/cognee`, so a project needs nothing but docket
and a cognee server it runs: docket never starts one. The search evaluation
compares it with the other strategies when `DOCKET_EVAL_COGNEE_URL` names a
server.

### Ontology templates beyond software delivery

`docket init --template <name>` starts a docket from another bundled ontology
than the default SDLC one: `people-org` (people, teams, organisations, roles,
locations, skills), `crm` (accounts, contacts, leads, deals, cases, products,
activities, reps, contracts, campaigns), `research` (papers, authors,
institutions, venues, datasets, methods, topics, claims),
`personal-knowledge` (people, conversations, events, notes, places,
interests, goals) or `product-catalogue` (products, variants, categories,
brands, collections, suppliers). Each has its own evidence sources, and is
exported as `ONTOLOGY_TEMPLATES`. `docket init` without `--template` is
unchanged.

### A search evaluation

`pnpm -C packages/docket eval:search` loads corpora from six ontologies into
local dockets - including LoCoMo, SciFact and WANDS, fetched by
`eval:search:download` rather than committed - and compares single-pass,
relevance-floored, precached and agentic search on relevance, on
no-answer queries such as "who is sophia", and on latency
([eval/search](eval/search/README.md)). Nothing in docket's own search
changed.

## 0.7.0

Includes everything in 0.6.1, which was staged but never published.

### `docket cloud`: share a project's knowledge with a Docket Cloud workspace

A project can now link to a Docket Cloud workspace, sign in, push its
canonical files and search the workspace beside its local adapters
([#53](https://github.com/chrisjowen/docket/pull/53)). Every `docket cloud`
command is optional: a project with no cloud linked works exactly as before,
and no other command makes a network call.

- `docket cloud link <org>/<workspace>` adds a query-only `cloud` adapter
  instance to `.docket.yaml`, offline. `--url` names another cloud than
  `https://docket.chrisjowen.net`; `--token-env` names the variable holding an
  API token for CI.
- `docket cloud login`, `logout` and `whoami`: a sign-in is for the linked
  workspace. `login` uses the device authorization grant (RFC 8628), printing
  a code and opening the browser to enter it. The session goes to the OS
  keychain, or to `~/.config/docket/credentials.json` created readable only
  by you (`DOCKET_KEYCHAIN=off` forces the file); access tokens renew as they
  are used.
- `docket cloud push [--dry-run]` sends only the canonical files whose hash
  differs from the cloud's copy, retires the ones the checkout no longer has,
  prints the cloud's validator diagnostics, and proposes a differing
  `entities.yaml` as an ontology draft, never publishing it.
- `docket cloud pull` writes the published ontology; `--resources` writes the
  documents written in the cloud instead, and `--ontology --resources` both.
  The ontology file is replaced with the published version; a resource
  document you already have is never overwritten.
- `docket cloud status`: the link, the sign-in, the ontology against the
  published one, and what a push would send.
- `docket cloud token create|list|revoke` for CI tokens.

### The cloud adapter

`@docket/adapter-cloud`, bundled in the package, answers `docket search`,
`ask`, `open` and the local MCP server from the workspace's `docket_search`
tool. A match this checkout also holds is an entity hit; every match is
evidence naming the resource. Offline or signed out it reports itself
`unavailable` and the other adapters' answers stand. `DOCKET_OFFLINE=1` stops
every cloud request before it leaves the machine.

## 0.6.1

### Sync, and what a host reconciles and draws with, in the public API

A host running docket over its own storage, such as a hosted service, can
now sync, reconcile, browse the graph and answer searches with docket's own
code through the package's public API, instead of patching in an
`./internal/*` export to reach its built modules.

- `sync(source, manifests, adapters, options?)`: `docket sync` over any
  `CanonicalSource`, into `SyncTarget`s (`{ id, fingerprint, create }`)
  whose manifests a `ManifestStore` keeps. Each instance is planned,
  batched, retried, reset and recorded exactly as the CLI syncs a project;
  one that fails is reported in `SyncError.result` while the others sync.
  `options` takes the `scope`, `fresh` (a rebuild, of every instance or the
  ids given), `strict` and `onProgress`. `SyncResult`, `SyncProgress` and
  `SyncSourceOptions` are exported with it.
- Sync's parts: `canonicalState` (`CanonicalState`), `planAdapter`
  (`PlannedChange`), and what a manifest records - `Checkpoint`,
  `emptyRecords`, `INPUT_KINDS` and `resetPendingFingerprint` - with the
  contracts' `unacknowledged`.
- The bundled adapters: `entityProjectionAdapter` and `Chat` from the
  adapter kit, and two new entry points, `@chrisjowen/docket/adapters/neo4j`
  (`createNeo4jProjection`, `neo4jConfigSchema`) and
  `@chrisjowen/docket/adapters/mem0` (`createMem0Projection`,
  `mem0ConfigSchema`).
- The graph browser: `readGraph`, its `UiGraph`, `UiEntity`, `UiEdge`,
  `UiAssessment` and `UiIndexStatus`, `iconFor` and `MATTER_OPTIONS`.
- Searching and asking: `searchText`, `MAX_SEARCH_LIMIT`, `SEARCH_SCHEMA`,
  `SearchGraph`, `SearchLink`, `SearchNode` and `SearchPath`; `askWith`
  (`AskOutcome`), `snapshotOf`, `toSearchResult`, `citationsIn` and
  `synthesisPrompt`.

### Fixes

- A manifest sync hands a `ManifestStore` now carries the checkpoint of the
  records it holds. The file store always recomputed it, so local docket is
  unchanged; a store that keeps manifests as given recorded a stale one.

## 0.6.0

### Ports for running docket over something other than a directory

Docket core now reads the canonical record and keeps sync manifests through
two ports, so a host such as a hosted service can run docket over its own
storage. The project's files remain the default of both, and local docket
behaves as before ([#50](https://github.com/chrisjowen/docket/pull/50)).

- `CanonicalSource`, with `CanonicalDocument` and `UnreadableDocument`: the
  ontology's text and revision, and every document as `{ path, raw, hash }`.
  `filesystemSource(resolved)` reads a project's files.
- `ManifestStore`: read, write, list and remove each adapter instance's sync
  manifest. `fileManifestStore(stateRoot)` writes the same files sync always
  has. `AdapterManifest` is exported with it.
- `openDocket` accepts `manifests` (a `ManifestStore`) and `models`, which
  adapters receive as `AdapterServices.models`. The Neo4j adapter writes
  Cypher with `services.models.cypher` when its own `cypher` config is unset.
- `createMcpServer` takes `{ source }` or `{ cwd }`, plus an optional tool
  registry. `searchTool` is the default and only entry; a tool name the
  registry does not own is refused. `McpServer`, `McpServerOptions`, `Tool`,
  `ToolContext`, `ToolDefinition`, `ToolRegistry`, `ToolResult` and
  `InvalidArgumentsError` are exported.

### Validation in the public API

A host that holds canonical documents somewhere other than a directory can
now validate them exactly as `docket validate` does, through the package's
public API instead of reaching into its built modules.

- `validate({ source })`, with `ValidateOptions` and `ValidateResult`: the
  whole read-only pass over any `CanonicalSource`. `readCanonical(source)`
  (`CanonicalRead`) reads and parses a source once.
- Its parts: `parseOntology` (`LoadedOntology`), `parseMemoryFile`
  (`ParseResult`), `hashContent`, `validateDocuments`
  (`ValidateDocumentsOptions`), `aggregate` (`AggregateResult`) and
  `confidenceModel` (`ConfidenceModel`).
- The configuration and model they work on: `memoryConfigSchema`,
  `MemoryConfig`, `ResolvedConfig`, `ontologySchema`, `Ontology`,
  `MemoryDocument`, `MemoryEntity`, `ATTRIBUTE_TYPES`,
  `EVIDENCE_LOCATION_FIELDS`, and the diagnostic helpers `error` and
  `warning`. Validation's diagnostic type is exported as
  `ValidationDiagnostic`, because `Diagnostic` remains the adapter contracts'.
- The bundled icons: `ICON_NAMES`, `IconName`, `FALLBACK_ICON` and
  `isIconName`.

### Also in this release

- `docket open` runs `docket sync` from its header, for every projection
  adapter or one, with live progress; it listens on 127.0.0.1 unless `--host`
  says otherwise ([#40](https://github.com/chrisjowen/docket/pull/40),
  [#41](https://github.com/chrisjowen/docket/pull/41)).
- `docket open` serves docket's MCP server at `POST /mcp`, whose
  `docket_search` tool carries an MCP app that draws what a search finds on
  the casebook's evidence board
  ([#43](https://github.com/chrisjowen/docket/pull/43),
  [#44](https://github.com/chrisjowen/docket/pull/44)); the board draws the
  subgraphs adapters return instead of guessed neighbours
  ([#47](https://github.com/chrisjowen/docket/pull/47)).
- The Neo4j adapter answers a search with one native ranked subgraph query
  ([#48](https://github.com/chrisjowen/docket/pull/48)).
- `docket open --allow-origin` and `docket --version`, used by docket's
  Wheelhouse plugin, which now ships with the CLI built from its own commit
  ([#42](https://github.com/chrisjowen/docket/pull/42),
  [#46](https://github.com/chrisjowen/docket/pull/46)).
- The Claude plugin's background review runs with every hook disabled
  ([#45](https://github.com/chrisjowen/docket/pull/45)).
