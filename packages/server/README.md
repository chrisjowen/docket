# @chrisjowen/docket-server

The core a Docket server is built on, shared by Docket Cloud and a
self-hosted, single-tenant server: the same MCP tools, ontology writes and
permission checks, with each deployment plugging its own storage, sign-in and
tenancy in through ports.

```bash
npm install @chrisjowen/docket-server @chrisjowen/docket
```

`@chrisjowen/docket` is a peer dependency: the core parses and validates
documents with your docket, so a server validates exactly as `docket
validate` does.

It was extracted from Docket Cloud release by release, and now carries the
whole shared core: the ports, the scope and role vocabulary, the ontology
lifecycle, how a write becomes a document, the canonical store on Postgres,
the MCP tools and endpoint, and the reconcile and search loops. It also runs
`docket serve`, the self-hosted, single-tenant server built on all of them
(`@chrisjowen/docket-server/serve`).

## Ports

A deployment implements these; the core uses nothing else to reach its data
or its callers.

| Port | What a deployment supplies |
| --- | --- |
| `Tx` | One SQL transaction: anything with `query(text, values)`, such as a `pg` client |
| `DocumentCodec` | How document bodies are stored at rest: `seal`, `open`, and the `aad` that binds a body to its revision |
| `StoreContext`, `StoreRunner`, `StoreLimits` | A transaction with its codec and limits, and how to run one |
| `ScopeSource` | The stores the background loops visit: one per organisation, or just one |
| `Principal`, `McpResource` | Who is calling, and the workspace a request is for |
| `Authenticator` | Resolves a bearer credential to a principal |
| `Authorizer` | The principal's role now, and which roles may publish the ontology over MCP |
| `AuditSink` | Where each request's audit event goes, inside the write's transaction |
| `Limiter`, `ModelGate` | Optional rate limits, and a check before each model call |
| `QueryBackend` | Where search and ask are answered |

A deployment with richer principals or resources (an organisation id, say)
passes its own types: `Authenticator`, `Authorizer`, `Limiter` and
`ModelGate` take them as type parameters.

## Scopes and roles

```ts
import { checkScope, effectiveScopes, type Authorizer } from '@chrisjowen/docket-server'

const authorizer: Authorizer = {
  role: async (principal) => roleOf(principal.subject),
  ontologyWriters: async (workspaceId) => settingsOf(workspaceId).ontologyWriters
}

const refusal = checkScope(await effectiveScopes(principal, authorizer), 'docket:write')
if (refusal) return new Response(refusal.description, { status: refusal.status })
```

- `SCOPES`: `docket:read`, `docket:write`, `ontology:read`,
  `ontology:propose`, `ontology:write`. `docket:read` implies
  `ontology:read`.
- `ROLES`: `owner`, `admin`, `editor`, `viewer`. Viewers read; editors and
  up also write and propose; `ontology:write` reaches only the roles the
  workspace's `ontologyWriters` setting names, never a viewer.
- `effectiveScopes(principal, authorizer)` is the credential's scopes cut to
  its subject's role now, read on every call: demoting a member narrows every
  credential they hold from their next call, and one whose role is gone
  grants nothing.
- `checkScope(effective, needed)` is null when the call may go ahead, a 401
  `invalid_token` when the credential grants nothing, or a 403
  `insufficient_scope` naming the scope it lacks.

## The ontology lifecycle

A workspace's ontology changes by draft. `checkDraft` re-validates every
document against a draft with docket's validator and diffs the diagnostics
with the published head's, so the publisher sees what the change would do
before it lands:

```ts
import { checkDraft, type StoredDocument, type WorkspaceSnapshot } from '@chrisjowen/docket-server'

const snapshot: WorkspaceSnapshot = { documents, origins, head: { number: 1, ontology } }
const stored: StoredDocument[] = [] // the documents' text: read it when there is a migration
const check = checkDraft(snapshot, stored, draftYaml, { migration })
check.classification // 'safe', 'narrowing' or 'breaking'
```

