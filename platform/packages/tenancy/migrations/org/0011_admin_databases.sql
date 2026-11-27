-- Ownership and the 30-day deletion grace period for the org admin API.
-- Uniqueness includes deleted rows: the worker frees addresses at hard delete.
ALTER TABLE {{schema}}.workspaces
  ADD COLUMN owner_ref text,
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by text;
CREATE UNIQUE INDEX workspaces_owner_ref ON {{schema}}.workspaces (owner_ref) WHERE owner_ref IS NOT NULL;
CREATE INDEX workspaces_deletion_due ON {{schema}}.workspaces (deleted_at) WHERE deleted_at IS NOT NULL;
