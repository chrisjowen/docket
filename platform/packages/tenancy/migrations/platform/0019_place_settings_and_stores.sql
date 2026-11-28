-- Storage and AI per space (tenancy v2, phase 5). Settings now resolve
-- account -> space -> docket: an account's defaults, a space's alternatives,
-- a docket's own choice. Same ownership as 0001.
--
-- Nothing an existing docket resolves to changes here: the account's model
-- choices move out of ai_caps.models unchanged, no space has a key of its
-- own yet, and every docket that exists is pinned to the stores it projects
-- into now - the account's Neo4j and the account's shared Qdrant collection.

-- --- Settings per place ----------------------------------------------------------

-- The models a place chose for each use ({ "cypher": "...", "synthesis": "..." }),
-- the models the places inside it may choose from (the same shape, a list per
-- use; none: whatever this place may), and a space's slice of the account's
-- monthly AI cap. A higher place's list limits every place below it.
CREATE TABLE platform.ai_settings (
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  place_kind text NOT NULL CHECK (place_kind IN ('account', 'space', 'docket')),
  -- '' for the account.
  place_id text NOT NULL DEFAULT '',
  models jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(models) = 'object'),
  allowed jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(allowed) = 'object'),
  monthly_usd numeric(10, 2) CHECK (monthly_usd >= 0),
  updated_by text REFERENCES platform.users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, place_kind, place_id),
  CHECK ((place_kind = 'account') = (place_id = '')),
  CHECK (monthly_usd IS NULL OR place_kind = 'space')
);

INSERT INTO platform.ai_settings (org_id, place_kind, place_id, models, updated_by, updated_at)
SELECT org_id, 'account', '', models, updated_by, updated_at FROM platform.ai_caps WHERE models <> '{}';

ALTER TABLE platform.ai_caps DROP COLUMN models;

-- --- Provider keys per space -------------------------------------------------------

-- A space's own model key: OpenRouter, Anthropic or OpenAI. Sealed with the
-- org's data key, bound to the org, the space and the provider; only the
-- last four characters are ever shown again. Without one, the space's calls
-- go on the account's key, as before.
CREATE TABLE platform.provider_keys (
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  space_id text NOT NULL CHECK (space_id ~ '^[a-z0-9]{1,40}$'),
  provider text NOT NULL CHECK (provider IN ('openrouter', 'anthropic', 'openai')),
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  dek_version integer NOT NULL,
  hint text NOT NULL CHECK (length(hint) BETWEEN 1 AND 4),
  created_by text REFERENCES platform.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, space_id)
);

-- --- Stores ---------------------------------------------------------------------------

-- Every Neo4j instance and Qdrant collection an org's dockets project into:
-- the account's own (no space, no docket), a space's own Neo4j instance, or
-- one docket's Qdrant collection. `target` is where to connect, never a
-- credential; `credentials_secret` the k8s Secret that holds them.
CREATE TABLE platform.stores (
  id text PRIMARY KEY CHECK (id ~ '^st[a-z0-9]{8,30}$'),
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('neo4j', 'qdrant')),
  space_id text,
  docket_id text,
  -- requested: asked for from a space's Settings, not provisioned yet;
  -- retiring: its dockets go back to the account's store, then it is removed.
  status text NOT NULL CHECK (status IN ('requested', 'provisioning', 'ready', 'suspended', 'failed', 'retiring')),
  target text,
  credentials_secret text,
  last_error text,
  -- When a projection or a query last used the store; idle Neo4j pods are suspended.
  used_at timestamptz,
  requested_by text REFERENCES platform.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (space_id IS NULL OR docket_id IS NULL),
  CHECK (kind = 'neo4j' OR space_id IS NULL),
  CHECK (kind = 'qdrant' OR docket_id IS NULL)
);
CREATE UNIQUE INDEX stores_owner ON platform.stores (org_id, kind, coalesce(space_id, ''), coalesce(docket_id, ''));

-- Which store each docket projects into, for each kind: what the worker opens
-- for a projection, a search or a purge. A docket without one is new, and the
-- worker gives it one: its space's own Neo4j or the account's, and a Qdrant
-- collection of its own.
CREATE TABLE platform.docket_stores (
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  docket_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('neo4j', 'qdrant')),
  store_id text NOT NULL REFERENCES platform.stores (id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, docket_id, kind)
);
CREATE INDEX docket_stores_store ON platform.docket_stores (store_id);

-- The account's stores, as the worker last provisioned them.
INSERT INTO platform.stores (id, org_id, kind, status, target, credentials_secret, last_error, used_at, updated_at)
SELECT 'st' || left(replace(gen_random_uuid()::text, '-', ''), 16), org_id, store, status, target, credentials_secret, last_error, used_at, updated_at
  FROM platform.org_stores;

-- Every docket that exists stays where it is: the account's Neo4j and the
-- account's shared Qdrant collection, made now for an org the worker has not
-- reached yet so the docket is pinned to it all the same.
DO $$
DECLARE
  org record;
  workspaces regclass;
  store_kind text;
BEGIN
  FOR org IN SELECT id FROM platform.orgs LOOP
    workspaces := to_regclass(format('%I.workspaces', 'org_' || org.id));
    CONTINUE WHEN workspaces IS NULL;
    FOREACH store_kind IN ARRAY ARRAY['neo4j', 'qdrant'] LOOP
      INSERT INTO platform.stores (id, org_id, kind, status)
      SELECT 'st' || left(replace(gen_random_uuid()::text, '-', ''), 16), org.id, store_kind, 'provisioning'
       WHERE NOT EXISTS (
         SELECT 1 FROM platform.stores s WHERE s.org_id = org.id AND s.kind = store_kind AND s.space_id IS NULL AND s.docket_id IS NULL);
    END LOOP;
    EXECUTE format(
      'INSERT INTO platform.docket_stores (org_id, docket_id, kind, store_id)
       SELECT $1, w.id, s.kind, s.id FROM %s w
         JOIN platform.stores s ON s.org_id = $1 AND s.space_id IS NULL AND s.docket_id IS NULL',
      workspaces)
    USING org.id;
  END LOOP;
END
$$;

DROP TABLE platform.org_stores;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.ai_settings TO {{app_role}};
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.provider_keys TO {{app_role}};
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.stores TO {{app_role}};
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.docket_stores TO {{app_role}};