- **Safe**: no document gains a diagnostic.
- **Narrowing**: existing resources or links gain diagnostics (`affected`
  lists them); an admin publishes anyway to accept them.
- **Breaking**: resources would become `unknown-type` or
  `unknown-relationship`. A migration (`renameType`, `mapType`,
  `renameRelationship`, `dropAttribute`) rewrites the server's own documents,
  keeping their layout and comments and recording the change as evidence; a
  document from a repository or the CLI changes at its source, so each one
  still broken is `unresolved` until the publisher gives it a disposition.

`importYaml` and `exportYaml` read and write `entities.yaml` as it is,
comments and all; `proposedText` applies a proposal, a whole ontology or a
merge patch onto the head; `TEMPLATES` are the starter ontologies, generated
from docket's own default by `pnpm -C packages/server templates`.

## Writes

Every write - an MCP write tool or a web form - becomes a docket Markdown
document. `stampEvidence` records the writer as the observer, the request as
the session and now as the time, keeping a client's own `observedBy` as
`reportedBy`. `composeDocument` merges the change into the resource's
document, or makes a new one, keeping what is there and adding only evidence
it does not already hold, so repeating a write adds nothing. The write tools
parse their arguments with `argumentsOf` and `parseEvidence`, and answer with
`writeAnswer`.

How a write becomes a document, and the ontology lifecycle above, are docket's
workspace core (`@chrisjowen/docket/workspace`), re-exported here unchanged:
docket's own MCP server writes a project's files through the same code.

## The Postgres store

`@chrisjowen/docket-server/postgres` keeps a workspace's canonical data in
Postgres: documents with every revision, the ontology's drafts and published
versions, the activity log, supersessions, adapter manifests and the outbox
reconciliation reads. It imports no driver; pass it your own pool (a
`pg.Pool`).

```ts
import { readFile } from 'node:fs/promises'

import pg from 'pg'
import { localKeyCodec } from '@chrisjowen/docket-server'
import { createWorkspace, migrate, postgresStore, writeResource } from '@chrisjowen/docket-server/postgres'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
await migrate(pool) // the core tables, in `public`; safe to run from every replica at start

const store = postgresStore({ pool, codec: localKeyCodec({ key: await readFile('docket.key') }) })
await store.run((ctx) =>
  createWorkspace(ctx, { name: 'Platform', slug: 'platform', start: { template: 'sdlc' }, publisher: { actor: 'user:me', login: 'me' } })
)
```

- **One schema, or one per tenant.** `migrate(pool, { schema })` runs the
  same `{{schema}}`-templated migrations into any schema and records them in
  that schema's own `docket_migrations` ledger; `postgresStore({ schema })`
  puts it first on each transaction's search path. A single-tenant server
  keeps one store in `public`; Docket Cloud keeps one per organisation.
- **Codecs.** Each document body, and each activity and supersession detail,
  is sealed by the store's `DocumentCodec`, bound by its associated data to
  the row and revision it belongs to, with the key version beside it.
  `plaintextCodec()` stores text as it is, for a server whose operator owns
  its disk; `localKeyCodec({ key })` seals with AES-256-GCM and one 32-byte
  key kept outside the database. Every body is also hash-checked when it is
  read.
- **Writes are serialised where they meet.** A write validates against the
  published ontology head while holding it `FOR SHARE`, and a publish takes
  it `FOR UPDATE`, so a write validated against an old head is checked again
  against the new one before it commits, and a publish waits for the writes
  in flight and checks them too. Two writes to one resource take a lock on
  it, so their evidence merges rather than overwrites.
