-- MCP authentication (§8.2-8.5): API tokens, and what the OAuth authorization
-- server keeps (clients, grants, codes, opaque access and refresh tokens).
-- Credentials only, never customer content. Same ownership as 0001.

-- API tokens for headless agents and CI (§8.3). Only the SHA-256 of a token is
-- stored; `prefix` is its first characters, shown in the UI and the audit log.
CREATE TABLE platform.api_tokens (
  id text PRIMARY KEY CHECK (id ~ '^tok_[a-z0-9]{12}$'),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  prefix text NOT NULL,
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  -- One workspace: a token is never org-wide in the beta (§8.3).
  workspace_id text NOT NULL,
  -- A human member or a service account; the token can never do more than its role allows (§8.4).
  owner_id text NOT NULL REFERENCES platform.users (id) ON DELETE CASCADE,
  scopes text[] NOT NULL CHECK (
    cardinality(scopes) > 0 AND scopes <@ ARRAY['docket:read', 'docket:write', 'ontology:read', 'ontology:propose']
  ),
  description text CHECK (length(description) <= 200),
  created_by text NOT NULL REFERENCES platform.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Required, and at most 90 days after creation (§8.3).
  expires_at timestamptz NOT NULL CHECK (expires_at <= created_at + interval '90 days'),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by text
);
CREATE INDEX api_tokens_workspace ON platform.api_tokens (org_id, workspace_id, created_at DESC);
CREATE INDEX api_tokens_owner ON platform.api_tokens (owner_id);

-- The OAuth authorization server's store (`oidc-provider`'s adapter): one row
-- per model instance. Ids are kept as their SHA-256, so the table holds no
-- usable access token, refresh token or code (§8.5: every request looks the
-- token up by hash).
CREATE TABLE platform.oauth_store (
  model text NOT NULL,
  id_hash text NOT NULL,
  payload jsonb NOT NULL,
  grant_id text,
  uid text,
  -- Who and what, for the grants list and revocation: the user, the client, the MCP resource.
  account_id text,
  client_id text,
  resource text,
  expires_at timestamptz,
  consumed_at timestamptz,
  PRIMARY KEY (model, id_hash)
);
CREATE INDEX oauth_store_grant ON platform.oauth_store (grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX oauth_store_uid ON platform.oauth_store (uid) WHERE uid IS NOT NULL;
CREATE INDEX oauth_store_account ON platform.oauth_store (model, account_id) WHERE account_id IS NOT NULL;
CREATE INDEX oauth_store_expires ON platform.oauth_store (expires_at) WHERE expires_at IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON platform.api_tokens TO {{app_role}};
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.oauth_store TO {{app_role}};
