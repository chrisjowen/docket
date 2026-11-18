# Changelog

Changes to `@chrisjowen/docket-server`.

## 0.8.0

### `docket serve`

`@chrisjowen/docket-server/serve` is `docket serve`, the self-hosted,
single-tenant Docket server docket's CLI runs
([docs/self-hosting.md](../../docs/self-hosting.md)): the eleven MCP tools at
`/mcp/<workspace>`, static bearer tokens with a role, scopes and workspaces
each (`createToken`, `listTokens`, `revokeToken`, `tokenAuth`), health and
readiness, the documents API `docket cloud` calls at its single-tenant paths,
`docket open`'s page behind a token sign-in, and an audit log of every call.
It keeps its workspaces in projects' own files by default
(`filesBackend`, with no database) or in this package's Postgres store
(`postgresBackend`, with the outbox loop projecting into jsonl, SQLite or
Postgres and the search pipeline answering in-process). `pg` becomes an
optional peer dependency, used only by a Postgres-backed server. It needs
`@chrisjowen/docket` 0.13.0 or later.

### The endpoint and the store

- `handleMcp` takes `tools` and `source`, for a deployment that keeps its
  documents outside this store and offers its own tools with the same names,
  schemas and scopes.
- `pushDocuments` and `checkoutProblem` (`@chrisjowen/docket-server/postgres`):
  `docket cloud push` into the store, ported from Docket Cloud, with the
  store's document limit read from `StoreContext.limits`.

## 0.7.0

### Postgres and SQLite instances in search fusion

`SIGNALS` reads a `postgres` or `sqlite` projection instance's scores as a
`lexical` signal, as it does Neo4j's full-text scores: docket 0.12.0's
Postgres and SQLite adapters rank by full-text unless set to `search:
semantic`, when a deployment names the instance `semantic` in `signals`.
`@chrisjowen/docket` 0.12.0 satisfies the peer dependency as well as 0.11.

## 0.6.0

### One MCP surface with docket's own server

docket's local MCP server now offers the same eleven tools as this core, so
the surface each tool presents - its name, input schema, annotations,
argument checks and answers - is defined once, in docket
(`@chrisjowen/docket/mcp/surface`), and the server's tools are built on it.
The workspace core they write through - how a write becomes a document,
evidence, supersession, and the ontology's change check, migrations and
proposals - moved to docket too (`@chrisjowen/docket/workspace`), so docket
writes a project's files by the same rules. Everything this package exported
is still exported, unchanged, except that:

- `Origin` gains `'local'`, a project's own file as docket's local MCP server
  writes it; a migration rewrites a `local` document as it does a `cloud`
  one.
- `writeAnswer` takes `viewer: string | null` and leaves the revision out of
  its text when there is none.

`src/mcp/parity.test.ts` lists docket's tools beside the server's and fails
when they drift. `@chrisjowen/docket` (`^0.11.0`) is the peer dependency.

## 0.5.0

### The reconcile and search loops

The fifth release moves Docket Cloud's worker loops into the core, at
`@chrisjowen/docket-server/runtime`, completing the shared core.

- **Reconciliation**: `reconciler({ projections })` brings a workspace's
  projections up to its canonical documents from the outbox - manifests in
  Postgres, acknowledged changes only, backoff per instance, a queued rebuild
  resetting each instance once, deleted workspaces purged - over any
  `StoreScope` and a deployment's `ProjectionSet`. `projectInstance`,
  `recordStatus` and `backoffMs` are its parts.
- **The outbox loop**: `outboxLoop` drains every store a `ScopeSource`
  names, one workspace at a time under an advisory lock, woken by
  `NOTIFY docket_outbox` or `kick()`, sweeping on an interval besides.
