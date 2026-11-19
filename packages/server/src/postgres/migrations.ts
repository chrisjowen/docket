import { createHash } from 'node:crypto'

import type { Tx } from '../ports.js'
import { ident, transaction, type Pool } from './db.js'

/**
 * The store's schema, as migrations. Each is SQL with a `{{schema}}`
 * placeholder the runner fills with a checked identifier, so one deployment
 * keeps one store in `public` and another keeps one per tenant, each in its
 * own schema. Each schema records the migrations applied to it in its own
 * `docket_migrations` ledger. Migrations are never edited once released: a
 * change is a new one.
 */
export interface Migration {
  version: number
  name: string
  sql: string
}

const CORE_0001 = `
-- The canonical store: workspaces, their documents with every revision, the
-- ontology's versions, each adapter instance's manifest and standing, the
-- outbox reconciliation reads, the activity log, supersessions, and the
-- deletions and reconcile passes the worker records.

CREATE TABLE {{schema}}.workspaces (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]{1,40}$'),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The roles whose ontology:write credentials may publish this workspace's
  -- ontology over MCP; empty keeps MCP to proposals. Never viewers.
  ontology_mcp_roles text[] NOT NULL DEFAULT '{}'
    CHECK (ontology_mcp_roles <@ ARRAY['owner', 'admin', 'editor']::text[]),
  -- Who outside the store owns the workspace, and when it was marked for deletion.
  owner_ref text,
  deleted_at timestamptz,
  deleted_by text
);
CREATE UNIQUE INDEX workspaces_owner_ref ON {{schema}}.workspaces (owner_ref) WHERE owner_ref IS NOT NULL;
CREATE INDEX workspaces_deletion_due ON {{schema}}.workspaces (deleted_at) WHERE deleted_at IS NOT NULL;

-- Canonical docket documents, each whole file sealed by the deployment's codec.
CREATE TABLE {{schema}}.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (origin IN ('repo', 'cloud', 'cli')),
  origin_ref text,
  path text NOT NULL,
  resource_id text NOT NULL,
  resource_type text NOT NULL,
  raw_ciphertext bytea NOT NULL,
  raw_nonce bytea NOT NULL,
  dek_version integer NOT NULL,
  hash text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  -- A server-written document carried into a repo: once the repo copy syncs back, this one names it.
  exported_to text
);
CREATE INDEX documents_resource ON {{schema}}.documents (workspace_id, resource_id);
-- A live document is identified by its path, as it would be in a repo.
CREATE UNIQUE INDEX documents_live_path ON {{schema}}.documents (workspace_id, path) WHERE retired_at IS NULL;
CREATE INDEX documents_live ON {{schema}}.documents (workspace_id) WHERE retired_at IS NULL;

CREATE TABLE {{schema}}.document_revisions (
  document_id uuid NOT NULL REFERENCES {{schema}}.documents (id) ON DELETE CASCADE,
  revision integer NOT NULL,
  raw_ciphertext bytea NOT NULL,
  raw_nonce bytea NOT NULL,
  dek_version integer NOT NULL,
  hash text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, revision)
);

-- Ontology versions. A draft has no number until it is published; published
-- versions are numbered 1, 2, ... per workspace and never rewritten.
CREATE TABLE {{schema}}.ontology_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  number integer CHECK (number > 0),
  parent_number integer,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'discarded')),
  yaml text NOT NULL,
  yaml_hash text NOT NULL,
  message text,
  -- Where the text came from: template:<id>, import, copy:<workspace>, editor, rollback:v<n>.
  source text NOT NULL,
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  published_by text,
  check_result jsonb,
  migration jsonb,
  -- What the publisher decided for each resource a breaking change left
  -- unknown: update-in-repo (pending repo work) or accept-data-loss.
  dispositions jsonb,
  CHECK ((status = 'published') = (number IS NOT NULL)),
  CHECK (status <> 'published' OR (published_at IS NOT NULL AND published_by IS NOT NULL))
);
CREATE UNIQUE INDEX ontology_versions_number ON {{schema}}.ontology_versions (workspace_id, number) WHERE number IS NOT NULL;
CREATE INDEX ontology_versions_drafts ON {{schema}}.ontology_versions (workspace_id, updated_at DESC) WHERE status = 'draft';

-- What sync knows each adapter instance of a workspace holds: hashes and ids, never document text.
CREATE TABLE {{schema}}.adapter_manifests (
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  instance_id text NOT NULL,
  manifest jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, instance_id)
);

-- Any change to a workspace's documents or published ontology writes a row
-- here in the same transaction; reconciliation reads it.
CREATE TABLE {{schema}}.outbox (
  seq bigserial PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('documents', 'ontology', 'rebuild', 'recheck')),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX outbox_pending ON {{schema}}.outbox (workspace_id, seq) WHERE processed_at IS NULL;

-- How each adapter instance of a workspace is keeping up.
CREATE TABLE {{schema}}.projection_status (
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  instance_id text NOT NULL,
  checkpoint text,
  failures integer NOT NULL DEFAULT 0,
  last_error text,
  attempted_at timestamptz,
  synced_at timestamptz,
  retry_at timestamptz,
  -- The newest rebuild request this instance has been reset and replayed for.
  rebuilt_through bigint,
  PRIMARY KEY (workspace_id, instance_id)
);

-- The activity log: every change to a workspace's knowledge, whatever channel
-- it came through - who, the documents touched, the evidence added and what
-- the validator said - linked to the request's audit event by its request id.
-- The detail is customer content, sealed by the codec like the documents.
CREATE TABLE {{schema}}.ingest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('repo', 'mcp', 'ui', 'cli', 'ontology', 'enrichment')),
  actor text NOT NULL,
  -- A repo sync's connection, repository and commit; empty for every other channel.
  connection_id text,
  repository text,
  commit_sha text,
  documents jsonb NOT NULL DEFAULT '[]',
  notices text[] NOT NULL DEFAULT '{}',
  ontology_draft_id uuid REFERENCES {{schema}}.ontology_versions (id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'refused', 'partial', 'error')),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_label text,
  action text,
  evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  detail_ciphertext bytea,
  detail_nonce bytea,
  dek_version integer,
  CONSTRAINT ingest_events_detail_sealed
    CHECK ((detail_ciphertext IS NULL) = (detail_nonce IS NULL) AND (detail_ciphertext IS NULL) = (dek_version IS NULL))
);
CREATE INDEX ingest_events_workspace ON {{schema}}.ingest_events (workspace_id, created_at DESC);
CREATE INDEX ingest_events_connection ON {{schema}}.ingest_events (connection_id, created_at DESC);
CREATE INDEX ingest_events_channel ON {{schema}}.ingest_events (workspace_id, channel, created_at DESC);
CREATE INDEX ingest_events_actor ON {{schema}}.ingest_events (workspace_id, actor, created_at DESC);

-- A deleted workspace's projections are outside Postgres: each deletion is
-- recorded here, in its transaction, for the worker to clear. It outlives the
-- workspace on purpose, so it has no foreign key.
CREATE TABLE {{schema}}.workspace_deletions (
  workspace_id text PRIMARY KEY CHECK (workspace_id ~ '^[a-z0-9]{1,40}$'),
  slug text NOT NULL,
  name text NOT NULL,
  deleted_by text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  purged_at timestamptz,
  failures integer NOT NULL DEFAULT 0,
  last_error text,
  retry_at timestamptz
);
CREATE INDEX workspace_deletions_pending ON {{schema}}.workspace_deletions (deleted_at) WHERE purged_at IS NULL;

-- One reconcile pass of a workspace: what woke it, and per instance what it
-- applied, failed or reset - kinds, ids and operations, never document text.
CREATE TABLE {{schema}}.sync_runs (
  id bigserial PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  triggers text[] NOT NULL DEFAULT '{}',
  ok boolean NOT NULL,
  instances jsonb NOT NULL
);
CREATE INDEX sync_runs_recent ON {{schema}}.sync_runs (workspace_id, finished_at DESC);

-- Every supersession recorded: one live per resource. One lifted (re-pointed)
-- keeps its row with lifted_at set, so the history stays. The reason and
-- evidence are customer content, sealed by the codec.
CREATE TABLE {{schema}}.supersessions (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  resource_id text NOT NULL,
  superseded_by text NOT NULL CHECK (superseded_by <> resource_id),
  valid_until timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('agent', 'consolidation')),
  actor text NOT NULL,
  actor_label text NOT NULL,
  -- The consolidation run that found it, when one did.
  run_id uuid,
  detail_ciphertext bytea NOT NULL,
  detail_nonce bytea NOT NULL,
  dek_version integer NOT NULL,
  request_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  lifted_at timestamptz
);
CREATE UNIQUE INDEX supersessions_live ON {{schema}}.supersessions (workspace_id, resource_id) WHERE lifted_at IS NULL;
CREATE INDEX supersessions_by ON {{schema}}.supersessions (workspace_id, superseded_by) WHERE lifted_at IS NULL;
`

