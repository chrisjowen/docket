-- Background consolidation (dreaming): once after each enrichment run, for
-- the workspaces that turn enrichment on, walks every resource's
-- neighbourhood (its direct links and theirs) and has the org's AI write a
-- narrative summary of it, inside the enrichment job's monthly AI limit. Each
-- summary goes into a document of the resource's own under
-- `.docket/~inferred/<id>/summary.md` - frontmatter `summary`,
-- `summary_generated_at`, `summary_model`, `summary_confidence` and
-- `summary_evidence`, with the `summary_run` and `summary_checkpoint` it came
-- from - rewritten in place by the next summary, so no document a person,
-- repo or checkout wrote is ever touched. A summary nothing new replaces -
-- a near-duplicate's, a too-short regeneration's, or a near-isolated
-- resource's - is retired, and its document with it.

-- One per finished enrichment run: the run that follows it.
CREATE TABLE {{schema}}.consolidation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  enrichment_run_id uuid NOT NULL UNIQUE REFERENCES {{schema}}.enrichment_runs (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'limited', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  summary jsonb,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  error text
);
CREATE INDEX consolidation_runs_recent ON {{schema}}.consolidation_runs (workspace_id, started_at DESC);
CREATE UNIQUE INDEX consolidation_runs_one_running ON {{schema}}.consolidation_runs (workspace_id) WHERE status = 'running';

-- Every summary written: the document revision that holds its text, how it
-- was made and from which neighbourhood fingerprint, and when it stopped
-- being live: in which run, why, and the summary that replaced it - the
-- resource's next, or the one of the resource it near-duplicates - when one
-- did. One live summary per resource.
CREATE TABLE {{schema}}.consolidation_summaries (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES {{schema}}.consolidation_runs (id) ON DELETE CASCADE,
  resource_id text NOT NULL,
  path text NOT NULL,
  revision integer NOT NULL,
  model text NOT NULL,
  confidence numeric(3, 2) NOT NULL,
  evidence_ids text[] NOT NULL DEFAULT '{}',
  checkpoint text NOT NULL,
  generated_at timestamptz NOT NULL,
  superseded_by uuid REFERENCES {{schema}}.consolidation_summaries (id) DEFERRABLE INITIALLY DEFERRED,
  superseded_at timestamptz,
  superseded_in uuid REFERENCES {{schema}}.consolidation_runs (id) ON DELETE SET NULL,
  superseded_reason text CHECK (superseded_reason IN ('replaced', 'duplicate', 'trivial', 'isolated'))
);
CREATE UNIQUE INDEX consolidation_summaries_live ON {{schema}}.consolidation_summaries (workspace_id, resource_id) WHERE superseded_at IS NULL;
CREATE INDEX consolidation_summaries_run ON {{schema}}.consolidation_summaries (run_id);

-- What each resource's neighbourhood looked like when it was last summarized:
-- a run skips every resource whose neighbourhood still has that fingerprint.
CREATE TABLE {{schema}}.consolidation_checkpoints (
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  resource_id text NOT NULL,
  fingerprint text NOT NULL,
  seen_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, resource_id)
);

GRANT SELECT, INSERT, UPDATE ON {{schema}}.consolidation_runs, {{schema}}.consolidation_summaries, {{schema}}.consolidation_checkpoints TO {{org_role}};
