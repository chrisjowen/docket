-- Reverts platform 0019, for rolling back to a build before storage and AI
-- per space. Run by hand as the migration owner, in one transaction, with
-- {{app_role}} replaced by the request role; the runner never applies it.
-- The account's model choices go back to ai_caps.models, and the account's
-- stores back to org_stores. What spaces and dockets chose for themselves,
-- spaces' own keys, and spaces' and dockets' own stores are dropped: every
-- docket goes back to the account's models, key and stores. Remove a space's
-- own Neo4j pod and a docket's own Qdrant collection by hand (they are named
-- `neo4j-<store id>` and `org_<org>__ws_<docket>`), and reproject the dockets
-- that used them.

ALTER TABLE platform.ai_caps ADD COLUMN models jsonb NOT NULL DEFAULT '{}';
INSERT INTO platform.ai_caps (org_id, monthly_usd, models, updated_by, updated_at)
SELECT s.org_id, 20, s.models, s.updated_by, s.updated_at
  FROM platform.ai_settings s
 WHERE s.place_kind = 'account' AND s.models <> '{}'
ON CONFLICT (org_id) DO UPDATE SET models = EXCLUDED.models;

CREATE TABLE platform.org_stores (
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  store text NOT NULL CHECK (store IN ('neo4j', 'qdrant')),
  status text NOT NULL CHECK (status IN ('provisioning', 'ready', 'suspended', 'failed')),
  target text,
  credentials_secret text,
  last_error text,
  used_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, store)
);
INSERT INTO platform.org_stores (org_id, store, status, target, credentials_secret, last_error, used_at, updated_at)
SELECT org_id, kind, CASE WHEN status IN ('requested', 'retiring') THEN 'provisioning' ELSE status END,
       target, credentials_secret, last_error, used_at, updated_at
  FROM platform.stores
 WHERE space_id IS NULL AND docket_id IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.org_stores TO {{app_role}};

DROP TABLE platform.docket_stores;
DROP TABLE platform.stores;
DROP TABLE platform.provider_keys;
DROP TABLE platform.ai_settings;

DELETE FROM platform.schema_migrations WHERE schema_name = 'platform' AND version = 19;