- **The search pipeline**: `queryService` answers `docket_search` and
  `docket_ask` over the projections through docket's coordinator, with
  reciprocal rank fusion, a cross-encoder re-ranker (`rerankerClient`), the
  fitted relevance cut (`CUT_MODEL`, `RETRIEVAL_CUT_MODEL`, `cut`), the
  unknown-name gate, supersession notes, and a model's summary when one is
  set up. `searchBoard`, `searchCandidates`, `rankCandidates`,
  `changesFound` and `askProjections` are its parts; `fitCut`, `macroScores`
  and `ndcgAt` refit and score it.
- **In the Postgres store**: the sync history (`recordSyncRun`,
  `listSyncRuns`, `syncStanding`, `requestRecheck`) and each projection's
  standing (`indexStatus`, `instanceStatuses`).

## 0.4.0

### The MCP tools and endpoint

The fourth release moves Docket Cloud's MCP tools and its endpoint's
request pipeline into the core, at `@chrisjowen/docket-server/mcp`.

- **The eleven tools**: `docket_search`, `docket_get`, `docket_ask` and
  `docket_ontology` to read; `docket_remember`, `docket_update_notes`,
  `docket_add_evidence`, `docket_retire`, `docket_supersede`,
  `docket_propose_ontology_change` and `docket_publish_ontology_change` to
  write. Each names the scope a call needs (`readTools`, `writeTools`,
  `serverTools`, `registryFor`, `scopeOf`, `isWriteTool`), and runs with a
  `ToolContext`: the workspace, its `StoreRunner`, a `QueryClient` for search
  and ask, a model gate, the writer and role, and `audited` for a write.
- **`handleMcp(request, options)`**: the endpoint as one `Request` to
  `Response` function with no web framework. It refuses a credential in the
  URL, answers a missing or unknown bearer with an RFC 9728 challenge, runs
  the deployment's `Limiter`, cuts the credential to its subject's role now,
  refuses a tool out of reach with `403 insufficient_scope`, and audits each
  request once, a write inside its own transaction. `bearerOf`,
  `credentialInUrl`, `bearerChallenge`, `protectedResourceMetadataUrl`,
  `PROTOCOL_VERSIONS` and `CORS_HEADERS` go with it.
- **The query protocol**: `SearchQuery`, `AskQuery`, `WorkspaceSearch`,
  `AskResponse`, `QueryError`, and `queryClient`, `queryKey` and
  `queryAuthorised` for a query service in another process.

## 0.3.0

### The canonical store on Postgres

The third release moves Docket Cloud's canonical store into the core, at
`@chrisjowen/docket-server/postgres`. It imports no driver: a deployment
passes its own pool.

- **Migrations**: `migrate(pool, { schema })` applies the core tables -
  workspaces, documents and their revisions, ontology versions, adapter
  manifests, the outbox, projection standing, the activity log, workspace
  deletions, sync runs and supersessions - to `public` or any schema, from
  `{{schema}}`-templated SQL, recording them in the schema's own
  `docket_migrations` ledger and refusing one whose text has changed.
  `postgresStore({ pool, schema, codec, limits })` is a `StoreRunner` over
  it.
- **Documents**: `putDocument`, `retireDocument`, `readDocument(s)`,
  `listDocuments`, `listDocumentPage`, `documentHistory` and the rest, every
  body sealed by the store's codec and hash-checked when read.
- **Writes**: `writeResource`, `addEvidence`, `appendNotes`,
  `writeInference`, `retireResource` and `describeResource`, validated
  against the ontology head held `FOR SHARE` in the transaction they commit
  in, with `lockOntologyHead` and `lockResource`.
- **The ontology**: `createDraft`, `updateDraft`, `discardDraft`,
  `checkDraft`, `evaluate`, `publish`, `rollback`, `proposeOntologyChange`,
  `publishOntologyChange` and `createWorkspace`, with `headOf`,
  `listPublished`, `listDrafts` and `versionBy*`.
- **The activity log, supersessions, workspaces and the outbox**:
  `recordIngest`, `listIngests`, `supersedeResource`, `liveSupersessions`,
  `insertWorkspace`, `deleteWorkspace`, `pendingDeletions`,
  `setOntologyMcpRoles`, `enqueue` and others.
