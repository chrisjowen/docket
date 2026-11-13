# Changelog

Changes to `@chrisjowen/docket`. Earlier releases are described on the
repository's [GitHub releases](https://github.com/chrisjowen/docket/releases).

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
