-- One org's schema (§5.1): its workspaces, canonical documents with their
-- revisions, and its hash-chained audit log. Objects are owned by the
-- migration owner; the org's login-less role {{org_role}} gets DML on its own
-- schema only, and the audit log is append-only even for it.

CREATE TABLE {{schema}}.workspaces (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]{1,40}$'),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Canonical docket documents, the whole file encrypted with the org's data key (§6.1, §7.3).
CREATE TABLE {{schema}}.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (origin IN ('repo', 'cloud', 'cli')),
  origin_ref text,
  path text NOT NULL,
  resource_id text NOT NULL,
  resource_type text NOT NULL,
  raw_ciphertext bytea NOT NULL,
  raw_nonce bytea NOT NULL,
  dek_version integer NOT NULL,
  hash text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz
);
CREATE INDEX documents_resource ON {{schema}}.documents (workspace_id, resource_id);

CREATE TABLE {{schema}}.document_revisions (
  document_id uuid NOT NULL REFERENCES {{schema}}.documents (id) ON DELETE CASCADE,
  revision integer NOT NULL,
  raw_ciphertext bytea NOT NULL,
  raw_nonce bytea NOT NULL,
  dek_version integer NOT NULL,
  hash text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, revision)
);

-- The org's audit log (§10): append-only, hash-chained, mirrored to the platform stream.
CREATE TABLE {{schema}}.audit_event (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  at timestamptz NOT NULL,
  org_id text NOT NULL CHECK (org_id = '{{org_id}}'),
  workspace_id text,
  actor text NOT NULL,
  ip text,
  user_agent text,
  action text NOT NULL,
  target text[] NOT NULL DEFAULT '{}',
  args_digest text,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'denied', 'error', 'invalid')),
  latency_ms integer NOT NULL,
  request_id text NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL
);
CREATE INDEX audit_event_actor ON {{schema}}.audit_event (actor, seq);
CREATE TABLE {{schema}}.audit_head (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  hash text NOT NULL
);
INSERT INTO {{schema}}.audit_head (hash) VALUES (repeat('0', 64));
CREATE TRIGGER audit_event_mirror AFTER INSERT ON {{schema}}.audit_event
  FOR EACH ROW EXECUTE FUNCTION platform.mirror_audit_event();

GRANT USAGE ON SCHEMA {{schema}} TO {{org_role}};
GRANT SELECT, INSERT, UPDATE, DELETE ON {{schema}}.workspaces, {{schema}}.documents, {{schema}}.document_revisions TO {{org_role}};
GRANT SELECT, INSERT ON {{schema}}.audit_event TO {{org_role}};
GRANT USAGE ON SEQUENCE {{schema}}.audit_event_seq_seq TO {{org_role}};
GRANT SELECT, UPDATE ON {{schema}}.audit_head TO {{org_role}};
