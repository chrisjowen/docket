-- Deleting a workspace (§4): its row goes, and everything that references it
-- in the org's schema goes with it (documents and revisions, the ontology,
-- manifests, the outbox, projection status, repo connections and the activity
-- log). The projections are outside Postgres, so each deletion is recorded
-- here, in the same transaction, for the worker to clear the workspace's
-- scope from the org's Neo4j and Qdrant. It keeps ids and names only, never
-- document text, and outlives the workspace on purpose: there is no foreign
-- key. Same ownership as 0001.
CREATE TABLE {{schema}}.workspace_deletions (
  workspace_id text PRIMARY KEY CHECK (workspace_id ~ '^[a-z0-9]{1,40}$'),
  slug text NOT NULL,
  name text NOT NULL,
  deleted_by text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  -- When the worker cleared the projections; null while that is still to do.
  purged_at timestamptz,
  failures integer NOT NULL DEFAULT 0,
  last_error text,
  retry_at timestamptz
);
CREATE INDEX workspace_deletions_pending ON {{schema}}.workspace_deletions (deleted_at) WHERE purged_at IS NULL;

-- A deletion wakes the worker like any other change.
CREATE TRIGGER workspace_deletions_notify AFTER INSERT ON {{schema}}.workspace_deletions
  FOR EACH STATEMENT EXECUTE FUNCTION platform.outbox_notify();

GRANT SELECT, INSERT, UPDATE ON {{schema}}.workspace_deletions TO {{org_role}};
