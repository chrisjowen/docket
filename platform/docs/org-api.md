# Docket Cloud Org Admin API (Part A)

**Status:** Implemented · **Audience:** org operators and their integrations · **Scope:** Generic org-level database (workspace) management with master admin keys. Nothing integration-specific.

This document defines the REST API an org operator uses to create and manage per-user "databases" (workspaces) on demand, issue scoped access keys for MCP agents, and observe usage/audit, plus how Docket Cloud ops mint and revoke the org's master admin keys. It fits the existing multi-tenant model (per-org Postgres schema, Neo4j pod, Qdrant collections, KEK-wrapped keys, tenant router, audit log, rate limits).

All endpoints in sections 2-4 are JSON, use `Authorization: Bearer <master-key>`, and are rate-limited, audited, and tenant-isolated. Errors follow the existing `error` + `error_description` shape (see `CliError`).

## 1. Master Admin Key

An org has one or more master admin keys. A key is:
- 32 random bytes, base62 encoded with prefix `dmk_` (displayed once).
- Stored only as SHA-256 hash + prefix (`dmk_` and the next 8 chars) + metadata.
- Scoped to exactly one org; usable only for that org's databases.
- Rotatable (new key minted; old remains until explicitly revoked or expires).
- Revocable (immediate; all or by id).
- Optional TTL (default 1 year; max 2 years).

**Ops-only lifecycle.** Master keys are minted, listed, rotated and revoked by Docket Cloud ops with `worker/master-keys.js` in the worker pod (`ops/runbooks/master-keys.md`), never over this API: no master key and no org member can mint, rotate or revoke one. Each mint and revoke is recorded in the org's audit log as `system:operator:<name>` (`org.admin.master-key.mint`, `org.admin.master-key.revoke`). A mint takes:
- `ttl_days?` (1-730, default 365).
- `database_limit?`: how many databases the org admin API may hold in the org (default 1000, stored on the org). Each mint may change it.

It returns `{ id, prefix, key, created_at, expires_at, database_limit }`; `key` is shown **once**: the tool writes it alone to stdout, for the operator to pipe into a secret store, and refuses to write it to a terminal. A revoke names one key by id, or every unrevoked key of the org.

**The `org-admin` service account.** The org's first mint provisions an `org-admin` service account (a `platform.users` row of kind `service` with a membership and no grant); later mints reuse it. It holds no grant on any database, so it can neither read nor write one, and no key it owned could either. The per-database access keys the API issues belong to each database's own service accounts instead (section 3). It takes no member seat, and member management (UI or API) refuses to remove it or give it access. It is retired only when ops revokes the org's last live (unrevoked, unexpired) master key: that revokes every access key the API issued in the same transaction, so downstream agents lose access. The account itself stays, and a later mint reuses it. Revocation is ops-only.

Keys are looked up by hash on every request. Revoked or expired keys are refused with `invalid_token`.

## 2. Databases (Workspaces)

