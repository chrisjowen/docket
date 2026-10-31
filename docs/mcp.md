# docket's MCP server: `docket_search`

`docket open` is also an [MCP](https://modelcontextprotocol.io) server for the
docket it serves. It has one tool, `docket_search`, whose result carries an
[MCP app](https://modelcontextprotocol.io/extensions/apps) (the
`io.modelcontextprotocol/ui` extension, stable spec 2026-01-26). The app draws
the matching resources and their links on the casebook's evidence board. A host
that draws MCP apps, such as Wheelhouse, shows that board where the search was
made. A host that does not still gets the result as text.

The server is in `packages/docket/src/mcp/`, the app in
`packages/docket-ui/src/mcp-app/`. This file is the contract they keep.

## Transport

| | |
| --- | --- |
| Endpoint | `POST /mcp` on `docket open`'s address, e.g. `http://127.0.0.1:4400/mcp` |
| Transport | Streamable HTTP. Each POST carries one JSON-RPC 2.0 message, and the answer is `application/json`. Batches, `GET` streams and SSE are not offered (`GET` answers 405). |
| Sessions | None. `initialize` returns no `mcp-session-id`, so every request stands on its own. |
| Protocol versions | `2025-11-25`, `2025-06-18`, `2025-03-26`. `initialize` returns the client's version when it is one of these, else the newest. |
| Capabilities | `tools`, `resources`. |
| Who may call | This machine only: a request from a loopback address with a loopback `Host` (`127.0.0.1`, `localhost` or `[::1]` and the port). It is for programs, such as Wheelhouse's MCP client, which send no browser headers. A browser page cannot reach it, even one `--allow-origin` named: the body must be `application/json` (else 415), which a page cannot send without a CORS preflight, and `/mcp` answers no preflight (405, with no CORS headers). |
| Discovery | `GET /api/health` includes `"mcp": "/mcp"`. |

Notifications (`notifications/initialized` and the rest) are answered with 202
and no body. Anything other than one JSON-RPC message is answered with 400 and
JSON-RPC error `-32700` (not JSON) or `-32600` (not a request).

In Wheelhouse, the docket plugin declares this server as its MCP server
`docket` on its `viewer` service, at path `/mcp`
(`.wheelhouse-plugin/plugin.json`, `wheelhouse/src/server.ts`). Wheelhouse
starts the viewer per project, so each project's `docket` server searches
that project's docket.

## The tool: `docket_search`

```json
{
  "name": "docket_search",
  "title": "Search the docket",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "minLength": 1 },
      "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 },
      "project": { "type": "string" }
    },
    "required": ["query"],
    "additionalProperties": false
  },
  "annotations": { "readOnlyHint": true, "idempotentHint": true, "openWorldHint": false },
  "_meta": { "ui": { "resourceUri": "ui://docket/search.html" } }
}
```

- `query` is what to look for, in words. It is trimmed and must not be empty.
- `limit` is the number of hits asked of each projection, as `docket search -n` takes.
- `project` is the project the host means. Wheelhouse sends its project id,
  and picks the project's `docket` server by it; a call without it is not
  drawn as an app. The server searches its own docket whatever it says, so it
  is not checked against the docket's name.
- The tool only reads, so Wheelhouse runs it, and an app's call to it, without
  asking. Its `_meta.ui` gives no `visibility`, so both the model and the app
  can call it.
- If the arguments are wrong (no query, a limit out of range, a project that
  is not a string, any other key) or the tool name is unknown, the answer is
  JSON-RPC error `-32602`. If the docket cannot be read (no `.docket.yaml`,
  say), the answer is a result with `isError: true` and the reason as text.

It runs `docket search` (every adapter enabled for query, through the shared
coordinator) and reads the graph from the canonical files, as `docket open`'s
`GET /api/graph` does.

### The board

The board shows what the projections returned, not relationships guessed
between their hits (`docs/adapter-spec.md` §13). It is filled in this order,
up to 60 resources:

1. The matches: the entities each projection's entities blocks name.
2. The subgraphs the projections returned, as their graph blocks hold them:
   their nodes, their relationships with the evidence each cites, and the
   paths they used. A node that names an entity the files hold takes the
   entity's id. Any other node is a ghost under the id the projection gave
   it, prefixed with the projection's id (`neo4j:x`) if that is an entity's
   id the node does not name. A relationship that two projections returned is
   drawn once, with both in `foundBy`.
3. Canonical context: the resources one link away from each match, and every
   link the files declare between two resources on the board. These have
   `via: "canonical"`.

When a projection returned a subgraph, the app draws it at full strength and
the canonical context faded. When none did, as with the keyword and semantic
projections, the board is the matches and their canonical neighbours, and
nothing fades.

### The result

`content` is one `text` item for the model to read. It names each match with
its id, type, title, canonical file, confidence and links. Each returned link
names the projections that returned it and its confidence. It then lists:

- the other resources the projections returned
- the paths they used, step by step, each with the evidence its relationships cite as its `why`: `service.orders -depends_on-> service.ledger -depends_on-> datasource.ledger-db (neo4j)`
- each relationship they returned, with the evidence it cites as its `why`
- the resources one link away in the files

Last, it says how each projection answered, and whether the search index is
behind the files.

`structuredContent` is a `docket-search.v1` object, which the app draws
(`packages/docket/src/mcp/types.ts`):

```jsonc
{
  "schema": "docket-search.v1",
  "query": "orders",
  "project": { "name": "shop", "root": "/work/shop" },
  // What the projections found, most relevant first: the order the first answering projection ranked them in.
  "matches": [
    { "id": "service.orders", "type": "service", "title": "Orders API",
      "path": ".docket/resources/services/orders.md", "confidence": 0.8, "foundBy": ["local"] }
  ],
  // The matches, the nodes of the subgraphs the projections returned, then the resources
  // one link away from the matches, either direction: at most 60.
  // `via` is "adapter" for what a projection returned, "canonical" for context read from the files.
  "nodes": [
    { "id": "service.orders", "type": "service", "title": "Orders API", "path": "...", "match": true, "ghost": false, "via": "adapter" },
    { "id": "service.ledger", "type": "service", "title": "Ledger", "path": "...", "match": false, "ghost": false, "via": "adapter" },
    // A node no file defines: here, a link target the projection's graph holds.
    { "id": "datasource.ledger-db", "type": "", "title": "datasource.ledger-db", "match": false, "ghost": true, "via": "adapter" },
    { "id": "team.payments", "type": "team", "title": "Payments", "path": "...", "match": false, "ghost": false, "via": "canonical" }
  ],
  // The relationships the projections returned, with who returned them, the highest confidence
  // any gave (0 to 1, when one says) and the text of the evidence they cite. Then every
  // relationship the files declare between two resources on the board.
  "links": [
    { "source": "service.orders", "rel": "depends_on", "target": "service.ledger", "via": "adapter",
      "foundBy": ["neo4j"], "confidence": 0.9, "why": ["Orders posts to the ledger."] },
    { "source": "service.ledger", "rel": "depends_on", "target": "datasource.ledger-db", "via": "adapter", "foundBy": ["neo4j"] },
    { "source": "service.orders", "rel": "owned_by", "target": "team.payments", "via": "canonical" }
  ],
  // The paths the projections used, as the ordered ids of the resources on them, each on the board.
  // Each path's why is the evidence its relationships cite.
  "paths": [{ "nodes": ["service.orders", "service.ledger", "datasource.ledger-db"], "foundBy": ["neo4j"],
      "why": ["Orders posts to the ledger."] }],
  // Returned nodes and neighbours left off to keep the board at 60.
  "omitted": 0,
  // Every resource type, with its icon and how many entities the whole docket has of it,
  // so the app colours types as the casebook does.
  "types": [{ "name": "service", "icon": "server", "count": 7 }],
  "sources": [{ "name": "local", "hits": 1, "note": "Keyword (BM25) search ..." }],
  "index": { "synced": true, "behind": 0 },
  // docket open's page: the casebook shows a resource at <viewer>#<id>.
  "viewer": "http://127.0.0.1:4400/",
  "warnings": []
}
```

`via`, `foundBy`, `confidence`, `why` and `paths` were added to
`docket-search.v1` without changing its schema name: a reader that ignores
them reads the result as before.

A source that could not answer has `error` instead of hits. When `index`
says the index is not synced, or is `behind` the files, the search may miss
what the files hold; `docket sync` catches it up.

## The app: `ui://docket/search.html`

`resources/read` of `ui://docket/search.html` returns one item: `mimeType`
`text/html;profile=mcp-app`, the page as `text`, and
`_meta.ui: { "prefersBorder": true }`. The page is a single HTML document of
about 270 KB, with its script and styles inlined. It declares no CSP origins,
because it needs no network. It is built from docket-ui's own components: the
casebook's graph view, type marks and buttons.

The app speaks the MCP Apps bridge:

- It sends `ui/initialize` (`protocolVersion` `2026-01-26`,
  `appCapabilities.availableDisplayModes: ["inline", "fullscreen"]`), then
  `ui/notifications/initialized`, then `ui/notifications/size-changed` as its
  height changes.
- It reads `ui/notifications/tool-input` (the query, for its search box),
  `ui/notifications/tool-result` (draws `structuredContent` when it is
  `docket-search.v1`, else shows the result's text) and
  `ui/notifications/tool-cancelled`. It answers `ui/resource-teardown`.
- It follows `ui/notifications/host-context-changed`, and the `hostContext`
  from `ui/initialize`. It takes the light or dark `theme`, and the host's
  style variables over docket's own colours: `--color-background-primary`,
  `--color-background-secondary`, `--color-text-primary`,
  `--color-text-secondary`, `--color-border-primary`, `--border-radius-md` and
  `--font-sans` (`HOST_TOKENS` in `bridge.ts`). The graph keeps the casebook's
  own surface and type colours.
- It asks the host for:
  - `tools/call` of `docket_search`, from its search box.
  - `ui/open-link` of `<viewer>#<id>`, through **Open in docket** on a picked
    resource.
  - `ui/request-display-mode`, for full screen when the host offers it.

  It asks for nothing else.

On the board, a subgraph a projection returned stands at full strength. The
canonical context (`via: "canonical"`) fades, and a note beside the board says
what the faded part is. The list beside the board shows the matches, then the
paths the projections returned. Picking a resource, on the board or in either
list, brings it and its neighbours forward. It also shows its file and its
links, and for each returned link, who returned it, its confidence and why.

## Building

`pnpm build` at the repository root builds the app (docket-ui's
`vite build --config vite.mcp-app.config.ts`, also `pnpm -C packages/docket-ui
build:mcp-app`) into `packages/docket-ui/mcp-app/search.html`. The docket
package's build copies it to `dist/mcp-app/search.html`, and `docket open`
reads it from there. If the app is not built, `resources/read` answers with an
error that says so.
