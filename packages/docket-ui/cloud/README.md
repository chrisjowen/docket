# The multi-tenant server's web UI

`@docket/cloud-ui`: the pages of `docket serve --config` (the multi-tenant
server in [`platform/`](../../../platform)) as a static single-page app
(SvelteKit, `adapter-static`) that calls the **public API** alone, `/api/v1`.
It is licensed under the [AGPL-3.0-only](LICENSE), like the server; the rest
of `packages/docket-ui` keeps its Apache-2.0 licence
([`LICENSING.md`](../../../LICENSING.md)).

The pages move here from the server one feature at a time. Until a page has
moved, the server renders it; the two share one shell, one look and one set of
components, so a visitor cannot tell which drew a page.

| Page | Here since | API operations |
| --- | --- | --- |
| A docket's Access tab (`/o/{account}/w/{docket}/access`) | B5 | `me.get`, `accounts.navigation`, `accounts.search` (⌘K), `dockets.get`, `dockets.summary`, `access.explain`, `access.who`, `grants.list`, `roles.list`, `grants.create`, `grants.replace`, `grants.delete` |

It calls the operations `@docket/api` defines ([`packages/api`](../../api),
served at `GET /api/v1/openapi.json`), by their ids and with their types; the
server routes, checks and validates every call by the same definition.
`accounts.navigation`, `accounts.search`, `dockets.summary` and `access.who`
are there for the app's frame and the Access tab.

## How it talks to the server

- **On the page's own origin.** Every call is `/api/v1/...` on the origin the
  page came from: the server itself, or a host that serves this UI and passes
  `/api` through. The session cookie goes with it; every change carries the
  session's CSRF token in `X-CSRF-Token` (`me.get` hands it over).
- **Signed out**, a page sends the browser to the server's `/signin` and back.
- **Versions.** The build records the API version it was made for
  (`@docket/api`'s `API_VERSION`, in `_ui/manifest.json`). Every `/api/v1`
  answer carries the server's (`X-Docket-Api-Version`), and the page refuses
  to run against another major version, or an older minor one, saying so; a
  standalone host checks the same (`GET /api/v1/openapi.json`) before it
  serves.

## The build boundary

The UI draws the components and client modules the server's pages still use
(`$platform`, the server's `src/lib`) rather than copies of them. The build
refuses anything that only runs on the server: the server's own code
(`$lib/server`, its routes and hooks, any `*.server.*` module), Node's modules,
SvelteKit's private environment and `$app/server`, the server's packages (bar
the client-safe `@docket/api` and `@docket/platform-tenancy/roles`), and any package not on the
list in [`boundary.js`](boundary.js). The build fails naming the import and
who made it.

## Serving it

**Bundled (the default).** The server's build copies `build/` into its own
`ui/` and serves it: `/_ui/*` and the pages listed in the manifest are the
UI's, everything else the server's. The UI and the API it calls upgrade
together. `--no-ui` (or `ui: { enabled: false }`) serves neither.

**On its own.** The same files, from a static host or CDN, in front of the
server. The default shape keeps one origin: the host serves the UI's files
and pages and passes everything else - `/api`, sign-in (`/signin`, `/auth`,
`/signout`), OAuth (`/oauth`, `/.well-known`), MCP (`/mcp`) and the pages the
server still renders - through to the server, whose public URL (`ORIGIN`, or
`publicUrl` in `docket-server.yaml`) is this host's. Sign-in callbacks and
OAuth then stay on that one configured origin.

```bash
pnpm --filter @docket/cloud-ui build
node packages/docket-ui/cloud/standalone.mjs --api http://127.0.0.1:4390 --port 4400
node packages/docket-ui/cloud/standalone.mjs --api http://127.0.0.1:4390 --check   # versions only
pnpm --filter @docket/cloud-ui pack:standalone   # dist/docket-cloud-ui-<version>.tgz: site/, serve.js, standalone.mjs
```

`standalone.mjs` is a small reference host, dependency-free Node. Any
reverse proxy does the same; with nginx, for example:

```nginx
location /_ui/ { root /srv/docket-cloud-ui/site; }
location ~ ^/o/[^/]+/w/[^/]+/access/?$ { root /srv/docket-cloud-ui/site; try_files /index.html =404; }
location / { proxy_pass http://docket:4390; proxy_set_header X-Forwarded-For $remote_addr; }
```

Take the page patterns from `site/_ui/manifest.json`, since they grow with each
release. A UI on a genuinely different origin from its API (not proxied) needs
trusted origins, a cookie and CSRF policy and tested OAuth redirects, and is not
supported yet.

## Develop

```bash
node platform/tests/e2e/serve.mjs                 # the server, at http://127.0.0.1:4470
pnpm --filter @docket/cloud-ui dev                # this UI with hot reload, the rest proxied there
DOCKET_API=http://127.0.0.1:4480 pnpm --filter @docket/cloud-ui dev   # another server
pnpm --filter @docket/cloud-ui typecheck          # its own source; the server's files are the server's to check
pnpm --filter @docket/cloud-ui test               # the boundary and the serving module
```

The contract tests for the operations it calls are the server's:
`platform/apps/server/src/lib/server/api/ui.int.test.ts`, with a session
and with API and OAuth tokens, refusals included; the Playwright suite's
`web-ui.e2e.ts` drives the UI bundled, standalone and at phone width.
