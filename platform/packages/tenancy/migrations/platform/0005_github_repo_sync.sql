-- GitHub repo sync (§14.1): which org each GitHub App installation belongs to,
-- where a push to a repo's branch is routed, and the queue of sync and export
-- jobs the worker drains. These rows hold GitHub ids, repo names and commit
-- SHAs, never document text; a connection's details live in its org's schema.

-- An installation of the Docket Cloud GitHub App, linked to one org by an admin
-- whose GitHub account can see it.
CREATE TABLE platform.github_installations (
  installation_id bigint PRIMARY KEY,
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  account_login text NOT NULL,
  account_type text NOT NULL,
  linked_by text NOT NULL REFERENCES platform.users (id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz,
  -- Uninstalled on GitHub: its connections stop syncing.
  deleted_at timestamptz
);
CREATE INDEX github_installations_org ON platform.github_installations (org_id);

-- Where a push lands: one row per repo connection, so a webhook finds the
-- connections it concerns without entering every org.
CREATE TABLE platform.repo_routes (
  connection_id text PRIMARY KEY CHECK (connection_id ~ '^[a-z0-9]{1,40}$'),
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  installation_id bigint NOT NULL REFERENCES platform.github_installations (installation_id) ON DELETE CASCADE,
  repo_id bigint NOT NULL,
  repo_full_name text NOT NULL,
  branch text NOT NULL,
  -- The installation lost access to the repo (installation_repositories: removed).
  removed_at timestamptz
);
CREATE INDEX repo_routes_push ON platform.repo_routes (installation_id, repo_id, branch);
CREATE INDEX repo_routes_org ON platform.repo_routes (org_id);

-- Sync and export jobs. A push waits `run_after` before it runs, and a later
-- push to the same connection while it waits joins it, so a burst of pushes is
-- one sync.
CREATE TABLE platform.repo_jobs (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  connection_id text NOT NULL REFERENCES platform.repo_routes (connection_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('sync', 'export')),
  -- Every file, not just those whose blob changed: the initial import and "Resync now".
  full_sync boolean NOT NULL DEFAULT false,
  requested_by text NOT NULL,
  -- How many webhook deliveries or requests this job stands for.
  requests integer NOT NULL DEFAULT 1,
  attempts integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  outcome text CHECK (outcome IN ('ok', 'error', 'abandoned')),
  error text
);
CREATE UNIQUE INDEX repo_jobs_one_waiting ON platform.repo_jobs (connection_id, kind) WHERE started_at IS NULL;
CREATE INDEX repo_jobs_due ON platform.repo_jobs (run_after) WHERE started_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.github_installations, platform.repo_routes, platform.repo_jobs TO {{app_role}};
GRANT USAGE ON SEQUENCE platform.repo_jobs_id_seq TO {{app_role}};