- **Limits** are the deployment's: `postgresStore({ limits: {
  documentsPerWorkspace, workspaces } })`. There are none by default.

`writeResource`, `addEvidence`, `appendNotes`, `writeInference` and
`retireResource` are the write tools' paths; `supersedeResource` marks a
record out of date. `createDraft`, `checkDraft`, `publish`, `rollback`,
`proposeOntologyChange` and `publishOntologyChange` are the ontology's.
`postgresSource` and `postgresManifests` are docket's `CanonicalSource` and
`ManifestStore` over the store, so `docket validate` and sync read it as
they read files.

The integration tests run every suite against both shapes - a plain schema
with the plaintext codec, and a templated schema with a local key - when
`DOCKET_TEST_PG_URL` names a role that may create databases:

```bash
DOCKET_TEST_PG_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres pnpm -C packages/server test
```

## The MCP endpoint

`@chrisjowen/docket-server/mcp` is a workspace's MCP endpoint: the eleven
tools, and `handleMcp`, the request pipeline in front of them as one
framework-free function from a `Request` to a `Response`, so any HTTP server
can mount it.

The tools are Docket's MCP surface, which docket defines once
(`@chrisjowen/docket/mcp/surface`): every tool's name, input schema,
annotations, argument checks and answers. docket's own MCP server (`docket
open`'s `/mcp`) offers the same tools over a project's files, so an agent sees
the same surface on the local CLI, a self-hosted server and Docket Cloud. Only
the descriptions differ, worded for where each runs. `src/mcp/parity.test.ts`
lists both side by side and fails when they drift. A deployment that builds its
own tools on this package keeps them on the surface the same way:

```ts
import { TOOL_DEFINITIONS, surfaceOf } from '@chrisjowen/docket/mcp/surface'

expect(listedTools.map(surfaceOf)).toEqual(TOOL_DEFINITIONS.map(surfaceOf))
```

| Tool | Scope | What it does |
| --- | --- | --- |
| `docket_search` | `docket:read` | The projections' relevant results, each with its confidence and where it was found, and what has gone out of date |
| `docket_get` | `docket:read` | One resource's merged record, evidence, documents and revision history, and whether it was superseded |
| `docket_ask` | `docket:read` | A question answered from the projections, with a model's cited summary |
| `docket_ontology` | `ontology:read` | The published ontology |
| `docket_remember`, `docket_update_notes`, `docket_add_evidence` | `docket:write` | Write a resource, append notes, add evidence: every write with evidence, checked against the ontology |
| `docket_retire`, `docket_supersede` | `docket:write` | Retire a resource written here, or mark one out of date in favour of its replacement |
| `docket_propose_ontology_change` | `ontology:propose` | A checked draft; it never publishes |
| `docket_publish_ontology_change` | `ontology:write` | Publish directly, where the workspace lets the caller's role |

```ts
import { handleMcp } from '@chrisjowen/docket-server/mcp'

const response = await handleMcp(request, {
  resourceUrl, resource,              // the workspace the path names, or null
  authenticator, authorizer,          // the bearer's principal, and its role now
  audit: () => auditSink,
  store: () => store,                 // the workspace's StoreRunner
  query: () => queryClient,           // where search and ask are answered
  links: () => ({ viewer, ontologyHistory }),
  requestId
})
```

The pipeline, in order: a credential in the URL is refused before it is
looked up; a missing or unknown bearer gets a `401` with a challenge naming
the resource's protected resource metadata; the deployment's `Limiter` may
answer instead; the credential's scopes are cut to its subject's role now
(`effectiveScopes`), and a tool they do not reach is refused `403
insufficient_scope`; then docket's own MCP server answers, with only the
tools the effective scopes allow. Each request is audited once: a write
records its event in the write's own transaction, so the change and its
event commit or roll back together.

A deployment that keeps its documents outside the Postgres store passes its
own `tools` (with the same names, schemas and scopes) and `source`, as
`docket serve` does over a project's files.

## `docket serve`

`@chrisjowen/docket-server/serve` is `docket serve`, which docket's CLI loads
from beside itself: a self-hosted, single-tenant server for several people and
agents writing to one ontology. See
[docs/self-hosting.md](../../docs/self-hosting.md) for running it.

```ts
import { createToken, loadServeConfig, startServe } from '@chrisjowen/docket-server/serve'

