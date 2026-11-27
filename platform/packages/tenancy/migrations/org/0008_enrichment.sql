-- Background enrichment: an optional job per workspace that infers links,
-- owners, duplicates and contradictions the documents imply but never state,
-- and writes each as a cloud document of its own under `.docket/~inferred/`,
-- with `inferred` evidence that gives its reasoning and cites its sources.
-- Same ownership as 0001: the migration owner owns the objects; {{org_role}}
-- gets DML on its own schema only. Everything here goes with its workspace.

-- One row per workspace that has ever been configured; none means off.
CREATE TABLE {{schema}}.enrichment_settings (
  workspace_id text PRIMARY KEY REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  schedule text NOT NULL DEFAULT 'nightly' CHECK (schedule IN ('nightly', 'weekly')),
  -- What its AI review may spend in a calendar month (UTC), inside the org's cap.
  monthly_limit_usd numeric(10, 2) NOT NULL DEFAULT 2 CHECK (monthly_limit_usd >= 0),
  -- When the next scheduled run is due; null while it is off.
  next_run_at timestamptz,
  -- A run someone asked for from Settings, picked up before the schedule.
  requested_at timestamptz,
  requested_by text,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enrichment_settings_due ON {{schema}}.enrichment_settings (next_run_at) WHERE enabled;

-- Each run, with what it found and wrote. The summary holds counts only, never document text.
CREATE TABLE {{schema}}.enrichment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  trigger text NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  requested_by text,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'limited', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  summary jsonb,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  error text,
  retired_at timestamptz,
  retired_by text
);
CREATE INDEX enrichment_runs_recent ON {{schema}}.enrichment_runs (workspace_id, started_at DESC);
-- One run at a time per workspace.
CREATE UNIQUE INDEX enrichment_runs_one_running ON {{schema}}.enrichment_runs (workspace_id) WHERE status = 'running';

-- Every inference ever written or rejected in review, by what it says
-- (`fingerprint`), so a run never makes it again - least of all one a person
-- retired. The reasoning and the evidence live in the inferred document
-- itself, encrypted like any other.
CREATE TABLE {{schema}}.enrichment_inferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES {{schema}}.enrichment_runs (id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('link', 'owner', 'duplicate', 'contradiction')),
  outcome text NOT NULL CHECK (outcome IN ('written', 'rejected')),
  resource_id text NOT NULL,
  target text NOT NULL,
  -- The relationship and the document, for one that was written.
  rel text,
  path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  UNIQUE (workspace_id, fingerprint),
  CHECK ((outcome = 'written') = (rel IS NOT NULL AND path IS NOT NULL))
);
CREATE INDEX enrichment_inferences_run ON {{schema}}.enrichment_inferences (run_id);

-- The job writes through the activity log like any other channel.
ALTER TABLE {{schema}}.ingest_events DROP CONSTRAINT ingest_events_channel_check;
ALTER TABLE {{schema}}.ingest_events
  ADD CONSTRAINT ingest_events_channel_check CHECK (channel IN ('repo', 'mcp', 'ui', 'cli', 'ontology', 'enrichment'));

GRANT SELECT, INSERT, UPDATE ON {{schema}}.enrichment_settings, {{schema}}.enrichment_runs, {{schema}}.enrichment_inferences TO {{org_role}};
