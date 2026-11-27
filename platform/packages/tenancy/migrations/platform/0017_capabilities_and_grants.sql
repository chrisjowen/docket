-- Capabilities and grants (tenancy v2, phase 2): access is a role on a place.
-- A role is a named bundle of capabilities - Reader, Writer and Admin built
-- in and fixed, plus the account's own - and a grant gives a user, a system
-- account or everyone in the account one role on the whole account or on one
-- docket, optionally adding or removing single capabilities for that grant
-- alone. This replaces both role systems: the per-org role and the account
-- role with its derived namespace grants. Owner and guest become flags on a
-- membership. Same ownership as 0001. Reverted by
-- 0017_capabilities_and_grants.down.sql.
--
-- The backfill keeps everyone's access as it is: owner -> the owner flag;
-- admin -> Admin on the account; editor (developer) -> Writer on the account;
-- viewer (read-only) -> Reader on the account; a guest's namespace grants ->
-- the same role on each of those dockets. A docket whose "ontology changes
-- over MCP" setting named a role gives each member of that role who writes
-- there "Writer + Publish ontology changes" on that docket. Before anything
-- old is dropped, every member's access to every live docket, and to the
-- account, is evaluated both ways and compared; any difference aborts the
-- migration.
--
-- Publishing the ontology becomes one capability on every surface: whoever
-- could publish in the web app (admins) or over MCP (the setting's roles)
-- holds it, and holds it on both.

CREATE TABLE platform.roles (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9_-]{1,64}$'),
  -- Null for the built-in roles, which every account has.
  org_id text REFERENCES platform.orgs (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  description text CHECK (description IS NULL OR length(description) <= 200),
  caps text[] NOT NULL CHECK (
    caps <@ ARRAY['read', 'write', 'propose', 'publish', 'decide', 'create', 'access', 'system', 'tokens', 'settings', 'delete', 'audit']
  ),
  created_by text REFERENCES platform.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((org_id IS NULL) = (id IN ('reader', 'writer', 'admin')))
);
CREATE UNIQUE INDEX roles_name ON platform.roles (coalesce(org_id, ''), lower(btrim(name)));
CREATE INDEX roles_org ON platform.roles (org_id);

INSERT INTO platform.roles (id, org_id, name, description, caps) VALUES
  ('reader', NULL, 'Reader', 'Reads and asks', ARRAY['read']),
  ('writer', NULL, 'Writer', 'Reads, writes knowledge and proposes ontology changes', ARRAY['read', 'write', 'propose']),
  ('admin', NULL, 'Admin', 'Every capability',
   ARRAY['read', 'write', 'propose', 'publish', 'decide', 'create', 'access', 'system', 'tokens', 'settings', 'delete', 'audit']);

-- The built-in roles are fixed: requests may change an account's own roles only.
CREATE FUNCTION platform.keep_builtin_roles() RETURNS trigger
  LANGUAGE plpgsql SET search_path = platform, pg_temp AS $$
BEGIN
  IF OLD.org_id IS NULL THEN
    RAISE EXCEPTION 'the built-in role % cannot be changed', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER roles_builtin BEFORE UPDATE OR DELETE ON platform.roles
  FOR EACH ROW EXECUTE FUNCTION platform.keep_builtin_roles();

-- One grant per grantee and place. `principal_id` null: everyone in the
-- account (its people who are not guests; never system accounts). A docket is
-- a workspace in the org's schema, by id; its grants go when its row does.
CREATE TABLE platform.grants (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  principal_id text,
  place_kind text NOT NULL CHECK (place_kind IN ('account', 'docket')),
  place_id text CHECK (place_id ~ '^[a-z0-9]{1,40}$'),
  role_id text NOT NULL REFERENCES platform.roles (id),
  add_caps text[] NOT NULL DEFAULT '{}' CHECK (
    add_caps <@ ARRAY['read', 'write', 'propose', 'publish', 'decide', 'create', 'access', 'system', 'tokens', 'settings', 'delete', 'audit']
  ),
  remove_caps text[] NOT NULL DEFAULT '{}' CHECK (
    remove_caps <@ ARRAY['read', 'write', 'propose', 'publish', 'decide', 'create', 'access', 'system', 'tokens', 'settings', 'delete', 'audit']
  ),
  granted_by text REFERENCES platform.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((place_kind = 'account') = (place_id IS NULL)),
  FOREIGN KEY (org_id, principal_id) REFERENCES platform.memberships (org_id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX grants_one_per_place ON platform.grants (org_id, coalesce(principal_id, ''), place_kind, coalesce(place_id, ''));
CREATE INDEX grants_principal ON platform.grants (principal_id);
CREATE INDEX grants_docket ON platform.grants (org_id, place_id) WHERE place_kind = 'docket';

-- A grant's role is a built-in one or one of its own account's.
CREATE FUNCTION platform.check_grant_role() RETURNS trigger
  LANGUAGE plpgsql SET search_path = platform, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.roles r WHERE r.id = NEW.role_id AND (r.org_id IS NULL OR r.org_id = NEW.org_id)) THEN
    RAISE EXCEPTION 'role % is not one of this account''s', NEW.role_id USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER grants_role BEFORE INSERT OR UPDATE OF role_id, org_id ON platform.grants
  FOR EACH ROW EXECUTE FUNCTION platform.check_grant_role();

ALTER TABLE platform.memberships
  ADD COLUMN owner boolean NOT NULL DEFAULT false,
  ADD COLUMN guest boolean NOT NULL DEFAULT false;

-- --- Backfill -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.tier(permission text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE permission WHEN 'admin' THEN 3 WHEN 'write' THEN 2 WHEN 'read' THEN 1 ELSE 0 END
$$;
CREATE OR REPLACE FUNCTION pg_temp.role_of_tier(tier integer) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE tier WHEN 3 THEN 'admin' WHEN 2 THEN 'writer' WHEN 1 THEN 'reader' END
$$;

UPDATE platform.memberships SET owner = (role = 'owner'), guest = (account_role = 'guest');

-- Admins, developers and read-only members: their role on the whole account.
INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id, created_at)
SELECT 'g_' || gen_random_uuid(), m.org_id, m.user_id, 'account', NULL,
       CASE m.account_role WHEN 'admin' THEN 'admin' WHEN 'developer' THEN 'writer' ELSE 'reader' END, m.created_at
  FROM platform.memberships m
 WHERE m.account_role IN ('admin', 'developer', 'read_only');

-- Any namespace grant above what the account grant gives - every grant a
-- guest holds - becomes the same role on that docket. A provisioner reached no
-- namespace, whatever it was granted, so it keeps none.
INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id, created_at)
SELECT 'g_' || gen_random_uuid(), g.org_id, g.principal_id, 'docket', g.namespace_id, pg_temp.role_of_tier(pg_temp.tier(g.permission)), g.created_at
  FROM platform.namespace_grants g
  JOIN platform.memberships m ON m.org_id = g.org_id AND m.user_id = g.principal_id
 WHERE m.account_role NOT IN ('owner', 'admin', 'provisioner')
   AND pg_temp.tier(g.permission) > pg_temp.tier(CASE m.account_role WHEN 'developer' THEN 'write' WHEN 'read_only' THEN 'read' END);

-- Ontology changes over MCP: each member of a role a docket's setting names,
-- who writes there, gets Writer + Publish ontology changes on that docket.
-- Admins publish already. An org whose schema predates the setting has none.
DO $$
DECLARE
  org record;
  workspaces regclass;
BEGIN
  FOR org IN SELECT id FROM platform.orgs LOOP
    workspaces := to_regclass(format('%I.workspaces', 'org_' || org.id));
    CONTINUE WHEN workspaces IS NULL;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'org_' || org.id AND table_name = 'workspaces' AND column_name = 'ontology_mcp_roles');
    EXECUTE format(
      'INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id, add_caps)
       SELECT ''g_'' || gen_random_uuid(), $1, m.user_id, ''docket'', w.id, ''writer'', ARRAY[''publish'']
         FROM %s w
         JOIN platform.memberships m ON m.org_id = $1 AND m.role = ANY (w.ontology_mcp_roles)
         JOIN platform.namespace_grants g ON g.org_id = $1 AND g.principal_id = m.user_id AND g.namespace_id = w.id
        WHERE w.deleted_at IS NULL AND g.permission = ''write'' AND m.account_role NOT IN (''owner'', ''admin'', ''provisioner'')
       ON CONFLICT (org_id, coalesce(principal_id, ''''), place_kind, coalesce(place_id, ''''))
       DO UPDATE SET add_caps = ARRAY[''publish'']',
      workspaces)
    USING org.id;
  END LOOP;
END
$$;

-- --- Dual evaluation ----------------------------------------------------------
-- Every member's access to every live docket, and to the account, the old way
-- and the new way. The old way: an owner or admin is admin on every docket; a
-- provisioner reaches none; anyone else has their namespace grant there; and
-- publishing needs admin there, or write there and a role the docket's MCP
-- setting names. The new way: the owner flag, or the best role among the
-- grants covering the docket, and Publish when that is Admin or a grant adds
-- it. Any difference stops the migration before anything old is dropped.
CREATE TEMPORARY TABLE access_compared (org_id text, user_id text, place text, old_access text, new_access text) ON COMMIT DROP;

DO $$
DECLARE
  org record;
  workspaces regclass;
  has_setting boolean;
  differences integer;
  example record;
BEGIN
  FOR org IN SELECT id FROM platform.orgs LOOP
    workspaces := to_regclass(format('%I.workspaces', 'org_' || org.id));
    CONTINUE WHEN workspaces IS NULL;
    has_setting := EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'org_' || org.id AND table_name = 'workspaces' AND column_name = 'ontology_mcp_roles');
    EXECUTE format(
      'INSERT INTO access_compared (org_id, user_id, place, old_access, new_access)
       SELECT $1, m.user_id, w.id,
              concat_ws(''/'', old.tier, CASE WHEN old.tier = 3 OR (old.tier = 2 AND m.role = ANY (%s)) THEN ''publish'' END),
              concat_ws(''/'', new.tier, CASE WHEN new.tier = 3 OR new.publish THEN ''publish'' END)
         FROM %s w
         JOIN platform.memberships m ON m.org_id = $1
         CROSS JOIN LATERAL (
           SELECT CASE
                    WHEN m.account_role IN (''owner'', ''admin'') THEN 3
                    WHEN m.account_role = ''provisioner'' THEN 0
                    ELSE coalesce((SELECT pg_temp.tier(g.permission) FROM platform.namespace_grants g
                                    WHERE g.org_id = $1 AND g.principal_id = m.user_id AND g.namespace_id = w.id), 0)
                  END AS tier
         ) old
         CROSS JOIN LATERAL (
           SELECT CASE WHEN m.owner THEN 3
                       ELSE coalesce(max(CASE n.role_id WHEN ''admin'' THEN 3 WHEN ''writer'' THEN 2 WHEN ''reader'' THEN 1 END), 0) END AS tier,
                  coalesce(bool_or(''publish'' = ANY (n.add_caps)), false) AS publish
             FROM platform.grants n
            WHERE n.org_id = $1 AND n.principal_id = m.user_id
              AND (n.place_kind = ''account'' OR n.place_id = w.id)
         ) new
        WHERE w.deleted_at IS NULL',
      CASE WHEN has_setting THEN 'w.ontology_mcp_roles' ELSE 'ARRAY[]::text[]' END, workspaces)
    USING org.id;
  END LOOP;

  -- The account itself: what each member may do across it, by their per-org role.
  INSERT INTO access_compared (org_id, user_id, place, old_access, new_access)
  SELECT m.org_id, m.user_id, 'account', m.role,
         CASE WHEN m.owner THEN 'owner'
              ELSE (SELECT CASE n.role_id WHEN 'admin' THEN 'admin' WHEN 'writer' THEN 'editor' WHEN 'reader' THEN 'viewer' END
                      FROM platform.grants n
                     WHERE n.org_id = m.org_id AND n.principal_id = m.user_id AND n.place_kind = 'account') END
    FROM platform.memberships m
   WHERE m.account_role NOT IN ('guest', 'provisioner');

  SELECT count(*) INTO differences FROM access_compared WHERE old_access IS DISTINCT FROM new_access;
  IF differences > 0 THEN
    SELECT * INTO example FROM access_compared WHERE old_access IS DISTINCT FROM new_access LIMIT 1;
    RAISE EXCEPTION 'grants backfill would change % access decisions (for example org %, member %, on %: % became %)',
      differences, example.org_id, example.user_id, example.place, example.old_access, example.new_access
      USING ERRCODE = '23514';
  END IF;
END
$$;

-- --- The old model goes ---------------------------------------------------------

DROP FUNCTION pg_temp.tier(text), pg_temp.role_of_tier(integer);

DROP TRIGGER memberships_namespace_grants ON platform.memberships;
DROP FUNCTION platform.grant_member_namespaces();
DROP TRIGGER memberships_account_role ON platform.memberships;
DROP FUNCTION platform.derive_account_role();
-- With every org's trigger that granted a new workspace to its members.
DROP FUNCTION platform.grant_namespace_members() CASCADE;
DROP FUNCTION platform.derived_grant(text);

-- With every org's trigger that dropped a deleted workspace's namespace
-- grants: org 0019 attaches this one in its place, before the org is served
-- again. Org 0016 and 0017, superseded here, are recorded but no longer run on
-- an org that does not have them yet.
DROP FUNCTION platform.drop_namespace_grants() CASCADE;

-- Drops a deleted docket's grants. Org schemas attach it to their workspaces
-- table with the org id as its argument; it runs as its owner, so an org role
-- needs no privilege on the platform schema.
CREATE FUNCTION platform.drop_docket_grants() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $$
BEGIN
  DELETE FROM platform.grants WHERE org_id = TG_ARGV[0] AND place_kind = 'docket' AND place_id = OLD.id;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION platform.drop_docket_grants() FROM PUBLIC;

-- A database's system account, as platform 0014 made it, with its grant in
-- the new shape: a guest holding Writer or Reader on that one docket.
CREATE OR REPLACE FUNCTION platform.database_account(org text, namespace text, level text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $$
DECLARE
  account text;
BEGIN
  IF level IS NULL OR level NOT IN ('write', 'read') THEN
    RAISE EXCEPTION 'a database account is write or read, not %', level USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('docket-cloud:database-account:' || org || ':' || namespace));
  SELECT user_id INTO account FROM platform.database_accounts
   WHERE org_id = org AND namespace_id = namespace AND permission = level;
  IF account IS NOT NULL THEN
    RETURN account;
  END IF;
  account := gen_random_uuid()::text;
  INSERT INTO platform.users (id, kind, login, service_org_id, description, created_by)
  SELECT account, 'service', format('org-admin/%s/%s', namespace, level), org,
         format('Owns the %s keys the org admin API issues for one database.', level), o.org_admin_id
    FROM platform.orgs o WHERE o.id = org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no organisation %', org USING ERRCODE = '23503';
  END IF;
  INSERT INTO platform.memberships (org_id, user_id, guest) VALUES (org, account, true);
  INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id)
  VALUES ('g_' || gen_random_uuid(), org, account, 'docket', namespace, CASE level WHEN 'write' THEN 'writer' ELSE 'reader' END);
  INSERT INTO platform.database_accounts (org_id, namespace_id, permission, user_id)
  VALUES (org, namespace, level, account);
  RETURN account;
