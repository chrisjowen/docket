# Changelog

Changes to `@chrisjowen/docket`. Earlier releases are described on the
repository's [GitHub releases](https://github.com/chrisjowen/docket/releases).

## Unreleased

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
