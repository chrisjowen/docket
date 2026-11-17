# Changelog

Changes to `@chrisjowen/docket-server`.

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
