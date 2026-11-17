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

It is being extracted from Docket Cloud release by release. This release
carries the ports, the scope and role vocabulary, the ontology lifecycle, how
a write becomes a document, and the canonical store on Postgres; the MCP
tools and handler, and the reconcile and search loops follow.

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

## Licence

[Apache License, Version 2.0](LICENSE).
