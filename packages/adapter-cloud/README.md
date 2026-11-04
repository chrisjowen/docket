# @docket/adapter-cloud

Answers docket's questions from a Docket Cloud workspace as well as from the
local adapters, through the workspace's MCP `docket_search` tool. It is query
only and projects nothing. When the cloud cannot be reached, the project is
not signed in, or `DOCKET_OFFLINE` is set, it reports itself `unavailable` and
the coordinator answers from the other adapters.

Its default export is the `AdapterDefinition`
([`docs/adapter-spec.md`](../../docs/adapter-spec.md) §7). `docket cloud link
<org>/<workspace>` writes its instance. The configuration is:

- `url` (default `https://docket.chrisjowen.net`): https, or plain http on
  this machine only (`localhost`, `127.x.x.x`, `[::1]`).
- `workspace`: `<org>/<workspace>`.
- `tokenEnv` (optional): the name of an environment variable that holds an API
  token, for CI. Without it, the adapter uses the session `docket cloud login`
  kept. Any other field is rejected.

A match the checkout also holds becomes an entity hit. Every match is a passage
of evidence naming the resource, so `docket ask` also shows the matches only
the cloud holds.

A private workspace package, not published on its own. `@chrisjowen/docket`
bundles it into `dist/bundled/adapter-cloud`.