END
$$;

DROP TABLE platform.namespace_grants;
ALTER TABLE platform.memberships DROP COLUMN account_role, DROP COLUMN role;

-- Invites carry a role on a place: what the person gets when they accept.
-- An open owner invite stays one.
ALTER TABLE platform.invites
  ADD COLUMN role_id text REFERENCES platform.roles (id),
  ADD COLUMN place_kind text NOT NULL DEFAULT 'account' CHECK (place_kind IN ('account', 'docket')),
  ADD COLUMN place_id text CHECK (place_id ~ '^[a-z0-9]{1,40}$'),
  ADD COLUMN owner boolean NOT NULL DEFAULT false,
  ADD COLUMN guest boolean NOT NULL DEFAULT false,
  ADD CHECK ((place_kind = 'account') = (place_id IS NULL));
UPDATE platform.invites SET
  owner = (role = 'owner'),
  role_id = CASE role WHEN 'owner' THEN 'admin' WHEN 'admin' THEN 'admin' WHEN 'editor' THEN 'writer' ELSE 'reader' END;
ALTER TABLE platform.invites ALTER COLUMN role_id SET NOT NULL, ALTER COLUMN place_kind DROP DEFAULT, DROP COLUMN role;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.roles TO {{app_role}};
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.grants TO {{app_role}};
