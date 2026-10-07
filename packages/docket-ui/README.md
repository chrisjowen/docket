# docket-ui

The web UI `docket open` serves: SvelteKit (static, single page), shadcn-svelte
and d3. It is private - `pnpm build` at the workspace root builds it, and the
`@chrisjowen/docket` build copies `build/` into its own `dist/ui`, which the
npm package ships.

The API it reads is defined in
[`packages/docket/src/open/types.ts`](../docket/src/open/types.ts):
`GET /api/graph` for every entity and relationship, `GET /api/ask?q=` for
`docket search` answers.

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
```
