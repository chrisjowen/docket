# Changelog

Changes to `@chrisjowen/docket`. Earlier releases are described on the
repository's [GitHub releases](https://github.com/chrisjowen/docket/releases).

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
