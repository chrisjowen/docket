# Changelog

Changes to `@chrisjowen/docket`. Earlier releases are described on the
repository's [GitHub releases](https://github.com/chrisjowen/docket/releases).

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
  ids given), `strict` and `onProgress`. `SyncResult`, `SyncProgress`,
  `SyncSourceOptions`, `TargetReport`, `PassReport`, `RecordRef`,
  `RecordFailure` and `ManifestOrigin` are exported with it.
- Sync's parts: `canonicalState` (`CanonicalState`, `DerivedInput`),
  `planAdapter` (`AdapterPlan`, `AdapterPlanOptions`, `PlannedChange`), and
  what a manifest records - `Checkpoint`, `checkpointOf`, `emptyRecords`,
  `INPUT_KINDS`, `resetPendingFingerprint`, `ADAPTER_MANIFEST_VERSION` and
  `RecordEntry` - with the contracts' `unacknowledged`.
- The bundled adapters: `entityProjectionAdapter`, `EntityProjection`,
  `EntityProjectionAdapterOptions` and `Chat` from the adapter kit, and two
  new entry points, `@chrisjowen/docket/adapters/neo4j`
  (`createNeo4jProjection`, `neo4jConfigSchema`) and
  `@chrisjowen/docket/adapters/mem0` (`createMem0Projection`,
  `mem0ConfigSchema`).
- The graph browser: `readGraph`, its `UiGraph`, `UiEntity`, `UiEdge`,
  `UiAssessment`, `UiIndexStatus` and the types they hold, `iconFor` and
  `MATTER_OPTIONS`.
- Searching and asking: `searchText`, `MAX_SEARCH_LIMIT`, `SEARCH_SCHEMA`
  and the `SearchGraph` types; `askWith` (`AskOutcome`), `snapshotOf`
  (`RequestSnapshot`), `toSearchResult` (`SearchResult`), `citationsIn` and
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
