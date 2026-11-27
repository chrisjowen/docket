-- Supersession: a fact gone out of date is never deleted. When a newer
-- record contradicts an older one about the same thing, the older is marked
-- superseded - until when it held, which record replaces it, why, and the
-- evidence for the change - and search answers with the replacement and a
-- note of the change rather than presenting the older as current. An agent
-- supersedes a record directly (`docket_supersede`); consolidation does it
-- when it finds a clear contradiction between two records of one type.

-- Every supersession recorded. One live per resource; a supersession lifted
-- (re-pointed by an agent) keeps its row with `lifted_at` set, so the
-- history stays. The reason and evidence are customer content, sealed under
-- the org's data key like the activity log's detail.
CREATE TABLE {{schema}}.supersessions (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  resource_id text NOT NULL,
  superseded_by text NOT NULL CHECK (superseded_by <> resource_id),
  valid_until timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('agent', 'consolidation')),
  actor text NOT NULL,
  actor_label text NOT NULL,
  run_id uuid REFERENCES {{schema}}.consolidation_runs (id) ON DELETE SET NULL,
  detail_ciphertext bytea NOT NULL,
  detail_nonce bytea NOT NULL,
  dek_version integer NOT NULL,
  request_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  lifted_at timestamptz
);
CREATE UNIQUE INDEX supersessions_live ON {{schema}}.supersessions (workspace_id, resource_id) WHERE lifted_at IS NULL;
CREATE INDEX supersessions_by ON {{schema}}.supersessions (workspace_id, superseded_by) WHERE lifted_at IS NULL;

-- Each pair of records consolidation has judged for a contradiction, and
-- what both said when it did: a pair whose records have not changed since is
-- not asked about again.
CREATE TABLE {{schema}}.contradiction_checks (
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  older_id text NOT NULL,
  newer_id text NOT NULL,
  fingerprint text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('supersedes', 'distinct', 'unsure')),
  checked_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, older_id, newer_id)
);

-- Consolidation runs on its own schedule as well as after each enrichment
-- run: a scheduled run follows no enrichment run.
ALTER TABLE {{schema}}.consolidation_runs ALTER COLUMN enrichment_run_id DROP NOT NULL;

GRANT SELECT, INSERT, UPDATE ON {{schema}}.supersessions, {{schema}}.contradiction_checks TO {{org_role}};