- **docket's ports over the store**: `postgresSource` (a `CanonicalSource`)
  and `postgresManifests` (a `ManifestStore`).

In the root entry point:

- **Codecs**: `plaintextCodec()` and `localKeyCodec({ key, keyVersion,
  aad })`, AES-256-GCM with one local key.
- **Document rules**: `pathProblem`, `cloudDocumentPath`, `checkDocument`,
  `DocumentError` and `DOCUMENT_BYTES`.
- **Supersession notes**: `currentRecord`, `changeNote` and `dayOf`.
- **Ports**: `SealedBody` gains an optional `keyVersion`, which the store
  keeps beside each sealed body so a deployment that rotates keys opens each
  with its own; `StoreContext` gains optional `limits` (`StoreLimits`).

## 0.2.0

### The ontology lifecycle, and how writes become documents

The second release moves Docket Cloud's pure logic into the core: everything
here works on values, with no store.

- **The ontology lifecycle**: `checkDraft` and `evaluateDraft` re-validate a
  workspace's documents against a draft, diff the diagnostics with the
  published head's, classify the change as safe, narrowing or breaking, and
  apply a migration's rewrites of server-written documents first. They take
  the workspace as a `WorkspaceSnapshot` and its `StoredDocument`s, which a
  store reads. With them come `compare`, `classify`, `parseDraft`,
  `diffOntologies`, the migrations (`rewriteDocument`, `migrationProblems`,
  `migrationSteps`, `describeMigration`), `importYaml`, `exportYaml` and
  `lintOntology`, `proposedText` and `mergePatch` for proposals, the starter
  `TEMPLATES` (SDLC, a lean service catalogue and blank, generated from
  docket's default ontology), and the lifecycle's errors
  (`OntologyInvalid`, `OntologyBreakingChange`, `OntologyNarrowingChange`,
  `MigrationInvalid`, `StaleDraft` and others).
- **Write building**: `composeDocument` merges a change to one resource into
  its document's Markdown, or makes a new one, keeping the existing layout
  and comments and adding only evidence it does not already hold.
  `stampEvidence` stamps a client's evidence with the writer, the request and
  the time; `appendedNotes`, `sameMeaning`, `splitDocument` and
  `renderDocument` go with it, and the write inputs, `WriteResult` and
  `WRITE_LIMITS` describe a write.
- **Write tool arguments**: `argumentsOf`, `parseEvidence`,
  `parseAttributes`, `requiredText`, `optionalText`, the `EVIDENCE_SCHEMA`
  the write tools publish, and `writeAnswer`, how a write's result reads.

`@chrisjowen/docket` (`^0.10.0`) is now a peer dependency: the core parses
and validates with the host's own docket, so a server validates exactly as
`docket validate` does. `yaml` is a dependency.

## 0.1.0

### The first release: ports, and the scope and role vocabulary

`@chrisjowen/docket-server` is the core a Docket server is built on, shared
by Docket Cloud and a self-hosted, single-tenant server. This first release
carries:

- **Ports**, the interfaces a deployment plugs its storage, auth and tenancy
  into: `Tx`, `DocumentCodec`, `StoreContext`, `StoreRunner`, `ScopeSource`,
  `Principal`, `McpResource`, `Authenticator`, `Authorizer`, `AuditSink`,
  `Limiter`, `ModelGate` and `QueryBackend`.
- **The scope and role vocabulary**: `SCOPES`, `SCOPE_LABELS`, `roleScopes`,
  `impliedScopes`, `parseScopeString`, `isScope`, `ROLES` and `isRole`.
- **Effective permission**: `effectiveScopes` cuts a credential's scopes to
  its subject's role now, read through the `Authorizer` port on every call,
  and `checkScope` answers a 401 or a 403 `insufficient_scope`.

The ontology lifecycle, the Postgres store, the MCP tools and handler, and
the reconcile and search loops follow in later releases.
