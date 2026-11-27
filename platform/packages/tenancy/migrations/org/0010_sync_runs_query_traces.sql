-- How a workspace's data reaches its stores and how its questions are
-- answered, for the read-only Sync and Queries views in its Settings: one row
-- per reconcile pass, and one trace per question put to the query service.
-- Both keep a bounded history (the newest 200 per workspace, 30 days at
-- most), pruned as rows are added. Same ownership as 0001.

-- An owner asks for a pass now, outside the backoff, through the outbox like
-- any other change: a re-check projects nothing a pass would not.
ALTER TABLE {{schema}}.outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE {{schema}}.outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN ('documents', 'ontology', 'rebuild', 'recheck'));

-- One reconcile pass of a workspace: what woke it, and per instance what it
-- applied, failed or reset, and the records it changed - kinds, ids and
-- operations only, never document text.
CREATE TABLE {{schema}}.sync_runs (
  id bigserial PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  -- The outbox kinds the pass covered: documents, ontology, rebuild, recheck.
  triggers text[] NOT NULL DEFAULT '{}',
  ok boolean NOT NULL,
  instances jsonb NOT NULL
);
CREATE INDEX sync_runs_recent ON {{schema}}.sync_runs (workspace_id, finished_at DESC);

-- One question put to the workspace's projections (`docket_search`,
-- `docket_ask`): which stores were asked, what each returned, the query that
-- ran and who wrote it, what went into the answer and what it cost. The
-- question and its steps are customer content, sealed with the org's data key
-- like the activity log's detail; they hold ids and titles, never document
-- bodies or evidence text.
CREATE TABLE {{schema}}.query_traces (
  id uuid PRIMARY KEY,
  -- The order traces were kept in, newest last: two can share a timestamp.
  seq bigserial NOT NULL,
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  tool text NOT NULL CHECK (tool IN ('search', 'ask')),
  actor text NOT NULL,
  -- The member who asked, through any of their tokens or OAuth clients: a
  -- member who may not read everyone's questions reads only their own.
  user_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('answered', 'failed')),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  at timestamptz NOT NULL DEFAULT now(),
  detail_ciphertext bytea NOT NULL,
  detail_nonce bytea NOT NULL,
  dek_version integer NOT NULL
);
CREATE INDEX query_traces_recent ON {{schema}}.query_traces (workspace_id, seq DESC);
CREATE INDEX query_traces_asked_by ON {{schema}}.query_traces (workspace_id, user_id, seq DESC);

GRANT SELECT, INSERT, DELETE ON {{schema}}.sync_runs, {{schema}}.query_traces TO {{org_role}};
GRANT USAGE ON SEQUENCE {{schema}}.sync_runs_id_seq, {{schema}}.query_traces_seq_seq TO {{org_role}};
