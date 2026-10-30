# docket-ui

The web UI `docket open` serves: SvelteKit (static, single page), shadcn-svelte
and d3. It is private - `pnpm build` at the workspace root builds it, and the
`@chrisjowen/docket` build copies `build/` into its own `dist/ui`, which the
npm package ships.

It has three routes, with one inspector beside them all for an exhibit or a
piece of evidence (docs/adapter-spec.md §13):

- **Browse** - the canonical graph with its type and relationship filters, a
  table of exhibits and observations filterable by type, source, date and
  assessment, and a history of dated observations (`eventAt` and `observedAt`
  labelled apart) and supersessions. All of it reads the files, never an index.
- **Ask** - one question to the configured adapters, every `ResultBlock` kind
  drawn by its own renderer (and unknown kinds as structured data), each
  adapter's interpretation, coverage, failures and evidence shown on its own,
  and an optional summary.
- **Adapters** - each instance's roles, health and freshness. Never its
  configuration.

The API it reads is defined in
[`packages/docket/src/open/types.ts`](../docket/src/open/types.ts):
`GET /api/graph` for every entity and relationship. Ask, Adapters and the
evidence inspector read the coordinator's API - `POST /api/ask`,
`GET /api/adapters` and `POST /api/evidence`, whose types
[`packages/docket/src/query/wire.ts`](../docket/src/query/wire.ts) defines -
and validate every adapter answer with `@docket/contracts`. Against a server
without the coordinator, Ask answers through the legacy `GET /api/ask` (or
`GET /api/chat` with a summary), translated into one entity block per source,
and Adapters says status is not available.

Each resource type is drawn with its icon: the `icon` its ontology entry
declares, else docket's built-in one for that type name, else a generic one.
The icons a type may name, and that resolution, live in
[`packages/docket/src/ontology/icons.ts`](../docket/src/ontology/icons.ts),
which the server validates against and `src/lib/icons.ts` maps to the bundled
Lucide components.

```bash
# In a repository with a .docket/, serve the API:
docket open --no-open
# Then, here, the UI with hot reload, proxying /api to it:
pnpm dev                          # DOCKET_API=http://127.0.0.1:<port> for another port
# Or with POST /api/ask and GET /api/adapters served from src/lib/ask/fixtures.ts:
pnpm dev:fixtures
```

The Sync button only works against `docket open` directly: the server accepts
a sync only from its own origin on `127.0.0.1`, so one sent through the dev
proxy is refused.

## Inside Wheelhouse

The same casebook is docket's Wheelhouse plugin element,
`<docket-casebook>`: `src/embed/` defines it, mounting the shell
docket open's page draws (`src/lib/components/casebook.svelte`) in a shadow
root, with its views kept in memory (`MemoryNavigator`, `src/lib/nav.svelte.ts`)
rather than as routes, and its API at the project's viewer
(`apiAt(url)`, `src/lib/api.ts`) rather than the page's own origin. Wheelhouse
starts that viewer as `docket open --allow-origin <Wheelhouse's page>`, so the
page may use it. `src/embed/embed.css` leaves the shadcn-svelte colours to
Wheelhouse, so the casebook follows its themes, and keeps the casebook's own
(`src/lib/styles/casebook.css`).

```bash
pnpm build:embed                  # embed/index.js, one ES module
```

The plugin's build (`wheelhouse/build.mjs` at the repository root) builds the
same bundle into `wheelhouse/ui/index.js`; see
[`wheelhouse/README.md`](../../wheelhouse/README.md).

## docket_search's MCP app

`src/mcp-app/` is the app an MCP host draws for docket's `docket_search`
tool ([docs/mcp.md](../../docs/mcp.md)). It is the casebook's graph view
(`src/lib/components/graph-view.svelte`) showing what the search found and
the resources one link away, with the matches listed beside it. It speaks the
MCP Apps bridge over postMessage (`bridge.ts`) and draws in the host's colours
where the host gives them. `vite.mcp-app.config.ts` builds it as one HTML page
with everything inlined, which `pnpm build` writes to `mcp-app/search.html`.
The docket package's build copies it to `dist/mcp-app/`, where `docket open`
serves it as `ui://docket/search.html`.

```bash
pnpm build:mcp-app                # mcp-app/search.html, one self-contained page
```
