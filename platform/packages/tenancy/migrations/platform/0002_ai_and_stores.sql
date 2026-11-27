-- AI through OpenRouter with a monthly cap per org (§11), and the state of each
-- org's projection stores (§5.2-5.3, §16). Same ownership as 0001: the
-- migration owner owns the objects, the request role gets what requests and
-- the worker need.

-- Each org's monthly AI budget, in US dollars, and its model choices from the
-- platform allowlist. No row means the beta default.
CREATE TABLE platform.ai_caps (
  org_id text PRIMARY KEY REFERENCES platform.orgs (id) ON DELETE CASCADE,
  monthly_usd numeric(10, 2) NOT NULL CHECK (monthly_usd >= 0),
  -- The model each use runs on: { "cypher": "...", "synthesis": "..." }.
  models jsonb NOT NULL DEFAULT '{}',
  updated_by text REFERENCES platform.users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The org's own OpenRouter key (§11), created through OpenRouter's key
-- provisioning API with a credit limit equal to the cap. The key is sealed
-- with the org's data key; `key_hash` is OpenRouter's id for it.
CREATE TABLE platform.ai_keys (
  org_id text PRIMARY KEY REFERENCES platform.orgs (id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  dek_version integer NOT NULL,
  limit_usd numeric(10, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- What each AI call cost, metered from OpenRouter's response (§11).
CREATE TABLE platform.ai_usage (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  workspace_id text,
  actor text NOT NULL,
  -- What the call was for: cypher, synthesis, extraction.
  purpose text NOT NULL,
  model text NOT NULL,
  generation_id text,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_org_at ON platform.ai_usage (org_id, at);

-- The owner warnings sent for a month (80% of the cap), so each is sent once.
CREATE TABLE platform.ai_cap_warnings (
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  -- The calendar month in UTC, 'YYYY-MM'.
  month text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  threshold integer NOT NULL CHECK (threshold BETWEEN 1 AND 100),
  spent_usd numeric(12, 6) NOT NULL,
  cap_usd numeric(10, 2) NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, month, threshold)
);

-- Each org's Neo4j pod and Qdrant collections, as the worker last provisioned them.
CREATE TABLE platform.org_stores (
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  store text NOT NULL CHECK (store IN ('neo4j', 'qdrant')),
  status text NOT NULL CHECK (status IN ('provisioning', 'ready', 'suspended', 'failed')),
  -- Where to connect, never a credential.
  target text,
  -- The k8s Secret holding the store's credentials for this org.
  credentials_secret text,
  last_error text,
  -- When a projection or a query last used the store; idle stores are suspended.
  used_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, store)
);

-- Wakes the worker when a workspace changes. Org schemas attach it to their
-- outbox (org migration 0003); the payload is the org's schema name.
CREATE FUNCTION platform.outbox_notify() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('docket_outbox', TG_TABLE_SCHEMA);
  RETURN NULL;
END
$$;

-- The worker waits for the API to migrate before it starts, so it reads the ledger.
GRANT SELECT ON platform.schema_migrations TO {{app_role}};
GRANT SELECT, INSERT, UPDATE ON platform.ai_caps TO {{app_role}};
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.ai_keys TO {{app_role}};
GRANT SELECT, INSERT ON platform.ai_usage TO {{app_role}};
GRANT USAGE ON SEQUENCE platform.ai_usage_id_seq TO {{app_role}};
GRANT SELECT, INSERT ON platform.ai_cap_warnings TO {{app_role}};
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.org_stores TO {{app_role}};
