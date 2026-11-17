# Changelog

Changes to `@chrisjowen/docket-server`.

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