const config = await loadServeConfig({ cwd })        // docket-server.yaml and the environment
const { token } = await createToken(config, { name: 'ada', role: 'owner' })
const running = await startServe(config)             // running.url, running.close()
```

The same module also tells a single-tenant `docket-server.yaml` apart from a
multi-tenant one and checks the latter: `readServerConfigFile` reads its
`mode`, and
`loadPlatformConfig` reads and validates its sources, secrets and sign-in,
for docket's CLI to hand to `@docket/server-platform`. See
[The multi-tenant server](../../docs/self-hosting.md#the-multi-tenant-server).

It is the ports above, filled in for one tenant:

- **Store.** With no `database`, each workspace is a project's own files,
  written through docket's local tools (`localTools`) under the project's
  write lock, which other processes take turns on too, and indexed by the
  project's own projections after every write (`filesBackend`). With
  `database.url`, it is this package's Postgres store, with the outbox loop
  projecting into the configured projections and `queryService` answering
  in-process (`postgresBackend`).
- **Sign-in.** Static bearer tokens (`tokenAuth`): the SHA-256 of each, with a
  role, scopes and workspaces, compared in constant time. The tokens file is
  re-read when it changes, so `role()` reads a revocation on the next call.
  `ontologyWriters` is the server's `ontology.mcpWriters`.
- **Audit.** One JSON line per call (`fileAuditLog`), with the arguments as a
  digest.
- **HTTP.** `serveHandler` mounts `handleMcp` at `/mcp/{workspace}`, `/mcp`
  and `/mcp/{org}/{workspace}`, the documents API `docket cloud` calls (with
  `pushDocuments` over Postgres), `/healthz` and `/readyz`, and docket open's
  page behind a token sign-in.

`src/serve/gates.test.ts` runs both stores end to end over HTTP, and
`src/mcp/parity.test.ts` holds the server's surface to docket's.

## The runtime loops

`@chrisjowen/docket-server/runtime` is what a server runs beside its
endpoint. A deployment names its stores (a `ScopeSource`: Docket Cloud has
one per organisation, a self-hosted server one) and its projections (a
`ProjectionSet`: the instances every workspace projects into, and how to
reach their stores).

```ts
import { outboxLoop, queryService, reconciler } from '@chrisjowen/docket-server/runtime'

const reconcile = reconciler({ projections })
const loop = outboxLoop({ scopes, pool, reconciler: reconcile, instances: projections.instances, log: console })
loop.start() // drains every store's outbox; `kick()` after a write, or NOTIFY docket_outbox

const search = queryService({ store, projections: openForQuery, instances: projections.instances, reranker: null, log: console })
await search.search({ workspaceId, query: 'who owns orders', limit: 10, userId })
```

- **Reconciliation** brings each workspace's projections up to its canonical
  documents, as docket's sync does a checkout: each instance planned from
  its manifest in Postgres, only what an adapter acknowledged advancing the
  manifest, and the manifest written only after the adapter flushed, so a
  pass that crashes replays without duplicates. One instance failing never
  holds up another; it backs off (30 s doubling, at most 30 minutes) and its
  outbox rows stay pending until it catches up. A queued rebuild resets each
  instance once. Every pass goes in the sync history (`listSyncRuns`), with
  any secret an error quotes redacted.
- **The outbox loop** drains every store's outbox one workspace at a time,
  under a session advisory lock so two processes never project the same
  workspace at once, and purges a deleted workspace from the projections
  first.
- **The search pipeline** puts a question to every projection through
  docket's coordinator and checks each hit against the canonical documents.
  A search fuses the projections' hits (reciprocal rank fusion) with what the
  activity log names, lets a cross-encoder (`rerankerClient`) read the
  question with each candidate, and keeps what a fitted model says is
  relevant: often fewer than `limit`, and nothing for a question about
  someone the workspace never recorded. A record gone out of date is never a
  match: its replacement stands in for it, with a note of the change. Without
  a re-ranker it cuts on the projections' scores alone. `docket_ask` adds a
  model's cited summary when `models` names one.

## Licence

[Apache License, Version 2.0](LICENSE).
