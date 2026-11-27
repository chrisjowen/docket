-- Projections (§6.2): how each adapter instance of a workspace is keeping up,
-- the rebuild request, and the notification that wakes the worker. Same
-- ownership as 0001.

-- A rebuild is requested through the outbox like any other change.
ALTER TABLE {{schema}}.outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE {{schema}}.outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN ('documents', 'ontology', 'rebuild'));

-- One row per adapter instance of a workspace: its last checkpoint, and the
-- failures since its last successful pass. Five in a row show "index behind"
-- with the adapter's message.
CREATE TABLE {{schema}}.projection_status (
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  instance_id text NOT NULL,
  checkpoint text,
  failures integer NOT NULL DEFAULT 0,
  last_error text,
  attempted_at timestamptz,
  synced_at timestamptz,
  -- When the worker tries again after a failure.
  retry_at timestamptz,
  -- The newest rebuild request this instance has been reset and replayed for.
  rebuilt_through bigint,
  PRIMARY KEY (workspace_id, instance_id)
);

CREATE TRIGGER outbox_notify AFTER INSERT ON {{schema}}.outbox
  FOR EACH STATEMENT EXECUTE FUNCTION platform.outbox_notify();

GRANT SELECT, INSERT, UPDATE, DELETE ON {{schema}}.projection_status TO {{org_role}};
