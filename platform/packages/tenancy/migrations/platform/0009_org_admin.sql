-- The org admin API (docs/org-api.md). Ops mints an org's master keys; the
-- first mint provisions the org's `org-admin` service account, which owns the
-- per-database access keys the API issues. It takes no member seat and member
-- management cannot remove it. Databases the API creates are held to the
-- org's own limit, set by ops, not the beta's workspace limit. Same ownership
-- as 0001.
ALTER TABLE platform.orgs
  ADD COLUMN admin_database_limit integer NOT NULL DEFAULT 1000 CHECK (admin_database_limit > 0),
  ADD COLUMN org_admin_id text REFERENCES platform.users (id);

-- Only the SHA-256 of a key is stored; `prefix` names it in listings and the audit log.
CREATE TABLE platform.org_master_keys (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at <= created_at + interval '730 days'),
  revoked_at timestamptz,
  last_used_at timestamptz
);
CREATE INDEX org_master_keys_org ON platform.org_master_keys (org_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON platform.org_master_keys TO {{app_role}};