/**
 * Supersede proposals: a supersession is scored by the workspace's policies
 * and is `pending` until its evidence clears the bar, `accepted` after, or
 * `rejected`. Every supersession recorded before is accepted, as it
 * always was, and marked grandfathered. A record has at most one accepted
 * and one pending supersession at a time; a rejected one stays for history.
 */
const CORE_0002 = `
ALTER TABLE {{schema}}.supersessions
  ADD COLUMN status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted', 'rejected')),
  ADD COLUMN score real CHECK (score BETWEEN 0 AND 1),
  ADD COLUMN threshold real CHECK (threshold BETWEEN 0 AND 1),
  ADD COLUMN updated_at timestamptz,
  ADD COLUMN decided_at timestamptz,
  ADD COLUMN decided_by text,
  ADD COLUMN grandfathered boolean NOT NULL DEFAULT true;
ALTER TABLE {{schema}}.supersessions ALTER COLUMN grandfathered SET DEFAULT false;
DROP INDEX {{schema}}.supersessions_live;
CREATE UNIQUE INDEX supersessions_live ON {{schema}}.supersessions (workspace_id, resource_id) WHERE lifted_at IS NULL AND status = 'accepted';
CREATE UNIQUE INDEX supersessions_pending ON {{schema}}.supersessions (workspace_id, resource_id) WHERE lifted_at IS NULL AND status = 'pending';
`

