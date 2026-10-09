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