A database = a workspace inside the org. Created with an ontology (template or inline YAML). The generic templates are the existing `sdlc`, `lean-catalogue`, `people-org`, `crm`, `research`, `personal-knowledge`, `product-catalogue` and `blank`; any other ontology (for example an integration's own user-memory ontology) is supplied by the caller as `inline_yaml`. This API ships no caller-specific templates.

**Endpoints**

- `POST /api/admin/o/{org}/databases`  
  Body:
  ```json
  {
    "name": "alice-memory",
    "slug": "alice",              // optional; auto-generated if absent
    "owner_ref": "user:example-app:7f3a9c", // required; the caller's stable id for the owner, unique per org
    "ontology": { "template": "blank" } | { "inline_yaml": "..." }
  }
  ```
  - Idempotent on `owner_ref`: if an active database already has this `owner_ref`, and `slug` (if given) is its slug, and `ontology` (if given) matches its current head ontology, returns it with 200 (no-op).
  - Otherwise, if an active database has this `owner_ref` but a different `slug` or ontology, or the `slug` is taken by a database with a different `owner_ref`, or the `slug` or `owner_ref` belongs to a database in its deletion grace period: 409 `conflict`. An existing database is never returned for a different `owner_ref`.
  - Otherwise creates workspace + first ontology version (same checks as UI create) and returns 201.
  - The beta's per-org workspace limit for members (5) does not apply. The API holds the org to its own `database_limit` (section 1, default 1000), counting every workspace in the org, including those in grace; past it the call is refused with 403 `limit`. Members creating workspaces in the UI stay held to the beta limit, which counts only workspaces without an `owner_ref`: this API's databases never use up the members' allowance.
  - Response 201/200: `{ id, slug, name, status, created_at, ontology_version, owner_ref }`

- `GET /api/admin/o/{org}/databases`  
  Query: `?status=active|deleted|all` (default active).  
  Response: `{ databases: [...] }`

- `GET /api/admin/o/{org}/databases/{slug}`  
  Response: full record + current head ontology version + key count.

- `DELETE /api/admin/o/{org}/databases/{slug}`  
  Soft delete: sets `deleted_at` and revokes the database's access keys; data is retained for a 30-day grace period, during which the database is listed only under `?status=deleted` and its slug and `owner_ref` stay reserved.  
  Idempotent: calling it again on a database in grace is a no-op. Response 204.  
  After the grace period the worker hard-deletes it through the existing deletion path (row removed, `workspace_deletions` recorded, Neo4j/Qdrant projections purged); it then no longer appears in any listing and its slug and `owner_ref` are free.

- `PUT /api/admin/o/{org}/databases/{slug}/ontology`  
  Body: same `ontology` shape as create.  
  Creates new published version (runs checks). Response: `{ version, published_at }`

## 3. Per-Database Access Keys (MCP / Agent Use)

Issue hashed keys scoped to one database. These are the credentials an integration's MCP client (and future agents) use to call `docket_remember`, `docket_search`, etc.

- `POST /api/admin/o/{org}/databases/{slug}/keys`  
  Body: `{ description?: string, ttl_days?: number, scopes?: ["docket:read","docket:write"] }`  
  - `ttl_days`: 1-90, default 90 (the `api_tokens` 90-day limit). There is no renewal: for longer access the caller issues a new key before expiry and revokes the old one.
  - `scopes`: a non-empty subset of `docket:read`, `docket:write` (default both). Ontology changes go through the ontology endpoint above, not access keys.
  - Only for a database this API created (one with an `owner_ref`). A database made in Docket Cloud's UI is refused with 403 `forbidden`: a master key never reaches a database it did not make.

  Response 201: `{ id, prefix, key, created_at, expires_at }` — `key` shown **once**.

- `GET /api/admin/o/{org}/databases/{slug}/keys`  
  Response: list (metadata only).

- `DELETE /api/admin/o/{org}/databases/{slug}/keys/{key_id}`  
  Revoke. Response 204.

Keys are `dkt_sys_` system account tokens (keys issued before platform migration `0016_tokens_and_connections` keep their `dkt_live_` text and work as before). They are stored in `platform.api_tokens` with their one database in `dockets`, the hash and the prefix: a read key is read-only, and a write key keeps exactly the scopes this API has always given it (`docket:read`, `docket:write`, `ontology:read`) as its ceiling. `owner_id` is one of the database's two service accounts, `org-admin/<database id>/write` for a key with `docket:write` and `org-admin/<database id>/read` for a read-only one, made by the first key at that level (`platform.database_accounts`, platform migration `0014_database_accounts`). Each is a guest holding Writer or Reader on that one database and nothing else, so a key reaches only its database, at most at its level. They take no member seat, are not listed as members, and member management refuses to change them. `created_by` is the org's `org-admin` service account (section 1). The master key that issued a key is recorded as the actor in the audit event.

## 4. Usage & Audit

- `GET /api/admin/o/{org}/usage`  
  Response: `{ databases: N, active_keys: N, calls_30d: N, storage_bytes: N, ... }` (org-level rollup).

- `GET /api/admin/o/{org}/audit`  
  Query: `?entity=database&slug=...&action=...&since=...`  
  Returns the existing append-only audit events for the org, filtered.

All mutating calls write an audit event (`org.admin.database.create`, `org.admin.key.issue`, `org.admin.key.revoke`, etc.) with the master-key id as actor.

## 5. Security, Limits, Errors

- **Database limit:** the org's `database_limit`, set by ops at mint (default 1000), not the beta's member workspace limit.
- **Rate limits:** Reuse `mcpLimits` + `tokenCreateLimits` (or new `orgAdminLimits`). 60 requests/min per master key, 10 key creations/min.
- **Auth errors:** 401 `invalid_token`, 403 `insufficient_scope` (if key is read-only in future), 403 `forbidden` for a key on a database the API did not create.
- **Validation:** Same slug rules, ontology checks, tenant isolation as existing paths.
- **Idempotency:** Create is idempotent on `owner_ref` (409 `conflict` on any mismatch); delete is idempotent (204).
- **Soft delete:** `deleted_at` column on workspaces; every workspace query (UI, MCP, tenant router, this API) excludes databases in grace unless `?status=deleted`.
- **No graph/Neo4j changes here** — the worker projection still owns that.
- **Audit chain:** Every call appends to the platform audit log (hash-chained).

## 6. OpenAPI Sketch (for codegen)

See the full shapes above. All JSON responses include `request_id` for tracing and `X-Request-Id` in the headers. A 204 has no body and carries only the header. Responses use `Cache-Control: no-store`.

## 7. Implementation Notes (for docket-cloud builders)

- Platform migration `0009_org_admin`: `platform.org_master_keys` (id, org_id, key_hash, prefix, created_at, expires_at, revoked_at, last_used_at), and `platform.orgs.admin_database_limit` (default 1000) and `platform.orgs.org_admin_id`.
- `mintMasterKey` (tenancy) mints keys and provisions the `org-admin` account; `listMasterKeys` and `revokeMasterKeys` list and revoke them, the last retiring `org-admin`'s access keys; `adminDatabaseLimit` reads the limit, which database create passes to `createWorkspace` as `maxWorkspaces`. `worker/master-keys.js` (`apps/worker/src/master-key-tool.ts`) is the ops tool over all three.
- Member creates count `countMemberWorkspaces` (canonical-store), the workspaces without an `owner_ref`, against the beta limit.
- Server route: `apps/server/src/routes/api/admin/o/[org]/[...path]/+server.ts`, with the shared pipeline and handlers in `lib/server/org-admin.ts`. Auth, tenant changes, platform credentials and the success audit append commit in one transaction; refusals are audited after rollback. A live key for a different org receives 401 `invalid_token`.
- Reuse `tenantRouter.withTenant`, `KeyService` for hashing, `audit`, existing rate-limit and bearer lookup.
- Ontology creation reuses `createWorkspace` + `publish` from `@docket/platform-ontology-service`.
- Org migration `0011_admin_databases`: `workspaces.deleted_at timestamptz`, `deleted_by text`, and `owner_ref text` (unique where not null, including grace rows). Workspace reads in `canonical-store` filter `deleted_at IS NULL` except the admin listing and deletion/expiry paths.
- Worker: the housekeeping sweep (at startup and every 10 minutes) calls the existing `deleteWorkspace` once `deleted_at` is at least 30 days old. It removes webhook routes and records `workspace_deletions`, whose existing purge clears Neo4j/Qdrant. Reservations remain until that sweep commits.
- Access keys reuse `issueApiToken` / `api_tokens`, owned by the database's read or write account (`databaseAccount` in tenancy, over `platform.database_account`), with the org's `org-admin` service account as creator. Platform migration `0014_database_accounts` moved every live key `org-admin` owned before it to those accounts without changing its text, and left `org-admin` with no grant (since platform migration `0017_capabilities_and_grants`, a membership with no grant at all).
- Tests: fast unit tests in `*.test.ts` (no DB) + `*.int.test.ts` for the new tables/endpoints. E2E later.
- The first PR ships this document with the master-key mint, the `org-admin` account and the database limit, so integrations can code against a frozen spec.

### Settled wire details

- `name` is required on create (1-80 characters after trimming); retries leave the original name unchanged. `owner_ref` is an exact, non-blank string of at most 512 characters; it is never inferred from a slug or changed by a retry. UI-created workspaces have `owner_ref: null` and remain visible to the admin API, but it issues no keys for them.
- If `slug` is absent on a new database, it is generated from the name plus a random suffix; retries look up `owner_ref` first and reuse that slug. The ontology is required for a new database and may be omitted on a retry. Equality means the SHA-256 of the exact current YAML text after stripping an export header, including comments and whitespace. A template and its identical inline YAML match.
- `PUT .../ontology` accepts exactly `{ "template": "blank" }` or `{ "inline_yaml": "..." }`; any other body, including a create-style `{ "ontology": { ... } }` wrapper, returns 400 `invalid_request`. Publishing runs normal validation and existing-document checks. Invalid YAML/schema returns 400 `invalid_request`; a breaking, narrowing or stale publish returns 409 `conflict` without publishing a version. Changes needing migrations or explicit acceptance go through the ontology editor.
- Database records include `deleted_at` (null while active). A single-database GET returns active records only, adding `created_by`, `ontology: { version, yaml, published_at }`, and `key_count` (unexpired, unrevoked keys). Deleted databases appear only in the deleted/all list and remain addressable for idempotent DELETE; other operations return 404.
- Key metadata responses are `{ keys: [...] }`, newest first, including `id`, `prefix`, `scopes`, `description`, `created_at`, `expires_at`, `last_used_at` and `revoked_at`. They include all keys for the database (including member-created, expired and revoked keys) and never include key text or hashes. Missing/already-revoked key IDs return 404; a key ID from another database cannot be revoked. As for all Docket credentials, `docket:read` also grants `ontology:read`; these keys never grant ontology proposal/publish scopes.
- Soft deletion revokes the database's API tokens and OAuth grants in the same transaction as setting `deleted_at`. The database limit and usage database count include all workspaces, including UI-created databases and grace rows. UI creates keep the existing beta limit, counting UI-created workspaces only.
- `usage.active_keys` counts unexpired, unrevoked API tokens in the org; `calls_30d` counts existing org audit events in the preceding 30 days, before this call's audit append. `storage_bytes` sums encrypted canonical documents, their revision ciphertext/nonces, and all ontology YAML; it excludes indexes, projections and database overhead. `database_limit` reports the current operator-set limit.
- Audit responses are `{ events: [...] }`, newest first, capped at the existing audit API's default 100 events. Filters run before that cap: `action` is exact, `since` is a timestamp, `entity=database` selects events with a workspace id, including existing UI/MCP activity. `slug` matches current and historical workspace ids and the `database:<slug>` audit target (which remains after hard deletion). Database, key and ontology events use that target. Each call is audited with `token:<master-key-id>` as actor, including reads, retries and refusals after authentication; unauthenticated refusals go to the platform log as anonymous, at most one burst record per client address, org path and outcome a minute, and count toward the per-address refused-credential limit shared with MCP and the CLI API (429 with `Retry-After` once exceeded). Hard deletion adds `org.admin.database.purge` as `system:database-expiry`.
- General calls share a 60/minute bucket per master key, and key creation adds a 10/minute bucket. 429 responses carry `Retry-After`. Master keys are looked up without a credential cache on every call; calls lock the key through commit so ops revocation and in-flight calls have a definite order.

## 8. Non-Goals (MVP)

- Payments, teams, multi-org master keys, key delegation, restore-from-grace, usage billing export, caller-specific ontology templates.
- Workspace-level MCP changes (those stay per the existing `/mcp/{org}/{ws}` contract).
- Integration-specific ontology or filing logic (that lives in the integration).

---


This spec is the contract integrations build against. Changes require a new version of this document.