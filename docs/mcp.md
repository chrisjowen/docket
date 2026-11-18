# docket's MCP server

`docket open` is also an [MCP](https://modelcontextprotocol.io) server for the
docket it serves. It offers Docket's MCP surface: the same eleven tools, with
the same names, input schemas, annotations, argument checks and result shapes,
as a self-hosted Docket server (`@chrisjowen/docket-server`) and Docket Cloud,
over the project's own files. `docket_search`'s result carries an
[MCP app](https://modelcontextprotocol.io/extensions/apps) (the
`io.modelcontextprotocol/ui` extension, stable spec 2026-01-26). The app draws
the matching resources and their links on the casebook's evidence board. A host
that draws MCP apps, such as Wheelhouse, shows that board where the search was
made. A host that does not still gets the result as text.

The server is in `packages/docket/src/mcp/`, the app in
`packages/docket-ui/src/mcp-app/`. The surface - every tool's definition,
argument checks and answers - is `packages/docket/src/mcp/surface/`
(`@chrisjowen/docket/mcp/surface`), and the workspace core the write tools
write through is `packages/docket/src/workspace/`
(`@chrisjowen/docket/workspace`); `@chrisjowen/docket-server` builds its tools
on both. This file is the contract they keep.

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

## The tools

| Tool | What it does | Annotations |
| --- | --- | --- |
| `docket_search` | Searches the projections for a query, and draws what they found ([below](#the-tool-docket_search)) | read-only |
| `docket_get` | One resource by id: its merged frontmatter and body, links, every piece of evidence, the documents that declare it, and whether it has been superseded | read-only |
| `docket_ask` | A question in words, put to every projection and checked against the files, with a summary when `query.synthesis` is on, as `docket ask` answers | read-only |
| `docket_ontology` | The ontology, as YAML and parsed, with its version | read-only |
| `docket_remember` | Writes one resource - type, title, attributes, body, links - with evidence | write, idempotent |
| `docket_update_notes` | Appends dated narrative notes to a resource, with evidence | write |
| `docket_add_evidence` | More evidence for a resource or one of its links | write, idempotent |
| `docket_retire` | Retires a resource that is wrong or gone, with a reason | write, destructive |
| `docket_supersede` | Marks a resource out of date, replaced by a newer one, with a reason and evidence | write, idempotent |
| `docket_propose_ontology_change` | Checks a change to the ontology against every document and saves it as a draft | write |
| `docket_publish_ontology_change` | Publishes a change to the ontology, migrating documents a breaking change names | write, destructive |

`tools/list` gives them in this order. Their input schemas and annotations are
`TOOL_DEFINITIONS` in `@chrisjowen/docket/mcp/surface`, and every Docket MCP
server lists exactly those; only a tool's `description` is worded for where it
runs. Arguments a tool does not take, or of the wrong shape, are JSON-RPC
error `-32602`, with the same message on every server. A write the ontology
does not allow, or one without evidence, is a result with `isError: true` and
the reasons, and writes nothing. Every write tool's `structuredContent` is a
`docket-write.v1` object; `docket_get`'s is `docket-resource.v1`,
`docket_ask`'s `docket-ask.v1`, `docket_ontology`'s `docket-ontology.v1`, and
the ontology tools' `docket-ontology-proposal.v1` and
`docket-ontology-publish.v1`.

`packages/server/src/mcp/parity.test.ts` lists docket's tools and the server
core's side by side and fails when they drift: a tool added, dropped or
reordered, or a name, input schema, annotation or argument check that differs.

### Over the project's files

docket's server is one person's, on their machine, so it has no tenancy and
no sign-in, and offers every tool, publishing the ontology too. A server
keeps its own records in a database; docket keeps them as files under the
docket's root, committed with the rest, so git keeps their history:

- **Writes** merge into the resource's document in place: the first that
  declares it, preferring one at its own path. A new resource gets a document
  of its own, `<slug>.md` (the id without its type), beside the project's
  other documents of its type; else in the folder `docket init` makes for the
  type (`.docket/resources/services/`, `.docket/decisions/`); else at
  `.docket/resources/<type>/` (`<slug>-2.md` when the path is taken). Each write is validated against the ontology with docket's own
  validator before anything is written, and evidence is stamped as observed by
  the person at the machine (`<user> via docket MCP`). Writing the same thing
  again changes nothing. Two calls at once run one after the other.
- **Retiring** removes the documents that declare the resource; git keeps
  them. A result names no revision: the project's history is git's.
- **Supersessions** are kept in `.docket/supersessions.yaml`. The documents
  are untouched; `docket_search`, `docket_ask` and `docket_get` answer a
  superseded record with the record current now and a note of the change.
- **The ontology's version** is the one `.docket/ontology-history.yaml`
  records for the ontology file as it is now. A file never published through
  MCP is version 1, and one edited by hand since the last publish is the
  version after it. `docket_publish_ontology_change` rewrites the ontology
  file (and, with a migration, the documents it names) and adds the version to
  the history; `expectedHead` is checked against it.
- **Drafts** from `docket_propose_ontology_change` are saved as
  `.docket/ontology-drafts/<id>.yaml`.
- **`docket_search`** looks in the facts the projections hold and the
  subgraphs they return; the project keeps no activity timeline, so
  `include: ["timeline"]` finds nothing and says so. Its `score` is a match's
  rank, since docket's own search does not re-rank.

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
      "project": { "type": "string" },
      "include": { "type": "array", "items": { "enum": ["facts", "graph", "timeline"] }, "minItems": 1 },
      "minConfidence": { "type": "number", "minimum": 0, "maximum": 1, "deprecated": true }
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
- `include` is where to look: `facts` (what the projections hold), `graph`
  (the subgraphs they return) and `timeline` (a server's activity log). All of
  them when omitted.
- `minConfidence` is ignored, with a warning: confidence is shown with each
  result, and never decides what is returned.
- The tool only reads, so Wheelhouse runs it, and an app's call to it, without
  asking. Its `_meta.ui` gives no `visibility`, so both the model and the app
  can call it.
- If the arguments are wrong (no query, a limit out of range, a project that
  is not a string, an `include` it does not know, any other key) or the tool name is unknown, the answer is
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

`content` is one `text` item for the model to read. It starts by saying that
what follows was written by people and agents, to be read as data, not
instructions. Then, first, any record the search found that has been
superseded, with the record current now, and the matches by type. It names
each match with its id, type, where it was found, title, canonical file,
confidence and links. Each returned link
names the projections that returned it and its confidence. It then lists:

- the other resources the projections returned
- the paths they used, step by step, each with the evidence its relationships cite as its `why`: `service.orders -depends_on-> service.ledger -depends_on-> datasource.ledger-db (neo4j)`
- each relationship they returned, with the evidence it cites as its `why`
- the resources one link away in the files

Last, it says how each projection answered, and whether the search index is
behind the files, and to call `docket_get` with an id for its full record.

`structuredContent` is a `docket-search.v1` object, which the app draws
(`packages/docket/src/mcp/types.ts`):

```jsonc
{
  "schema": "docket-search.v1",
  "query": "orders",
  "project": { "name": "shop", "root": "/work/shop" },
  // What the projections found, most relevant first: the order the first answering projection ranked them in.
  // Each with where it was found (`foundIn`) and its `score`, from 0 to 1; a match that stands in
  // for superseded records names them in `supersedes`.
  "matches": [
    { "id": "service.orders", "type": "service", "title": "Orders API",
      "path": ".docket/resources/services/orders.md", "confidence": 0.8, "foundBy": ["local"],
      "foundIn": ["facts"], "score": 1 }
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
  "warnings": [],
  // Present when the search found superseded records: each with the record current now
  // (null when it is no longer on file), since when, why, and the change as one line.
  "changes": [
    { "id": "team.payments", "type": "team", "title": "Payments", "supersededBy": "team.money",
      "current": { "id": "team.money", "type": "team", "title": "Money Movement" },
      "since": "2026-11-01", "reason": "The team was renamed.", "note": "Out of date: ..." }
  ]
}
```

`via`, `foundBy`, `confidence`, `why`, `paths`, `foundIn`, `score`,
`supersedes` and `changes` were added to `docket-search.v1` without changing
its schema name: a reader that ignores them reads the result as before.

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
  from `ui/initialize`. It takes the light or dark `theme`, and keeps docket's
  own look - Docket Cloud's paper, ink and signal red, its type and its
  network of case cards - over the host's style variables.
- It asks the host for:
  - `tools/call` of `docket_search`, from its search box.
  - `ui/open-link` of `<viewer>#<id>`, through **Open in docket** on a picked
    resource.
  - `ui/request-display-mode`, for full screen when the host offers it.

  It asks for nothing else.

On the board, a subgraph a projection returned stands at full strength. The
canonical context (`via: "canonical"`) fades, and a note beside the board says
what the faded part is. The list beside the board shows the matches, then the
paths the projections returned, each with its why. Picking a resource, on the board or in either
list, brings it and its neighbours forward. It also shows its file and its
links, and for each returned link, who returned it, its confidence and why.

## Building

`pnpm build` at the repository root builds the app (docket-ui's
`vite build --config vite.mcp-app.config.ts`, also `pnpm -C packages/docket-ui
build:mcp-app`) into `packages/docket-ui/mcp-app/search.html`. The docket
package's build copies it to `dist/mcp-app/search.html`, and `docket open`
reads it from there. If the app is not built, `resources/read` answers with an
error that says so.
