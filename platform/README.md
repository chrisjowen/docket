# Docket server platform

The multi-tenant Docket server: accounts (orgs) and their dockets
(workspaces), members and roles, sign-in with GitHub, OpenID Connect or a
password, Docket's own OAuth authorization server for MCP clients and the
CLI's device sign-in, the web app and its JSON API, each docket's MCP
endpoint, the worker that projects every docket into its graph and vector
stores, background enrichment and consolidation, repository sync, the audit
log, metering and rate limits. Its canonical store is Postgres, one schema per account, encrypted with per-account
keys under a platform key.

It is licensed under the [GNU Affero General Public License, version 3
only](LICENSE). The rest of the repository keeps its Apache-2.0 licence; see
[`LICENSING.md`](../LICENSING.md).

This is the product source the hosted Docket Cloud service ran, imported as a
snapshot without its private history, with the hosted service's deployment,
infrastructure, runbooks and marketing site left out. The hosted service moves to run
from these packages.

## Layout

| Path | Package | What |
| --- | --- | --- |
| `apps/server` | `@docket/server-platform` | The SvelteKit app (adapter-node): the API, MCP endpoints (`/mcp/{org}/{ws}`), the OAuth endpoints, sign-in, and the product's pages. `server.js` serves the build, with the OAuth authorization server in front. |
| `apps/worker` | `@docket/server-worker` | The worker: the outbox and projections (Neo4j, Qdrant/mem0, optional cognee), the query service behind `docket_search` and `docket_ask`, repository sync and export PRs, enrichment, consolidation, and per-account provisioning. |
| `packages/tenancy` | `@docket/platform-tenancy` | Accounts, members, invites, roles and namespace grants, the identities every sign-in provider resolves to, tenant routing, and the platform and per-account SQL migrations. |
| `packages/auth` | `@docket/platform-auth` | GitHub, OpenID Connect and password sign-in, sessions, CSRF, the OAuth provider (`oidc-provider`), API tokens and effective scopes. |
| `packages/keys` | `@docket/platform-keys` | `KeyService`: envelope encryption of per-account data keys under the platform key (KEK). |
| `packages/audit` | `@docket/platform-audit` | The append-only, hash-chained audit log. |
| `packages/limits` | `@docket/platform-limits` | Rate limits and quotas shared by every replica. |
| `packages/canonical-store` | `@docket/platform-canonical-store` | Dockets and their canonical documents in Postgres, writes with evidence, trust, proposals, saved chats, the activity log. |
| `packages/ontology-service` | `@docket/platform-ontology-service` | Templates, drafts, versions, the change check, migrations, import and export. |
| `packages/mcp-tools` | `@docket/platform-mcp-tools` | The MCP read and write tools, on docket's own tool surface. |
| `packages/projections` | `@docket/platform-projections` | Each docket's projections on its account's stores. |
| `packages/provisioner` | `@docket/platform-provisioner` | Per-account Postgres schemas and roles, Neo4j pods (Kubernetes), Qdrant collections, key rewrapping. |
| `packages/ai` | `@docket/platform-ai` | The model provider client, per-account keys, metering and the monthly cap. |
| `packages/enrichment`, `packages/consolidation` | `@docket/platform-enrichment`, `@docket/platform-consolidation` | Background enrichment and consolidation. |
| `packages/github` | `@docket/platform-github` | The GitHub App: tokens, webhooks, trees, export PRs. |
| `tests` | `@docket/platform-e2e` | The Playwright suite (`tests/e2e`), a fake GitHub and embedder, fixtures, and a k6 load test. |
| `docs` | | The org admin API, cognee, and how search decides what is relevant. |

The product's pages still live in `apps/server` beside the routes that serve
them. They move to `packages/docket-ui` as clients of the public API as that
API grows to cover them.

## Run it

`docket serve --config docket-server.yaml` runs it from a `version: 1`,
`mode: multi-tenant` config, and `docket open --config` runs the same file as
a local preview: the API, MCP, OAuth, sign-in and the product's pages on one
port, with the worker in the same process (`apps/server/runtime.js`, which
`docket` loads only for such a file). `--no-ui` runs it headless and
`--no-worker` runs the API alone. The config, its sources and secrets, and
the database it needs are in
[The multi-tenant server](../docs/self-hosting.md#the-multi-tenant-server).

A container can also run the two processes on their own, configured by
environment: `apps/server/server.js` (the API) and `apps/worker/dist/main.js`
(the worker), with the variables those files and `tests/e2e/serve.mjs` set.

## Develop

```sh
pnpm install && pnpm build
docker run -d --name docket-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55432:5432 postgres:17
docker run -d --name docket-neo4j -e NEO4J_AUTH=neo4j/local-neo4j -e NEO4J_server_memory_heap_max__size=256m \
  -e NEO4J_server_memory_pagecache_size=256m -p 127.0.0.1:57687:7687 neo4j:5.26-community
docker run -d --name docket-qdrant -e QDRANT__SERVICE__API_KEY=local-qdrant -e QDRANT__SERVICE__JWT_RBAC=true \
  -p 127.0.0.1:56333:6333 qdrant/qdrant:v1.18.3
export DOCKET_TEST_PG_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres
export DOCKET_TEST_NEO4J_URL=bolt://127.0.0.1:57687 DOCKET_TEST_NEO4J_PASSWORD=local-neo4j
export DOCKET_TEST_QDRANT_URL=http://127.0.0.1:56333 DOCKET_TEST_QDRANT_API_KEY=local-qdrant
pnpm --filter "./platform/**" typecheck
pnpm --filter "./platform/**" test   # unit tests: no database, network or browser
pnpm test:integration                # *.int.test.ts against the stores above
pnpm test:e2e                        # Playwright, against the built app and that Postgres
```

A test that needs Postgres, Neo4j or Qdrant goes in a `*.int.test.ts` file
beside the code it tests, and skips without its `DOCKET_TEST_*` variables.

`node tests/e2e/serve.mjs` runs the built app against that Postgres and the
fake GitHub at http://127.0.0.1:4470/ (sign in as `alice` or `carol`). It
makes its own database and roles. With the Neo4j and Qdrant variables set it
runs the worker too. The file's header lists its other settings, including a
one-click demo sign-in for a local preview.
