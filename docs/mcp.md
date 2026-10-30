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
| Who may call | This machine only: a request from a loopback address with a loopback `Host` (`127.0.0.1`, `localhost` or `[::1]` and the port). A browser request that another site sent is refused (403) unless `--allow-origin` named that site. A program, such as Wheelhouse's MCP client, sends no browser headers and is answered. The body must be `application/json` (else 415), so a page on another site cannot post to it without a preflight, which is refused. |
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
      "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }
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
- The tool only reads, so Wheelhouse runs it, and an app's call to it, without
  asking. Its `_meta.ui` gives no `visibility`, so both the model and the app
  can call it.
- If the arguments are wrong (no query, a limit out of range, any other key) or
  the tool name is unknown, the answer is JSON-RPC error `-32602`. If the docket
  cannot be read (no `.docket.yaml`, say), the answer is a result with
  `isError: true` and the reason as text.

It runs `docket search` (every adapter enabled for query, through the shared
coordinator) and reads the graph from the canonical files, as `docket open`'s
`GET /api/graph` does.

### The result

`content` is one `text` item for the model to read. It names each match with
its id, type, title, canonical file, confidence and links. It then lists the
resources one link away, says how each projection answered, and says whether
the search index is behind the files.

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
  // The matches, then the resources one link away from them, either direction: at most 60.
  "nodes": [
    { "id": "service.orders", "type": "service", "title": "Orders API", "path": "...", "match": true, "ghost": false },
    { "id": "team.payments", "type": "team", "title": "Payments", "path": "...", "match": false, "ghost": false },
    // A link target no file defines yet.
    { "id": "service.ledger", "type": "", "title": "service.ledger", "match": false, "ghost": true }
  ],
  // Every relationship whose two ends are both on the board, as the source's file declares it.
  "links": [{ "source": "service.orders", "rel": "owned_by", "target": "team.payments" }],
  // Neighbours left off to keep the board at 60.
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

On the board, the matches' own links stand out. Picking a resource, on the
board or in the list beside it, brings it and its neighbours forward and
shows its file and its links.

## Building

`pnpm build` at the repository root builds the app (docket-ui's
`vite build --config vite.mcp-app.config.ts`, also `pnpm -C packages/docket-ui
build:mcp-app`) into `packages/docket-ui/mcp-app/search.html`. The docket
package's build copies it to `dist/mcp-app/search.html`, and `docket open`
reads it from there. If the app is not built, `resources/read` answers with an
error that says so.
