-- Knowledge in from GitHub and back out as PRs (§14.1, §14.3): each repo
-- connection of a workspace, the ingest events every change is recorded as,
-- and the export PRs opened. Same ownership as 0001: the migration owner owns
-- the objects; {{org_role}} gets DML on its own schema only.

-- A repo connection: (installation, repo, branch, path) -> workspace (§14.1).
CREATE TABLE {{schema}}.repo_connections (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]{1,40}$'),
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  installation_id bigint NOT NULL,
  repo_id bigint NOT NULL,
  repo_full_name text NOT NULL,
  branch text NOT NULL,
  -- The docket memory root in the repo, `.docket/` by default.
  path text NOT NULL,
  export_enabled boolean NOT NULL DEFAULT false,
  -- The commit the last sync read, and each file's blob SHA there: the next push diffs against it.
  last_sync_sha text,
  last_sync_at timestamptz,
  last_sync_error text,
  tree jsonb NOT NULL DEFAULT '{}',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz
);
CREATE UNIQUE INDEX repo_connections_live ON {{schema}}.repo_connections (workspace_id, repo_id, branch, path)
  WHERE disconnected_at IS NULL;

-- Every change to a workspace's knowledge, whatever channel it came through
-- (§14.2): who, how, the documents touched, and what the sync noticed. A repo
-- push is one event with the commit it read.
CREATE TABLE {{schema}}.ingest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('repo', 'mcp', 'ui', 'cli', 'ontology')),
  actor text NOT NULL,
  connection_id text REFERENCES {{schema}}.repo_connections (id) ON DELETE SET NULL,
  repository text,
  commit_sha text,
  -- [{ path, resourceId, change: upserted | retired | exported }]
  documents jsonb NOT NULL DEFAULT '[]',
  notices text[] NOT NULL DEFAULT '{}',
  -- The draft a differing entities.yaml proposed, if any.
  ontology_draft_id uuid REFERENCES {{schema}}.ontology_versions (id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'partial', 'error')),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingest_events_workspace ON {{schema}}.ingest_events (workspace_id, created_at DESC);
CREATE INDEX ingest_events_connection ON {{schema}}.ingest_events (connection_id, created_at DESC);

-- A cloud document that an export PR carried into a repo: once the repo copy
-- syncs back in, the cloud copy names it here and leaves the projections (§14.3).
ALTER TABLE {{schema}}.documents ADD COLUMN exported_to text;

-- The PRs "Export cloud knowledge" opened (§14.3).
CREATE TABLE {{schema}}.repo_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id text NOT NULL REFERENCES {{schema}}.repo_connections (id) ON DELETE CASCADE,
  branch text NOT NULL,
  pr_number integer NOT NULL,
  pr_url text NOT NULL,
  -- [{ documentId, path, resourceId, hash }] and the ontology, if it went too.
  documents jsonb NOT NULL,
  ontology_number integer,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX repo_exports_connection ON {{schema}}.repo_exports (connection_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON {{schema}}.repo_connections, {{schema}}.ingest_events, {{schema}}.repo_exports TO {{org_role}};