/** The core store's migrations, in order. */
export const CORE_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'core_0001_canonical_store', sql: CORE_0001 },
  { version: 2, name: 'core_0002_supersede_proposals', sql: CORE_0002 }
]

export class MigrationError extends Error {
  override name = 'MigrationError'
}

/** Serialises every migration run against one database. */
const MIGRATION_LOCK = "hashtext('docket:migrate')"

export const migrationChecksum = (sql: string): string => createHash('sha256').update(sql).digest('hex')

/** A migration's SQL with its placeholders filled. */
export function fillMigration(sql: string, values: Record<string, string>): string {
  return sql.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = values[key]
    if (value === undefined) throw new MigrationError(`migration placeholder {{${key}}} has no value`)
    return value
  })
}

/**
 * Brings one schema up to date inside the caller's transaction: creates it
 * when missing, applies the migrations its ledger lacks, and refuses one
 * whose applied text has changed. Returns how many it applied.
 */
export async function migrateSchema(tx: Tx, schema: string, migrations: readonly Migration[] = CORE_MIGRATIONS): Promise<number> {
  const quoted = ident(schema)
  await tx.query(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`)
  await tx.query(`CREATE SCHEMA IF NOT EXISTS ${quoted}`)
  await tx.query(`CREATE TABLE IF NOT EXISTS ${quoted}.docket_migrations (
    version integer PRIMARY KEY,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const { rows } = await tx.query<{ version: number; checksum: string }>(`SELECT version, checksum FROM ${quoted}.docket_migrations`)
  const applied = new Map(rows.map((row) => [row.version, row.checksum]))
  let count = 0
  for (const migration of migrations) {
    const sum = migrationChecksum(migration.sql)
    const seen = applied.get(migration.version)
    if (seen !== undefined) {
      if (seen !== sum) throw new MigrationError(`${schema} migration ${migration.name} changed after it was applied`)
      continue
    }
    await tx.query(fillMigration(migration.sql, { schema: quoted }))
    await tx.query(`INSERT INTO ${quoted}.docket_migrations (version, name, checksum) VALUES ($1, $2, $3)`, [migration.version, migration.name, sum])
    count += 1
  }
  return count
}

/** Brings a store's schema (`public` by default) up to date in one transaction. Safe to run from several processes at once. */
export function migrate(pool: Pool, options: { schema?: string } = {}): Promise<number> {
  return transaction(pool, (tx) => migrateSchema(tx, options.schema ?? 'public'))
}
