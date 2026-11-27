-- System accounts, tokens and named connections (tenancy v2, phase 1.2-1.5).
-- A token or an OAuth connection acts as its owner, and can only be narrowed:
-- read-only, and/or to some dockets. There are no scopes to choose. Same
-- ownership as 0001.

-- API tokens: `read_only`, and `dockets` (null: every docket the owner
-- reaches). Each token keeps the one docket it was bound to. A token whose
-- scopes say exactly what read-only or full access says drops them; any other
-- keeps them as `legacy_scopes`, a ceiling read-only and dockets cannot
-- express (a write token that could not propose, say), so no token gains
-- anything here. Personal tokens last at most 90 days and system accounts'
-- at most a year; the server holds each kind to its own limit.
ALTER TABLE platform.api_tokens
  ADD COLUMN read_only boolean NOT NULL DEFAULT false,
  ADD COLUMN dockets text[] CHECK (dockets IS NULL OR cardinality(dockets) > 0);
ALTER TABLE platform.api_tokens RENAME COLUMN scopes TO legacy_scopes;
ALTER TABLE platform.api_tokens DROP CONSTRAINT api_tokens_scopes_check;
ALTER TABLE platform.api_tokens ALTER COLUMN legacy_scopes DROP NOT NULL;
ALTER TABLE platform.api_tokens ADD CONSTRAINT api_tokens_legacy_scopes_check CHECK (
  legacy_scopes IS NULL OR (
    cardinality(legacy_scopes) > 0
    AND legacy_scopes <@ ARRAY['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write']
  )
);
ALTER TABLE platform.api_tokens DROP CONSTRAINT api_tokens_check;
ALTER TABLE platform.api_tokens ADD CONSTRAINT api_tokens_expires_at_check CHECK (expires_at <= created_at + interval '366 days');

UPDATE platform.api_tokens
   SET read_only = NOT (legacy_scopes && ARRAY['docket:write', 'ontology:propose', 'ontology:write']),
       dockets = ARRAY[workspace_id];
UPDATE platform.api_tokens SET legacy_scopes = NULL
 WHERE (read_only AND 'docket:read' = ANY (legacy_scopes))
    OR legacy_scopes @> ARRAY['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write'];

DROP INDEX platform.api_tokens_workspace;
ALTER TABLE platform.api_tokens DROP COLUMN workspace_id;
CREATE INDEX api_tokens_org ON platform.api_tokens (org_id, created_at DESC);
CREATE INDEX api_tokens_dockets ON platform.api_tokens USING gin (dockets);

-- Named connections: every OAuth sign-in is one, owned by the user who
-- approved it, named at consent ("Claude Code - work laptop"), and narrowed
-- like a token. It is the authorization server's grant (`oauth_store`), by id;
-- revoking it removes the grant with every access and refresh token under it.
CREATE TABLE platform.oauth_connections (
  grant_id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES platform.users (id) ON DELETE CASCADE,
  client_id text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  read_only boolean NOT NULL DEFAULT false,
  -- Null: every docket of the account its owner reaches.
  dockets text[] CHECK (dockets IS NULL OR cardinality(dockets) > 0),
  legacy_scopes text[] CHECK (
    legacy_scopes IS NULL OR (
      cardinality(legacy_scopes) > 0
      AND legacy_scopes <@ ARRAY['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write']
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX oauth_connections_user ON platform.oauth_connections (org_id, user_id, created_at DESC);
CREATE INDEX oauth_connections_dockets ON platform.oauth_connections USING gin (dockets);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.oauth_connections TO {{app_role}};

-- Every live grant becomes a connection, named after its client, on the one
-- docket its resource names, with its scopes kept as a ceiling unless read-only
-- or full access says exactly the same. A grant whose account or docket is
-- gone is left alone: it reaches nothing.
DO $$
DECLARE
  grant_row record;
  named text[];
  org text;
  docket text;
  workspaces regclass;
  scopes text[];
  writes boolean;
BEGIN
  FOR grant_row IN
    SELECT g.grant_id, g.account_id, g.client_id, g.resource, g.payload,
           (SELECT c.payload->>'client_name' FROM platform.oauth_store c
             WHERE c.model = 'Client' AND c.client_id = g.client_id LIMIT 1) AS client_name
      FROM platform.oauth_store g
     WHERE g.model = 'Grant' AND g.grant_id IS NOT NULL AND g.account_id IS NOT NULL AND g.client_id IS NOT NULL
       AND g.resource IS NOT NULL AND (g.expires_at IS NULL OR g.expires_at > now())
  LOOP
    named := regexp_match(grant_row.resource, '/mcp/([a-z0-9-]{1,40})/([a-z0-9-]{1,40})$');
    CONTINUE WHEN named IS NULL;
    SELECT o.id INTO org FROM platform.orgs o
     WHERE o.slug = named[1]
       AND EXISTS (SELECT 1 FROM platform.users u WHERE u.id = grant_row.account_id);
    CONTINUE WHEN org IS NULL;
    workspaces := to_regclass(format('%I.workspaces', 'org_' || org));
    CONTINUE WHEN workspaces IS NULL;
    EXECUTE format('SELECT w.id FROM %s w WHERE w.slug = $1 AND w.deleted_at IS NULL', workspaces) INTO docket USING named[2];
    CONTINUE WHEN docket IS NULL;
    scopes := ARRAY(
      SELECT s FROM unnest(string_to_array(coalesce(grant_row.payload->'resources'->>grant_row.resource, ''), ' ')) AS s
       WHERE s IN ('docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write')
    );
    CONTINUE WHEN cardinality(scopes) = 0;
    writes := scopes && ARRAY['docket:write', 'ontology:propose', 'ontology:write'];
    INSERT INTO platform.oauth_connections (grant_id, org_id, user_id, client_id, name, read_only, dockets, legacy_scopes)
    VALUES (
      grant_row.grant_id, org, grant_row.account_id, grant_row.client_id,
      left(coalesce(nullif(btrim(regexp_replace(grant_row.client_name, '[[:cntrl:]]+', ' ', 'g')), ''), grant_row.client_id), 80),
      NOT writes, ARRAY[docket],
      CASE WHEN (NOT writes AND 'docket:read' = ANY (scopes))
             OR scopes @> ARRAY['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write']
           THEN NULL ELSE scopes END
    )
    ON CONFLICT (grant_id) DO NOTHING;
  END LOOP;
END
$$;

-- No one acts for a system account (tenancy v2 §3.3): its writes are its own,
-- and evidence it files must cite a source. The column stays for the record.
UPDATE platform.users SET accountable_user_id = NULL WHERE kind = 'service';
