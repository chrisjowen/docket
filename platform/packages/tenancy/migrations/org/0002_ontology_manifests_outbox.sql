-- The canonical store and the ontology (§6, §13): one ontology per workspace
-- with its versions, each adapter instance's sync manifest, and the outbox the
-- reconciliation worker reads. Same ownership as 0001: the migration owner owns
-- the objects; {{org_role}} gets DML on its own schema only.

-- A live document is identified by its path, as it would be in a repo.
CREATE UNIQUE INDEX documents_live_path ON {{schema}}.documents (workspace_id, path) WHERE retired_at IS NULL;
CREATE INDEX documents_live ON {{schema}}.documents (workspace_id) WHERE retired_at IS NULL;

-- Ontology versions (§13.2). A draft has no number until it is published;
-- published versions are numbered 1, 2, ... per workspace and never rewritten.
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
  -- What the publisher decided for each resource a breaking change left unknown:
  -- update-in-repo (pending repo work) or accept-data-loss.
  dispositions jsonb,
  CHECK ((status = 'published') = (number IS NOT NULL)),
  CHECK (status <> 'published' OR (published_at IS NOT NULL AND published_by IS NOT NULL))
);
CREATE UNIQUE INDEX ontology_versions_number ON {{schema}}.ontology_versions (workspace_id, number) WHERE number IS NOT NULL;
CREATE INDEX ontology_versions_drafts ON {{schema}}.ontology_versions (workspace_id, updated_at DESC) WHERE status = 'draft';

-- What sync knows each adapter instance of a workspace holds (adapter-spec §8),
-- the cloud's ManifestStore. Hashes and ids only, never document text.
CREATE TABLE {{schema}}.adapter_manifests (
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  instance_id text NOT NULL,
  manifest jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, instance_id)
);

-- Any change to a workspace's documents or published ontology writes a row
-- here in the same transaction (§6.2); the worker reconciles from it.
CREATE TABLE {{schema}}.outbox (
  seq bigserial PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('documents', 'ontology')),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX outbox_pending ON {{schema}}.outbox (workspace_id, seq) WHERE processed_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON {{schema}}.ontology_versions, {{schema}}.adapter_manifests, {{schema}}.outbox TO {{org_role}};
GRANT USAGE ON SEQUENCE {{schema}}.outbox_seq_seq TO {{org_role}};
